"use client";

import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@provisionless/design-system";
import Link from "next/link";
import { useEffect, useState } from "react";

import { contentErrorMessage, listContentTypes, type ContentType } from "../../../lib/content.ts";

export default function ContentTypesPage() {
  const [contentTypes, setContentTypes] = useState<ContentType[] | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let active = true;
    void listContentTypes()
      .then((types) => {
        if (active) {
          setContentTypes(types);
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setContentTypes([]);
          setError(contentErrorMessage(caught, "Could not load content types. Please try again."));
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Content</h1>
          <p className="text-sm text-muted-foreground">
            Define content types and manage the entries stored in them.
          </p>
        </div>
        <Button asChild>
          <Link href="/content-types/new">New content type</Link>
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent className="pt-6">
          {contentTypes === undefined ? (
            <p role="status" className="text-sm text-muted-foreground">
              Loading content types…
            </p>
          ) : contentTypes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No content types yet. Create one to start adding entries.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Fields</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contentTypes.map((contentType) => (
                  <TableRow key={contentType.slug}>
                    <TableCell className="font-medium">{contentType.name}</TableCell>
                    <TableCell className="text-muted-foreground">{contentType.slug}</TableCell>
                    <TableCell>{contentType.fields.length}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button asChild variant="outline" size="sm">
                          <Link
                            href={`/content-types/${encodeURIComponent(contentType.slug)}/edit`}
                          >
                            Edit
                          </Link>
                        </Button>
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/content/${encodeURIComponent(contentType.slug)}`}>
                            Entries
                          </Link>
                        </Button>
                      </div>
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
