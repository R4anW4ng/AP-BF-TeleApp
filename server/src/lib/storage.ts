import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import multer from "multer";
import sharp from "sharp";
import type { StorageConfig } from "../config.js";
import type { MediaKind } from "../generated/prisma/client.js";
import { HttpError } from "./http.js";

/**
 * Object storage behind an interface so routes don't depend on S3 directly
 * (and tests can use the in-memory version).
 */
export interface Storage {
  /** False when no bucket credentials are configured. */
  readonly configured: boolean;
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
  /** URL the Mini App can load the object from. */
  urlFor(key: string): Promise<string>;
}

const PRESIGNED_URL_TTL_SECONDS = 60 * 60;

/** Cloudflare R2 (or any S3-compatible service: AWS S3, Backblaze B2, MinIO). */
export function createS3Storage(cfg: StorageConfig): Storage {
  const client = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    // R2 and MinIO need path-style addressing.
    forcePathStyle: true,
    // Newer SDKs add CRC checksums to every request by default; R2 and other
    // S3-compatible services don't all accept them, so only send when required.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

  return {
    configured: true,
    async putObject(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: cfg.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          // Keys are random UUIDs and never reused, so the content is immutable.
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
    },
    async deleteObject(key) {
      await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
    },
    async urlFor(key) {
      if (cfg.publicBaseUrl) return `${cfg.publicBaseUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;
      return getSignedUrl(client, new GetObjectCommand({ Bucket: cfg.bucket, Key: key }), {
        expiresIn: PRESIGNED_URL_TTL_SECONDS,
      });
    },
  };
}

/** Used when no S3 credentials are configured: uploads fail with 503, everything else works. */
export function createUnconfiguredStorage(): Storage {
  const fail = async (): Promise<never> => {
    throw new HttpError(503, "STORAGE_UNAVAILABLE", "Photo uploads are not configured on this server");
  };
  return { configured: false, putObject: fail, deleteObject: fail, urlFor: fail };
}

/** In-memory storage for tests. */
export function createMemoryStorage(): Storage & { objects: Map<string, { body: Buffer; contentType: string }> } {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  return {
    configured: true,
    objects,
    async putObject(key, body, contentType) {
      objects.set(key, { body, contentType });
    },
    async deleteObject(key) {
      objects.delete(key);
    },
    async urlFor(key) {
      return `memory://${key}`;
    },
  };
}

// -----------------------------------------------------------------------------
//  Image processing
// -----------------------------------------------------------------------------

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGES_PER_POST = 4;

/** Multipart parser for image uploads: kept in memory, then re-encoded by processImage. */
export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: MAX_IMAGES_PER_POST, fields: 10 },
});
const MAX_INPUT_PIXELS = 50_000_000;
const MAX_DIMENSION = 1600;
const ACCEPTED_FORMATS = new Set(["jpeg", "png", "webp", "gif", "avif", "heif"]);

export interface ProcessedImage {
  body: Buffer;
  contentType: "image/webp";
  width: number;
  height: number;
}

/**
 * Decode, auto-rotate, downscale and re-encode an uploaded image as WebP.
 *
 * Re-encoding means we only ever store pixels we produced ourselves, so a file
 * that merely claims to be an image is rejected. It also strips all metadata,
 * including EXIF GPS coordinates that phone cameras embed, which would
 * otherwise reveal where members live.
 */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  let format: string | undefined;
  try {
    format = (await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata()).format;
  } catch {
    throw new HttpError(415, "UNSUPPORTED_MEDIA", "That file is not a readable image");
  }
  if (!format || !ACCEPTED_FORMATS.has(format)) {
    throw new HttpError(415, "UNSUPPORTED_MEDIA", "Please upload a JPEG, PNG, WebP or HEIC photo");
  }

  try {
    const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate() // apply EXIF orientation before metadata is dropped
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    return { body: data, contentType: "image/webp", width: info.width, height: info.height };
  } catch {
    throw new HttpError(415, "UNSUPPORTED_MEDIA", "That image could not be processed");
  }
}

/** e.g. "living-post/2026/10/3f6c…e1.webp" */
export function newStorageKey(kind: MediaKind, now: Date = new Date()): string {
  const prefix = kind.toLowerCase().replace(/_/g, "-");
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${prefix}/${now.getUTCFullYear()}/${month}/${randomUUID()}.webp`;
}

/** Re-encode and store several images; if any step fails, nothing is left behind in the bucket. */
export async function storeImages(storage: Storage, kind: MediaKind, files: Buffer[]) {
  const images = await Promise.all(files.map((f) => processImage(f)));
  const stored = images.map((img) => ({ ...img, storageKey: newStorageKey(kind) }));
  const results = await Promise.allSettled(stored.map((s) => storage.putObject(s.storageKey, s.body, s.contentType)));
  const failure = results.find((r) => r.status === "rejected");
  if (failure) {
    await deleteObjects(storage, stored.map((s) => s.storageKey));
    throw failure.reason;
  }
  return stored;
}

/** Best-effort cleanup: an object we fail to delete is an orphaned blob, never a broken post. */
export async function deleteObjects(storage: Storage, keys: string[]): Promise<void> {
  if (!storage.configured || keys.length === 0) return;
  await Promise.allSettled(keys.map((k) => storage.deleteObject(k)));
}

/** URL for a stored object, or null when storage isn't configured. */
export async function mediaUrl(storage: Storage, key: string): Promise<string | null> {
  return storage.configured ? storage.urlFor(key) : null;
}
