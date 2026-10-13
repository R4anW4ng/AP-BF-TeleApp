import { describe, expect, it } from "vitest";
import { textToBlocks } from "./AdminPage";

describe("textToBlocks", () => {
  it("splits paragraphs on blank lines and turns '# ' lines into headings", () => {
    expect(textToBlocks("# The beginning\n\nFirst para\nstill first\n\n\n  Second  ")).toEqual([
      { type: "heading", text: "The beginning" },
      { type: "paragraph", text: "First para\nstill first" },
      { type: "paragraph", text: "Second" },
    ]);
  });
});
