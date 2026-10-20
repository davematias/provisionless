import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  params: { slug: "post", id: "entry-1" } as { slug: string; id: string },
}));

vi.mock("next/navigation", () => ({
  useParams: () => navigation.params,
  useRouter: () => ({ push: navigation.push, refresh: navigation.refresh }),
}));

import EditContentEntryPage from "./page.tsx";

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
  values: { title: "Hello", published: true },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = API;
  navigation.push.mockReset();
  navigation.refresh.mockReset();
  navigation.params = { slug: "post", id: "entry-1" };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("prefills an entry and saves updates", async () => {
  const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
    if (init?.method === "PUT") {
      return new Response(
        JSON.stringify({
          entry: { ...entry, values: { title: "Updated", published: true } },
        }),
      );
    }
    return new Response(
      JSON.stringify(String(_input).endsWith("/content-types/post") ? { contentType } : { entry }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<EditContentEntryPage />);

  const title = (await screen.findByLabelText("title *")) as HTMLInputElement;
  expect(title.value).toBe("Hello");
  expect((screen.getByLabelText("published") as HTMLInputElement).checked).toBe(true);

  fireEvent.change(title, { target: { value: "Updated" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/content/post"));
  const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
  expect(put?.[0]).toBe(`${API}/content/post/entry-1`);
  expect(JSON.parse(String(put?.[1]?.body))).toEqual({
    values: { title: "Updated", published: true },
  });
});

it("shows a not-found message for an unknown entry", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (input: unknown) =>
        new Response(
          String(input).endsWith("/content-types/post")
            ? JSON.stringify({ contentType })
            : JSON.stringify({ error: "Content entry not found" }),
          { status: String(input).endsWith("/content-types/post") ? 200 : 404 },
        ),
    ),
  );
  render(<EditContentEntryPage />);

  await screen.findByText("Content entry not found.");
});
