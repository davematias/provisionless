import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { SiteFooter } from "./site-footer.tsx";
import { GITHUB_URL } from "../lib/site.ts";

afterEach(cleanup);

it("links to the GitHub repository", () => {
  render(<SiteFooter />);

  expect(screen.getByRole("link", { name: "GitHub" }).getAttribute("href")).toBe(GITHUB_URL);
});
