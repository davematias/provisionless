export type ContentFieldType = "string" | "boolean";

export interface ContentField {
  name: string;
  type: ContentFieldType;
  required?: boolean;
}

export interface ContentType {
  slug: string;
  name: string;
  fields: ContentField[];
  createdAt: string;
  updatedAt: string;
}

export type ContentEntryValue = string | boolean;

export type ContentEntryValues = Record<string, ContentEntryValue>;

export interface ContentEntry {
  type: string;
  id: string;
  values: ContentEntryValues;
  createdAt: string;
  updatedAt: string;
}

export interface ContentFieldError {
  field: string;
  message: string;
}

export class ContentApiError extends Error {
  readonly status: number;
  readonly errors: ContentFieldError[];

  constructor(message: string, status: number, errors: ContentFieldError[] = []) {
    super(message);
    this.name = "ContentApiError";
    this.status = status;
    this.errors = errors;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  const body: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    const message =
      isRecord(body) && typeof body.error === "string" ? body.error : "Request failed";
    const errors =
      isRecord(body) && Array.isArray(body.errors)
        ? body.errors.filter(
            (error): error is ContentFieldError =>
              isRecord(error) &&
              typeof error.field === "string" &&
              typeof error.message === "string",
          )
        : [];
    throw new ContentApiError(message, response.status, errors);
  }

  return body as T;
}

export function contentErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ContentApiError) {
    if (error.status === 403) {
      return "Only administrators can manage content types.";
    }
    return error.message;
  }
  return fallback;
}

export async function listContentTypes(): Promise<ContentType[]> {
  const body = await request<{ contentTypes?: ContentType[] }>("/content-types");
  return body.contentTypes ?? [];
}

export async function getContentType(slug: string): Promise<ContentType | undefined> {
  try {
    const body = await request<{ contentType: ContentType }>(
      `/content-types/${encodeURIComponent(slug)}`,
    );
    return body.contentType;
  } catch (error) {
    if (error instanceof ContentApiError && error.status === 404) {
      return undefined;
    }
    throw error;
  }
}

export async function saveContentType(
  slug: string,
  input: { name: string; fields: ContentField[] },
): Promise<ContentType> {
  const body = await request<{ contentType: ContentType }>(
    `/content-types/${encodeURIComponent(slug)}`,
    { method: "PUT", body: JSON.stringify(input) },
  );
  return body.contentType;
}

export async function listContentEntries(slug: string): Promise<ContentEntry[]> {
  const body = await request<{ entries?: ContentEntry[] }>(`/content/${encodeURIComponent(slug)}`);
  return body.entries ?? [];
}

export async function getContentEntry(slug: string, id: string): Promise<ContentEntry | undefined> {
  try {
    const body = await request<{ entry: ContentEntry }>(
      `/content/${encodeURIComponent(slug)}/${encodeURIComponent(id)}`,
    );
    return body.entry;
  } catch (error) {
    if (error instanceof ContentApiError && error.status === 404) {
      return undefined;
    }
    throw error;
  }
}

export async function createContentEntry(
  slug: string,
  values: ContentEntryValues,
): Promise<ContentEntry> {
  const body = await request<{ entry: ContentEntry }>(`/content/${encodeURIComponent(slug)}`, {
    method: "POST",
    body: JSON.stringify({ values }),
  });
  return body.entry;
}

export async function updateContentEntry(
  slug: string,
  id: string,
  values: ContentEntryValues,
): Promise<ContentEntry> {
  const body = await request<{ entry: ContentEntry }>(
    `/content/${encodeURIComponent(slug)}/${encodeURIComponent(id)}`,
    { method: "PUT", body: JSON.stringify({ values }) },
  );
  return body.entry;
}
