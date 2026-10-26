import {
  ContentEntryNotFoundError,
  ContentEntryValidationError,
  ContentTypeValidationError,
  validateContentEntryValues,
  validateContentType,
  type ContentEntry,
  type ContentType,
  type ContentTypeInput,
} from "@provisionless/core";

import type { ContentEntryStore, ContentTypeStore } from "./store.ts";

export { ContentEntryNotFoundError, ContentEntryValidationError, ContentTypeValidationError };

/** Raised when a slug has no content schema. */
export class ContentTypeNotFoundError extends Error {
  constructor(slug: string) {
    super(`Content type "${slug}" was not found`);
    this.name = "ContentTypeNotFoundError";
  }
}

/**
 * Content schema and entry use cases: lookups, validation, ordering, and the cascade between a
 * schema and its entries. Routes translate these results and errors into HTTP responses.
 */
export class ContentService {
  readonly #types: ContentTypeStore;
  readonly #entries: ContentEntryStore;

  constructor(types: ContentTypeStore, entries: ContentEntryStore) {
    this.#types = types;
    this.#entries = entries;
  }

  /** Lists every content schema ordered by slug. */
  async listContentTypes(): Promise<ContentType[]> {
    const contentTypes = await this.#types.list();
    return contentTypes.sort((left, right) => left.slug.localeCompare(right.slug));
  }

  /**
   * Reads one content schema.
   *
   * @throws {ContentTypeNotFoundError} When the slug has no schema.
   */
  async getContentType(slug: string): Promise<ContentType> {
    const contentType = await this.#types.get(slug);
    if (!contentType) {
      throw new ContentTypeNotFoundError(slug);
    }
    return contentType;
  }

  /**
   * Validates and stores a schema, replacing any existing schema with the same slug.
   *
   * @throws {ContentTypeValidationError} When the name or fields are invalid.
   */
  async putContentType(slug: string, body: Record<string, unknown>): Promise<ContentType> {
    const candidate = { slug, name: body.name, fields: body.fields };
    const errors = validateContentType(candidate);
    if (errors.length > 0) {
      throw new ContentTypeValidationError(errors);
    }
    return this.#types.put(candidate as ContentTypeInput);
  }

  /**
   * Deletes a schema and every entry that belongs to it.
   *
   * @throws {ContentTypeNotFoundError} When the slug has no schema.
   */
  async deleteContentType(slug: string): Promise<void> {
    await this.getContentType(slug);
    await this.#entries.deleteByType(slug);
    await this.#types.delete(slug);
  }

  /**
   * Lists the entries of a content type.
   *
   * @throws {ContentTypeNotFoundError} When the slug has no schema.
   */
  async listEntries(slug: string): Promise<ContentEntry[]> {
    await this.getContentType(slug);
    return this.#entries.list(slug);
  }

  /**
   * Reads one entry.
   *
   * @throws {ContentTypeNotFoundError} When the slug has no schema.
   * @throws {ContentEntryNotFoundError} When the entry does not exist.
   */
  async getEntry(slug: string, id: string): Promise<ContentEntry> {
    await this.getContentType(slug);
    const entry = await this.#entries.get(slug, id);
    if (!entry) {
      throw new ContentEntryNotFoundError(slug, id);
    }
    return entry;
  }

  /**
   * Validates entry values against the stored schema and creates the entry.
   *
   * @throws {ContentTypeNotFoundError} When the slug has no schema.
   * @throws {ContentEntryValidationError} When values are missing, mistyped, or unknown.
   */
  async createEntry(slug: string, values: unknown): Promise<ContentEntry> {
    const contentType = await this.getContentType(slug);
    const errors = validateContentEntryValues(contentType, values);
    if (errors.length > 0) {
      throw new ContentEntryValidationError(errors);
    }
    return this.#entries.create(contentType, values);
  }

  /**
   * Validates new values and replaces an existing entry's values. Validation happens before the
   * lookup so invalid values are rejected even when the entry is missing.
   *
   * @throws {ContentTypeNotFoundError} When the slug has no schema.
   * @throws {ContentEntryValidationError} When values are missing, mistyped, or unknown.
   * @throws {ContentEntryNotFoundError} When the entry does not exist.
   */
  async updateEntry(slug: string, id: string, values: unknown): Promise<ContentEntry> {
    const contentType = await this.getContentType(slug);
    const errors = validateContentEntryValues(contentType, values);
    if (errors.length > 0) {
      throw new ContentEntryValidationError(errors);
    }
    const existing = await this.#entries.get(slug, id);
    if (!existing) {
      throw new ContentEntryNotFoundError(slug, id);
    }
    return this.#entries.update(contentType, id, values);
  }

  /**
   * Deletes one entry.
   *
   * @throws {ContentTypeNotFoundError} When the slug has no schema.
   * @throws {ContentEntryNotFoundError} When the entry does not exist.
   */
  async deleteEntry(slug: string, id: string): Promise<void> {
    await this.getContentType(slug);
    const deleted = await this.#entries.delete(slug, id);
    if (!deleted) {
      throw new ContentEntryNotFoundError(slug, id);
    }
  }
}
