"use client";

import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@provisionless/design-system";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import {
  ContentApiError,
  contentErrorMessage,
  saveContentType,
  type ContentField,
  type ContentFieldError,
  type ContentFieldType,
  type ContentType,
} from "../lib/content.ts";

interface EditableField {
  name: string;
  type: ContentFieldType;
  required: boolean;
}

function emptyField(): EditableField {
  return { name: "", type: "string", required: false };
}

function editableFields(contentType: ContentType | undefined): EditableField[] {
  if (!contentType) {
    return [emptyField()];
  }
  return contentType.fields.map((field) => ({
    name: field.name,
    type: field.type,
    required: field.required ?? false,
  }));
}

const selectClasses =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30";

export default function ContentTypeEditor({ initial }: { initial?: ContentType }) {
  const router = useRouter();
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [fields, setFields] = useState<EditableField[]>(() => editableFields(initial));
  const [error, setError] = useState<string | undefined>();
  const [fieldErrors, setFieldErrors] = useState<ContentFieldError[]>([]);
  const [pending, setPending] = useState(false);

  function updateField(index: number, patch: Partial<EditableField>) {
    setFields((current) =>
      current.map((field, fieldIndex) => (fieldIndex === index ? { ...field, ...patch } : field)),
    );
  }

  function addField() {
    setFields((current) => [...current, emptyField()]);
  }

  function removeField(index: number) {
    setFields((current) =>
      current.length === 1 ? current : current.filter((_, fieldIndex) => fieldIndex !== index),
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) {
      return;
    }

    setPending(true);
    setError(undefined);
    setFieldErrors([]);
    try {
      const saved = await saveContentType(slug.trim(), {
        name: name.trim(),
        fields: fields.map((field): ContentField => ({
          name: field.name.trim(),
          type: field.type,
          required: field.required,
        })),
      });
      router.push(`/content-types/${encodeURIComponent(saved.slug)}/edit`);
      router.refresh();
    } catch (caught) {
      setError(contentErrorMessage(caught, "Could not save the content type. Please try again."));
      if (caught instanceof ContentApiError) {
        setFieldErrors(caught.errors);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>{initial ? "Edit content type" : "New content type"}</CardTitle>
        <CardDescription>
          Define a slug, a display name, and the fields entries of this type can store.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="content-type-slug">Slug</Label>
              <Input
                id="content-type-slug"
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
                disabled={initial !== undefined}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="content-type-name">Name</Label>
              <Input
                id="content-type-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-sm font-medium">Fields</h2>
              <Button type="button" variant="outline" size="sm" onClick={addField}>
                Add field
              </Button>
            </div>
            {fields.map((field, index) => (
              <div
                key={index}
                className="grid gap-2 border-b border-border pb-3 md:grid-cols-[1fr_10rem_auto_auto] md:items-end"
              >
                <div className="space-y-2">
                  <Label htmlFor={`field-${index}-name`}>Field name</Label>
                  <Input
                    id={`field-${index}-name`}
                    value={field.name}
                    onChange={(event) => updateField(index, { name: event.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`field-${index}-type`}>Type</Label>
                  <select
                    id={`field-${index}-type`}
                    className={selectClasses}
                    value={field.type}
                    onChange={(event) =>
                      updateField(index, { type: event.target.value as ContentFieldType })
                    }
                  >
                    <option value="string">String</option>
                    <option value="boolean">Boolean</option>
                  </select>
                </div>
                <label className="flex h-9 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 rounded border-input"
                    checked={field.required}
                    onChange={(event) => updateField(index, { required: event.target.checked })}
                  />
                  Required
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeField(index)}
                  disabled={fields.length === 1}
                  aria-label={`Remove field ${index + 1}`}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>
                <p>{error}</p>
                {fieldErrors.length > 0 ? (
                  <ul className="list-disc pl-4">
                    {fieldErrors.map((fieldError) => (
                      <li key={`${fieldError.field}:${fieldError.message}`}>
                        {fieldError.field}: {fieldError.message}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="flex gap-2">
            <Button type="submit" loading={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button asChild variant="outline">
              <Link href="/content-types">Cancel</Link>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
