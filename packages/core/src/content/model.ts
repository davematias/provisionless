/** Content field types a schema may declare. */
export const CONTENT_FIELD_TYPES = ["string", "boolean"] as const;

export type ContentFieldType = (typeof CONTENT_FIELD_TYPES)[number];

export interface ContentField {
  name: string;
  type: ContentFieldType;
  required?: boolean;
}

export interface ContentTypeInput {
  slug: string;
  name: string;
  fields: ContentField[];
}

export interface ContentType extends ContentTypeInput {
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

export interface ContentValidationError {
  field: string;
  message: string;
}

const SLUG_PATTERN = /^[a-z][a-z0-9-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFieldType(value: unknown): value is ContentFieldType {
  return value === "string" || value === "boolean";
}

/**
 * Raised when a content schema fails validation. `errors` lists every field problem in a
 * client-safe shape.
 */
export class ContentTypeValidationError extends Error {
  readonly errors: ContentValidationError[];

  constructor(errors: ContentValidationError[]) {
    super(`Invalid content type: ${errors.map((error) => error.message).join("; ")}`);
    this.name = "ContentTypeValidationError";
    this.errors = errors;
  }
}

/**
 * Raised when entry values fail validation against their schema. `errors` lists every field problem
 * in a client-safe shape.
 */
export class ContentEntryValidationError extends Error {
  readonly errors: ContentValidationError[];

  constructor(errors: ContentValidationError[]) {
    super(`Invalid content entry: ${errors.map((error) => error.message).join("; ")}`);
    this.name = "ContentEntryValidationError";
    this.errors = errors;
  }
}

/**
 * Checks a candidate schema and returns one problem per invalid field. An empty array means the
 * schema is valid.
 */
export function validateContentType(input: unknown): ContentValidationError[] {
  if (!isRecord(input)) {
    return [{ field: "", message: "Content type must be an object" }];
  }

  const errors: ContentValidationError[] = [];
  if (typeof input.slug !== "string" || !SLUG_PATTERN.test(input.slug)) {
    errors.push({
      field: "slug",
      message:
        "Slug must start with a lowercase letter and contain only lowercase letters, numbers, and hyphens",
    });
  }
  if (typeof input.name !== "string" || input.name.trim() === "") {
    errors.push({ field: "name", message: "Name is required" });
  }

  if (!Array.isArray(input.fields) || input.fields.length === 0) {
    errors.push({ field: "fields", message: "At least one field is required" });
    return errors;
  }

  const names = new Set<string>();
  input.fields.forEach((field, index) => {
    const path = `fields[${index}]`;
    if (!isRecord(field)) {
      errors.push({ field: path, message: "Field must be an object" });
      return;
    }

    if (typeof field.name !== "string" || field.name.trim() === "") {
      errors.push({ field: `${path}.name`, message: "Field name is required" });
    } else if (names.has(field.name)) {
      errors.push({ field: `${path}.name`, message: "Field names must be unique" });
    } else {
      names.add(field.name);
    }

    if (!isFieldType(field.type)) {
      errors.push({
        field: `${path}.type`,
        message: 'Field type must be "string" or "boolean"',
      });
    }

    if (field.required !== undefined && typeof field.required !== "boolean") {
      errors.push({ field: `${path}.required`, message: "required must be a boolean" });
    }
  });

  return errors;
}

/**
 * Checks entry values against a schema: missing required fields, wrong value types, and unknown
 * fields. An empty array means the values are valid.
 */
export function validateContentEntryValues(
  contentType: Pick<ContentType, "fields">,
  values: unknown,
): ContentValidationError[] {
  if (!isRecord(values)) {
    return [{ field: "values", message: "Values must be an object" }];
  }

  const errors: ContentValidationError[] = [];
  const fields = new Map(contentType.fields.map((field) => [field.name, field]));

  for (const field of contentType.fields) {
    if (!(field.name in values)) {
      if (field.required) {
        errors.push({ field: field.name, message: "Field is required" });
      }
      continue;
    }

    const value = values[field.name];
    if (field.type === "string" && typeof value !== "string") {
      errors.push({ field: field.name, message: "Expected a string" });
    }
    if (field.type === "boolean" && typeof value !== "boolean") {
      errors.push({ field: field.name, message: "Expected a boolean" });
    }
  }

  for (const name of Object.keys(values)) {
    if (!fields.has(name)) {
      errors.push({ field: name, message: "Unknown field" });
    }
  }

  return errors;
}
