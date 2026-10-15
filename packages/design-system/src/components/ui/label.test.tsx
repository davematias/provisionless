import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { Input } from "./input.tsx";
import { Label } from "./label.tsx";

afterEach(cleanup);

it("associates the label with its input", () => {
  render(
    <>
      <Label htmlFor="username">Username</Label>
      <Input id="username" />
    </>,
  );

  const label = screen.getByText("Username");
  expect(label.getAttribute("data-slot")).toBe("label");
  expect(screen.getByLabelText("Username").getAttribute("id")).toBe("username");
});
