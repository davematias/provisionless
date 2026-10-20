import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push, refresh: navigation.refresh }),
}));

import ContentTypeEditor from "./content-type-editor.tsx";

const API = "https://api.example.test";

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = API;
  navigation.push.mockReset();
  navigation.refresh.mockReset();
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

function fillNewType() {
  fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "post" } });
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Post" } });
  fireEvent.change(screen.getByLabelText("Field name"), { target: { value: "title" } });
}

it("creates a content type with dynamic fields", async () => {
  const fetchMock = stubFetch(
    async () =>
      new Response(
        JSON.stringify({
          contentType: {
            slug: "post",
            name: "Post",
            fields: [{ name: "title", type: "string", required: true }],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        }),
        { status: 200 },
      ),
  );
  render(<ContentTypeEditor />);

  fillNewType();
  fireEvent.click(screen.getByLabelText("Required"));
  fireEvent.click(screen.getByRole("button", { name: "Add field" }));
  fireEvent.change(screen.getAllByLabelText("Field name")[1] as HTMLElement, {
    target: { value: "published" },
  });
  fireEvent.change(screen.getAllByLabelText("Type")[1] as HTMLElement, {
    target: { value: "boolean" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/content-types/post/edit"));
  expect(fetchMock).toHaveBeenCalledWith(`${API}/content-types/post`, {
    credentials: "include",
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Post",
      fields: [
        { name: "title", type: "string", required: true },
        { name: "published", type: "boolean", required: false },
      ],
    }),
  });
});

it("shows field errors returned by the API", async () => {
  stubFetch(
    async () =>
      new Response(
        JSON.stringify({
          error: "Invalid content type",
          errors: [{ field: "slug", message: "Slug is invalid" }],
        }),
        { status: 400 },
      ),
  );
  render(<ContentTypeEditor />);

  fillNewType();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await screen.findByText("slug: Slug is invalid");
  expect(navigation.push).not.toHaveBeenCalled();
});
