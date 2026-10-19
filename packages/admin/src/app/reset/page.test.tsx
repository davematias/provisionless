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

import ResetPasswordPage from "./page.tsx";

const API = "https://api.example.test";

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = API;
  navigation.replace.mockReset();
  navigation.refresh.mockReset();
  navigation.searchParams = new URLSearchParams("token=token-1");
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

function fillPasswords(password: string, confirmation: string) {
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: password } });
  fireEvent.change(screen.getByLabelText("Confirm new password"), {
    target: { value: confirmation },
  });
}

it("renders the new password and confirmation fields for a valid token", () => {
  stubFetch(async () => new Response("{}"));
  render(<ResetPasswordPage />);

  expect(screen.getByLabelText("New password")).toBeDefined();
  expect(screen.getByLabelText("Confirm new password")).toBeDefined();
  expect(screen.getByRole("button", { name: "Reset password" })).toBeDefined();
});

it("shows an error instead of a form when the token is missing", () => {
  navigation.searchParams = new URLSearchParams();
  const fetchMock = stubFetch(async () => new Response("{}"));
  render(<ResetPasswordPage />);

  const alert = screen.getByRole("alert");
  expect(alert.textContent).toBe("This reset link is missing a token. Request a new one.");
  expect(screen.queryByLabelText("New password")).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("confirms the reset and redirects to the login page with a confirmation", async () => {
  const fetchMock = stubFetch(async () => new Response(JSON.stringify({ ok: true })));
  render(<ResetPasswordPage />);

  fillPasswords("new-lovelace", "new-lovelace");
  fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/login?reset=success"));
  expect(navigation.refresh).toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledWith(`${API}/auth/reset/confirm`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "token-1", password: "new-lovelace" }),
  });
});

it("rejects mismatched passwords without calling the API", () => {
  const fetchMock = stubFetch(async () => new Response("{}"));
  render(<ResetPasswordPage />);

  fillPasswords("new-lovelace", "different");
  fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

  const alert = screen.getByRole("alert");
  expect(alert.textContent).toBe("The passwords do not match.");
  expect(fetchMock).not.toHaveBeenCalled();
  expect(navigation.replace).not.toHaveBeenCalled();
});

it("shows a clear error for an invalid or expired token", async () => {
  stubFetch(async () => new Response(JSON.stringify({ error: "Invalid" }), { status: 400 }));
  render(<ResetPasswordPage />);

  fillPasswords("new-lovelace", "new-lovelace");
  fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("This reset link is invalid or has expired. Request a new one.");
  expect(navigation.replace).not.toHaveBeenCalled();
});

it("reports network failures without redirecting", async () => {
  stubFetch(async () => {
    throw new TypeError("fetch failed");
  });
  render(<ResetPasswordPage />);

  fillPasswords("new-lovelace", "new-lovelace");
  fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Could not reach the API. Please try again.");
  expect(navigation.replace).not.toHaveBeenCalled();
});

it("shows a pending state while confirming", async () => {
  let release: (response: Response) => void = () => undefined;
  stubFetch(() => new Promise<Response>((resolve) => (release = resolve)) as Promise<Response>);
  render(<ResetPasswordPage />);

  fillPasswords("new-lovelace", "new-lovelace");
  fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

  await waitFor(() => expect(screen.getByRole("button", { name: "Resetting…" })).toBeDefined());
  release(new Response("{}", { status: 200 }));
  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/login?reset=success"));
});
