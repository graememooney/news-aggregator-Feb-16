"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Article = {
  title: string;
  link: string;
  published: string;

  source: string;
  source_logo?: string | null;
  country_flag_url?: string | null;

  snippet_text: string;

  title_en?: string | null;
  summary_en?: string | null;

  topic?: string | null;

  published_utc?: string | null;
  duplicates_count?: number | null;
  rank_score?: number | null;

  // explainable ranking fields from backend (optional)
  rank_factors?: any;

  source_categories?: string[] | null;
  source_category_primary?: string | null;
};

type Cluster = {
  cluster_id: string;
  topic: string;
  duplicates_count: number;
  sources_count: number;
  sources: { source: string; link: string; published_utc?: string }[];
  best_item: Article;
};

type CountryOption = {
  key: "all" | "mp" | "uy" | "ar" | "br" | "py" | "bo";
  code: string;
  name: string;
  flag_url: string;
};

const MERCOSUR_COUNTRIES: CountryOption[] = [
  { key: "all", code: "ALL", name: "All Mercosur", flag_url: "" },
  { key: "mp", code: "MP", name: "MercoPress", flag_url: "" },
  { key: "uy", code: "UY", name: "Uruguay", flag_url: "https://flagcdn.com/w40/uy.png" },
  { key: "ar", code: "AR", name: "Argentina", flag_url: "https://flagcdn.com/w40/ar.png" },
  { key: "br", code: "BR", name: "Brazil", flag_url: "https://flagcdn.com/w40/br.png" },
  { key: "py", code: "PY", name: "Paraguay", flag_url: "https://flagcdn.com/w40/py.png" },
  { key: "bo", code: "BO", name: "Bolivia", flag_url: "https://flagcdn.com/w40/bo.png" },
];

const ENRICH_BATCH_SIZE = 3;
const OBSERVER_ROOT_MARGIN = "900px";

const UNCATEGORIZED = "General";

const CATEGORY_ORDER = [
  "Politics",
  "Economy",
  "Business",
  "Markets",
  "World",
  "Society",
  "Education",
  "Health",
  "Science",
  "Technology",
  "Energy",
  "Environment",
  "Security",
  "Culture",
  "Sports",
  UNCATEGORIZED,
] as const;

type CategoryFilter = "all" | (typeof CATEGORY_ORDER)[number];

async function safeJson(res: Response) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function initials(source: string) {
  const s = (source || "").trim();
  if (!s) return "N";
  const parts = s.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase()).join("");
}

function includesQuery(haystack: string | null | undefined, q: string) {
  if (!haystack) return false;
  return haystack.toLowerCase().includes(q);
}

// Top Stories should feel curated
function topLimitForCountry(country: CountryOption["key"]) {
  if (country === "all") return 30;
  return 25;
}

