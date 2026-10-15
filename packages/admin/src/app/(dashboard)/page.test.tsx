import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import HomePage from "./page.tsx";

afterEach(cleanup);

it("renders the admin heading", () => {
  render(<HomePage />);

  expect(screen.getByRole("heading", { name: "Provisionless Admin" })).toBeDefined();
});
