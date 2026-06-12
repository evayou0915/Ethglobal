"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLogout } from "@/client/hooks";

/** Hand-off route used by the static landing's logout button. The landing
 *  page can't touch the React auth store directly (it's plain HTML), so it
 *  navigates here — we drop the session JWT, disconnect the wallet, clear
 *  the legacy localStorage mirror, then bounce back to "/". */
export default function LogoutPage() {
  const router = useRouter();
  const logout = useLogout();

  useEffect(() => {
    (async () => {
      try { await logout(); } catch { /* ignore */ }
      try {
        localStorage.removeItem("aurasci_auth");
        localStorage.removeItem("aurasci_auth_method");
        localStorage.removeItem("aurasci_handle");
      } catch { /* ignore (SSR / private mode) */ }
      router.replace("/");
    })();
  }, [logout, router]);

  return (
    <main style={{ minHeight: "60vh", display: "grid", placeItems: "center", color: "#7a6f63" }}>
      Signing out…
    </main>
  );
}
