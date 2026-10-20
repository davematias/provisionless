import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  params: { slug: "post" } as { slug: string },
}));

vi.mock("next/navigation", () => ({
  useParams: () => navigation.params,
  useRouter: () => ({ push: navigation.push, refresh: navigation.refresh }),
}));

import NewContentEntryPage from "./page.tsx";

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
  navigation.push.mockReset();
  navigation.refresh.mockReset();
  navigation.params = { slug: "post" };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("renders a field for each schema field and creates an entry", async () => {
  const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
    if (init?.method === "POST") {
      return new Response(
        JSON.stringify({
          entry: {
            type: "post",
            id: "entry-1",
            values: { title: "Hello", published: true },
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        }),
        { status: 201 },
      );
    }
    return new Response(JSON.stringify({ contentType }));
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<NewContentEntryPage />);

  fireEvent.change(await screen.findByLabelText("title *"), { target: { value: "Hello" } });
  fireEvent.click(screen.getByLabelText("published"));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/content/post"));
  const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
  expect(post?.[0]).toBe(`${API}/content/post`);
  expect(JSON.parse(String(post?.[1]?.body))).toEqual({
    values: { title: "Hello", published: true },
  });
});

it("shows validation errors from the API", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: unknown, init?: RequestInit) => {
      if (init?.method === "POST") {
        return new Response(
          JSON.stringify({
            error: "Invalid content entry",
            errors: [{ field: "title", message: "Field is required" }],
          }),
          { status: 400 },
        );
      }
      return new Response(JSON.stringify({ contentType }));
    }),
  );
  render(<NewContentEntryPage />);

  fireEvent.change(await screen.findByLabelText("title *"), { target: { value: "Hello" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await screen.findByText("title: Field is required");
  expect(navigation.push).not.toHaveBeenCalled();
});
