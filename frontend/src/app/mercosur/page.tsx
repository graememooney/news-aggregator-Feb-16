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

type HeadlineLimit = 30 | 50 | 100 | 200;

const REGION_KEY = "mercosur" as const;

const MERCOSUR_COUNTRIES: CountryOption[] = [
  { key: "all", code: "ALL", name: "All Mercosur", flag_url: "" },
  { key: "mp", code: "MP", name: "MercoPress", flag_url: "" },
  { key: "uy", code: "UY", name: "Uruguay", flag_url: "https://flagcdn.com/w40/uy.png" },
  { key: "ar", code: "AR", name: "Argentina", flag_url: "https://flagcdn.com/w40/ar.png" },
  { key: "br", code: "BR", name: "Brazil", flag_url: "https://flagcdn.com/w40/br.png" },
  { key: "py", code: "PY", name: "Paraguay", flag_url: "https://flagcdn.com/w40/py.png" },
  { key: "bo", code: "BO", name: "Bolivia", flag_url: "https://flagcdn.com/w40/bo.png" },
];

const HEADLINE_LIMIT_OPTIONS: HeadlineLimit[] = [30, 50, 100, 200];

const ENRICH_BATCH_SIZE = 3;
const PRIORITY_ENRICH_COUNT = 5;
const OBSERVER_ROOT_MARGIN = "900px";
const GENERIC_ENRICH_ERROR = "Service temporarily unavailable. Please try again later.";

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
  headlineLimit: "mercosur-news-headline-limit",
} as const;

const DEFAULT_COUNTRY: CountryOption["key"] = "uy";
const DEFAULT_RANGE = "24h";
const DEFAULT_CATEGORY: CategoryFilter = "all";
const DEFAULT_HEADLINE_LIMIT: HeadlineLimit = 30;
const DEFAULT_QUERY = "";

type ShareNavigator = Navigator & {
  share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
};

function CopyLinkIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path
        d="M10.6 13.4a1 1 0 0 1 0-1.4l3.4-3.4a3 3 0 1 1 4.2 4.2l-2.3 2.3a3 3 0 0 1-4.2 0"
        fill="none"
        stroke="#2563eb"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M13.4 10.6a1 1 0 0 1 0 1.4L10 15.4a3 3 0 0 1-4.2-4.2l2.3-2.3a3 3 0 0 1 4.2 0"
        fill="none"
        stroke="#60a5fa"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 32 32" className="h-5 w-5" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="#25D366" />
      <path
        fill="#fff"
        d="M23.4 18.7c-.3-.2-1.9-.9-2.2-1-.3-.1-.5-.2-.7.2-.2.3-.8 1-.9 1.1-.2.2-.3.2-.6.1-1.8-.9-3.1-1.7-4.4-3.9-.2-.3 0-.5.1-.7.1-.1.3-.4.5-.5.2-.2.2-.3.3-.5.1-.2 0-.4 0-.5 0-.1-.7-1.8-1-2.4-.2-.5-.5-.4-.7-.4h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4s1 2.7 1.1 2.9c.1.2 2 3.2 5 4.5.7.3 1.3.5 1.7.7.7.2 1.3.2 1.8.1.6-.1 1.9-.8 2.1-1.6.3-.8.3-1.5.2-1.6 0-.1-.2-.2-.5-.4Z"
      />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 32 32" className="h-5 w-5" aria-hidden="true">
      <rect width="32" height="32" rx="16" fill="#000000" />
      <path
        fill="#ffffff"
        d="M18.9 13.6 25.5 6h-1.6l-5.7 6.5L13.7 6H8.2l6.9 9.9L8.2 24h1.6l6-6.9 4.8 6.9h5.5l-7.2-10.4Zm-2.3 2.6-.7-1L10 7h2.5l4.7 6.7.7 1 6 8.6h-2.5l-4.9-7.1Z"
      />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg viewBox="0 0 32 32" className="h-5 w-5" aria-hidden="true">
      <rect width="32" height="32" rx="16" fill="#1877F2" />
      <path
        fill="#ffffff"
        d="M18.2 25v-8h2.7l.4-3.1h-3.1v-2c0-.9.3-1.6 1.6-1.6h1.7V7.5c-.3 0-1.3-.1-2.4-.1-2.4 0-4 1.4-4 4.2v2.3H12.4V17H15v8h3.2Z"
      />
    </svg>
  );
}

