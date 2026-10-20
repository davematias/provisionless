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

import EditContentTypePage from "./page.tsx";

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

it("loads an existing content type and saves updates", async () => {
  const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
    if (init?.method === "PUT") {
      return new Response(JSON.stringify({ contentType: { ...contentType, name: "Blog post" } }));
    }
    return new Response(JSON.stringify({ contentType }));
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<EditContentTypePage />);

  const slug = (await screen.findByLabelText("Slug")) as HTMLInputElement;
  expect(slug.value).toBe("post");
  expect(slug.disabled).toBe(true);
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Post");
  expect((screen.getAllByLabelText("Field name")[0] as HTMLInputElement).value).toBe("title");

  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Blog post" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/content-types/post/edit"));
  const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
  expect(put?.[0]).toBe(`${API}/content-types/post`);
  expect(JSON.parse(String(put?.[1]?.body))).toMatchObject({ name: "Blog post" });
});

it("shows a not-found message for an unknown slug", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "Content type not found" }), { status: 404 }),
    ),
  );
  render(<EditContentTypePage />);

  await screen.findByText("Content type not found.");
});
