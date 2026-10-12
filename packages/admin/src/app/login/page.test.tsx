import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => router }));

import LoginPage from "./page.tsx";

const API = "https://api.example.test";

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = API;
  router.replace.mockReset();
  router.refresh.mockReset();
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

it("renders username and password fields", () => {
  render(<LoginPage />);

  expect(screen.getByLabelText("Username")).toBeDefined();
  expect(screen.getByLabelText("Password")).toBeDefined();
  expect(screen.getByRole("button", { name: "Sign in" })).toBeDefined();
});

it("posts credentials to the API login endpoint with cookies and redirects home", async () => {
  const fetchMock = stubFetch(
    async () => new Response(JSON.stringify({ user: {} }), { status: 200 }),
  );
  render(<LoginPage />);

  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "ada" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "lovelace" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
  expect(router.refresh).toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledWith(`${API}/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "ada", password: "lovelace" }),
  });
  expect(screen.queryByRole("alert")).toBeNull();
});

it("shows a generic error for invalid credentials without redirecting", async () => {
  stubFetch(
    async () =>
      new Response(JSON.stringify({ error: "Invalid username or password" }), { status: 401 }),
  );
  render(<LoginPage />);

  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "ada" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Invalid username or password");
  expect(router.replace).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Sign in" })).toBeDefined();
});

it("shows the same generic error for a disabled account", async () => {
  stubFetch(
    async () =>
      new Response(JSON.stringify({ error: "Invalid username or password" }), { status: 401 }),
  );
  render(<LoginPage />);

  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "disabled-user" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "lovelace" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Invalid username or password");
});

it("reports network failures without redirecting", async () => {
  stubFetch(async () => {
    throw new TypeError("fetch failed");
  });
  render(<LoginPage />);

  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "ada" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "lovelace" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Could not reach the API. Please try again.");
  expect(router.replace).not.toHaveBeenCalled();
});

it("shows a pending state while logging in and redirects when it completes", async () => {
  let release: (response: Response) => void = () => undefined;
  const fetchMock = stubFetch(
    () => new Promise<Response>((resolve) => (release = resolve)) as Promise<Response>,
  );
  render(<LoginPage />);

  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "ada" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "lovelace" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const pendingButton = screen.getByRole("button", { name: "Signing in…" });
  expect(pendingButton.hasAttribute("disabled")).toBe(true);

  release(new Response("{}", { status: 200 }));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
});
