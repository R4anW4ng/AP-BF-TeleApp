import type { TestimonyBlock } from "../api/types";

/** A block in the editor: the API shape plus a stable key for React lists. */
export type EditorBlock = TestimonyBlock & { key: string };

let counter = 0;
const newKey = () => `b${++counter}`;

export function emptyBlock(type: TestimonyBlock["type"]): EditorBlock {
  switch (type) {
    case "heading":
    case "paragraph":
      return { key: newKey(), type, text: "" };
    case "quote":
      return { key: newKey(), type, text: "", cite: null };
    case "image":
      return { key: newKey(), type, mediaId: "", caption: null, url: null };
  }
}

export function withKeys(blocks: TestimonyBlock[]): EditorBlock[] {
  return blocks.map((b) => ({ ...b, key: newKey() }));
}

/** Move item `i` one place up (-1) or down (+1); out-of-range moves are no-ops. */
export function moveBlock<T>(list: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (i < 0 || i >= list.length || j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Pasted story text → blocks: blank lines separate paragraphs; a line starting with "# " is a heading. */
export function textToBlocks(body: string): TestimonyBlock[] {
  return body
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => (chunk.startsWith("# ") ? { type: "heading", text: chunk.slice(2).trim() } : { type: "paragraph", text: chunk }));
}

/**
 * What the API accepts: no editor keys or resolved image URLs (the server's
 * schema is strict), empty text blocks and images that never finished uploading dropped.
 */
export function toPayloadBlocks(blocks: EditorBlock[]): TestimonyBlock[] {
  const out: TestimonyBlock[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "heading":
      case "paragraph":
        if (b.text.trim()) out.push({ type: b.type, text: b.text.trim() });
        break;
      case "quote":
        if (b.text.trim()) out.push({ type: "quote", text: b.text.trim(), cite: b.cite?.trim() || null });
        break;
      case "image":
        if (b.mediaId) out.push({ type: "image", mediaId: b.mediaId, caption: b.caption?.trim() || null });
        break;
    }
  }
  return out;
}
