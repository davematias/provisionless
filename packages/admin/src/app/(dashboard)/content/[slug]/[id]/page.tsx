"use client";

import { Alert, AlertDescription, Button } from "@provisionless/design-system";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import ContentEntryForm from "../../../../../components/content-entry-form.tsx";
import {
  contentErrorMessage,
  getContentEntry,
  getContentType,
  type ContentEntry,
  type ContentType,
} from "../../../../../lib/content.ts";

export default function EditContentEntryPage() {
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const [contentType, setContentType] = useState<ContentType | null | undefined>();
  const [entry, setEntry] = useState<ContentEntry | null | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let active = true;
    void Promise.all([getContentType(slug), getContentEntry(slug, id)])
      .then(([foundType, foundEntry]) => {
        if (active) {
          setContentType(foundType ?? null);
          setEntry(foundEntry ?? null);
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setContentType(null);
          setEntry(null);
          setError(contentErrorMessage(caught, "Could not load the entry. Please try again."));
        }
      });
    return () => {
      active = false;
    };
  }, [id, slug]);

  if (contentType === undefined || entry === undefined) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading entry…
      </p>
    );
  }

  if (contentType === null || entry === null) {
    return (
      <div className="max-w-md space-y-4">
        <Alert variant="destructive">
          <AlertDescription>{error ?? "Content entry not found."}</AlertDescription>
        </Alert>
        <Button asChild variant="outline">
          <Link href={`/content/${encodeURIComponent(slug)}`}>Back to entries</Link>
        </Button>
      </div>
    );
  }

  return <ContentEntryForm contentType={contentType} entry={entry} />;
}