function EmailIcon() {
  return (
    <svg viewBox="0 0 32 32" className="h-5 w-5" aria-hidden="true">
      <rect width="32" height="32" rx="16" fill="#EA4335" />
      <path
        fill="#ffffff"
        d="M9 10.5A1.5 1.5 0 0 1 10.5 9h11A1.5 1.5 0 0 1 23 10.5v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 9 21.5v-11Zm1.7.2 5.3 4.1 5.3-4.1H10.7Zm10.6 1.9-4.6 3.6a1.2 1.2 0 0 1-1.4 0l-4.6-3.6v8.7h10.6v-8.7Z"
      />
    </svg>
  );
}

function MoreAppsIcon() {
  return (
    <svg viewBox="0 0 32 32" className="h-5 w-5" aria-hidden="true">
      <defs>
        <linearGradient id="moreAppsGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8b5cf6" />
          <stop offset="50%" stopColor="#06b6d4" />
          <stop offset="100%" stopColor="#22c55e" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="16" fill="url(#moreAppsGradient)" />
      <path
        fill="#ffffff"
        d="M10 16.9a2.4 2.4 0 1 0 0-1.8h5.8l2.2-2.5a2.4 2.4 0 1 0-1.4-1.2l-2.7 3.1c-.2.2-.2.3-.3.6v.1H10Zm13.6 3.3a2.4 2.4 0 0 0-5-0.7l-2.9-2.1a1 1 0 0 0-.6-.2H10a2.4 2.4 0 1 0 0 1.8h4.8l3.2 2.3a2.4 2.4 0 1 0 5.6-1.1Z"
      />
    </svg>
  );
}

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

