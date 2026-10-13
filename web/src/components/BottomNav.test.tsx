import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { BottomNav } from "./BottomNav";

const renderNav = (isAdmin: boolean, path = "/") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <BottomNav isAdmin={isAdmin} />
    </MemoryRouter>,
  );

describe("BottomNav", () => {
  it("links the 5 primary tabs", () => {
    renderNav(false);
    const links = screen.getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/", "/prayer", "/living", "/testimonies", "/me"]);
  });

  it("hides the Admin tab from regular users", () => {
    renderNav(false);
    expect(screen.queryByRole("link", { name: /admin/i })).toBeNull();
  });

  it("shows the Admin tab to admins", () => {
    renderNav(true);
    expect(screen.getByRole("link", { name: /admin/i }).getAttribute("href")).toBe("/admin");
  });

  it("marks the current tab active", () => {
    renderNav(false, "/living");
    expect(screen.getByRole("link", { name: /living/i }).className).toContain("active");
    expect(screen.getByRole("link", { name: /home/i }).className).not.toContain("active");
  });
});
