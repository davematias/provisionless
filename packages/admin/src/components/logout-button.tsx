"use client";

import { Button } from "@provisionless/design-system";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { logout } from "../lib/session.ts";

export default function LogoutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onClick() {
    if (pending) {
      return;
    }
    setPending(true);
    await logout(process.env.NEXT_PUBLIC_API_URL);
    router.replace("/login");
    router.refresh();
  }

  return (
    <Button type="button" variant="ghost" className={className} loading={pending} onClick={onClick}>
      Sign out
    </Button>
  );
}
