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
  Logo,
} from "@provisionless/design-system";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";

import { hasSession, resolveRedirect } from "../../lib/session.ts";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = resolveRedirect(searchParams.get("from"));
  const resetConfirmed = searchParams.get("reset") === "success";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;
    void hasSession(process.env.NEXT_PUBLIC_API_URL).then((ok) => {
      if (active && ok) {
        router.replace(redirectTo);
      }
    });
    return () => {
      active = false;
    };
  }, [redirectTo, router]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) {
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        setError("Invalid username or password");
        return;
      }
      router.replace(redirectTo);
      router.refresh();
    } catch {
      setError("Could not reach the API. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <Logo showWordmark={false} className="mb-3" markClassName="size-10" />
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Sign in to manage your content.</CardDescription>
        </CardHeader>
        <CardContent>
          {resetConfirmed ? (
            <Alert className="mb-4">
              <AlertDescription>
                Your password has been reset. Sign in with your new password.
              </AlertDescription>
            </Alert>
          ) : null}
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                name="username"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <Button type="submit" className="w-full" loading={pending}>
              {pending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
