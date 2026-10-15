"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { hasSession, isPublicPath, loginUrlFor } from "../lib/session.ts";

export default function AuthGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = isPublicPath(pathname);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    if (isPublic) {
      return;
    }
    let active = true;
    setAuthenticated(false);
    void hasSession(process.env.NEXT_PUBLIC_API_URL).then((ok) => {
      if (!active) {
        return;
      }
      if (ok) {
        setAuthenticated(true);
      } else {
        router.replace(loginUrlFor(pathname));
      }
    });
    return () => {
      active = false;
    };
  }, [isPublic, pathname, router]);

  if (isPublic) {
    return <>{children}</>;
  }
  if (!authenticated) {
    return <p role="status">Checking your session…</p>;
  }
  return <>{children}</>;
}
