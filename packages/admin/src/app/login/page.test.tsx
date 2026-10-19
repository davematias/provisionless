import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace, refresh: navigation.refresh }),
  useSearchParams: () => navigation.searchParams,
}));

import LoginPage from "./page.tsx";

const API = "https://api.example.test";

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = API;
  navigation.replace.mockReset();
  navigation.refresh.mockReset();
  navigation.searchParams = new URLSearchParams();
  stubFetch(async () => new Response("{}", { status: 401 }));
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

function stubSession(meStatus: number) {
  return stubFetch(
    async (input) =>
      new Response("{}", {
        status: String(input).endsWith("/auth/me") ? meStatus : 200,
      }),
  );
}

it("renders username and password fields", () => {
  render(<LoginPage />);

  expect(screen.getByLabelText("Username")).toBeDefined();
  expect(screen.getByLabelText("Password")).toBeDefined();
  expect(screen.getByRole("button", { name: "Sign in" })).toBeDefined();
});

it("shows a confirmation after a password reset", () => {
  navigation.searchParams = new URLSearchParams("reset=success");
  stubSession(401);
  render(<LoginPage />);

  const alert = screen.getByRole("alert");
  expect(alert.textContent).toBe("Your password has been reset. Sign in with your new password.");
});

it("posts credentials to the API login endpoint with cookies and redirects home", async () => {
  const fetchMock = stubFetch(
    async () => new Response(JSON.stringify({ user: {} }), { status: 200 }),
  );
  render(<LoginPage />);

  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "ada" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "lovelace" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/"));
  expect(navigation.refresh).toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledWith(`${API}/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "ada", password: "lovelace" }),
  });
  expect(screen.queryByRole("alert")).toBeNull();
});

it("returns to the originally requested page after signing in", async () => {
  navigation.searchParams = new URLSearchParams("from=%2Fcontent%2Fpages");
  stubSession(401);
  render(<LoginPage />);

  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "ada" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "lovelace" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/content/pages"));
});

it("ignores a non-internal requested page after signing in", async () => {
  navigation.searchParams = new URLSearchParams("from=%2F%2Fevil.example");
  stubSession(401);
  render(<LoginPage />);

  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "ada" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "lovelace" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/"));
});

it("redirects an already-authenticated visitor to the requested page", async () => {
  navigation.searchParams = new URLSearchParams("from=%2Fcontent");
  stubSession(200);
  render(<LoginPage />);

  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/content"));
});

it("redirects an already-authenticated visitor home by default", async () => {
  stubSession(200);
  render(<LoginPage />);

  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/"));
});

it("shows a generic error for invalid credentials without redirecting", async () => {
  stubFetch(async () => new Response("{}", { status: 401 }));
  render(<LoginPage />);

  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "ada" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Invalid username or password");
  expect(navigation.replace).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Sign in" })).toBeDefined();
});

it("shows the same generic error for a disabled account", async () => {
  stubFetch(async () => new Response("{}", { status: 401 }));
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
  expect(navigation.replace).not.toHaveBeenCalled();
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
  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/"));
});
