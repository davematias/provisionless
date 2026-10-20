import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import ContentTypesPage from "./page.tsx";

const API = "https://api.example.test";

const contentType = {
  slug: "post",
  name: "Post",
  fields: [
    { name: "title", type: "string", required: true },
    { name: "published", type: "boolean" },
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = API;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubFetch(implementation: (input: unknown, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(implementation);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

it("lists content types with edit and entries links", async () => {
  stubFetch(
    async () => new Response(JSON.stringify({ contentTypes: [contentType] }), { status: 200 }),
  );
  render(<ContentTypesPage />);

  await screen.findByText("Post");
  expect(screen.getByText("post")).toBeDefined();
  expect(screen.getByText("2")).toBeDefined();
  expect(screen.getByRole("link", { name: "Edit" }).getAttribute("href")).toBe(
    "/content-types/post/edit",
  );
  expect(screen.getByRole("link", { name: "Entries" }).getAttribute("href")).toBe("/content/post");
  expect(screen.getByRole("link", { name: "New content type" }).getAttribute("href")).toBe(
    "/content-types/new",
  );
});

it("shows an empty state", async () => {
  stubFetch(async () => new Response(JSON.stringify({ contentTypes: [] }), { status: 200 }));
  render(<ContentTypesPage />);

  await screen.findByText("No content types yet. Create one to start adding entries.");
});

it("shows a permission error for non-admin users", async () => {
  stubFetch(async () => new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }));
  render(<ContentTypesPage />);

  await screen.findByText("Only administrators can manage content types.");
});
