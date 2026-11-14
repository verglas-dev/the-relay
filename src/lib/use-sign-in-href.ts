"use client";

import { useEffect, useState } from "react";
import { signInUrl } from "@/lib/verglas-site";

/**
 * A "Sign in with GitHub" link that comes back to this page as it is now,
 * query included. Until the page knows where it is, the plain sign-in.
 */
export function useSignInHref(): string {
  const [href, setHref] = useState("/api/verglas/auth");
  useEffect(() => {
    setHref(signInUrl(window.location.pathname + window.location.search));
  }, []);
  return href;
}
