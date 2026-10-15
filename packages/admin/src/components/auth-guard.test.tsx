import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  pathname: "/",
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: navigation.replace, refresh: navigation.refresh }),
}));

import AuthGuard from "./auth-guard.tsx";

const API = "https://api.example.test";

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = API;
  navigation.pathname = "/";
  navigation.replace.mockReset();
  navigation.refresh.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubStatus(status: number) {
  const fetchMock = vi.fn(async () => new Response("{}", { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

it("renders public pages without checking the session", () => {
  navigation.pathname = "/login";
  const fetchMock = stubStatus(200);

  render(
    <AuthGuard>
      <p>public content</p>
    </AuthGuard>,
  );

  expect(screen.getByText("public content")).toBeDefined();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(navigation.replace).not.toHaveBeenCalled();
});

it("redirects unauthenticated visitors to login with the requested page", async () => {
  navigation.pathname = "/content";
  stubStatus(401);

  render(
    <AuthGuard>
      <p>protected content</p>
    </AuthGuard>,
  );

  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/login?from=%2Fcontent"));
  expect(screen.queryByText("protected content")).toBeNull();
});

it("renders protected pages once the session is confirmed", async () => {
  navigation.pathname = "/content";
  stubStatus(200);

  render(
    <AuthGuard>
      <p>protected content</p>
    </AuthGuard>,
  );

  expect(screen.getByRole("status").textContent).toBe("Checking your session…");
  await waitFor(() => expect(screen.getByText("protected content")).toBeDefined());
  expect(navigation.replace).not.toHaveBeenCalled();
});
