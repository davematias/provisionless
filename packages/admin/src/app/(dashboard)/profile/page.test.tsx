import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import ProfilePage from "./page.tsx";

const API = "https://api.example.test";

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = API;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("shows the signed-in user's details", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            user: {
              username: "ada",
              id: "1",
              isAdmin: true,
              firstName: "Ada",
              lastName: "Lovelace",
              enabled: true,
              createdAt: "",
              updatedAt: "",
            },
          }),
          { status: 200 },
        ),
    ),
  );

  render(<ProfilePage />);

  await waitFor(() => expect(screen.getByText("Ada Lovelace")).toBeDefined());
  expect(screen.getByText("ada")).toBeDefined();
  expect(screen.getByText("Administrator")).toBeDefined();
});
