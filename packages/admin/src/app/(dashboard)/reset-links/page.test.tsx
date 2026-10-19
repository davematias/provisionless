import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import ResetLinksPage from "./page.tsx";

const API = "https://api.example.test";
const clipboard = { writeText: vi.fn() };

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = API;
  clipboard.writeText.mockReset();
  Object.defineProperty(navigator, "clipboard", {
    value: clipboard,
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function userResponse(isAdmin: boolean): Response {
  return new Response(
    JSON.stringify({
      user: {
        username: "ada",
        id: "1",
        email: "ada@example.com",
        isAdmin,
        firstName: "Ada",
        lastName: "Lovelace",
        enabled: true,
        createdAt: "",
        updatedAt: "",
      },
    }),
    { status: 200 },
  );
}

function stubFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn((input: unknown, init?: RequestInit) => handler(String(input), init));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

it("shows an administrators-only message to non-admin users", async () => {
  stubFetch(async (url) =>
    url.endsWith("/auth/me") ? userResponse(false) : new Response("{}", { status: 403 }),
  );
  render(<ResetLinksPage />);

  await screen.findByText("Only administrators can create reset links.");
  expect(screen.queryByLabelText("Username")).toBeNull();
});

it("reports when the account cannot be verified", async () => {
  stubFetch(async () => new Response("{}", { status: 401 }));
  render(<ResetLinksPage />);

  await screen.findByText("Could not verify your account. Refresh the page and try again.");
  expect(screen.queryByLabelText("Username")).toBeNull();
});

it("lets an admin create and copy a reset link", async () => {
  const fetchMock = stubFetch(async (url) => {
    if (url.endsWith("/auth/me")) {
      return userResponse(true);
    }
    return new Response(
      JSON.stringify({ username: "grace", url: "https://admin.example.com/reset?token=token-1" }),
      { status: 200 },
    );
  });
  render(<ResetLinksPage />);

  fireEvent.change(await screen.findByLabelText("Username"), {
    target: { value: "grace" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create reset link" }));

  await waitFor(() => {
    const input = screen.getByLabelText("Shareable reset link") as HTMLInputElement;
    expect(input.value).toBe("https://admin.example.com/reset?token=token-1");
  });
  expect(fetchMock).toHaveBeenCalledWith(`${API}/auth/reset/link`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "grace" }),
  });

  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  await waitFor(() =>
    expect(clipboard.writeText).toHaveBeenCalledWith(
      "https://admin.example.com/reset?token=token-1",
    ),
  );
  expect(screen.getByRole("button", { name: "Copied" })).toBeDefined();
});

it("shows a clear error when the username does not exist", async () => {
  stubFetch(async (url) => {
    if (url.endsWith("/auth/me")) {
      return userResponse(true);
    }
    return new Response(JSON.stringify({ error: "User not found" }), { status: 404 });
  });
  render(<ResetLinksPage />);

  fireEvent.change(await screen.findByLabelText("Username"), {
    target: { value: "nobody" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create reset link" }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("No user with that username was found.");
});

it("shows a permission error when the API rejects the request", async () => {
  stubFetch(async (url) => {
    if (url.endsWith("/auth/me")) {
      return userResponse(true);
    }
    return new Response("{}", { status: 403 });
  });
  render(<ResetLinksPage />);

  fireEvent.change(await screen.findByLabelText("Username"), {
    target: { value: "grace" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create reset link" }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("You do not have permission to create reset links.");
});

it("reports network failures", async () => {
  stubFetch(async (url) => {
    if (url.endsWith("/auth/me")) {
      return userResponse(true);
    }
    throw new TypeError("fetch failed");
  });
  render(<ResetLinksPage />);

  fireEvent.change(await screen.findByLabelText("Username"), {
    target: { value: "grace" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create reset link" }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Could not reach the API. Please try again.");
});
