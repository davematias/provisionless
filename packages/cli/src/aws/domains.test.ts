import { expect, it } from "vitest";

import { adminSiteNames } from "./domains.ts";

it("pairs an apex domain with its www variant", () => {
  expect(adminSiteNames("example.com")).toEqual({
    canonical: "example.com",
    redirectNames: ["www.example.com"],
    names: ["example.com", "www.example.com"],
  });
});

it("pairs a www domain with its apex", () => {
  expect(adminSiteNames("www.example.com")).toEqual({
    canonical: "www.example.com",
    redirectNames: ["example.com"],
    names: ["www.example.com", "example.com"],
  });
});

it("adds no redirect names for subdomains", () => {
  expect(adminSiteNames("admin.example.com")).toEqual({
    canonical: "admin.example.com",
    redirectNames: [],
    names: ["admin.example.com"],
  });
});

it("lowercases the domain", () => {
  expect(adminSiteNames("Admin.Example.COM").canonical).toBe("admin.example.com");
  expect(adminSiteNames("WWW.example.com").redirectNames).toEqual(["example.com"]);
});
