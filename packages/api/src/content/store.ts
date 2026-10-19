import type { ContentEntry, ContentType, ContentTypeInput } from "@provisionless/core";

export interface ContentTypeStore {
  get(slug: string): Promise<ContentType | undefined>;
  list(): Promise<ContentType[]>;
  put(input: ContentTypeInput): Promise<ContentType>;
  delete(slug: string): Promise<boolean>;
}

export interface ContentEntryStore {
  get(type: string, id: string): Promise<ContentEntry | undefined>;
  list(type: string): Promise<ContentEntry[]>;
  create(contentType: ContentType, values: unknown): Promise<ContentEntry>;
  update(contentType: ContentType, id: string, values: unknown): Promise<ContentEntry>;
  delete(type: string, id: string): Promise<boolean>;
  deleteByType(type: string): Promise<number>;
}
