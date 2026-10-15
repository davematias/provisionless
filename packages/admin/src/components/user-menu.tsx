"use client";

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@provisionless/design-system";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { displayName, fetchCurrentUser, logout, type CurrentUser } from "../lib/session.ts";

export default function UserMenu() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | undefined>();
  const [pending, setPending] = useState(false);

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

  async function onSignOut() {
    if (pending) {
      return;
    }
    setPending(true);
    await logout(process.env.NEXT_PUBLIC_API_URL);
    router.replace("/login");
    router.refresh();
  }

  const label = user ? displayName(user) : "Account";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="Account menu">
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/profile">Profile</Link>
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={onSignOut}>
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
