import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { Alert, AlertDescription, AlertTitle } from "./alert.tsx";

afterEach(cleanup);

it("renders an alert with the alert role", () => {
  render(
    <Alert variant="destructive">
      <AlertTitle>Error</AlertTitle>
      <AlertDescription>Invalid username or password</AlertDescription>
    </Alert>,
  );

  const alert = screen.getByRole("alert");
  expect(alert.textContent).toContain("Error");
  expect(alert.textContent).toContain("Invalid username or password");
  expect(alert.className).toContain("text-destructive");
});
