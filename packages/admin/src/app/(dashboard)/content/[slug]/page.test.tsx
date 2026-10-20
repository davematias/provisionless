import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  params: { slug: "post" } as { slug: string },
}));

vi.mock("next/navigation", () => ({
  useParams: () => navigation.params,
}));

import ContentEntriesPage from "./page.tsx";

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

const entry = {
  type: "post",
  id: "entry-1",
  values: { title: "Hello", published: false },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = API;
  navigation.params = { slug: "post" };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("shows entries for a content type with links to edit and create", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith("/content-types/post")) {
        return new Response(JSON.stringify({ contentType }));
      }
      return new Response(JSON.stringify({ entries: [entry] }));
    }),
  );
  render(<ContentEntriesPage />);

  await screen.findByText('{"title":"Hello","published":false}');
  expect(screen.getByText("entry-1")).toBeDefined();
  expect(screen.getByRole("link", { name: "New entry" }).getAttribute("href")).toBe(
    "/content/post/new",
  );
  expect(screen.getByRole("link", { name: "Edit" }).getAttribute("href")).toBe(
    "/content/post/entry-1",
  );
});

it("shows an empty state", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith("/content-types/post")) {
        return new Response(JSON.stringify({ contentType }));
      }
      return new Response(JSON.stringify({ entries: [] }));
    }),
  );
  render(<ContentEntriesPage />);

  await screen.findByText("No entries yet.");
});
