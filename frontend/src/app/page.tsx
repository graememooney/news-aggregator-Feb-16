"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const STORAGE_KEYS = {
  theme: "mercosur-news-theme",
} as const;

function applyTheme(theme: "dark" | "light") {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

export default function Home() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let savedTheme: "dark" | "light" = "dark";

    try {
      const themeRaw = window.localStorage.getItem(STORAGE_KEYS.theme);
      if (themeRaw === "light" || themeRaw === "dark") {
        savedTheme = themeRaw;
      }
    } catch {}

    setTheme(savedTheme);
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    applyTheme(theme);

    try {
      window.localStorage.setItem(STORAGE_KEYS.theme, theme);
    } catch {}
  }, [theme, mounted]);

  return (
    <main className="mx-auto min-h-screen max-w-6xl overflow-x-hidden px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
      <section className="relative overflow-hidden rounded-3xl border border-gray-200/80 bg-white/80 px-5 py-6 shadow-sm backdrop-blur-sm dark:border-gray-800 dark:bg-black/40 sm:px-7 sm:py-8">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.12),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(99,102,241,0.10),transparent_32%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.16),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(99,102,241,0.12),transparent_32%)]" />

        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="break-words text-5xl font-extrabold leading-[0.95] tracking-tight text-gray-950 dark:text-white sm:text-6xl">
              Regional News
            </h1>

            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-gray-600 dark:text-gray-400 sm:text-base">
              English-language regional editions designed to make local news easier to follow, compare, and scan.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <button
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              className="inline-flex min-h-11 items-center rounded-full border border-gray-900 bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:opacity-90 dark:border-white dark:bg-white dark:text-black"
            >
              {mounted ? (theme === "dark" ? "Light mode" : "Dark mode") : "Theme"}
            </button>
          </div>
        </div>
      </section>

      <section className="mt-8 rounded-3xl border border-gray-200 bg-white/80 p-5 shadow-sm backdrop-blur-sm dark:border-gray-800 dark:bg-black/30 sm:p-6">
        <div className="max-w-3xl">
          <h2 className="text-2xl font-bold tracking-tight text-gray-950 dark:text-white sm:text-3xl">
            Choose your edition
          </h2>

          <p className="mt-3 text-sm leading-relaxed text-gray-600 dark:text-gray-400 sm:text-base">
            Mercosur is the first live edition. Additional regional editions such as Mexico and Central America will be added here as the platform expands.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <Link
            href="/mercosur"
            className="group rounded-3xl border border-gray-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md dark:border-gray-800 dark:bg-white/[0.03] dark:hover:border-blue-500/40"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300">
                  Live now
                </div>

                <h3 className="mt-4 text-2xl font-bold tracking-tight text-gray-950 dark:text-white">
                  Mercosur
                </h3>

                <p className="mt-2 max-w-md text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                  Follow major stories across Uruguay, Argentina, Brazil, Paraguay, Bolivia, and MercoPress in English.
                </p>
              </div>

              <div className="shrink-0 rounded-full border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-900 transition group-hover:border-blue-300 group-hover:text-blue-600 dark:border-gray-700 dark:text-white dark:group-hover:border-blue-500/40 dark:group-hover:text-blue-300">
                Open
              </div>
            </div>
          </Link>

          <div className="rounded-3xl border border-dashed border-gray-300 bg-gray-50/70 p-5 dark:border-gray-700 dark:bg-white/[0.02]">
            <div className="inline-flex items-center rounded-full border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:border-gray-700 dark:bg-white/[0.04] dark:text-gray-400">
              Coming later
            </div>

            <h3 className="mt-4 text-2xl font-bold tracking-tight text-gray-950 dark:text-white">
              More regions
            </h3>

            <p className="mt-2 max-w-md text-sm leading-relaxed text-gray-600 dark:text-gray-400">
              Future editions will appear here as the platform expands into additional regional markets.
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-400">
                Mexico
              </span>
              <span className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-400">
                Central America
              </span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}