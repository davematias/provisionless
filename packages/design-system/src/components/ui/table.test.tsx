import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table.tsx";

afterEach(cleanup);

it("renders a table with headers, rows, and cells", () => {
  render(
    <Table>
      <TableCaption>Content types</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Slug</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>Post</TableCell>
          <TableCell>post</TableCell>
        </TableRow>
      </TableBody>
    </Table>,
  );

  expect(screen.getByRole("table")).toBeDefined();
  expect(screen.getByRole("columnheader", { name: "Name" })).toBeDefined();
  expect(screen.getByRole("cell", { name: "Post" })).toBeDefined();
  expect(screen.getByText("Content types")).toBeDefined();
});
