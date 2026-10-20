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
  createContentEntry,
  updateContentEntry,
  type ContentEntry,
  type ContentEntryValues,
  type ContentFieldError,
  type ContentType,
} from "../lib/content.ts";

function initialValues(
  contentType: ContentType,
  entry: ContentEntry | undefined,
): ContentEntryValues {
  return Object.fromEntries(
    contentType.fields.map((field) => [
      field.name,
      entry?.values[field.name] ?? (field.type === "boolean" ? false : ""),
    ]),
  );
}

export default function ContentEntryForm({
  contentType,
  entry,
}: {
  contentType: ContentType;
  entry?: ContentEntry;
}) {
  const router = useRouter();
  const [values, setValues] = useState<ContentEntryValues>(() => initialValues(contentType, entry));
  const [error, setError] = useState<string | undefined>();
  const [fieldErrors, setFieldErrors] = useState<ContentFieldError[]>([]);
  const [pending, setPending] = useState(false);

  function setValue(name: string, value: string | boolean) {
    setValues((current) => ({ ...current, [name]: value }));
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
      if (entry) {
        await updateContentEntry(contentType.slug, entry.id, values);
      } else {
        await createContentEntry(contentType.slug, values);
      }
      router.push(`/content/${encodeURIComponent(contentType.slug)}`);
      router.refresh();
    } catch (caught) {
      setError(contentErrorMessage(caught, "Could not save the entry. Please try again."));
      if (caught instanceof ContentApiError) {
        setFieldErrors(caught.errors);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>{entry ? "Edit entry" : "New entry"}</CardTitle>
        <CardDescription>{contentType.name}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          {contentType.fields.map((field, index) => {
            const id = `entry-field-${index}`;
            if (field.type === "boolean") {
              return (
                <div key={field.name} className="flex items-center gap-2">
                  <input
                    id={id}
                    type="checkbox"
                    className="size-4 rounded border-input"
                    checked={values[field.name] === true}
                    onChange={(event) => setValue(field.name, event.target.checked)}
                  />
                  <Label htmlFor={id}>
                    {field.name}
                    {field.required ? " (required)" : ""}
                  </Label>
                </div>
              );
            }

            const value = values[field.name];
            return (
              <div key={field.name} className="space-y-2">
                <Label htmlFor={id}>
                  {field.name}
                  {field.required ? " *" : ""}
                </Label>
                <Input
                  id={id}
                  value={typeof value === "string" ? value : ""}
                  onChange={(event) => setValue(field.name, event.target.value)}
                  required={field.required}
                />
              </div>
            );
          })}

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
              <Link href={`/content/${encodeURIComponent(contentType.slug)}`}>Cancel</Link>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
