import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace, refresh: navigation.refresh }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: { children: ReactNode; href: string } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import UserMenu from "./user-menu.tsx";

const API = "https://api.example.test";

const user = {
  username: "ada",
  id: "1",
  isAdmin: true,
  firstName: "Ada",
  lastName: "Lovelace",
  enabled: true,
  createdAt: "",
  updatedAt: "",
};

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = API;
  navigation.replace.mockReset();
  navigation.refresh.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ user }), { status: 200 })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("shows the signed-in user's name on the trigger", async () => {
  render(<UserMenu />);

  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Account menu" }).textContent).toBe("Ada Lovelace"),
  );
});

it("opens the menu and signs out", async () => {
  render(<UserMenu />);
  const trigger = screen.getByRole("button", { name: "Account menu" });
  await waitFor(() => expect(trigger.textContent).toBe("Ada Lovelace"));

  fireEvent.pointerDown(trigger, { button: 0 });

  expect(await screen.findByRole("menuitem", { name: "Profile" })).toBeDefined();
  fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));

  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/login"));
});
