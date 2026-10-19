import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import ForgotPasswordPage from "./page.tsx";

const API = "https://api.example.test";

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = API;
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

it("renders a username field and a request button", () => {
  stubFetch(async () => new Response("{}", { status: 200 }));
  render(<ForgotPasswordPage />);

  expect(screen.getByLabelText("Username")).toBeDefined();
  expect(screen.getByRole("button", { name: "Send reset link" })).toBeDefined();
});

it("requests a reset with the username and shows a generic confirmation", async () => {
  const fetchMock = stubFetch(async () => new Response(JSON.stringify({ ok: true })));
  render(<ForgotPasswordPage />);

  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "ada" } });
  fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe(
    "If an account with that username exists, a password reset link has been sent.",
  );
  expect(fetchMock).toHaveBeenCalledWith(`${API}/auth/reset/request`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "ada" }),
  });
  expect(screen.queryByLabelText("Username")).toBeNull();
});

it("reports a server error without showing the confirmation", async () => {
  stubFetch(async () => new Response("{}", { status: 500 }));
  render(<ForgotPasswordPage />);

  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "ada" } });
  fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Could not request a password reset. Please try again.");
  expect(screen.getByLabelText("Username")).toBeDefined();
});

it("reports network failures", async () => {
  stubFetch(async () => {
    throw new TypeError("fetch failed");
  });
  render(<ForgotPasswordPage />);

  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "ada" } });
  fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Could not reach the API. Please try again.");
});

it("shows a pending state while the request is in flight", async () => {
  let release: (response: Response) => void = () => undefined;
  stubFetch(() => new Promise<Response>((resolve) => (release = resolve)) as Promise<Response>);
  render(<ForgotPasswordPage />);

  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "ada" } });
  fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));

  await waitFor(() => expect(screen.getByRole("button", { name: "Sending…" })).toBeDefined());
  release(new Response("{}", { status: 200 }));
  await screen.findByRole("alert");
});
