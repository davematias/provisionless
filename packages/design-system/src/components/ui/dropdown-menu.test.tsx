import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu.tsx";

afterEach(cleanup);

it("opens the menu and renders its items", async () => {
  render(
    <DropdownMenu>
      <DropdownMenuTrigger>Open</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>Profile</DropdownMenuItem>
        <DropdownMenuItem>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>,
  );

  const trigger = screen.getByRole("button", { name: "Open" });
  expect(trigger.getAttribute("aria-haspopup")).toBe("menu");

  fireEvent.pointerDown(trigger, { button: 0 });

  expect(await screen.findByRole("menuitem", { name: "Profile" })).toBeDefined();
  expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeDefined();
});
