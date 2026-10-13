import { describe, expect, it } from "vitest";
import { emptyBlock, moveBlock, textToBlocks, toPayloadBlocks, withKeys } from "./blocks";

describe("testimony editor blocks", () => {
  it("turns pasted text into paragraphs and '# ' headings", () => {
    expect(textToBlocks("# The beginning\n\nFirst para\nstill first\n\n\n  Second  ")).toEqual([
      { type: "heading", text: "The beginning" },
      { type: "paragraph", text: "First para\nstill first" },
      { type: "paragraph", text: "Second" },
    ]);
  });

  it("moves blocks within bounds", () => {
    expect(moveBlock(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveBlock(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    const list = ["a", "b"];
    expect(moveBlock(list, 0, -1)).toBe(list);
    expect(moveBlock(list, 1, 1)).toBe(list);
  });

  it("strips editor-only fields and drops empty or unfinished blocks for the strict API schema", () => {
    const blocks = [
      ...withKeys([
        { type: "heading", text: "  Title  " },
        { type: "paragraph", text: "   " },
        { type: "quote", text: "Verse", cite: "  " },
        { type: "image", mediaId: "m1", caption: "", url: "https://cdn/x.webp", width: 10, height: 10 },
      ]),
      emptyBlock("image"), // never uploaded
    ];
    expect(toPayloadBlocks(blocks)).toEqual([
      { type: "heading", text: "Title" },
      { type: "quote", text: "Verse", cite: null },
      { type: "image", mediaId: "m1", caption: null },
    ]);
  });

  it("gives every block a unique key", () => {
    const keys = withKeys([{ type: "paragraph", text: "a" }, { type: "paragraph", text: "b" }]).map((b) => b.key);
    expect(new Set([...keys, emptyBlock("heading").key]).size).toBe(3);
  });
});
