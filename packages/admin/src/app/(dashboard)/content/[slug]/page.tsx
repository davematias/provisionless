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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@provisionless/design-system";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import {
  contentErrorMessage,
  getContentType,
  listContentEntries,
  type ContentEntry,
  type ContentType,
} from "../../../../lib/content.ts";

export default function ContentEntriesPage() {
  const { slug } = useParams<{ slug: string }>();
  const [contentType, setContentType] = useState<ContentType | null | undefined>();
  const [entries, setEntries] = useState<ContentEntry[]>([]);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let active = true;
    void Promise.all([getContentType(slug), listContentEntries(slug)])
      .then(([found, loadedEntries]) => {
        if (active) {
          setContentType(found ?? null);
          setEntries(loadedEntries);
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setContentType(null);
          setError(contentErrorMessage(caught, "Could not load entries. Please try again."));
        }
      });
    return () => {
      active = false;
    };
  }, [slug]);

  if (contentType === undefined) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading entries…
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{contentType.name}</h1>
          <p className="text-sm text-muted-foreground">
            Entries stored for the {contentType.slug} content type.
          </p>
        </div>
        <Button asChild>
          <Link href={`/content/${encodeURIComponent(slug)}/new`}>New entry</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Entries</CardTitle>
          <CardDescription>
            {entries.length === 0 ? "No entries yet." : `${entries.length} entries`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? null : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Values</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {entry.id}
                    </TableCell>
                    <TableCell>
                      <code className="block max-w-md break-all whitespace-pre-wrap text-xs">
                        {JSON.stringify(entry.values)}
                      </code>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="outline" size="sm">
                        <Link
                          href={`/content/${encodeURIComponent(slug)}/${encodeURIComponent(entry.id)}`}
                        >
                          Edit
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
