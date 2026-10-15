import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./card.tsx";

afterEach(cleanup);

it("renders card sections", () => {
  render(
    <Card>
      <CardHeader>
        <CardTitle>Welcome</CardTitle>
        <CardDescription>Manage your content</CardDescription>
      </CardHeader>
      <CardContent>Body</CardContent>
    </Card>,
  );

  expect(screen.getByText("Welcome").getAttribute("data-slot")).toBe("card-title");
  expect(screen.getByText("Manage your content")).toBeDefined();
  expect(screen.getByText("Body").getAttribute("data-slot")).toBe("card-content");
  expect(screen.getByText("Welcome").closest("[data-slot='card']")).not.toBeNull();
});