function applyTheme(theme: "dark" | "light") {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

// UI: show UTC without seconds
function formatPublishedUTC(a: Article) {
  const iso = (a.published_utc || "").trim();
  if (!iso) return a.published || "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return a.published || "";
  const d = new Date(t);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min} UTC`;
}

// Minimal type for the PWA install prompt event
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function isIOS() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
}

function isStandalone() {
  if (typeof window === "undefined") return false;
  const nav: any = window.navigator;
  return window.matchMedia?.("(display-mode: standalone)")?.matches || !!nav.standalone;
}

function normalizeTopic(t: string | null | undefined) {
  const raw = (t || "").trim();
  if (!raw) return UNCATEGORIZED;
  if (raw.toLowerCase() === "uncategorized") return UNCATEGORIZED;
  return raw;
}

function isLaDiaria(link: string) {
  try {
    const u = new URL(link);
    return u.hostname.includes("ladiaria.com.uy");
  } catch {
    return false;
  }
}

export default function Home() {
  // We always use clustered Top Stories now
  const [clusters, setClusters] = useState<Cluster[]>([]);

  const [query, setQuery] = useState("");
  const [range, setRange] = useState("24h");
  const [country, setCountry] = useState<CountryOption["key"]>("uy");
  const [category, setCategory] = useState<CategoryFilter>("all");

  const [loading, setLoading] = useState(false);
  const [enriching, setEnriching] = useState(false);

  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [mounted, setMounted] = useState(false);

  const [infoOpen, setInfoOpen] = useState(false);

  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [ios, setIos] = useState(false);

  const inflightRef = useRef(false);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const queuedRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<string[]>([]);

  const failedLogosRef = useRef<Set<string>>(new Set());
  const [, forceRerender] = useState(0);

  const normalizedQuery = useMemo(() => query.trim().toLowerCase(), [query]);

  const topicsInData = useMemo(() => {
    const s = new Set<string>();
    for (const c of clusters) s.add(normalizeTopic(c.best_item.topic || c.topic));
    if (!s.size) s.add(UNCATEGORIZED);
    return s;
  }, [clusters]);

  const categoryOptions = useMemo(() => CATEGORY_ORDER, []);

  useEffect(() => {
    if (category !== "all" && !topicsInData.has(category)) {
      setCategory("all");
    }
  }, [topicsInData, category]);

  function openTranslated(link: string) {
    const target = isLaDiaria(link)
      ? `${window.location.origin}/api/reader?url=${encodeURIComponent(link)}`
      : link;

    const encoded = encodeURIComponent(target);
    window.open(`https://translate.google.com/translate?sl=auto&tl=en&u=${encoded}`, "_blank");
  }

  async function loadTopStories(selectedRange = range, selectedCountry = country) {
    setLoading(true);

    const limit = topLimitForCountry(selectedCountry);

    const res = await fetch(
      `/api/top?country=${encodeURIComponent(selectedCountry)}&range=${encodeURIComponent(
        selectedRange
      )}&q=&limit=${encodeURIComponent(String(limit))}`,
      { cache: "no-store" }
    );

    const data = await safeJson(res);
    const list: Cluster[] = (data?.clusters || []) as Cluster[];

    setClusters(list);

    queuedRef.current.clear();
    queueRef.current = [];

    setLoading(false);
  }

  function currentArticlesForEnrichLookup(): Article[] {
    return clusters.map((c) => c.best_item);
  }

  function applyEnrichedToState(link: string, title_en: string, summary_en: string) {
    setClusters((prev) =>
      prev.map((c) => {
        if (c.best_item.link !== link) return c;
        return { ...c, best_item: { ...c.best_item, title_en, summary_en } };
      })
    );
  }

  async function enrichBatch(links: string[]) {
    if (links.length === 0) return;

    const lookup = new Map(currentArticlesForEnrichLookup().map((a) => [a.link, a]));
    const batch = links
      .map((l) => lookup.get(l))
      .filter(Boolean)
      .map((a) => ({
        title: a!.title,
        link: a!.link,
        source: a!.source,
        snippet: a!.snippet_text,
      }));

    if (batch.length === 0) return;

    const res = await fetch("/api/enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: batch }),
      cache: "no-store",
    });

    const data = await safeJson(res);
    const enriched = (data?.items || data?.backend_response?.items || []) as any[];

    for (const e of enriched) {
      const link = (e?.link || "").trim();
      if (!link) continue;
      applyEnrichedToState(link, e.title_en || "", e.summary_en || "");
    }
  }

  async function pumpQueue() {
    if (inflightRef.current || queueRef.current.length === 0) return;

    inflightRef.current = true;
    setEnriching(true);

    try {
      const next = queueRef.current.splice(0, ENRICH_BATCH_SIZE);
      await enrichBatch(next);
    } finally {
      inflightRef.current = false;
      setEnriching(false);

      if (queueRef.current.length > 0) {
        setTimeout(pumpQueue, 50);
      }
    }
  }

  // Initial load
  useEffect(() => {
    loadTopStories("24h", "uy");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // IntersectionObserver for enrichment
  useEffect(() => {
    const list = clusters.map((c) => c.best_item);
    if (list.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        let added = false;

        for (const entry of entries) {
          if (!entry.isIntersecting) continue;

          const link = (entry.target as HTMLElement).dataset.link;
          if (!link) continue;

          const article = list.find((a) => a.link === link);
          if (!article) continue;

          if (article.title_en && article.summary_en) continue;

          if (!queuedRef.current.has(link)) {
            queuedRef.current.add(link);
            queueRef.current.push(link);
            added = true;
          }
        }

        if (added) pumpQueue();
      },
      { rootMargin: OBSERVER_ROOT_MARGIN }
    );

    Object.values(cardRefs.current).forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusters]);

  // Theme / storage hydration-safe
  useEffect(() => {
    setMounted(true);

    try {
      const saved = window.localStorage.getItem("theme");
      const t = saved === "light" || saved === "dark" ? saved : "dark";
      setTheme(t);
    } catch {}

    // install context
    try {
      setIos(isIOS());
      setStandalone(isStandalone());
    } catch {}
  }, []);

  // Handle beforeinstallprompt (Chrome/Edge)
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handler);

    const vis = () => {
      try {
        setStandalone(isStandalone());
      } catch {}
    };
    document.addEventListener("visibilitychange", vis);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);

  useEffect(() => {
    if (!mounted) return;
    applyTheme(theme);
    try {
      window.localStorage.setItem("theme", theme);
    } catch {}
  }, [theme, mounted]);

  // Filtering (category + search)
  const filteredClusters = useMemo(() => {
    let list = clusters;

    if (category !== "all") {
      list = list.filter((c) => normalizeTopic(c.best_item.topic || c.topic) === category);
    }

    if (!normalizedQuery) return list;

    return list.filter((c) => {
      const a = c.best_item;
      const hay = [a.title_en, a.summary_en, a.title, a.snippet_text, a.source, c.topic]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(normalizedQuery);
    });
  }, [clusters, normalizedQuery, category]);

  const missingCount = useMemo(() => {
    const list = clusters.map((c) => c.best_item);
    return list.filter((a) => !a.title_en || !a.summary_en).length;
  }, [clusters]);

  async function handleInstallClick() {
    if (standalone) return;

    if (installEvent) {
      try {
        await installEvent.prompt();
        await installEvent.userChoice;
      } catch {}
      return;
    }

    setInfoOpen(true);
  }

  const selectedCountryName = MERCOSUR_COUNTRIES.find((c) => c.key === country)?.name || "Uruguay";
  const installButtonLabel = installEvent ? "Install" : "Add to Home";

  return (
    <main className="p-8 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="font-extrabold leading-tight tracking-tight text-5xl sm:text-6xl">
            <span className="text-blue-500">Mercosur</span> News
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1 text-sm sm:text-base">
            Your Source for Regional Information
          </p>
        </div>

        <div className="flex items-center gap-3 mt-2">
          <button
            onClick={() => setInfoOpen(true)}
            aria-label="Info"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-500 text-sm transition bg-transparent text-blue-500 hover:text-blue-400"
          >
            <span className="italic font-semibold">i</span>
          </button>

          {!standalone ? (
            <button
              onClick={handleInstallClick}
              className="inline-flex items-center rounded-full border border-gray-500 px-4 py-2 text-sm transition bg-transparent text-black dark:text-white hover:opacity-90"
              title="Add this app to your home screen"
            >
              {installButtonLabel}
            </button>
          ) : null}

          <button
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            className="inline-flex items-center rounded-full border border-gray-500 px-3 py-1.5 text-xs transition bg-black text-white dark:bg-white dark:text-black hover:opacity-90"
          >
            {mounted ? (theme === "dark" ? "Light mode" : "Dark mode") : "Theme"}
          </button>
        </div>
      </div>

      <hr className="border-gray-200 dark:border-gray-800 mb-10" />

      <div className="flex items-baseline justify-between gap-4 mb-6">
        <h2 className="text-3xl font-bold">{selectedCountryName} News</h2>

        <span className="text-gray-600 dark:text-gray-400 text-xs sm:text-sm whitespace-nowrap">
          {loading ? "" : missingCount > 0 ? "" : ""}
        </span>
      </div>

      {/* Controls row */}
      <div className="mb-8 grid grid-cols-1 gap-3 md:grid-cols-12 md:items-end">
        {/* Date Range */}
        <div className="md:col-span-3">
          <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Date Range</label>
          <select
            value={range}
            onChange={(e) => {
              const val = e.target.value;
              setRange(val);
              loadTopStories(val, country);
            }}
            className="w-full h-10 border border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-900 text-black dark:text-white px-3 rounded focus:outline-none focus:ring-2 focus:ring-gray-400"
          >
            <option value="24h">Last 24 Hours</option>
            <option value="3d">Last 3 Days</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
          </select>
        </div>

        {/* Select Country */}
        <div className="md:col-span-3">
          <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Select Country</label>
          <select
            value={country}
            onChange={(e) => {
              const val = e.target.value as CountryOption["key"];
              setCountry(val);
              loadTopStories(range, val);
            }}
            className="w-full h-10 border border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-900 text-black dark:text-white px-3 rounded focus:outline-none focus:ring-2 focus:ring-gray-400"
          >
            {MERCOSUR_COUNTRIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Category */}
        <div className="md:col-span-3">
          <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as CategoryFilter)}
            className="w-full h-10 border border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-900 text-black dark:text-white px-3 rounded focus:outline-none focus:ring-2 focus:ring-gray-400"
          >
            <option value="all">All categories</option>
            {categoryOptions.map((c) => (
              <option key={c} value={c} disabled={!topicsInData.has(c)}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {/* Search */}
        <div className="md:col-span-3">
          <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Search</label>

          <div className="flex items-center gap-3">
            <input
              className="h-10 w-full text-xs border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-black dark:text-white px-3 rounded placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-400"
              placeholder={"Headlines & summaries"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />

            <button
              className="h-10 bg-black text-white dark:bg-white dark:text-black px-4 rounded border border-gray-300 hover:opacity-90 whitespace-nowrap shrink-0"
              onClick={() => {
                // client-side only; button kept for UX
              }}
            >
              Search
            </button>
          </div>
        </div>
      </div>

      {loading && <p className="text-gray-600 dark:text-gray-400">Loading…</p>}

      <div className="space-y-6">
        {filteredClusters.map((c) => {
          const a = c.best_item;

          const src = (a.source || "").trim();
          const logoFailed = failedLogosRef.current.has(src);
          const showLogo = !!a.source_logo && !logoFailed;

          const titleReady = !!(a.title_en && a.title_en.trim());
          const summaryReady = !!(a.summary_en && a.summary_en.trim());

          const topic = normalizeTopic(a.topic || c.topic);

          return (
            <div
              key={c.cluster_id}
              ref={(el) => {
                cardRefs.current[a.link] = el;
              }}
              data-link={a.link}
              className="relative border border-gray-200 dark:border-gray-700 rounded p-5 bg-white dark:bg-transparent"
            >
              {topic ? (
                <div className="absolute top-3 right-3">
                  <span className="text-[11px] px-2 py-1 rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-white/5 text-gray-700 dark:text-white/80">
                    {topic}
                  </span>
                </div>
              ) : null}

              <div className="flex items-center gap-2 mb-2">
                {a.country_flag_url ? (
                  <img src={a.country_flag_url} alt="Flag" className="h-4 w-auto rounded-sm" />
                ) : null}

                {showLogo ? (
                  <img
                    src={a.source_logo as string}
                    alt={a.source}
                    className="h-5 w-5 object-contain"
                    onError={() => {
                      failedLogosRef.current.add(src);
                      forceRerender((x) => x + 1);
                    }}
                  />
                ) : (
                  <span className="inline-flex h-5 min-w-5 px-1 items-center justify-center rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-[11px] border border-gray-200 dark:border-gray-700">
                    {initials(a.source)}
                  </span>
                )}

                <span className="text-sm text-gray-600 dark:text-gray-400">{a.source}</span>
              </div>

              {titleReady ? (
                <h3 className="font-semibold text-lg">{a.title_en}</h3>
              ) : (
                <div className="mt-1 space-y-2 animate-pulse">
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-5/6" />
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/6" />
                </div>
              )}

              {summaryReady ? (
                <p className="mt-2 text-gray-800 dark:text-white/80">{a.summary_en}</p>
              ) : (
                <div className="mt-3 space-y-2 animate-pulse">
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-5/6" />
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-4/6" />
                </div>
              )}

              <p className="text-sm text-gray-600 dark:text-gray-400 mt-3">{formatPublishedUTC(a)}</p>

              <button
                onClick={() => openTranslated(a.link)}
                className="mt-4 inline-flex items-center rounded-full border border-gray-500 px-4 py-2 text-sm transition bg-black text-white dark:bg-white dark:text-black hover:opacity-90"
              >
                Open Translated Article →
              </button>
            </div>
          );
        })}
      </div>

      {/* Info Modal */}
      {infoOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button className="absolute inset-0 bg-black/60" aria-label="Close" onClick={() => setInfoOpen(false)} />
          <div className="relative w-full max-w-xl max-h-[85vh] overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-black p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold">About Mercosur News</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  RSS headlines across Mercosur, translated to English with short summaries.
                </p>
              </div>

              <button
                onClick={() => setInfoOpen(false)}
                className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 hover:opacity-90"
                aria-label="Close modal"
              >
                Close
              </button>
            </div>

            <div className="mt-4 space-y-4 text-sm">
              <div className="text-gray-800 dark:text-white/80">
                <p>
                  Mercosur News aggregates public RSS headlines across the Mercosur region and presents them in a clean,
                  readable feed.
                </p>
                <p className="mt-2">
                  As you scroll, headlines are translated into English and paired with short English summaries. You can
                  open any source article via Google Translate to view the full story in English.
                </p>
              </div>

              <div className="border-t border-gray-200 dark:border-gray-800 pt-4">
                <div className="font-semibold text-gray-900 dark:text-white">How to use</div>
                <ul className="mt-2 list-disc pl-5 space-y-1 text-gray-600 dark:text-gray-400">
                  <li>
                    <span className="text-gray-800 dark:text-white/80">Date Range:</span> filter by recency.
                  </li>
                  <li>
                    <span className="text-gray-800 dark:text-white/80">Select Country:</span> view by country (or all /
                    MercoPress).
                  </li>
                  <li>
                    <span className="text-gray-800 dark:text-white/80">Category:</span> filter the feed by topic.
                  </li>
                  <li>
                    <span className="text-gray-800 dark:text-white/80">Search:</span> filter headlines and summaries.
                  </li>
                </ul>
              </div>

              <div className="border-t border-gray-200 dark:border-gray-800 pt-4">
                <div className="font-semibold text-gray-900 dark:text-white">Add to Home Screen</div>

                {standalone ? (
                  <div className="mt-2 text-gray-600 dark:text-gray-400">
                    You’re already running Mercosur News in installed mode.
                  </div>
                ) : installEvent ? (
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <div className="text-gray-600 dark:text-gray-400">Your browser supports installing this app.</div>
                    <button
                      onClick={handleInstallClick}
                      className="inline-flex items-center rounded-full border border-gray-500 px-4 py-2 text-sm transition bg-black text-white dark:bg-white dark:text-black hover:opacity-90 whitespace-nowrap"
                    >
                      Install
                    </button>
                  </div>
                ) : ios ? (
                  <div className="mt-2 text-gray-600 dark:text-gray-400">
                    On iPhone/iPad: tap Share in Safari, then choose “Add to Home Screen”.
                  </div>
                ) : (
                  <div className="mt-2 text-gray-600 dark:text-gray-400">
                    If you don’t see an Install prompt, the site may not be installable in this browser yet.
                  </div>
                )}
              </div>

              <div className="border-t border-gray-200 dark:border-gray-800 pt-4">
                <div className="font-semibold text-gray-900 dark:text-white">Notes</div>
                <p className="mt-2 text-gray-600 dark:text-gray-400">
                  Topics are automatically labeled. Translation and summarization are generated as stories enter view to
                  keep the feed responsive.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}