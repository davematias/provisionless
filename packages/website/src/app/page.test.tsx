import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import HomePage from "./page.tsx";
import { GITHUB_URL } from "../lib/site.ts";

afterEach(cleanup);

it("renders the hero and links to GitHub", () => {
  render(<HomePage />);

  expect(
    screen.getByRole("heading", { name: "Content management, without the servers" }),
  ).toBeDefined();
  expect(screen.getByRole("link", { name: "View on GitHub" }).getAttribute("href")).toBe(
    GITHUB_URL,
  );
});

it("renders the feature cards", () => {
  render(<HomePage />);

  expect(screen.getByText("Serverless by default")).toBeDefined();
  expect(screen.getByText("Headless content API")).toBeDefined();
  expect(screen.getByText("Typed content models")).toBeDefined();
});
