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
const PRIORITY_ENRICH_COUNT = 5;
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

type EnrichStatus = "idle" | "loading" | "ok" | "error";
type EnrichState = { status: EnrichStatus; message?: string };

type LoadError = { message: string; status?: number } | null;

const STORAGE_KEYS = {
  theme: "mercosur-news-theme",
  country: "mercosur-news-country",
  range: "mercosur-news-range",
  category: "mercosur-news-category",
} as const;

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

function storyCountLabel(count: number) {
  return `${count} ${count === 1 ? "story" : "stories"}`;
}

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

function isValidCountryKey(value: string): value is CountryOption["key"] {
  return ["all", "mp", "uy", "ar", "br", "py", "bo"].includes(value);
}

function isValidRange(value: string) {
  return ["24h", "3d", "7d", "30d"].includes(value);
}

function isValidCategory(value: string): value is CategoryFilter {
  return value === "all" || CATEGORY_ORDER.includes(value as (typeof CATEGORY_ORDER)[number]);
}

export default function Home() {
  const [clusters, setClusters] = useState<Cluster[]>([]);

  const [query, setQuery] = useState("");
  const [range, setRange] = useState("24h");
  const [country, setCountry] = useState<CountryOption["key"]>("uy");
  const [category, setCategory] = useState<CategoryFilter>("all");

  const [loading, setLoading] = useState(false);

  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [mounted, setMounted] = useState(false);
  const [prefsReady, setPrefsReady] = useState(false);

  const [infoOpen, setInfoOpen] = useState(false);

  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [ios, setIos] = useState(false);

  const [loadError, setLoadError] = useState<LoadError>(null);

  const [enrichState, setEnrichState] = useState<Record<string, EnrichState>>({});

  const inflightRef = useRef(false);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const queuedRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<string[]>([]);

  const failedLogosRef = useRef<Set<string>>(new Set());
  const [, forceRerender] = useState(0);

  const searchInputRef = useRef<HTMLInputElement | null>(null);

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
    const target = isLaDiaria(link) ? `${window.location.origin}/api/reader?url=${encodeURIComponent(link)}` : link;
    const encoded = encodeURIComponent(target);
    window.open(`https://translate.google.com/translate?sl=auto&tl=en&u=${encoded}`, "_blank");
  }

  function performSearchAction() {
    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {}
    try {
      searchInputRef.current?.blur();
    } catch {}
  }

  function clearSearchAndCategory() {
    setQuery("");
    setCategory("all");
    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {}
    try {
      searchInputRef.current?.focus();
    } catch {}
  }

  async function loadTopStories(selectedRange = range, selectedCountry = country) {
    setLoading(true);
    setLoadError(null);

    const limit = topLimitForCountry(selectedCountry);

    try {
      const res = await fetch(
        `/api/top?country=${encodeURIComponent(selectedCountry)}&range=${encodeURIComponent(selectedRange)}&q=&limit=${encodeURIComponent(
          String(limit)
        )}`,
        { cache: "no-store" }
      );

      const data = await safeJson(res);

      if (!res.ok) {
        const msg = (data?.error as string) || (data?.detail as string) || "We couldn’t load headlines right now.";
        setClusters([]);
        setLoadError({ message: msg, status: res.status });
      } else {
        const list: Cluster[] = (data?.clusters || []) as Cluster[];
        setClusters(list);

        queuedRef.current.clear();
        queueRef.current = [];
        setEnrichState({});
      }
    } catch {
      setClusters([]);
      setLoadError({ message: "We couldn’t load headlines right now.", status: 0 });
    } finally {
      setLoading(false);
    }
  }

  function currentArticlesForEnrichLookup(): Article[] {
    return clusters.map((c) => c.best_item);
  }

  function setLinkState(link: string, next: EnrichState) {
    if (!link) return;
    setEnrichState((prev) => ({ ...prev, [link]: next }));
  }

  function applyEnrichedToState(link: string, title_en: string, summary_en: string) {
    setClusters((prev) =>
      prev.map((c) => {
        if (c.best_item.link !== link) return c;
        return { ...c, best_item: { ...c.best_item, title_en, summary_en } };
      })
    );
    setLinkState(link, { status: "ok" });
  }

  function markBatchLoading(links: string[]) {
    setEnrichState((prev) => {
      const next = { ...prev };
      for (const link of links) {
        const cur = next[link];
        if (cur?.status === "ok") continue;
        next[link] = { status: "loading" };
      }
      return next;
    });
  }

  function markBatchError(links: string[], message?: string) {
    setEnrichState((prev) => {
      const next = { ...prev };
      for (const link of links) {
        const cur = next[link];
        if (cur?.status === "ok") continue;
        next[link] = { status: "error", message: message || "Summary unavailable." };
      }
      return next;
    });
  }

  async function enrichBatch(links: string[]) {
    if (links.length === 0) return;

    const lookup = new Map(currentArticlesForEnrichLookup().map((a) => [a.link, a]));
    const linkToClusterId = new Map(clusters.map((c) => [c.best_item.link, c.cluster_id]));

    const batch = links
      .map((l) => {
        const a = lookup.get(l);
        if (!a) return null;
        if (a.title_en && a.summary_en) return null;

        const cluster_id = linkToClusterId.get(l) || "";
        return { title: a.title, link: a.link, source: a.source, snippet: a.snippet_text, cluster_id };
      })
      .filter(Boolean) as any[];

    if (batch.length === 0) return;

    const batchLinks = batch.map((b) => String(b.link || "").trim()).filter(Boolean);
    markBatchLoading(batchLinks);

    const res = await fetch("/api/enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: batch }),
      cache: "no-store",
    });

    const data = await safeJson(res);
    const enriched = (data?.items || data?.backend_response?.items || []) as any[];

    if (!res.ok) {
      const msg =
        (data?.error as string) ||
        (data?.backend_response?.detail as string) ||
        (data?.backend_response?.error as string) ||
        "Summary unavailable.";
      markBatchError(batchLinks, msg);
      return;
    }

    const got = new Set<string>();
    for (const e of enriched) {
      const link = (e?.link || "").trim();
      if (!link) continue;

      const t = (e?.title_en || "").trim();
      const s = (e?.summary_en || "").trim();

      if (t && s) {
        applyEnrichedToState(link, t, s);
        got.add(link);
      }
    }

    const missed = batchLinks.filter((l) => !got.has(l));
    if (missed.length > 0) markBatchError(missed, "Summary unavailable.");
  }

  async function pumpQueue() {
    if (inflightRef.current || queueRef.current.length === 0) return;

    inflightRef.current = true;

    try {
      const next = queueRef.current.splice(0, ENRICH_BATCH_SIZE);
      await enrichBatch(next);
    } finally {
      inflightRef.current = false;

      if (queueRef.current.length > 0) {
        setTimeout(pumpQueue, 50);
      }
    }
  }

  function retryEnrich(link: string) {
    const l = (link || "").trim();
    if (!l) return;

    setLinkState(l, { status: "idle" });
    queuedRef.current.delete(l);

    queueRef.current.push(l);
    queuedRef.current.add(l);

    pumpQueue();
  }

  useEffect(() => {
    let savedTheme: "dark" | "light" = "dark";
    let savedCountry: CountryOption["key"] = "uy";
    let savedRange = "24h";
    let savedCategory: CategoryFilter = "all";

    try {
      const themeRaw = window.localStorage.getItem(STORAGE_KEYS.theme);
      if (themeRaw === "light" || themeRaw === "dark") {
        savedTheme = themeRaw;
      }

      const countryRaw = window.localStorage.getItem(STORAGE_KEYS.country);
      if (countryRaw && isValidCountryKey(countryRaw)) {
        savedCountry = countryRaw;
      }

      const rangeRaw = window.localStorage.getItem(STORAGE_KEYS.range);
      if (rangeRaw && isValidRange(rangeRaw)) {
        savedRange = rangeRaw;
      }

      const categoryRaw = window.localStorage.getItem(STORAGE_KEYS.category);
      if (categoryRaw && isValidCategory(categoryRaw)) {
        savedCategory = categoryRaw;
      }
    } catch {}

    setMounted(true);
    setTheme(savedTheme);

    try {
      setIos(isIOS());
      setStandalone(isStandalone());
    } catch {}

    setCountry(savedCountry);
    setRange(savedRange);
    setCategory(savedCategory);
    setPrefsReady(true);

    loadTopStories(savedRange, savedCountry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (clusters.length === 0) return;

    const priorityLinks: string[] = [];
    for (const c of clusters) {
      const a = c.best_item;
      const link = (a.link || "").trim();
      if (!link) continue;
      if (a.title_en && a.summary_en) continue;

      const st = enrichState[link]?.status;
      if (st === "loading" || st === "error" || st === "ok") continue;
      if (queuedRef.current.has(link)) continue;

      priorityLinks.push(link);
      if (priorityLinks.length >= PRIORITY_ENRICH_COUNT) break;
    }

    if (priorityLinks.length === 0) return;

    for (const link of priorityLinks) {
      queuedRef.current.add(link);
      queueRef.current.push(link);
    }

    pumpQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusters]);

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

          const st = enrichState[link]?.status;
          if (st === "error" || st === "loading") continue;

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
  }, [clusters, enrichState]);

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
      window.localStorage.setItem(STORAGE_KEYS.theme, theme);
    } catch {}
  }, [theme, mounted]);

  useEffect(() => {
    if (!prefsReady) return;
    try {
      window.localStorage.setItem(STORAGE_KEYS.country, country);
    } catch {}
  }, [country, prefsReady]);

  useEffect(() => {
    if (!prefsReady) return;
    try {
      window.localStorage.setItem(STORAGE_KEYS.range, range);
    } catch {}
  }, [range, prefsReady]);

  useEffect(() => {
    if (!prefsReady) return;
    try {
      window.localStorage.setItem(STORAGE_KEYS.category, category);
    } catch {}
  }, [category, prefsReady]);

  const filteredClusters = useMemo(() => {
    let list = clusters;

    if (category !== "all") {
      list = list.filter((c) => normalizeTopic(c.best_item.topic || c.topic) === category);
    }

    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return list;

    return list.filter((c) => {
      const a = c.best_item;
      const hay = [a.title_en, a.summary_en, a.source, c.topic].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(normalizedQuery);
    });
  }, [clusters, query, category]);

  const hasActiveSearch = query.trim().length > 0;
  const hasActiveCategory = category !== "all";
  const showEmptyState = !loading && !loadError && clusters.length > 0 && filteredClusters.length === 0;
  const showClearFilters = showEmptyState && (hasActiveSearch || hasActiveCategory);

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
    <main className="mx-auto max-w-5xl overflow-x-hidden px-4 py-6 sm:p-8">
      <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="break-words text-5xl font-extrabold leading-tight tracking-tight sm:text-6xl">
            <span className="text-blue-500">Mercosur</span> News
          </h1>
          <p className="mt-2 max-w-md text-sm text-gray-600 dark:text-gray-400 sm:text-base">Your Source for Regional Information</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:mt-2 sm:justify-end">
          <button
            onClick={() => setInfoOpen(true)}
            aria-label="Info"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-gray-500 bg-transparent text-sm text-blue-500 transition hover:text-blue-400"
          >
            <span className="italic font-semibold">i</span>
          </button>

          {!standalone ? (
            <button
              onClick={handleInstallClick}
              className="inline-flex min-h-10 items-center rounded-full border border-gray-500 bg-transparent px-4 py-2 text-sm text-black transition hover:opacity-90 dark:text-white"
              title="Add this app to your home screen"
            >
              {installButtonLabel}
            </button>
          ) : null}

          <button
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            className="inline-flex min-h-10 items-center rounded-full border border-gray-500 bg-black px-4 py-2 text-sm text-white transition hover:opacity-90 dark:bg-white dark:text-black"
          >
            {mounted ? (theme === "dark" ? "Light mode" : "Dark mode") : "Theme"}
          </button>
        </div>
      </div>

      <hr className="mb-10 border-gray-200 dark:border-gray-800" />

      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-3xl font-bold">{selectedCountryName} News</h2>
          {!loading && !loadError ? (
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{storyCountLabel(filteredClusters.length)}</p>
          ) : null}
        </div>
      </div>

      {loadError ? (
        <div className="mb-6 rounded border border-gray-300 bg-gray-50 p-4 dark:border-gray-700 dark:bg-white/5">
          <div className="flex items-start justify-between gap-3">
            <div className="text-sm text-gray-800 dark:text-white/80">
              <div className="font-semibold">Service temporarily unavailable</div>
              <div className="mt-1 text-gray-600 dark:text-gray-400">
                We couldn’t load headlines right now. Please try again in a moment.
              </div>
              {typeof loadError.status === "number" && loadError.status ? (
                <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-500">Error code: {loadError.status}</div>
              ) : null}
            </div>
            <button
              onClick={() => loadTopStories(range, country)}
              className="inline-flex items-center whitespace-nowrap rounded-full border border-gray-500 bg-black px-4 py-2 text-sm text-white transition hover:opacity-90 dark:bg-white dark:text-black"
            >
              Retry
            </button>
          </div>
        </div>
      ) : null}

      <div className="mb-8 grid grid-cols-1 gap-3 md:grid-cols-12 md:items-end">
        <div className="md:col-span-3">
          <label className="mb-1 block text-sm text-gray-700 dark:text-gray-300">Date Range</label>
          <select
            value={range}
            onChange={(e) => {
              const val = e.target.value;
              setRange(val);
              loadTopStories(val, country);
            }}
            className="h-10 w-full rounded border border-gray-300 bg-white px-3 text-black focus:outline-none focus:ring-2 focus:ring-gray-400 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
          >
            <option value="24h">Last 24 Hours</option>
            <option value="3d">Last 3 Days</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
          </select>
        </div>

        <div className="md:col-span-3">
          <label className="mb-1 block text-sm text-gray-700 dark:text-gray-300">Select Country</label>
          <select
            value={country}
            onChange={(e) => {
              const val = e.target.value as CountryOption["key"];
              setCountry(val);
              loadTopStories(range, val);
            }}
            className="h-10 w-full rounded border border-gray-300 bg-white px-3 text-black focus:outline-none focus:ring-2 focus:ring-gray-400 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
          >
            {MERCOSUR_COUNTRIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-3">
          <label className="mb-1 block text-sm text-gray-700 dark:text-gray-300">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as CategoryFilter)}
            className="h-10 w-full rounded border border-gray-300 bg-white px-3 text-black focus:outline-none focus:ring-2 focus:ring-gray-400 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
          >
            <option value="all">All categories</option>
            {categoryOptions.map((c) => (
              <option key={c} value={c} disabled={!topicsInData.has(c)}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-3">
          <label className="mb-1 block text-sm text-gray-700 dark:text-gray-300">Search</label>
          <div className="flex items-center gap-3">
            <input
              ref={searchInputRef}
              className="h-10 w-full min-w-0 rounded border border-gray-300 bg-white px-3 text-xs text-black placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
              placeholder="Headlines & summaries"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  performSearchAction();
                }
              }}
            />

            <button
              className="h-10 shrink-0 rounded border border-gray-300 bg-black px-4 text-white hover:opacity-90 dark:bg-white dark:text-black"
              onClick={performSearchAction}
              title="Search (filters as you type)"
            >
              Search
            </button>
          </div>
        </div>
      </div>

      {showEmptyState ? (
        <div className="rounded border border-gray-200 bg-gray-50 px-5 py-8 text-center dark:border-gray-800 dark:bg-white/[0.03]">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">No stories matched your filters</h3>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-gray-600 dark:text-gray-400">
            Try clearing your search or switching category filters to see more stories in this feed.
          </p>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-xs text-gray-500 dark:text-gray-500">
            {hasActiveSearch ? (
              <span className="rounded-full border border-gray-300 px-3 py-1 dark:border-gray-700">Search: {query}</span>
            ) : null}
            {hasActiveCategory ? (
              <span className="rounded-full border border-gray-300 px-3 py-1 dark:border-gray-700">Category: {category}</span>
            ) : null}
          </div>

          {showClearFilters ? (
            <div className="mt-5">
              <button
                onClick={clearSearchAndCategory}
                className="inline-flex items-center rounded-full border border-gray-500 bg-black px-4 py-2 text-sm text-white transition hover:opacity-90 dark:bg-white dark:text-black"
              >
                Clear filters
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-6">
        {filteredClusters.map((c) => {
          const a = c.best_item;

          const src = (a.source || "").trim();
          const logoFailed = failedLogosRef.current.has(src);
          const showLogo = !!a.source_logo && !logoFailed;

          const titleReady = !!(a.title_en && a.title_en.trim());
          const summaryReady = !!(a.summary_en && a.summary_en.trim());
          const translatedReady = titleReady && summaryReady;

          const topic = normalizeTopic(a.topic || c.topic);

          const link = a.link;
          const st = enrichState[link]?.status || "idle";
          const errMsg = enrichState[link]?.message || "Summary unavailable.";

          return (
            <div
              key={c.cluster_id}
              ref={(el) => {
                cardRefs.current[a.link] = el;
              }}
              data-link={a.link}
              className={`rounded border p-5 transition ${
                translatedReady
                  ? "border-gray-200 bg-white dark:border-gray-700 dark:bg-transparent"
                  : "border-gray-200 bg-gray-50/70 opacity-70 dark:border-gray-800 dark:bg-white/[0.03]"
              }`}
            >
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  {a.country_flag_url ? <img src={a.country_flag_url} alt="Flag" className="h-4 w-auto rounded-sm" /> : null}

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
                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-gray-200 bg-gray-100 px-1 text-[11px] text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
                      {initials(a.source)}
                    </span>
                  )}

                  <span className="min-w-0 truncate text-sm text-gray-600 dark:text-gray-400">{a.source}</span>
                </div>

                {topic ? (
                  <span className="shrink-0 rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] text-gray-700 dark:border-gray-700 dark:bg-white/5 dark:text-white/80">
                    {topic}
                  </span>
                ) : null}
              </div>

              {translatedReady ? (
                <>
                  <h3 className="text-lg font-semibold">{a.title_en}</h3>
                  <p className="mt-2 text-gray-800 dark:text-white/80">{a.summary_en}</p>
                </>
              ) : st === "error" ? (
                <>
                  <div className="mb-2 h-6 w-40 rounded bg-gray-200 dark:bg-gray-700" />
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <p className="text-sm text-gray-600 dark:text-gray-400">{errMsg}</p>
                    <button
                      onClick={() => retryEnrich(a.link)}
                      className="inline-flex items-center whitespace-nowrap rounded-full border border-gray-500 bg-transparent px-3 py-1.5 text-xs text-black transition hover:opacity-90 dark:text-white"
                      aria-label="Retry summary enrichment"
                    >
                      Retry
                    </button>
                  </div>
                </>
              ) : (
                <div className="animate-pulse space-y-3">
                  <div className="h-6 w-5/6 rounded bg-gray-200 dark:bg-gray-700" />
                  <div className="h-3 w-5/6 rounded bg-gray-200 dark:bg-gray-700" />
                  <div className="h-3 w-4/6 rounded bg-gray-200 dark:bg-gray-700" />
                </div>
              )}

              <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">{formatPublishedUTC(a)}</p>

              <button
                onClick={() => openTranslated(a.link)}
                disabled={!translatedReady}
                className={`mt-4 inline-flex items-center rounded-full border border-gray-500 px-4 py-2 text-sm transition ${
                  translatedReady
                    ? "bg-black text-white hover:opacity-90 dark:bg-white dark:text-black"
                    : "cursor-not-allowed bg-gray-300 text-gray-600 dark:bg-gray-800 dark:text-gray-500"
                }`}
              >
                Open Translated Article →
              </button>
            </div>
          );
        })}
      </div>

      {infoOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button className="absolute inset-0 bg-black/60" aria-label="Close" onClick={() => setInfoOpen(false)} />
          <div className="relative max-h-[85vh] w-[calc(100vw-2rem)] max-w-xl overflow-x-hidden overflow-y-auto rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-black">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="break-words text-lg font-semibold">About Mercosur News</h3>
                <p className="mt-1 break-words text-sm text-gray-600 dark:text-gray-400">
                  RSS headlines across Mercosur, translated to English with short summaries.
                </p>
              </div>

              <button
                onClick={() => setInfoOpen(false)}
                className="shrink-0 rounded border border-gray-300 px-2 py-1 text-xs hover:opacity-90 dark:border-gray-700"
                aria-label="Close modal"
              >
                Close
              </button>
            </div>

            <div className="mt-4 space-y-4 overflow-x-hidden break-words text-sm leading-relaxed">
              <div className="text-gray-800 dark:text-white/80">
                <p>
                  Mercosur News aggregates public RSS headlines across the Mercosur region and presents them in a clean, readable feed.
                </p>
                <p className="mt-2">
                  As you scroll, headlines are translated into English and paired with short English summaries. You can open any source
                  article via Google Translate to view the full story in English.
                </p>
              </div>

              <div className="border-t border-gray-200 pt-4 dark:border-gray-800">
                <div className="font-semibold text-gray-900 dark:text-white">How to use</div>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-gray-600 dark:text-gray-400">
                  <li>
                    <span className="text-gray-800 dark:text-white/80">Date Range:</span> filter by recency.
                  </li>
                  <li>
                    <span className="text-gray-800 dark:text-white/80">Select Country:</span> view by country (or all / MercoPress).
                  </li>
                  <li>
                    <span className="text-gray-800 dark:text-white/80">Category:</span> filter the feed by topic.
                  </li>
                  <li>
                    <span className="text-gray-800 dark:text-white/80">Search:</span> filter headlines and summaries.
                  </li>
                </ul>
              </div>

              <div className="border-t border-gray-200 pt-4 dark:border-gray-800">
                <div className="font-semibold text-gray-900 dark:text-white">Add to Home Screen</div>

                {standalone ? (
                  <div className="mt-2 text-gray-600 dark:text-gray-400">You’re already running Mercosur News in installed mode.</div>
                ) : installEvent ? (
                  <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-gray-600 dark:text-gray-400">Your browser supports installing this app.</div>
                    <button
                      onClick={handleInstallClick}
                      className="inline-flex items-center justify-center rounded-full border border-gray-500 bg-black px-4 py-2 text-sm text-white transition hover:opacity-90 dark:bg-white dark:text-black"
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

              <div className="border-t border-gray-200 pt-4 dark:border-gray-800">
                <div className="font-semibold text-gray-900 dark:text-white">Notes</div>
                <p className="mt-2 text-gray-600 dark:text-gray-400">
                  Topics are automatically labeled. Translation and summarization are generated as stories enter view to keep the feed
                  responsive.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}