"use client";

import { Alert, AlertDescription, Button } from "@provisionless/design-system";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import ContentEntryForm from "../../../../../components/content-entry-form.tsx";
import {
  contentErrorMessage,
  getContentType,
  type ContentType,
} from "../../../../../lib/content.ts";

export default function NewContentEntryPage() {
  const { slug } = useParams<{ slug: string }>();
  const [contentType, setContentType] = useState<ContentType | null | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let active = true;
    void getContentType(slug)
      .then((found) => {
        if (active) {
          setContentType(found ?? null);
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setContentType(null);
          setError(
            contentErrorMessage(caught, "Could not load the content type. Please try again."),
          );
        }
      });
    return () => {
      active = false;
    };
  }, [slug]);

  if (contentType === undefined) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading content type…
      </p>
    );
  }

  if (contentType === null) {
    return (
      <div className="max-w-md space-y-4">
        <Alert variant="destructive">
          <AlertDescription>{error ?? "Content type not found."}</AlertDescription>
        </Alert>
        <Button asChild variant="outline">
          <Link href="/content-types">Back to content</Link>
        </Button>
      </div>
    );
  }

  return <ContentEntryForm contentType={contentType} />;
}
