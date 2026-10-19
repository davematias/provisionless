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
import { useEffect, useState, type FormEvent } from "react";

import { fetchCurrentUser, type CurrentUser } from "../../../lib/session.ts";

export default function ResetLinksPage() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | undefined>();
  const [loaded, setLoaded] = useState(false);
  const [username, setUsername] = useState("");
  const [link, setLink] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    void fetchCurrentUser(process.env.NEXT_PUBLIC_API_URL).then((user) => {
      if (active) {
        setCurrentUser(user);
        setLoaded(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) {
      return;
    }
    setPending(true);
    setError(undefined);
    setLink(undefined);
    setCopied(false);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/reset/link`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username }),
      });
      if (response.status === 403) {
        setError("You do not have permission to create reset links.");
        return;
      }
      if (response.status === 404) {
        setError("No user with that username was found.");
        return;
      }
      if (!response.ok) {
        setError("Could not create a reset link. Please try again.");
        return;
      }
      const body = (await response.json()) as { url?: unknown };
      if (typeof body.url !== "string" || body.url === "") {
        setError("Could not create a reset link. Please try again.");
        return;
      }
      setLink(body.url);
    } catch {
      setError("Could not reach the API. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function copyLink() {
    if (!link) {
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setError("Could not copy the link. Select it and copy it manually.");
    }
  }

  if (!loaded) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Checking your permissions…
      </p>
    );
  }

  if (!currentUser) {
    return (
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Reset links</CardTitle>
          <CardDescription>Generate a link when email delivery is not available.</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertDescription>
              Could not verify your account. Refresh the page and try again.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (!currentUser.isAdmin) {
    return (
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Reset links</CardTitle>
          <CardDescription>Generate a link when email delivery is not available.</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertDescription>Only administrators can create reset links.</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Reset links</h1>
        <p className="text-sm text-muted-foreground">
          Generate a single-use link to share when email delivery is unavailable.
        </p>
      </div>
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Create a reset link</CardTitle>
          <CardDescription>
            The link expires in one hour and can be used once. Share it over a trusted channel.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                name="username"
                autoComplete="off"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
              />
            </div>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <Button type="submit" loading={pending}>
              {pending ? "Creating…" : "Create reset link"}
            </Button>
          </form>
          {link ? (
            <div className="space-y-2 border-t border-border pt-4">
              <Label htmlFor="reset-link">Shareable reset link</Label>
              <div className="flex gap-2">
                <Input
                  id="reset-link"
                  readOnly
                  value={link}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button type="button" variant="outline" onClick={() => void copyLink()}>
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
