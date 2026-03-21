"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Legacy /mercosur route — redirects to the main page with region=mercosur.
 * Preserves any query params the user had (country, range, category, etc.)
 */
export default function MercosurRedirect() {
  const router = useRouter();

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);

    // Map old "country" param to the main page's "subdivision" param
    const country = sp.get("country");
    if (country) {
      sp.set("subdivision", country);
      sp.delete("country");
    }

    // Ensure region is set
    if (!sp.has("region")) {
      sp.set("region", "mercosur");
    }

    const qs = sp.toString();
    router.replace(`/${qs ? `?${qs}` : ""}`);
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-black text-white">
      <p className="text-sm text-gray-400">Redirecting…</p>
    </div>
  );
}