function freshnessLabel(ageS: number | null) {
  if (ageS === null || Number.isNaN(ageS)) return "";
  if (ageS < 30) return "Updated just now";
  if (ageS < 90) return "Updated 1 minute ago";
  if (ageS < 3600) return `Updated ${Math.floor(ageS / 60)} minutes ago`;
  if (ageS < 7200) return "Updated 1 hour ago";
  return `Updated ${Math.floor(ageS / 3600)} hours ago`;
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

function isValidHeadlineLimit(value: string): value is `${HeadlineLimit}` {
  return ["30", "50", "100", "200"].includes(value);
}

function buildShareableUrl(params: {
  region: string;
  country: CountryOption["key"];
  range: string;
  category: CategoryFilter;
  headlineLimit: HeadlineLimit;
  query: string;
}) {
  if (typeof window === "undefined") return "";

  const sp = new URLSearchParams();

  sp.set("region", params.region);

  if (params.country !== DEFAULT_COUNTRY) sp.set("country", params.country);
  if (params.range !== DEFAULT_RANGE) sp.set("range", params.range);
  if (params.category !== DEFAULT_CATEGORY) sp.set("category", params.category);
  if (params.headlineLimit !== DEFAULT_HEADLINE_LIMIT) sp.set("limit", String(params.headlineLimit));

  const trimmedQuery = params.query.trim();
  if (trimmedQuery) sp.set("q", trimmedQuery);

  const qs = sp.toString();
  return `${window.location.pathname}${qs ? `?${qs}` : ""}`;
}

export default function MercosurPage() {
  const [clusters, setClusters] = useState<Cluster[]>([]);

  const [query, setQuery] = useState("");
  const [range, setRange] = useState("24h");
  const [country, setCountry] = useState<CountryOption["key"]>("uy");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [headlineLimit, setHeadlineLimit] = useState<HeadlineLimit>(30);

  const [loading, setLoading] = useState(false);

  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [mounted, setMounted] = useState(false);
  const [prefsReady, setPrefsReady] = useState(false);

  const [infoOpen, setInfoOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [ios, setIos] = useState(false);

  const [loadError, setLoadError] = useState<LoadError>(null);
  const [freshnessAgeS, setFreshnessAgeS] = useState<number | null>(null);

  const [enrichState, setEnrichState] = useState<Record<string, EnrichState>>({});

  const [shareMessage, setShareMessage] = useState("");

  const inflightRef = useRef(false);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const queuedRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<string[]>([]);

  const failedLogosRef = useRef<Set<string>>(new Set());
  const [, forceRerender] = useState(0);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const shareMessageTimerRef = useRef<number | null>(null);

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

  function showShareFeedback(message: string) {
    setShareMessage(message);

    if (shareMessageTimerRef.current) {
      window.clearTimeout(shareMessageTimerRef.current);
    }

    shareMessageTimerRef.current = window.setTimeout(() => {
      setShareMessage("");
      shareMessageTimerRef.current = null;
    }, 1800);
  }

  function getSharePath() {
    return buildShareableUrl({
      region: REGION_KEY,
      country,
      range,
      category,
      headlineLimit,
      query,
    });
  }

  function getShareUrl() {
    return `${window.location.origin}${getSharePath()}`;
  }

  async function copyShareUrl(url: string) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      return;
    }

    const ta = document.createElement("textarea");
    ta.value = url;
    ta.setAttribute("readonly", "");
    ta.style.position = "absolute";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }

  async function handleCopyLink() {
    try {
      await copyShareUrl(getShareUrl());
      showShareFeedback("Link copied");
      setShareOpen(false);
    } catch {
      showShareFeedback("Copy failed");
    }
  }

  async function handleNativeShare() {
    try {
      const nav = navigator as ShareNavigator;
      const url = getShareUrl();

      if (!nav.share) {
        await copyShareUrl(url);
        showShareFeedback("Link copied");
        setShareOpen(false);
        return;
      }

      try {
        await nav.share({
          title: "Mercosur News",
          text: `View this Mercosur News feed: ${selectedCountryName}`,
          url,
        });
      } catch (err: any) {
        const name = String(err?.name || "");
        if (name === "AbortError") return;
        await copyShareUrl(url);
        showShareFeedback("Link copied");
      }

      setShareOpen(false);
    } catch {
      showShareFeedback("Copy failed");
    }
  }

  function openExternalShare(type: "whatsapp" | "x" | "facebook" | "email") {
    const url = getShareUrl();
    const encodedUrl = encodeURIComponent(url);
    const text = encodeURIComponent(`Mercosur News: ${selectedCountryName}`);
    let shareHref = "";

    if (type === "whatsapp") {
      shareHref = `https://wa.me/?text=${text}%20${encodedUrl}`;
    } else if (type === "x") {
      shareHref = `https://twitter.com/intent/tweet?text=${text}&url=${encodedUrl}`;
    } else if (type === "facebook") {
      shareHref = `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`;
    } else if (type === "email") {
      shareHref = `mailto:?subject=${encodeURIComponent(`Mercosur News: ${selectedCountryName}`)}&body=${encodeURIComponent(
        `Take a look at this Mercosur News view:\n\n${url}`
      )}`;
    }

    if (!shareHref) return;
    window.open(shareHref, "_blank", "noopener,noreferrer");
    setShareOpen(false);
  }

  async function loadTopStories(
    selectedRange = range,
    selectedCountry = country,
    selectedHeadlineLimit = headlineLimit
  ) {
    setLoading(true);
    setLoadError(null);

    try {
      const params = new URLSearchParams({
        region: REGION_KEY,
        country: selectedCountry,
        range: selectedRange,
        q: "",
        limit: String(selectedHeadlineLimit),
      });

      const res = await fetch(`/api/top?${params.toString()}`, {
        cache: "no-store",
      });

      const data = await safeJson(res);

      if (!res.ok) {
        setClusters([]);
        setFreshnessAgeS(null);
        setLoadError({ message: "We couldn’t load headlines right now.", status: res.status });
      } else {
        const list: Cluster[] = (data?.clusters || []) as Cluster[];
        setClusters(list);

        const age = typeof data?.cache_age_s === "number" ? data.cache_age_s : 0;
        setFreshnessAgeS(age);

        queuedRef.current.clear();
        queueRef.current = [];
        setEnrichState({});
      }
    } catch {
      setClusters([]);
      setFreshnessAgeS(null);
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

  function markBatchError(links: string[], message = GENERIC_ENRICH_ERROR) {
    setEnrichState((prev) => {
      const next = { ...prev };
      for (const link of links) {
        const cur = next[link];
        if (cur?.status === "ok") continue;
        next[link] = { status: "error", message };
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

    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: batch }),
        cache: "no-store",
      });

      const data = await safeJson(res);
      const enriched = (data?.items || data?.backend_response?.items || []) as any[];

      if (!res.ok) {
        markBatchError(batchLinks);
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
      if (missed.length > 0) markBatchError(missed);
    } catch {
      markBatchError(batchLinks);
    }
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
    let savedCountry: CountryOption["key"] = DEFAULT_COUNTRY;
    let savedRange = DEFAULT_RANGE;
    let savedCategory: CategoryFilter = DEFAULT_CATEGORY;
    let savedHeadlineLimit: HeadlineLimit = DEFAULT_HEADLINE_LIMIT;
    let savedQuery = DEFAULT_QUERY;

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

      const headlineLimitRaw = window.localStorage.getItem(STORAGE_KEYS.headlineLimit);
      if (headlineLimitRaw && isValidHeadlineLimit(headlineLimitRaw)) {
        savedHeadlineLimit = Number(headlineLimitRaw) as HeadlineLimit;
      }
    } catch {}

    try {
      const sp = new URLSearchParams(window.location.search);

      const countryParam = sp.get("country");
      if (countryParam && isValidCountryKey(countryParam)) {
        savedCountry = countryParam;
      }

      const rangeParam = sp.get("range");
      if (rangeParam && isValidRange(rangeParam)) {
        savedRange = rangeParam;
      }

      const categoryParam = sp.get("category");
      if (categoryParam && isValidCategory(categoryParam)) {
        savedCategory = categoryParam;
      }

      const limitParam = sp.get("limit");
      if (limitParam && isValidHeadlineLimit(limitParam)) {
        savedHeadlineLimit = Number(limitParam) as HeadlineLimit;
      }

      const queryParam = sp.get("q");
      if (typeof queryParam === "string") {
        savedQuery = queryParam;
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
    setHeadlineLimit(savedHeadlineLimit);
    setQuery(savedQuery);
    setPrefsReady(true);

    loadTopStories(savedRange, savedCountry, savedHeadlineLimit);
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

  useEffect(() => {
    if (!prefsReady) return;
    try {
      window.localStorage.setItem(STORAGE_KEYS.headlineLimit, String(headlineLimit));
    } catch {}
  }, [headlineLimit, prefsReady]);

  useEffect(() => {
    if (!prefsReady) return;
    try {
      const nextUrl = buildShareableUrl({
        region: REGION_KEY,
        country,
        range,
        category,
        headlineLimit,
        query,
      });
      if (nextUrl && `${window.location.pathname}${window.location.search}` !== nextUrl) {
        window.history.replaceState(null, "", nextUrl);
      }
    } catch {}
  }, [country, range, category, headlineLimit, query, prefsReady]);

  useEffect(() => {
    return () => {
      if (shareMessageTimerRef.current) {
        window.clearTimeout(shareMessageTimerRef.current);
      }
    };
  }, []);

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
  const freshnessText = !loadError ? freshnessLabel(freshnessAgeS) : "";
  const nav = typeof navigator !== "undefined" ? (navigator as ShareNavigator) : null;
  const canNativeShare = !!nav?.share;

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
  const installButtonLabel = installEvent ? "Install" : "How to install";

  return (
    <main className="mx-auto max-w-6xl overflow-x-hidden px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
      <section className="relative overflow-hidden rounded-3xl border border-gray-200/80 bg-white/80 px-5 py-6 shadow-sm backdrop-blur-sm dark:border-gray-800 dark:bg-black/40 sm:px-7 sm:py-8">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.12),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(99,102,241,0.10),transparent_32%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.16),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(99,102,241,0.12),transparent_32%)]" />

        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="break-words text-5xl font-extrabold leading-[0.95] tracking-tight text-gray-950 dark:text-white sm:text-6xl">
              <span className="text-blue-500">Mercosur</span> News
            </h1>

            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-gray-600 dark:text-gray-400 sm:text-base">
              Regional News, Translated for You
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <button
              onClick={() => setInfoOpen(true)}
              aria-label="Info"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-gray-300 bg-white text-sm text-blue-600 shadow-sm transition hover:border-blue-300 hover:text-blue-500 dark:border-gray-700 dark:bg-black dark:text-blue-400"
            >
              <span className="italic font-semibold">i</span>
            </button>

            {!standalone ? (
              <button
                onClick={handleInstallClick}
                className="inline-flex min-h-11 items-center rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 shadow-sm transition hover:border-gray-400 hover:bg-gray-50 dark:border-gray-700 dark:bg-black dark:text-white dark:hover:bg-white/[0.04]"
                title={installEvent ? "Install this app" : "View manual install instructions"}
              >
                {installButtonLabel}
              </button>
            ) : null}

            <button
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              className="inline-flex min-h-11 items-center rounded-full border border-gray-900 bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:opacity-90 dark:border-white dark:bg-white dark:text-black"
            >
              {mounted ? (theme === "dark" ? "Light mode" : "Dark mode") : "Theme"}
            </button>
          </div>
        </div>
      </section>

      <section className="mt-8 flex flex-col gap-4 rounded-3xl border border-gray-200 bg-white/80 p-5 shadow-sm backdrop-blur-sm dark:border-gray-800 dark:bg-black/30 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-3xl font-bold tracking-tight text-gray-950 dark:text-white">{selectedCountryName} News</h2>

              <button
                onClick={() => setShareOpen(true)}
                className="inline-flex items-center rounded-full border border-gray-300 bg-white px-3.5 py-1.5 text-sm font-medium text-gray-900 shadow-sm transition hover:border-gray-400 hover:bg-gray-50 dark:border-gray-700 dark:bg-black dark:text-white dark:hover:bg-white/[0.04]"
                title="Share this view"
              >
                Share
              </button>

              {shareMessage ? <span className="text-sm text-gray-600 dark:text-gray-400">{shareMessage}</span> : null}
            </div>

            {!loading && !loadError ? (
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600 dark:text-gray-400">
                <span>{storyCountLabel(filteredClusters.length)}</span>
                {freshnessText ? <span>{freshnessText}</span> : null}
              </div>
            ) : null}
          </div>

          <div className="pt-1 text-sm font-medium text-gray-500 dark:text-gray-400 lg:text-right">
            {loading && !loadError ? "Loading headlines..." : ""}
          </div>
        </div>

        {loadError ? (
          <div className="rounded-2xl border border-gray-300 bg-gray-50 p-4 dark:border-gray-700 dark:bg-white/5">
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
                onClick={() => loadTopStories(range, country, headlineLimit)}
                className="inline-flex items-center whitespace-nowrap rounded-full border border-gray-900 bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 dark:border-white dark:bg-white dark:text-black"
              >
                Retry
              </button>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-15 md:items-end">
          <div className="md:col-span-3">
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Date Range</label>
            <select
              value={range}
              onChange={(e) => {
                const val = e.target.value;
                setRange(val);
                loadTopStories(val, country, headlineLimit);
              }}
              className="h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-black shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            >
              <option value="24h">Last 24 Hours</option>
              <option value="3d">Last 3 Days</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
            </select>
          </div>

          <div className="md:col-span-3">
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Select Country</label>
            <select
              value={country}
              onChange={(e) => {
                const val = e.target.value as CountryOption["key"];
                setCountry(val);
                loadTopStories(range, val, headlineLimit);
              }}
              className="h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-black shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            >
              {MERCOSUR_COUNTRIES.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-3">
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as CategoryFilter)}
              className="h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-black shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            >
              <option value="all">All categories</option>
              {categoryOptions.map((c) => (
                <option key={c} value={c} disabled={!topicsInData.has(c)}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Headline Limit</label>
            <select
              value={headlineLimit}
              onChange={(e) => {
                const val = Number(e.target.value) as HeadlineLimit;
                setHeadlineLimit(val);
                loadTopStories(range, country, val);
              }}
              className="h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-black shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            >
              {HEADLINE_LIMIT_OPTIONS.map((limit) => (
                <option key={limit} value={limit}>
                  Top {limit}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-4">
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Search</label>
            <div className="flex items-center gap-3">
              <input
                ref={searchInputRef}
                className="h-11 w-full min-w-0 rounded-xl border border-gray-300 bg-white px-3 text-sm text-black shadow-sm placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
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
                className="h-11 shrink-0 rounded-xl border border-gray-900 bg-gray-900 px-4 text-sm font-medium text-white shadow-sm transition hover:opacity-90 dark:border-white dark:bg-white dark:text-black"
                onClick={performSearchAction}
                title="Search (filters as you type)"
              >
                Search
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-3xl border border-amber-200 bg-gradient-to-r from-amber-50 via-white to-amber-50 p-5 shadow-sm dark:border-amber-500/20 dark:from-amber-500/10 dark:via-black/40 dark:to-amber-500/10">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="inline-flex items-center rounded-full border border-amber-300 bg-white/70 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:border-amber-400/30 dark:bg-white/5 dark:text-amber-300">
              Upgrade
            </div>
            <h3 className="mt-3 text-lg font-semibold tracking-tight text-gray-950 dark:text-white">
              Subscribe and keep the app ad free
            </h3>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-gray-700 dark:text-gray-300">
              Enjoy a cleaner reading experience while supporting the continued growth of Mercosur News.
            </p>
          </div>

          <div className="shrink-0">
            <button
              className="inline-flex min-h-11 items-center rounded-full border border-gray-900 bg-gray-900 px-5 py-2 text-sm font-medium text-white shadow-sm transition hover:opacity-90 dark:border-white dark:bg-white dark:text-black"
              type="button"
            >
              Subscribe
            </button>
          </div>
        </div>
      </section>

      {showEmptyState ? (
        <div className="mt-6 rounded-3xl border border-gray-200 bg-gray-50 px-5 py-8 text-center shadow-sm dark:border-gray-800 dark:bg-white/[0.03]">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">No stories match this view</h3>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-gray-600 dark:text-gray-400">
            Try broadening your search or switching categories to see more coverage from this feed.
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
                className="inline-flex items-center rounded-full border border-gray-900 bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 dark:border-white dark:bg-white dark:text-black"
              >
                Reset search and category
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-6 space-y-6">
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
          const errMsg = enrichState[link]?.message || GENERIC_ENRICH_ERROR;

          return (
            <div
              key={c.cluster_id}
              ref={(el) => {
                cardRefs.current[a.link] = el;
              }}
              data-link={a.link}
              className={`rounded-3xl border p-5 shadow-sm transition sm:p-6 ${
                translatedReady
                  ? "border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.02]"
                  : "border-gray-200 bg-gray-50/80 opacity-70 dark:border-gray-800 dark:bg-white/[0.03]"
              }`}
            >
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
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
                    <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-gray-200 bg-gray-100 px-1 text-[11px] text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
                      {initials(a.source)}
                    </span>
                  )}

                  <span className="min-w-0 truncate text-sm text-gray-600 dark:text-gray-400">{a.source}</span>
                </div>

                {topic ? (
                  <span className="shrink-0 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-700 dark:border-gray-700 dark:bg-white/5 dark:text-white/80">
                    {topic}
                  </span>
                ) : null}
              </div>

              {translatedReady ? (
                <>
                  <h3 className="text-xl font-semibold leading-snug tracking-tight text-gray-950 dark:text-white">{a.title_en}</h3>
                  <p className="mt-3 text-[15px] leading-7 text-gray-700 dark:text-white/75">{a.summary_en}</p>
                </>
              ) : st === "error" ? (
                <>
                  <div className="mb-2 h-6 w-40 rounded bg-gray-200 dark:bg-gray-700" />
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <p className="text-sm text-gray-600 dark:text-gray-400">{errMsg}</p>
                    <button
                      onClick={() => retryEnrich(a.link)}
                      className="inline-flex items-center whitespace-nowrap rounded-full border border-gray-400 bg-transparent px-3 py-1.5 text-xs font-medium text-black transition hover:opacity-90 dark:border-gray-600 dark:text-white"
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

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-gray-600 dark:text-gray-400">{formatPublishedUTC(a)}</p>

                <button
                  onClick={() => openTranslated(a.link)}
                  disabled={!translatedReady}
                  className={`inline-flex items-center rounded-full border px-4 py-2 text-sm font-medium transition ${
                    translatedReady
                      ? "border-gray-900 bg-gray-900 text-white hover:opacity-90 dark:border-white dark:bg-white dark:text-black"
                      : "cursor-not-allowed border-gray-300 bg-gray-300 text-gray-600 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-500"
                  }`}
                >
                  Open Translated Article →
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {shareOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" aria-label="Close share modal" onClick={() => setShareOpen(false)} />
          <div className="relative w-[calc(100vw-2rem)] max-w-md rounded-3xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-700 dark:bg-black">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-xl font-semibold tracking-tight">Share this view</h3>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">Send this feed to another app or copy the link.</p>
              </div>

              <button
                onClick={() => setShareOpen(false)}
                className="shrink-0 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium hover:opacity-90 dark:border-gray-700"
                aria-label="Close share modal"
              >
                Close
              </button>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                onClick={handleCopyLink}
                className="flex items-center gap-3 rounded-2xl border border-gray-300 bg-white px-4 py-4 text-left text-sm font-medium shadow-sm transition hover:bg-gray-50 dark:border-gray-700 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
              >
                <span className="shrink-0">
                  <CopyLinkIcon />
                </span>
                <span>Copy link</span>
              </button>

              <button
                onClick={() => openExternalShare("whatsapp")}
                className="flex items-center gap-3 rounded-2xl border border-gray-300 bg-white px-4 py-4 text-left text-sm font-medium shadow-sm transition hover:bg-gray-50 dark:border-gray-700 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
              >
                <span className="shrink-0">
                  <WhatsAppIcon />
                </span>
                <span>WhatsApp</span>
              </button>

              <button
                onClick={() => openExternalShare("x")}
                className="flex items-center gap-3 rounded-2xl border border-gray-300 bg-white px-4 py-4 text-left text-sm font-medium shadow-sm transition hover:bg-gray-50 dark:border-gray-700 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
              >
                <span className="shrink-0">
                  <XIcon />
                </span>
                <span>X</span>
              </button>

              <button
                onClick={() => openExternalShare("facebook")}
                className="flex items-center gap-3 rounded-2xl border border-gray-300 bg-white px-4 py-4 text-left text-sm font-medium shadow-sm transition hover:bg-gray-50 dark:border-gray-700 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
              >
                <span className="shrink-0">
                  <FacebookIcon />
                </span>
                <span>Facebook</span>
              </button>

              <button
                onClick={() => openExternalShare("email")}
                className="flex items-center gap-3 rounded-2xl border border-gray-300 bg-white px-4 py-4 text-left text-sm font-medium shadow-sm transition hover:bg-gray-50 dark:border-gray-700 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
              >
                <span className="shrink-0">
                  <EmailIcon />
                </span>
                <span>Email</span>
              </button>

              <button
                onClick={handleNativeShare}
                className={`flex items-center gap-3 rounded-2xl border px-4 py-4 text-left text-sm font-medium shadow-sm transition ${
                  canNativeShare
                    ? "border-gray-300 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
                    : "border-gray-200 bg-gray-100 text-gray-500 dark:border-gray-800 dark:bg-white/[0.02] dark:text-gray-500"
                }`}
              >
                <span className="shrink-0">
                  <MoreAppsIcon />
                </span>
                <span>More apps</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {infoOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" aria-label="Close" onClick={() => setInfoOpen(false)} />
          <div className="relative max-h-[85vh] w-[calc(100vw-2rem)] max-w-2xl overflow-x-hidden overflow-y-auto rounded-3xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-700 dark:bg-black sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="break-words text-xl font-semibold tracking-tight">About Mercosur News</h3>
                <p className="mt-1 break-words text-sm text-gray-600 dark:text-gray-400">
                  A mobile-friendly regional news feed for Mercosur headlines, translated into English.
                </p>
              </div>

              <button
                onClick={() => setInfoOpen(false)}
                className="shrink-0 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium hover:opacity-90 dark:border-gray-700"
                aria-label="Close modal"
              >
                Close
              </button>
            </div>

            <div className="mt-5 space-y-5 overflow-x-hidden break-words text-sm leading-relaxed">
              <div className="text-gray-800 dark:text-white/80">
                <p>
                  Mercosur News brings together public RSS headlines from across Uruguay, Argentina, Brazil, Paraguay, Bolivia, and MercoPress in one clean, easy-to-scan feed.
                </p>
                <p className="mt-2">
                  The app groups overlapping coverage into a single top story, then translates the headline into English and generates a short English summary so you can follow regional developments faster.
                </p>
                <p className="mt-2">
                  When you want more detail, use the article button to open the original source through Google Translate and read the full story in English.
                </p>
              </div>

              <div className="border-t border-gray-200 pt-5 dark:border-gray-800">
                <div className="font-semibold text-gray-900 dark:text-white">What you can do</div>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-gray-600 dark:text-gray-400">
                  <li>
                    <span className="text-gray-800 dark:text-white/80">Browse by country:</span> switch between individual Mercosur markets, MercoPress, or the full regional feed.
                  </li>
                  <li>
                    <span className="text-gray-800 dark:text-white/80">Filter by date range:</span> focus on the last 24 hours, 3 days, 7 days, or 30 days.
                  </li>
                  <li>
                    <span className="text-gray-800 dark:text-white/80">Filter by category:</span> narrow the feed to topics such as Politics, Economy, World, Environment, Technology, Sports, and more.
                  </li>
                  <li>
                    <span className="text-gray-800 dark:text-white/80">Adjust headline volume:</span> choose how many top stories to load in the feed.
                  </li>
                  <li>
                    <span className="text-gray-800 dark:text-white/80">Search in English:</span> quickly find relevant stories using translated headlines and summaries.
                  </li>
                </ul>
              </div>

              <div className="border-t border-gray-200 pt-5 dark:border-gray-800">
                <div className="font-semibold text-gray-900 dark:text-white">How translation works</div>
                <p className="mt-2 text-gray-600 dark:text-gray-400">
                  Headlines and summaries are translated into English as stories load, so the feed stays fast, responsive, and easy to scan. Cards remain muted until English text is ready, so you only see finished English content.
                </p>
              </div>

              <div className="border-t border-gray-200 pt-5 dark:border-gray-800">
                <div className="font-semibold text-gray-900 dark:text-white">Add to Home Screen</div>

                {standalone ? (
                  <div className="mt-2 space-y-2 text-gray-600 dark:text-gray-400">
                    <p>You’re already running Mercosur News in installed mode.</p>
                    <p>If you reopen it from your home screen or app launcher, it should continue to open as an app.</p>
                  </div>
                ) : installEvent ? (
                  <div className="mt-2 space-y-3 text-gray-600 dark:text-gray-400">
                    <p>Your browser supports installing Mercosur News for a faster, app-like experience.</p>
                    <button
                      onClick={handleInstallClick}
                      className="inline-flex items-center justify-center rounded-full border border-gray-900 bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 dark:border-white dark:bg-white dark:text-black"
                    >
                      Install
                    </button>
                    <p>
                      If you prefer to do it manually, open your browser menu and look for options such as “Install app”, “Add to Home screen”, or “Create shortcut”.
                    </p>
                  </div>
                ) : ios ? (
                  <div className="mt-2 space-y-2 text-gray-600 dark:text-gray-400">
                    <p>On iPhone or iPad, open this site in Safari, tap Share, then choose “Add to Home Screen”.</p>
                    <p>If you do not see the option right away, scroll the Share sheet list until “Add to Home Screen” appears.</p>
                  </div>
                ) : (
                  <div className="mt-2 space-y-2 text-gray-600 dark:text-gray-400">
                    <p>If your browser does not show an install prompt, you can usually add the app manually from the browser menu.</p>
                    <p>Look for options such as “Install app”, “Add to Home screen”, “Create shortcut”, or “Install this site as an app”.</p>
                    <p>If you do not see an install prompt, this browser may not currently support app installation for this site.</p>
                  </div>
                )}
              </div>

              <div className="border-t border-gray-200 pt-5 dark:border-gray-800">
                <div className="font-semibold text-gray-900 dark:text-white">Why it’s useful</div>
                <p className="mt-2 text-gray-600 dark:text-gray-400">
                  Mercosur News is designed for readers who want a faster view of regional developments without having to monitor multiple local-language outlets separately.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}