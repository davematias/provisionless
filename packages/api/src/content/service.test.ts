import {
  ContentEntryValidationError,
  ContentTypeValidationError,
  type ContentEntry,
  type ContentType,
  type ContentTypeInput,
} from "@provisionless/core";
import { beforeEach, expect, it } from "vitest";

import { ContentEntryNotFoundError, ContentService, ContentTypeNotFoundError } from "./service.ts";
import type { ContentEntryStore, ContentTypeStore } from "./store.ts";

class MemoryContentTypes implements ContentTypeStore {
  readonly types = new Map<string, ContentType>();

  async get(slug: string): Promise<ContentType | undefined> {
    return this.types.get(slug);
  }

  async list(): Promise<ContentType[]> {
    return [...this.types.values()];
  }

  async put(input: ContentTypeInput): Promise<ContentType> {
    const now = "2026-01-01T00:00:00.000Z";
    const contentType: ContentType = {
      ...input,
      createdAt: this.types.get(input.slug)?.createdAt ?? now,
      updatedAt: now,
    };
    this.types.set(input.slug, contentType);
    return contentType;
  }

  async delete(slug: string): Promise<boolean> {
    return this.types.delete(slug);
  }
}

class MemoryContentEntries implements ContentEntryStore {
  readonly entries = new Map<string, ContentEntry>();

  #key(type: string, id: string): string {
    return `${type}:${id}`;
  }

  async get(type: string, id: string): Promise<ContentEntry | undefined> {
    return this.entries.get(this.#key(type, id));
  }

  async list(type: string): Promise<ContentEntry[]> {
    return [...this.entries.values()].filter((entry) => entry.type === type);
  }

  async create(contentType: ContentType, values: unknown): Promise<ContentEntry> {
    const now = "2026-01-01T00:00:00.000Z";
    const entry: ContentEntry = {
      type: contentType.slug,
      id: crypto.randomUUID(),
      values: values as ContentEntry["values"],
      createdAt: now,
      updatedAt: now,
    };
    this.entries.set(this.#key(entry.type, entry.id), entry);
    return entry;
  }

  async update(contentType: ContentType, id: string, values: unknown): Promise<ContentEntry> {
    const existing = this.entries.get(this.#key(contentType.slug, id));
    if (!existing) {
      throw new Error("missing");
    }
    const entry: ContentEntry = {
      ...existing,
      values: values as ContentEntry["values"],
      updatedAt: "2026-01-02T00:00:00.000Z",
    };
    this.entries.set(this.#key(entry.type, entry.id), entry);
    return entry;
  }

  async delete(type: string, id: string): Promise<boolean> {
    return this.entries.delete(this.#key(type, id));
  }

  async deleteByType(type: string): Promise<number> {
    let deleted = 0;
    for (const [key, entry] of this.entries) {
      if (entry.type === type) {
        this.entries.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }
}

let types: MemoryContentTypes;
let entries: MemoryContentEntries;
let service: ContentService;

beforeEach(async () => {
  types = new MemoryContentTypes();
  entries = new MemoryContentEntries();
  service = new ContentService(types, entries);
  await service.putContentType("post", {
    name: "Post",
    fields: [{ name: "title", type: "string", required: true }],
  });
  await service.putContentType("page", {
    name: "Page",
    fields: [{ name: "body", type: "string" }],
  });
});

it("lists content types sorted by slug", async () => {
  const contentTypes = await service.listContentTypes();

  expect(contentTypes.map((contentType) => contentType.slug)).toEqual(["page", "post"]);
});

it("reports missing content types", async () => {
  await expect(service.getContentType("missing")).rejects.toThrow(ContentTypeNotFoundError);
  await expect(service.listEntries("missing")).rejects.toThrow(ContentTypeNotFoundError);
  await expect(service.deleteContentType("missing")).rejects.toThrow(ContentTypeNotFoundError);
});

it("rejects invalid schemas without writing them", async () => {
  await expect(
    service.putContentType("post", {
      name: "",
      fields: [{ name: "title", type: "number" }],
    }),
  ).rejects.toThrow(ContentTypeValidationError);

  const contentType = await service.getContentType("post");
  expect(contentType.name).toBe("Post");
});

it("validates entries against the stored schema", async () => {
  await expect(service.createEntry("post", {})).rejects.toThrow(ContentEntryValidationError);
  await expect(service.createEntry("post", { title: 42 })).rejects.toThrow(
    ContentEntryValidationError,
  );

  const entry = await service.createEntry("post", { title: "Hello" });
  expect(entry.values.title).toBe("Hello");
});

it("reports missing content types before validating entry values", async () => {
  await expect(service.createEntry("missing", {})).rejects.toThrow(ContentTypeNotFoundError);
});

it("reports missing entries", async () => {
  await expect(service.getEntry("post", "missing")).rejects.toThrow(ContentEntryNotFoundError);
  await expect(service.deleteEntry("post", "missing")).rejects.toThrow(ContentEntryNotFoundError);
});

it("validates new values before checking that the entry exists", async () => {
  await expect(service.updateEntry("post", "missing", {})).rejects.toThrow(
    ContentEntryValidationError,
  );
});

it("deletes every entry when a content type is deleted", async () => {
  await service.createEntry("post", { title: "Hello" });

  await service.deleteContentType("post");

  expect(entries.entries.size).toBe(0);
  await expect(service.getContentType("post")).rejects.toThrow(ContentTypeNotFoundError);
});

it("deletes a single entry", async () => {
  const entry = await service.createEntry("post", { title: "Hello" });

  await service.deleteEntry("post", entry.id);

  expect(entries.entries.size).toBe(0);
});
