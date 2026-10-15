import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace, refresh: navigation.refresh }),
}));

import LogoutButton from "./logout-button.tsx";

const API = "https://api.example.test";

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = API;
  navigation.replace.mockReset();
  navigation.refresh.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("calls the logout endpoint and redirects to login", async () => {
  const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);

  render(<LogoutButton />);
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/login"));
  expect(fetchMock).toHaveBeenCalledWith(`${API}/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
  expect(navigation.refresh).toHaveBeenCalled();
});
