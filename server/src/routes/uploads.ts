import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../db.js";
import { currentUser, HttpError } from "../lib/http.js";
import { MAX_UPLOAD_BYTES, newStorageKey, processImage, type Storage } from "../lib/storage.js";
import { userLimiter } from "../middleware/rateLimit.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 },
});

const KindSchema = z.enum(["LIVING_POST", "TESTIMONY"]).default("LIVING_POST");

/**
 * POST /api/uploads?kind=LIVING_POST   (multipart/form-data, field "image")
 *
 * The image is decoded and re-encoded server-side (see processImage), stored
 * in R2, and recorded as an unattached Media row owned by the uploader. The
 * returned id is then sent with the post/testimony that uses it.
 */
export function uploadsRouter({ storage }: { storage: Storage }): Router {
  const router = Router();

  // Fail before reading the body if there is nowhere to put it.
  router.use((_req, _res, next) => {
    if (!storage.configured) throw new HttpError(503, "STORAGE_UNAVAILABLE", "Photo uploads are not configured on this server");
    next();
  });

  router.post("/", userLimiter(60 * 60_000, 30), upload.single("image"), async (req, res) => {
    const user = currentUser(req);
    const kind = KindSchema.parse(req.query.kind);
    if (kind === "TESTIMONY" && user.role !== "ADMIN") {
      throw new HttpError(403, "FORBIDDEN", "Only admins can upload testimony images");
    }
    if (!req.file) throw new HttpError(400, "BAD_UPLOAD", 'Attach an image in the "image" field');

    const image = await processImage(req.file.buffer);
    const storageKey = newStorageKey(kind);
    await storage.putObject(storageKey, image.body, image.contentType);

    const media = await prisma.media.create({
      data: {
        kind,
        storageKey,
        mimeType: image.contentType,
        sizeBytes: image.body.length,
        width: image.width,
        height: image.height,
        uploaderId: user.id,
      },
    });

    res.status(201).json({
      id: media.id,
      url: await storage.urlFor(storageKey),
      width: media.width,
      height: media.height,
    });
  });

  return router;
}
