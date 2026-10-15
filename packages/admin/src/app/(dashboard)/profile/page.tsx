"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@provisionless/design-system";
import { useEffect, useState } from "react";

import { displayName, fetchCurrentUser, type CurrentUser } from "../../../lib/session.ts";

export default function ProfilePage() {
  const [user, setUser] = useState<CurrentUser | undefined>();

  useEffect(() => {
    let active = true;
    void fetchCurrentUser(process.env.NEXT_PUBLIC_API_URL).then((result) => {
      if (active) {
        setUser(result);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Your account details.</CardDescription>
      </CardHeader>
      <CardContent>
        {user ? (
          <dl className="grid gap-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Name</dt>
              <dd>{displayName(user)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Username</dt>
              <dd>{user.username}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Role</dt>
              <dd>{user.isAdmin ? "Administrator" : "Member"}</dd>
            </div>
          </dl>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            Loading your profile…
          </p>
        )}
      </CardContent>
    </Card>
  );
}
