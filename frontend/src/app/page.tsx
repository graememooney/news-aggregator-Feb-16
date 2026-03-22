"use client";

import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Article = {
  title: string;
  link: string;
  published: string;
  source: string;
  source_logo?: string | null;
  country_flag_url?: string | null;
  subdivision_flag_url?: string | null;
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

type RegionKey = string;
type SubdivisionKey = string;

type SubdivisionOption = {
  key: SubdivisionKey;
  code: string;
  name: string;
  flag_url: string;
  source_count?: number;
};

type RegionOption = {
  key: RegionKey;
  name: string;
  status: "live" | "coming-soon";
  subdivision_label?: string;
  default_subdivision?: string;
  default_country?: string;
  subdivisions_count?: number;
  countries_count?: number;
  source_count?: number;
};

type HeadlineLimit = 30 | 50 | 100 | 200;

const FALLBACK_REGION_OPTIONS: RegionOption[] = [
  {
    key: "mercosur",
    name: "Mercosur",
    status: "live",
    subdivision_label: "Country",
    default_subdivision: "uy",
    default_country: "uy",
  },
  {
    key: "mexico",
    name: "Mexico",
    status: "live",
    subdivision_label: "State",
    default_subdivision: "all",
    default_country: "all",
  },
  {
    key: "central-america",
    name: "Central America",
    status: "live",
    subdivision_label: "Country",
    default_subdivision: "all",
    default_country: "all",
  },
];

const FALLBACK_MERCOSUR_SUBDIVISIONS: SubdivisionOption[] = [
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
const STARTUP_SPLASH_MIN_MS = 1800;

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
  region: "mercosur-news-region",
  subdivision: "mercosur-news-subdivision",
  country: "mercosur-news-country",
  range: "mercosur-news-range",
  category: "mercosur-news-category",
  headlineLimit: "mercosur-news-headline-limit",
  subscribed: "pulse-news-subscribed",
  customerId: "pulse-news-customer-id",
} as const;

const DEFAULT_REGION = "mercosur";
const DEFAULT_RANGE = "24h";
const DEFAULT_CATEGORY: CategoryFilter = "all";
const DEFAULT_HEADLINE_LIMIT: HeadlineLimit = 30;
const DEFAULT_QUERY = "";

const APP_NAME = "Regional Pulse News";
const APP_TAGLINE = "Regional News, Translated for You";
const BRAND_LOGO_PATH = "/regional-pulse-logo.png";

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

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 10.2v5.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="7.2" r="1.1" fill="currentColor" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <circle cx="12" cy="12" r="4" fill="#FACC15" />
      <path
        d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9 5.3 5.3"
        stroke="#FACC15"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path d="M20 14.2A8.5 8.5 0 0 1 9.8 4a8.8 8.8 0 1 0 10.2 10.2Z" fill="currentColor" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16 16l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path d="M4 6h16M7 12h10M10 18h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
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
  region: RegionKey;
  subdivision: SubdivisionKey;
  range: string;
  category: CategoryFilter;
  headlineLimit: HeadlineLimit;
  query: string;
  defaultSubdivisionForRegion: string;
}) {
  if (typeof window === "undefined") return "";

  const sp = new URLSearchParams();

  if (params.region !== DEFAULT_REGION) sp.set("region", params.region);
  if (params.subdivision !== params.defaultSubdivisionForRegion) sp.set("subdivision", params.subdivision);
  if (params.range !== DEFAULT_RANGE) sp.set("range", params.range);
  if (params.category !== DEFAULT_CATEGORY) sp.set("category", params.category);
  if (params.headlineLimit !== DEFAULT_HEADLINE_LIMIT) sp.set("limit", String(params.headlineLimit));

  const trimmedQuery = params.query.trim();
  if (trimmedQuery) sp.set("q", trimmedQuery);

  const qs = sp.toString();
  return `${window.location.pathname}${qs ? `?${qs}` : ""}`;
}

function getFallbackRegionOption(key: string) {
  return FALLBACK_REGION_OPTIONS.find((r) => r.key === key);
}

function getFallbackSubdivisionsForRegion(regionKey: string): SubdivisionOption[] {
  if (regionKey === "mercosur") return FALLBACK_MERCOSUR_SUBDIVISIONS;
  if (regionKey === "mexico") {
    return [
      { key: "all", code: "ALL", name: "All Mexico", flag_url: "" },
      { key: "cdmx", code: "CDMX", name: "CDMX", flag_url: "" },
      { key: "jalisco", code: "JAL", name: "Jalisco", flag_url: "" },
      { key: "nuevo-leon", code: "NL", name: "Nuevo León", flag_url: "" },
      { key: "edomex", code: "MEX", name: "Estado de México", flag_url: "" },
      { key: "yucatan", code: "YUC", name: "Yucatán", flag_url: "" },
    ];
  }
  return [];
}

function isLiveRegionFromList(regionKey: string, options: RegionOption[]) {
  return options.some((r) => r.key === regionKey && r.status === "live");
}

function subdivisionLabelForRegion(regionKey: string, regions: RegionOption[]) {
  const fromRegion = (regions.find((r) => r.key === regionKey)?.subdivision_label || "").trim();
  if (fromRegion) return fromRegion;
  const fromFallback = (getFallbackRegionOption(regionKey)?.subdivision_label || "").trim();
  if (fromFallback) return fromFallback;
  return "Subdivision";
}

function defaultSubdivisionForRegion(regionKey: string, regions: RegionOption[], subdivisions: SubdivisionOption[]) {
  const fromRegion = (
    regions.find((r) => r.key === regionKey)?.default_subdivision ||
    regions.find((r) => r.key === regionKey)?.default_country ||
    ""
  ).trim();

  if (fromRegion && subdivisions.some((c) => c.key === fromRegion)) return fromRegion;
  if (subdivisions.length > 0) return subdivisions[0].key;

  const fallback = (
    getFallbackRegionOption(regionKey)?.default_subdivision ||
    getFallbackRegionOption(regionKey)?.default_country ||
    ""
  ).trim();

  return fallback || "all";
}

export default function Home() {
  const [clusters, setClusters] = useState<Cluster[]>([]);

  const [regionsData, setRegionsData] = useState<RegionOption[]>(FALLBACK_REGION_OPTIONS);
  const [subdivisionsData, setSubdivisionsData] = useState<SubdivisionOption[]>(FALLBACK_MERCOSUR_SUBDIVISIONS);

  const [region, setRegion] = useState<RegionKey>(DEFAULT_REGION);
  const [query, setQuery] = useState("");
  const [range, setRange] = useState(DEFAULT_RANGE);
  const [subdivision, setSubdivision] = useState<SubdivisionKey>(
    defaultSubdivisionForRegion(DEFAULT_REGION, FALLBACK_REGION_OPTIONS, FALLBACK_MERCOSUR_SUBDIVISIONS)
  );
  const [category, setCategory] = useState<CategoryFilter>(DEFAULT_CATEGORY);
  const [headlineLimit, setHeadlineLimit] = useState<HeadlineLimit>(DEFAULT_HEADLINE_LIMIT);

  const [loading, setLoading] = useState(false);

  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [mounted, setMounted] = useState(false);
  const [prefsReady, setPrefsReady] = useState(false);
  const [showStartupSplash, setShowStartupSplash] = useState(true);

  const [infoOpen, setInfoOpenRaw] = useState(false);
  const [shareOpen, setShareOpenRaw] = useState(false);
  const [filtersOpen, setFiltersOpenRaw] = useState(false);
  const [feedbackOpen, setFeedbackOpenRaw] = useState(false);

  // Feedback form state
  const [fbName, setFbName] = useState("");
  const [fbEmail, setFbEmail] = useState("");
  const [fbMessage, setFbMessage] = useState("");
  const [fbSending, setFbSending] = useState(false);
  const [fbSent, setFbSent] = useState(false);
  const [fbError, setFbError] = useState("");

  // Subscription state
  const [subscribed, setSubscribed] = useState(false);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [subscribeOpen, setSubscribeOpenRaw] = useState(false);
  const [subscribing, setSubscribing] = useState(false);

  const setSubscribeOpen = useCallback((open: boolean) => {
    if (open) { window.history.pushState({ modal: "subscribe" }, ""); }
    else if (window.history.state?.modal === "subscribe") { window.history.back(); }
    setSubscribeOpenRaw(open);
  }, []);

  // Back button closes modals instead of leaving the site.
  // Push a history entry when opening; pop it when closing.
  const setInfoOpen = useCallback((open: boolean) => {
    if (open) { window.history.pushState({ modal: "info" }, ""); }
    else if (window.history.state?.modal === "info") { window.history.back(); }
    setInfoOpenRaw(open);
  }, []);

  const setShareOpen = useCallback((open: boolean) => {
    if (open) { window.history.pushState({ modal: "share" }, ""); }
    else if (window.history.state?.modal === "share") { window.history.back(); }
    setShareOpenRaw(open);
  }, []);

  const setFiltersOpen = useCallback((open: boolean) => {
    if (open) { window.history.pushState({ modal: "filters" }, ""); }
    else if (window.history.state?.modal === "filters") { window.history.back(); }
    setFiltersOpenRaw(open);
  }, []);

  const setFeedbackOpen = useCallback((open: boolean) => {
    if (open) { window.history.pushState({ modal: "feedback" }, ""); }
    else if (window.history.state?.modal === "feedback") { window.history.back(); }
    setFeedbackOpenRaw(open);
    if (open) { setFbSent(false); setFbError(""); }
  }, []);

  useEffect(() => {
    function onPopState() {
      if (filtersOpen) setFiltersOpenRaw(false);
      if (infoOpen) setInfoOpenRaw(false);
      if (shareOpen) setShareOpenRaw(false);
      if (feedbackOpen) setFeedbackOpenRaw(false);
      if (subscribeOpen) setSubscribeOpenRaw(false);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [filtersOpen, infoOpen, shareOpen, feedbackOpen, subscribeOpen]);

  async function handleFeedbackSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFbSending(true);
    setFbError("");
    try {
      const res = await fetch("https://formspree.io/f/xwvrjygl", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ name: fbName, email: fbEmail, message: fbMessage }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.errors?.map((e: any) => e.message).join(", ") || "Something went wrong. Please try again.");
      }
      setFbSent(true);
      setFbName(""); setFbEmail(""); setFbMessage("");
    } catch (err: any) {
      setFbError(err.message || "Something went wrong. Please try again.");
    } finally {
      setFbSending(false);
    }
  }

  // Subscribe handler — opens Stripe Checkout
  async function handleSubscribe(plan: "monthly" | "yearly") {
    setSubscribing(true);
    try {
      const res = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || "Something went wrong. Please try again.");
      }
    } catch {
      alert("Something went wrong. Please try again.");
    } finally {
      setSubscribing(false);
    }
  }

  // Manage subscription — opens Stripe Customer Portal
  async function handleManageSubscription() {
    if (!customerId) return;
    try {
      const res = await fetch("/api/create-portal-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      // silent
    }
  }

  // On mount: check for Stripe return & load saved subscription state
  useEffect(() => {
    // Load saved subscription
    const saved = window.localStorage.getItem(STORAGE_KEYS.subscribed);
    const savedCust = window.localStorage.getItem(STORAGE_KEYS.customerId);
    if (saved === "true") {
      setSubscribed(true);
      if (savedCust) setCustomerId(savedCust);
    }

    // Check for Stripe checkout return
    const params = new URLSearchParams(window.location.search);
    const subscribeStatus = params.get("subscribe");
    const sessionId = params.get("session_id");

    if (subscribeStatus === "success" && sessionId) {
      // Verify the subscription with Stripe
      fetch(`/api/verify-subscription?session_id=${encodeURIComponent(sessionId)}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.subscribed) {
            setSubscribed(true);
            setCustomerId(data.customerId || null);
            window.localStorage.setItem(STORAGE_KEYS.subscribed, "true");
            if (data.customerId) {
              window.localStorage.setItem(STORAGE_KEYS.customerId, data.customerId);
            }
          }
        })
        .catch(() => {});

      // Clean up the URL
      const clean = new URL(window.location.href);
      clean.searchParams.delete("subscribe");
      clean.searchParams.delete("session_id");
      window.history.replaceState({}, "", clean.pathname + clean.search);
    } else if (subscribeStatus === "cancel") {
      const clean = new URL(window.location.href);
      clean.searchParams.delete("subscribe");
      window.history.replaceState({}, "", clean.pathname + clean.search);
    }
  }, []);

  // Persist subscription state
  useEffect(() => {
    if (!prefsReady) return;
    window.localStorage.setItem(STORAGE_KEYS.subscribed, subscribed ? "true" : "false");
    if (customerId) {
      window.localStorage.setItem(STORAGE_KEYS.customerId, customerId);
    }
  }, [subscribed, customerId, prefsReady]);

  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [ios, setIos] = useState(false);

  const [loadError, setLoadError] = useState<LoadError>(null);
  const [freshnessAgeS, setFreshnessAgeS] = useState<number | null>(null);

  const [enrichState, setEnrichState] = useState<Record<string, EnrichState>>({});
  const [shareMessage, setShareMessage] = useState("");
  const [comingSoonMessage, setComingSoonMessage] = useState("");

  const inflightRef = useRef(false);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const queuedRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<string[]>([]);

  const failedLogosRef = useRef<Set<string>>(new Set());
  const [, forceRerender] = useState(0);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const shareMessageTimerRef = useRef<number | null>(null);
  const comingSoonTimerRef = useRef<number | null>(null);

  const topicsInData = useMemo(() => {
    const s = new Set<string>();
    for (const c of clusters) s.add(normalizeTopic(c.best_item.topic || c.topic));
    if (!s.size) s.add(UNCATEGORIZED);
    return s;
  }, [clusters]);

  const categoryOptions = useMemo(() => CATEGORY_ORDER, []);

  const regionOptionsForUi = useMemo(() => {
    if (regionsData.length > 0) return regionsData;
    return FALLBACK_REGION_OPTIONS;
  }, [regionsData]);

  const subdivisionOptions = useMemo(() => {
    if (subdivisionsData.length > 0) return subdivisionsData;
    return getFallbackSubdivisionsForRegion(region);
  }, [subdivisionsData, region]);

  const subdivisionLabel = useMemo(() => {
    return subdivisionLabelForRegion(region, regionOptionsForUi);
  }, [region, regionOptionsForUi]);

  const selectedRegionDefaultSubdivision = useMemo(() => {
    return defaultSubdivisionForRegion(region, regionOptionsForUi, subdivisionOptions);
  }, [region, regionOptionsForUi, subdivisionOptions]);

  useEffect(() => {
    if (category !== "all" && !topicsInData.has(category)) {
      setCategory("all");
    }
  }, [topicsInData, category]);

  useEffect(() => {
    if (!subdivisionOptions.some((c) => c.key === subdivision)) {
      setSubdivision(selectedRegionDefaultSubdivision);
    }
  }, [subdivision, subdivisionOptions, selectedRegionDefaultSubdivision]);

  function openTranslated(link: string) {
    // On iOS, open the article directly so Safari's built-in translate can handle it
    // (Google Translate redirect doesn't work well on iOS Safari)
    if (ios) {
      window.open(link, "_blank");
      return;
    }
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

  function clearSearchOnly() {
    setQuery("");
    try {
      searchInputRef.current?.focus();
    } catch {}
  }

  async function fetchRegionsFromBackend(): Promise<RegionOption[]> {
    try {
      const res = await fetch("/api/regions", { cache: "no-store" });
      const data = await safeJson(res);
      if (!res.ok) return FALLBACK_REGION_OPTIONS;

      const regions = Array.isArray(data?.regions) ? data.regions : [];
      const cleaned = regions
        .map((r: any) => ({
          key: String(r?.key || "").trim(),
          name: String(r?.name || "").trim(),
          status: r?.status === "live" ? "live" : "coming-soon",
          subdivision_label: String(r?.subdivision_label || "").trim() || undefined,
          default_subdivision:
            String(r?.default_subdivision || "").trim() ||
            String(r?.default_country || "").trim() ||
            undefined,
          default_country:
            String(r?.default_country || "").trim() ||
            String(r?.default_subdivision || "").trim() ||
            undefined,
          subdivisions_count:
            typeof r?.subdivisions_count === "number"
              ? r.subdivisions_count
              : typeof r?.countries_count === "number"
              ? r.countries_count
              : undefined,
          countries_count:
            typeof r?.countries_count === "number"
              ? r.countries_count
              : typeof r?.subdivisions_count === "number"
              ? r.subdivisions_count
              : undefined,
          source_count: typeof r?.source_count === "number" ? r.source_count : undefined,
        }))
        .filter((r: RegionOption) => r.key && r.name);

      return cleaned.length > 0 ? cleaned : FALLBACK_REGION_OPTIONS;
    } catch {
      return FALLBACK_REGION_OPTIONS;
    }
  }

  async function fetchSubdivisionsForRegion(regionKey: string): Promise<SubdivisionOption[]> {
    try {
      const params = new URLSearchParams({ region: regionKey });
      const res = await fetch(`/api/subdivisions?${params.toString()}`, { cache: "no-store" });
      const data = await safeJson(res);

      if (!res.ok) {
        return getFallbackSubdivisionsForRegion(regionKey);
      }

      const subdivisions = Array.isArray(data?.subdivisions) ? data.subdivisions : [];
      const cleaned = subdivisions
        .map((c: any) => ({
          key: String(c?.key || "").trim(),
          code: String(c?.code || "").trim(),
          name: String(c?.name || "").trim(),
          flag_url: String(c?.flag_url || ""),
          source_count: typeof c?.source_count === "number" ? c.source_count : undefined,
        }))
        .filter((c: SubdivisionOption) => c.key && c.name);

      return cleaned.length > 0 ? cleaned : getFallbackSubdivisionsForRegion(regionKey);
    } catch {
      try {
        const params = new URLSearchParams({ region: regionKey });
        const res = await fetch(`/api/countries?${params.toString()}`, { cache: "no-store" });
        const data = await safeJson(res);
        if (!res.ok) return getFallbackSubdivisionsForRegion(regionKey);

        const countries = Array.isArray(data?.countries) ? data.countries : [];
        const cleaned = countries
          .map((c: any) => ({
            key: String(c?.key || "").trim(),
            code: String(c?.code || "").trim(),
            name: String(c?.name || "").trim(),
            flag_url: String(c?.flag_url || ""),
            source_count: typeof c?.source_count === "number" ? c.source_count : undefined,
          }))
          .filter((c: SubdivisionOption) => c.key && c.name);

        return cleaned.length > 0 ? cleaned : getFallbackSubdivisionsForRegion(regionKey);
      } catch {
        return getFallbackSubdivisionsForRegion(regionKey);
      }
    }
  }

  function resetFiltersToDefault() {
    const nextRegion = DEFAULT_REGION;
    const fallbackSubdivisions = getFallbackSubdivisionsForRegion(nextRegion);
    const nextSubdivision = defaultSubdivisionForRegion(nextRegion, regionOptionsForUi, fallbackSubdivisions);
    const nextRange = DEFAULT_RANGE;
    const nextCategory = DEFAULT_CATEGORY;
    const nextHeadlineLimit = DEFAULT_HEADLINE_LIMIT;

    setRegion(nextRegion);
    setSubdivision(nextSubdivision);
    setRange(nextRange);
    setCategory(nextCategory);
    setHeadlineLimit(nextHeadlineLimit);
    setQuery("");

    loadTopStories(nextRegion, nextRange, nextSubdivision, nextHeadlineLimit);
  }

  async function selectRegionHomepage(nextRegion: string) {
    const option = regionOptionsForUi.find((r) => r.key === nextRegion);
    if (!option) return;

    if (option.status !== "live") {
      showComingSoon(`${option.name} is coming soon.`);
      return;
    }

    const nextRange = DEFAULT_RANGE;
    const nextCategory = DEFAULT_CATEGORY;
    const nextHeadlineLimit = DEFAULT_HEADLINE_LIMIT;
    const nextQuery = "";

    setRegion(nextRegion);
    setRange(nextRange);
    setCategory(nextCategory);
    setHeadlineLimit(nextHeadlineLimit);
    setQuery(nextQuery);

    const nextSubdivisions = await fetchSubdivisionsForRegion(nextRegion);
    setSubdivisionsData(nextSubdivisions);

    const nextSubdivision = defaultSubdivisionForRegion(nextRegion, regionOptionsForUi, nextSubdivisions);
    setSubdivision(nextSubdivision);

    await loadTopStories(nextRegion, nextRange, nextSubdivision, nextHeadlineLimit);
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

  function showComingSoon(message: string) {
    setComingSoonMessage(message);

    if (comingSoonTimerRef.current) {
      window.clearTimeout(comingSoonTimerRef.current);
    }

    comingSoonTimerRef.current = window.setTimeout(() => {
      setComingSoonMessage("");
      comingSoonTimerRef.current = null;
    }, 2200);
  }

  function getSharePath() {
    return buildShareableUrl({
      region,
      subdivision,
      range,
      category,
      headlineLimit,
      query,
      defaultSubdivisionForRegion: selectedRegionDefaultSubdivision,
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
          title: APP_NAME,
          text: `View this ${selectedRegionName} feed`,
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
    const text = encodeURIComponent(`${selectedRegionName}: ${selectedSubdivisionName}`);
    let shareHref = "";

    if (type === "whatsapp") {
      shareHref = `https://wa.me/?text=${text}%20${encodedUrl}`;
    } else if (type === "x") {
      shareHref = `https://twitter.com/intent/tweet?text=${text}&url=${encodedUrl}`;
    } else if (type === "facebook") {
      shareHref = `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`;
    } else if (type === "email") {
      shareHref = `mailto:?subject=${encodeURIComponent(`${selectedRegionName}: ${selectedSubdivisionName}`)}&body=${encodeURIComponent(
        `Take a look at this view:\n\n${url}`
      )}`;
    }

    if (!shareHref) return;
    window.open(shareHref, "_blank", "noopener,noreferrer");
    setShareOpen(false);
  }

  async function loadTopStories(
    selectedRegion = region,
    selectedRange = range,
    selectedSubdivision = subdivision,
    selectedHeadlineLimit = headlineLimit
  ) {
    setLoading(true);
    setLoadError(null);

    try {
      const params = new URLSearchParams({
        region: selectedRegion,
        subdivision: selectedSubdivision,
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
        setLoadError({ message: "We couldn't load headlines right now.", status: res.status });
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
      setLoadError({ message: "We couldn't load headlines right now.", status: 0 });
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
    let savedRegion = DEFAULT_REGION;
    let savedSubdivision = "";
    let savedRange = DEFAULT_RANGE;
    let savedCategory: CategoryFilter = DEFAULT_CATEGORY;
    let savedHeadlineLimit: HeadlineLimit = DEFAULT_HEADLINE_LIMIT;
    let savedQuery = DEFAULT_QUERY;

    try {
      const themeRaw = window.localStorage.getItem(STORAGE_KEYS.theme);
      if (themeRaw === "light" || themeRaw === "dark") savedTheme = themeRaw;

      const regionRaw = (window.localStorage.getItem(STORAGE_KEYS.region) || "").trim();
      if (regionRaw) savedRegion = regionRaw;

      const subdivisionRaw =
        (window.localStorage.getItem(STORAGE_KEYS.subdivision) || "").trim() ||
        (window.localStorage.getItem(STORAGE_KEYS.country) || "").trim();
      if (subdivisionRaw) savedSubdivision = subdivisionRaw;

      const rangeRaw = window.localStorage.getItem(STORAGE_KEYS.range);
      if (rangeRaw && isValidRange(rangeRaw)) savedRange = rangeRaw;

      const categoryRaw = window.localStorage.getItem(STORAGE_KEYS.category);
      if (categoryRaw && isValidCategory(categoryRaw)) savedCategory = categoryRaw;

      const headlineLimitRaw = window.localStorage.getItem(STORAGE_KEYS.headlineLimit);
      if (headlineLimitRaw && isValidHeadlineLimit(headlineLimitRaw)) {
        savedHeadlineLimit = Number(headlineLimitRaw) as HeadlineLimit;
      }
    } catch {}

    try {
      const sp = new URLSearchParams(window.location.search);

      const regionParam = (sp.get("region") || "").trim();
      if (regionParam) savedRegion = regionParam;

      const subdivisionParam = (sp.get("subdivision") || sp.get("country") || "").trim();
      if (subdivisionParam) savedSubdivision = subdivisionParam;

      const rangeParam = sp.get("range");
      if (rangeParam && isValidRange(rangeParam)) savedRange = rangeParam;

      const categoryParam = sp.get("category");
      if (categoryParam && isValidCategory(categoryParam)) savedCategory = categoryParam;

      const limitParam = sp.get("limit");
      if (limitParam && isValidHeadlineLimit(limitParam)) {
        savedHeadlineLimit = Number(limitParam) as HeadlineLimit;
      }

      const queryParam = sp.get("q");
      if (typeof queryParam === "string") savedQuery = queryParam;
    } catch {}

    async function initialize() {
      const startTime = Date.now();

      const nextRegions = await fetchRegionsFromBackend();
      const normalizedRegion =
        nextRegions.some((r) => r.key === savedRegion) && isLiveRegionFromList(savedRegion, nextRegions)
          ? savedRegion
          : DEFAULT_REGION;

      const nextSubdivisions = await fetchSubdivisionsForRegion(normalizedRegion);
      const normalizedSubdivision = nextSubdivisions.some((c) => c.key === savedSubdivision)
        ? savedSubdivision
        : defaultSubdivisionForRegion(normalizedRegion, nextRegions, nextSubdivisions);

      setMounted(true);
      setTheme(savedTheme);

      try {
        setIos(isIOS());
        setStandalone(isStandalone());
      } catch {}

      setRegionsData(nextRegions);
      setSubdivisionsData(nextSubdivisions);

      setRegion(normalizedRegion);
      setSubdivision(normalizedSubdivision);
      setRange(savedRange);
      setCategory(savedCategory);
      setHeadlineLimit(savedHeadlineLimit);
      setQuery(savedQuery);
      setPrefsReady(true);

      await loadTopStories(normalizedRegion, savedRange, normalizedSubdivision, savedHeadlineLimit);

      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, STARTUP_SPLASH_MIN_MS - elapsed);

      window.setTimeout(() => {
        setShowStartupSplash(false);
      }, remaining);
    }

    void initialize();
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
      window.localStorage.setItem(STORAGE_KEYS.region, region);
    } catch {}
  }, [region, prefsReady]);

  useEffect(() => {
    if (!prefsReady) return;
    try {
      window.localStorage.setItem(STORAGE_KEYS.subdivision, subdivision);
      window.localStorage.setItem(STORAGE_KEYS.country, subdivision);
    } catch {}
  }, [subdivision, prefsReady]);

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
        region,
        subdivision,
        range,
        category,
        headlineLimit,
        query,
        defaultSubdivisionForRegion: selectedRegionDefaultSubdivision,
      });
      if (nextUrl && `${window.location.pathname}${window.location.search}` !== nextUrl) {
        window.history.replaceState(null, "", nextUrl);
      }
    } catch {}
  }, [region, subdivision, range, category, headlineLimit, query, prefsReady, selectedRegionDefaultSubdivision]);

  useEffect(() => {
    return () => {
      if (shareMessageTimerRef.current) window.clearTimeout(shareMessageTimerRef.current);
      if (comingSoonTimerRef.current) window.clearTimeout(comingSoonTimerRef.current);
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
  const hasNonDefaultRegion = region !== DEFAULT_REGION;
  const hasNonDefaultSubdivision = subdivision !== selectedRegionDefaultSubdivision;
  const hasNonDefaultRange = range !== DEFAULT_RANGE;
  const hasNonDefaultCategory = category !== DEFAULT_CATEGORY;
  const hasNonDefaultLimit = headlineLimit !== DEFAULT_HEADLINE_LIMIT;

  const showFilterChips =
    hasNonDefaultRegion || hasNonDefaultSubdivision || hasNonDefaultRange || hasNonDefaultCategory || hasNonDefaultLimit;

  const showEmptyState = !loading && !loadError && clusters.length > 0 && filteredClusters.length === 0;
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

  async function handleRegionChange(nextRegion: string) {
    const option = regionOptionsForUi.find((r) => r.key === nextRegion);
    if (!option) return;

    if (option.status !== "live") {
      showComingSoon(`${option.name} is coming soon.`);
      return;
    }

    setRegion(nextRegion);
    setClusters([]);
    setLoadError(null);

    const nextSubdivisions = await fetchSubdivisionsForRegion(nextRegion);
    setSubdivisionsData(nextSubdivisions);

    const nextSubdivision = defaultSubdivisionForRegion(nextRegion, regionOptionsForUi, nextSubdivisions);
    setSubdivision(nextSubdivision);

    await loadTopStories(nextRegion, range, nextSubdivision, headlineLimit);
  }

  async function handleSubdivisionChange(nextSubdivision: string) {
    setSubdivision(nextSubdivision);
    setClusters([]);
    setLoadError(null);
    await loadTopStories(region, range, nextSubdivision, headlineLimit);
  }

  async function handleRangeChange(nextRange: string) {
    setRange(nextRange);
    await loadTopStories(region, nextRange, subdivision, headlineLimit);
  }

  async function handleHeadlineLimitChange(nextLimit: HeadlineLimit) {
    setHeadlineLimit(nextLimit);
    await loadTopStories(region, range, subdivision, nextLimit);
  }

  const selectedRegionName = regionOptionsForUi.find((r) => r.key === region)?.name || "Mercosur";
  const selectedSubdivisionName = subdivisionOptions.find((c) => c.key === subdivision)?.name || "News";

  // Show ad/subscribe banners between articles (hidden for subscribers)
  const AD_BANNER_FIRST = 2;
  const AD_BANNER_INTERVAL = 8;
  function shouldShowBanner(idx: number): boolean {
    if (subscribed) return false;
    if (filteredClusters.length < 4) return false;
    if (idx === AD_BANNER_FIRST) return true;
    return idx > AD_BANNER_FIRST && (idx - AD_BANNER_FIRST) % AD_BANNER_INTERVAL === 0;
  }

  return (
    <>
      <main className="mx-auto max-w-6xl overflow-x-hidden px-4 py-4 sm:px-6 sm:py-8 lg:px-8">
        <section className="relative overflow-hidden rounded-3xl border border-blue-100/60 bg-gradient-to-br from-white/90 via-blue-50/30 to-indigo-50/40 px-5 py-5 shadow-sm backdrop-blur-sm dark:border-gray-800 dark:bg-gradient-to-br dark:from-black/40 dark:via-black/40 dark:to-black/40 sm:px-7 sm:py-7">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.18),transparent_45%),radial-gradient(circle_at_bottom_right,rgba(99,102,241,0.14),transparent_38%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.16),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(99,102,241,0.12),transparent_32%)]" />

          <div className="pointer-events-none absolute right-[-40px] top-[-30px] hidden h-52 w-52 opacity-[0.07] dark:opacity-[0.10] md:block">
            <img src={BRAND_LOGO_PATH} alt="" className="h-full w-full object-contain" />
          </div>

          <div className="relative flex flex-col gap-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <img
                    src={BRAND_LOGO_PATH}
                    alt={APP_NAME}
                    className="h-14 w-14 shrink-0 object-contain sm:h-16 sm:w-16"
                  />

                  <div className="min-w-0">
                    <h1 className="break-words text-[2.4rem] font-extrabold leading-[0.92] tracking-tight text-gray-950 dark:text-white sm:text-6xl">
                      <span className="text-blue-500">Regional Pulse</span> News
                    </h1>
                  </div>
                </div>

                <p className="mt-3 max-w-2xl text-sm leading-relaxed text-gray-600 dark:text-gray-400 sm:text-base">
                  {APP_TAGLINE}
                </p>
              </div>

              <div className="flex items-center gap-2 self-start sm:self-auto">
                {!standalone && (installEvent || ios) ? (
                  <button
                    onClick={handleInstallClick}
                    className="inline-flex min-h-9 items-center gap-2 rounded-full border border-blue-500 bg-blue-500 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-600 hover:border-blue-600"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4"><path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z" /><path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" /></svg>
                    <span>Install</span>
                  </button>
                ) : null}

                <button
                  onClick={() => setInfoOpen(true)}
                  aria-label="Info"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-300 bg-white text-blue-600 shadow-sm transition hover:border-blue-300 hover:text-blue-500 dark:border-gray-700 dark:bg-black dark:text-blue-400"
                >
                  <InfoIcon />
                </button>

                <button
                  onClick={() => setFeedbackOpen(true)}
                  aria-label="Feedback"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-300 bg-white text-blue-600 shadow-sm transition hover:border-blue-300 hover:text-blue-500 dark:border-gray-700 dark:bg-black dark:text-blue-400"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4"><path fillRule="evenodd" d="M3.43 2.524A41.29 41.29 0 0110 2c2.236 0 4.43.18 6.57.524 1.437.231 2.43 1.49 2.43 2.902v5.148c0 1.413-.993 2.67-2.43 2.902a41.102 41.102 0 01-3.55.414c-.28.02-.521.18-.643.413l-1.712 3.293a.75.75 0 01-1.33 0l-1.713-3.293a.783.783 0 00-.642-.413 41.108 41.108 0 01-3.55-.414C1.993 13.245 1 11.986 1 10.574V5.426c0-1.413.993-2.67 2.43-2.902z" clipRule="evenodd" /></svg>
                </button>

                <button
                  onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-300 bg-white text-blue-600 shadow-sm transition hover:border-blue-300 hover:text-blue-500 dark:border-gray-700 dark:bg-black dark:text-blue-400"
                  aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                >
                  {mounted ? theme === "dark" ? <SunIcon /> : <MoonIcon /> : <MoonIcon />}
                </button>

                {subscribed ? (
                  <button
                    onClick={handleManageSubscription}
                    aria-label="Manage subscription"
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-green-300 bg-green-50 text-green-600 shadow-sm transition hover:border-green-400 hover:bg-green-100 dark:border-green-700 dark:bg-green-500/10 dark:text-green-400 dark:hover:bg-green-500/20"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4"><path fillRule="evenodd" d="M8 15A7 7 0 108 1a7 7 0 000 14zm3.844-8.791a.75.75 0 00-1.188-.918l-3.7 4.79-1.649-1.833a.75.75 0 10-1.114 1.004l2.25 2.5a.75.75 0 001.152-.043l4.25-5.5z" clipRule="evenodd" /></svg>
                  </button>
                ) : (
                  <button
                    onClick={() => setSubscribeOpen(true)}
                    aria-label="Subscribe"
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-300 bg-white text-blue-600 shadow-sm transition hover:border-blue-300 hover:text-blue-500 dark:border-gray-700 dark:bg-black dark:text-blue-400"
                  >
                    <span className="text-sm font-bold leading-none">$</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        {subscribed ? (
          <div className="mt-3 flex items-center justify-between rounded-2xl border border-green-200 bg-green-50/80 px-3 py-1.5 dark:border-green-800 dark:bg-green-500/10">
            <div className="flex items-center gap-1.5">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 text-green-600 dark:text-green-400"><path fillRule="evenodd" d="M8 15A7 7 0 108 1a7 7 0 000 14zm3.844-8.791a.75.75 0 00-1.188-.918l-3.7 4.79-1.649-1.833a.75.75 0 10-1.114 1.004l2.25 2.5a.75.75 0 001.152-.043l4.25-5.5z" clipRule="evenodd" /></svg>
              <span className="text-xs font-medium text-green-800 dark:text-green-300">Ad-free subscriber</span>
            </div>
            <button
              onClick={handleManageSubscription}
              className="text-xs text-green-600 underline underline-offset-2 transition hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
            >
              Manage
            </button>
          </div>
        ) : null}

        <section className="mt-3 rounded-3xl border border-gray-200/60 bg-white/70 p-4 shadow-sm backdrop-blur-sm dark:border-gray-800 dark:bg-black/30 sm:p-5">
          <div className="flex flex-col gap-3">
            <div>
              <h2 className="text-base font-semibold text-gray-950 dark:text-white sm:text-lg">Choose your region</h2>
            </div>

            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {regionOptionsForUi.map((regionOption) => {
                const isSelected = regionOption.key === region;
                const isLive = regionOption.status === "live";

                return (
                  <button
                    key={regionOption.key}
                    type="button"
                    onClick={() => void selectRegionHomepage(regionOption.key)}
                    className={`min-w-0 rounded-2xl border px-2 py-2 text-center shadow-sm transition sm:px-3 sm:py-2.5 ${
                      isSelected
                        ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-500/10"
                        : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50 dark:border-gray-800 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
                    }`}
                  >
                    <div className="flex min-h-[52px] flex-col items-center justify-center gap-1.5 sm:min-h-[56px]">
                      <span
                        className={`block text-center text-[13px] font-semibold tracking-tight sm:text-[15px] ${
                          regionOption.key === "central-america" ? "leading-tight" : "truncate"
                        } text-gray-950 dark:text-white`}
                      >
                        {regionOption.name}
                      </span>

                      <span
                        className={`inline-flex w-fit max-w-full items-center justify-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[8px] font-semibold uppercase leading-none tracking-wide sm:px-2.5 sm:py-1 sm:text-[10px] ${
                          isLive
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300"
                            : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300"
                        }`}
                      >
                        {isLive ? "Live" : "Coming Soon"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            {comingSoonMessage ? (
              <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-200">
                {comingSoonMessage}
              </div>
            ) : null}
          </div>
        </section>

        <section className="mt-4 rounded-3xl border border-gray-200/60 bg-white/70 p-4 shadow-sm backdrop-blur-sm dark:border-gray-800 dark:bg-black/30 sm:p-5">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <label className="sr-only">Search</label>
                <input
                  ref={searchInputRef}
                  className="h-11 w-full rounded-xl border border-gray-300 bg-white px-3 pr-9 text-sm text-black shadow-sm placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                  placeholder="Search headlines & summaries"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      performSearchAction();
                    }
                  }}
                />
                {query && (
                  <button
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                    onClick={() => { setQuery(""); searchInputRef.current?.focus(); }}
                    title="Clear search"
                    type="button"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                )}
              </div>

              <button
                className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border border-gray-300 bg-white px-3 text-sm font-medium text-gray-900 shadow-sm transition hover:border-gray-400 hover:bg-gray-50 dark:border-gray-700 dark:bg-black dark:text-white dark:hover:bg-white/[0.04]"
                onClick={() => setFiltersOpen(true)}
                title="Open filters"
              >
                <FilterIcon />
                <span className="hidden sm:inline">Filters</span>
              </button>

              <button
                className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border border-gray-900 bg-gray-900 px-4 text-sm font-medium text-white shadow-sm transition hover:opacity-90 dark:border-white dark:bg-white dark:text-black"
                onClick={performSearchAction}
                title="Search"
              >
                <SearchIcon />
                <span className="hidden sm:inline">Search</span>
              </button>
            </div>

            {showFilterChips ? (
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                {hasNonDefaultRegion ? (
                  <span className="rounded-full border border-gray-300 px-3 py-1 dark:border-gray-700">
                    Region: {selectedRegionName}
                  </span>
                ) : null}
                {hasNonDefaultSubdivision ? (
                  <span className="rounded-full border border-gray-300 px-3 py-1 dark:border-gray-700">
                    {subdivisionLabel}: {selectedSubdivisionName}
                  </span>
                ) : null}
                {hasNonDefaultRange ? (
                  <span className="rounded-full border border-gray-300 px-3 py-1 dark:border-gray-700">
                    Range: {range === "24h" ? "24h" : range === "3d" ? "3 Days" : range === "7d" ? "7 Days" : "30 Days"}
                  </span>
                ) : null}
                {hasNonDefaultCategory ? (
                  <span className="rounded-full border border-gray-300 px-3 py-1 dark:border-gray-700">
                    Category: {category}
                  </span>
                ) : null}
                {hasNonDefaultLimit ? (
                  <span className="rounded-full border border-gray-300 px-3 py-1 dark:border-gray-700">
                    Limit: Top {headlineLimit}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>

        <section className="mt-5 flex flex-col gap-4 rounded-3xl border border-gray-200/60 bg-white/70 p-5 shadow-sm backdrop-blur-sm dark:border-gray-800 dark:bg-black/30 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-3xl font-bold tracking-tight text-gray-950 dark:text-white">{selectedSubdivisionName} News</h2>

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

            <div className="pt-1 text-sm font-medium text-gray-500 dark:text-gray-400 sm:text-right">
              {loading && !loadError ? "Loading headlines..." : ""}
            </div>
          </div>

          {loadError ? (
            <div className="rounded-2xl border border-gray-300 bg-gray-50 p-4 dark:border-gray-700 dark:bg-white/5">
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm text-gray-800 dark:text-white/80">
                  <div className="font-semibold">Service temporarily unavailable</div>
                  <div className="mt-1 text-gray-600 dark:text-gray-400">
                    We couldn't load headlines right now. Please try again in a moment.
                  </div>
                  {typeof loadError.status === "number" && loadError.status ? (
                    <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-500">Error code: {loadError.status}</div>
                  ) : null}
                </div>
                <button
                  onClick={() => loadTopStories(region, range, subdivision, headlineLimit)}
                  className="inline-flex items-center whitespace-nowrap rounded-full border border-gray-900 bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 dark:border-white dark:bg-white dark:text-black"
                >
                  Retry
                </button>
              </div>
            </div>
          ) : null}

          {showEmptyState ? (
            <div className="rounded-3xl border border-gray-200 bg-gray-50 px-5 py-8 text-center shadow-sm dark:border-gray-800 dark:bg-white/[0.03]">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">No stories match this view</h3>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                Try broadening your search or adjusting your filters to see more coverage from this feed.
              </p>

              {hasActiveSearch ? (
                <div className="mt-4">
                  <button
                    onClick={clearSearchOnly}
                    className="inline-flex items-center rounded-full border border-gray-900 bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 dark:border-white dark:bg-white dark:text-black"
                  >
                    Clear search
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2 lg:gap-6">
          {loading ? null : filteredClusters.map((c, index) => {
            const a = c.best_item;
            const isFeatured = index < 2;

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

            const displayFlag = a.subdivision_flag_url || a.country_flag_url || "";

            return (
              <Fragment key={c.cluster_id}>
                {shouldShowBanner(index) ? (
                  <button
                    onClick={() => setSubscribeOpen(true)}
                    className="lg:col-span-2 group cursor-pointer rounded-3xl border border-blue-200/60 bg-gradient-to-br from-blue-50 via-white to-indigo-50 p-5 shadow-sm transition hover:shadow-md hover:border-blue-300 dark:border-blue-500/20 dark:from-blue-950/40 dark:via-black/60 dark:to-indigo-950/30 dark:hover:border-blue-500/40"
                    type="button"
                  >
                    <div className="flex flex-col items-center gap-3 py-1">
                      <div className="flex items-center gap-3">
                        <img src={BRAND_LOGO_PATH} alt="" className="h-10 w-10 rounded-xl shadow-sm" />
                        <div className="text-left">
                          <p className="text-sm font-semibold text-gray-900 dark:text-white">Love Regional Pulse News?</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">Subscribe to go ad-free and support this app</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center rounded-full bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition group-hover:bg-blue-700">
                          Subscribe from $1.29/mo
                        </span>
                      </div>
                    </div>
                  </button>
                ) : null}

                <div
                  ref={(el) => {
                    cardRefs.current[a.link] = el;
                  }}
                  data-link={a.link}
                  className={`rounded-3xl border shadow-sm transition ${
                    isFeatured ? "lg:col-span-2 p-6 sm:p-8" : "p-5 sm:p-6"
                  } ${
                    translatedReady
                      ? "border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.02]"
                      : "border-gray-200 bg-gray-50/80 opacity-70 dark:border-gray-800 dark:bg-white/[0.03]"
                  }`}
                >
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      {displayFlag ? <img src={displayFlag} alt="Flag" className="h-4 w-auto rounded-sm" /> : null}

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
                      <h3 className={`font-semibold leading-snug tracking-tight text-gray-950 dark:text-white ${
                        isFeatured ? "text-2xl sm:text-[1.7rem]" : "text-xl"
                      }`}>{a.title_en}</h3>
                      <p className={`mt-3 leading-7 text-gray-800 dark:text-white/80 ${
                        isFeatured ? "text-base" : "text-[15px]"
                      }`}>{a.summary_en}</p>
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
                      <div className={`w-5/6 rounded bg-gray-200 dark:bg-gray-700 ${isFeatured ? "h-7" : "h-6"}`} />
                      <div className="h-3 w-5/6 rounded bg-gray-200 dark:bg-gray-700" />
                      <div className="h-3 w-4/6 rounded bg-gray-200 dark:bg-gray-700" />
                    </div>
                  )}

                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-gray-500 dark:text-gray-400">{formatPublishedUTC(a)}</p>

                    <button
                      onClick={() => openTranslated(a.link)}
                      disabled={!translatedReady}
                      className={`inline-flex items-center rounded-full border px-4 py-2.5 text-sm font-semibold transition ${
                        translatedReady
                          ? "border-blue-600 bg-blue-600 text-white shadow-sm hover:bg-blue-700 hover:border-blue-700 dark:border-blue-500 dark:bg-blue-500 dark:hover:bg-blue-600 dark:hover:border-blue-600"
                          : "cursor-not-allowed border-gray-300 bg-gray-200 text-gray-500 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-500"
                      }`}
                    >
                      {ios ? "Read Original Article →" : "Open Translated Article →"}
                    </button>
                  </div>
                </div>
              </Fragment>
            );
          })}
        </div>

        {filtersOpen ? (
          <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
            <button
              className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
              aria-label="Close filters"
              onClick={() => setFiltersOpen(false)}
            />
            <div className="relative max-h-[88vh] w-full overflow-x-hidden overflow-y-auto rounded-t-3xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-700 dark:bg-black sm:w-[calc(100vw-2rem)] sm:max-w-xl sm:rounded-3xl sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="text-xl font-semibold tracking-tight">Filters</h3>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                    Adjust your region and feed settings.
                  </p>
                </div>

                <button
                  onClick={() => setFiltersOpen(false)}
                  className="shrink-0 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium hover:opacity-90 dark:border-gray-700"
                  aria-label="Close filters modal"
                >
                  Close
                </button>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Region</label>
                  <select
                    value={region}
                    onChange={(e) => void handleRegionChange(e.target.value)}
                    className="h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-black shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                  >
                    {regionOptionsForUi.map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.status === "live" ? r.name : `${r.name} (coming soon)`}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">{subdivisionLabel}</label>
                  <select
                    value={subdivision}
                    onChange={(e) => void handleSubdivisionChange(e.target.value)}
                    className="h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-black shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                  >
                    {subdivisionOptions.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Date Range</label>
                  <select
                    value={range}
                    onChange={(e) => void handleRangeChange(e.target.value)}
                    className="h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-black shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                  >
                    <option value="24h">Last 24 Hours</option>
                    <option value="3d">Last 3 Days</option>
                    <option value="7d">Last 7 Days</option>
                    <option value="30d">Last 30 Days</option>
                  </select>
                </div>

                <div>
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

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Headline Limit</label>
                  <select
                    value={headlineLimit}
                    onChange={(e) => void handleHeadlineLimitChange(Number(e.target.value) as HeadlineLimit)}
                    className="h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-black shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                  >
                    {HEADLINE_LIMIT_OPTIONS.map((limit) => (
                      <option key={limit} value={limit}>
                        Top {limit}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                <button
                  onClick={resetFiltersToDefault}
                  className="inline-flex items-center rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 shadow-sm transition hover:border-gray-400 hover:bg-gray-50 dark:border-gray-700 dark:bg-black dark:text-white dark:hover:bg-white/[0.04]"
                >
                  Reset defaults
                </button>

                <button
                  onClick={() => setFiltersOpen(false)}
                  className="inline-flex items-center rounded-full border border-gray-900 bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:opacity-90 dark:border-white dark:bg-white dark:text-black"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        ) : null}

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

        {feedbackOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <button className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" aria-label="Close" onClick={() => setFeedbackOpen(false)} />
            <div className="relative max-h-[85vh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto rounded-3xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-700 dark:bg-black sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="text-xl font-semibold tracking-tight">Send Feedback</h3>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                    Found a bug, have an idea, or just want to say hello? We'd love to hear from you.
                  </p>
                </div>
                <button
                  onClick={() => setFeedbackOpen(false)}
                  className="shrink-0 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium hover:opacity-90 dark:border-gray-700"
                  aria-label="Close modal"
                >
                  Close
                </button>
              </div>

              {fbSent ? (
                <div className="mt-6 rounded-2xl border border-green-200 bg-green-50 p-5 text-center dark:border-green-800 dark:bg-green-900/20">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="mx-auto h-8 w-8 text-green-600 dark:text-green-400"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" /></svg>
                  <p className="mt-2 font-semibold text-green-800 dark:text-green-200">Thank you!</p>
                  <p className="mt-1 text-sm text-green-700 dark:text-green-300">Your feedback has been sent. We appreciate you taking the time.</p>
                  <button
                    onClick={() => setFeedbackOpen(false)}
                    className="mt-4 rounded-full border border-green-300 px-4 py-1.5 text-sm font-medium text-green-800 transition hover:bg-green-100 dark:border-green-700 dark:text-green-200 dark:hover:bg-green-900/40"
                  >
                    Done
                  </button>
                </div>
              ) : (
                <form onSubmit={handleFeedbackSubmit} className="mt-5 space-y-4">
                  <div>
                    <label htmlFor="fb-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Name</label>
                    <input
                      id="fb-name"
                      type="text"
                      required
                      value={fbName}
                      onChange={(e) => setFbName(e.target.value)}
                      placeholder="Your name"
                      className="mt-1 block w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-sm shadow-sm transition focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-black dark:text-white dark:focus:border-blue-400 dark:focus:ring-blue-400"
                    />
                  </div>
                  <div>
                    <label htmlFor="fb-email" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Email</label>
                    <input
                      id="fb-email"
                      type="email"
                      required
                      value={fbEmail}
                      onChange={(e) => setFbEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="mt-1 block w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-sm shadow-sm transition focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-black dark:text-white dark:focus:border-blue-400 dark:focus:ring-blue-400"
                    />
                  </div>
                  <div>
                    <label htmlFor="fb-message" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Message</label>
                    <textarea
                      id="fb-message"
                      required
                      rows={4}
                      value={fbMessage}
                      onChange={(e) => setFbMessage(e.target.value)}
                      placeholder="What's on your mind?"
                      className="mt-1 block w-full resize-y rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-sm shadow-sm transition focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-black dark:text-white dark:focus:border-blue-400 dark:focus:ring-blue-400"
                    />
                  </div>
                  {fbError ? (
                    <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{fbError}</p>
                  ) : null}
                  <button
                    type="submit"
                    disabled={fbSending}
                    className="inline-flex w-full items-center justify-center rounded-full border border-gray-900 bg-gray-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:opacity-90 disabled:opacity-50 dark:border-white dark:bg-white dark:text-black"
                  >
                    {fbSending ? "Sending…" : "Send Feedback"}
                  </button>
                </form>
              )}
            </div>
          </div>
        ) : null}

        {subscribeOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <button className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" aria-label="Close" onClick={() => setSubscribeOpen(false)} />
            <div className="relative w-[calc(100vw-2rem)] max-w-md rounded-3xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-700 dark:bg-black sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="text-xl font-semibold tracking-tight">Go Ad-Free</h3>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                    Support Regional Pulse News and enjoy a cleaner reading experience.
                  </p>
                </div>
                <button
                  onClick={() => setSubscribeOpen(false)}
                  className="shrink-0 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium hover:opacity-90 dark:border-gray-700"
                  aria-label="Close modal"
                >
                  Close
                </button>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  onClick={() => handleSubscribe("monthly")}
                  disabled={subscribing}
                  className="flex flex-col items-center gap-1 rounded-2xl border-2 border-gray-200 bg-white p-5 text-center shadow-sm transition hover:border-blue-400 hover:shadow-md dark:border-gray-700 dark:bg-white/[0.03] dark:hover:border-blue-500"
                >
                  <span className="text-2xl font-bold text-gray-950 dark:text-white">$1.29</span>
                  <span className="text-sm text-gray-600 dark:text-gray-400">per month</span>
                </button>

                <button
                  onClick={() => handleSubscribe("yearly")}
                  disabled={subscribing}
                  className="relative flex flex-col items-center gap-1 rounded-2xl border-2 border-blue-500 bg-blue-50 p-5 text-center shadow-sm transition hover:shadow-md dark:border-blue-400 dark:bg-blue-500/10"
                >
                  <span className="absolute -top-2.5 rounded-full bg-blue-500 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                    Save 23%
                  </span>
                  <span className="text-2xl font-bold text-gray-950 dark:text-white">$11.99</span>
                  <span className="text-sm text-gray-600 dark:text-gray-400">per year</span>
                  <span className="mt-0.5 text-xs text-blue-600 dark:text-blue-400">$1.00/month</span>
                </button>
              </div>

              {subscribing ? (
                <p className="mt-4 text-center text-sm text-gray-500">Redirecting to payment...</p>
              ) : (
                <p className="mt-4 text-center text-xs text-gray-400 dark:text-gray-500">
                  Secure payment via Stripe. Cancel anytime.
                </p>
              )}
            </div>
          </div>
        ) : null}

        {infoOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <button className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" aria-label="Close" onClick={() => setInfoOpen(false)} />
            <div className="relative max-h-[85vh] w-[calc(100vw-2rem)] max-w-2xl overflow-x-hidden overflow-y-auto rounded-3xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-700 dark:bg-black sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="break-words text-xl font-semibold tracking-tight">About {APP_NAME}</h3>
                  <p className="mt-1 break-words text-sm text-gray-600 dark:text-gray-400">
                    A mobile-friendly regional news feed, translated into English.
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
                    Follow regional news in English without juggling a dozen local-language sites. The app pulls in public RSS headlines, groups overlapping coverage into a single story card with a short English summary, and lets you switch between regional editions from one page.
                  </p>
                </div>

                <div className="border-t border-gray-200 pt-5 dark:border-gray-800">
                  <div className="font-semibold text-gray-900 dark:text-white">What you can do</div>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-gray-600 dark:text-gray-400">
                    <li>
                      <span className="text-gray-800 dark:text-white/80">Switch regions instantly:</span> jump between available regional editions without leaving the page.
                    </li>
                    <li>
                      <span className="text-gray-800 dark:text-white/80">Search in English:</span> search stays visible on the main screen for quick filtering across translated headlines.
                    </li>
                    <li>
                      <span className="text-gray-800 dark:text-white/80">Filter by what matters:</span> region, subdivision, date range, category, and headline limit are all in the Filters panel.
                    </li>
                    <li>
                      <span className="text-gray-800 dark:text-white/80">Read full articles:</span> tap the article button to open the original source in English (see "How translation works" below).
                    </li>
                  </ul>
                </div>

                <div className="border-t border-gray-200 pt-5 dark:border-gray-800">
                  <div className="font-semibold text-gray-900 dark:text-white">Story grouping</div>
                  <p className="mt-2 text-gray-600 dark:text-gray-400">
                    When multiple outlets cover the same story, the app groups them into a single card so you get one clean summary instead of a wall of duplicates. You can still see every source behind the story.
                  </p>
                </div>

                <div className="border-t border-gray-200 pt-5 dark:border-gray-800">
                  <div className="font-semibold text-gray-900 dark:text-white">How translation works</div>
                  <p className="mt-2 text-gray-600 dark:text-gray-400">
                    Headlines and summaries are translated into English automatically as stories load. Cards stay muted until the English text is ready so the feed always looks clean.
                  </p>
                  <p className="mt-2 text-gray-600 dark:text-gray-400">
                    For full articles, it depends on your device:
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-gray-600 dark:text-gray-400">
                    <li>
                      <span className="text-gray-800 dark:text-white/80">iPhone / iPad (Safari):</span> articles open in their original language. Tap the <span className="font-medium">aA</span> button in the address bar and choose "Translate to English" for a native, clean translation.
                    </li>
                    <li>
                      <span className="text-gray-800 dark:text-white/80">Android / Chrome:</span> articles open through Google Translate so you see the full story in English automatically.
                    </li>
                    <li>
                      <span className="text-gray-800 dark:text-white/80">Desktop browsers:</span> articles open through Google Translate. Most browsers also offer a built-in translate option in the address bar.
                    </li>
                  </ul>
                </div>

                <div className="border-t border-gray-200 pt-5 dark:border-gray-800">
                  <div className="font-semibold text-gray-900 dark:text-white">Add to Home Screen</div>

                  {standalone ? (
                    <div className="mt-2 space-y-2 text-gray-600 dark:text-gray-400">
                      <p>You're already running the app in installed mode.</p>
                      <p>If you reopen it from your home screen or app launcher, it should continue to open as an app.</p>
                    </div>
                  ) : installEvent ? (
                    <div className="mt-2 space-y-3 text-gray-600 dark:text-gray-400">
                      <p>Your browser supports installing this app for a faster, app-like experience.</p>
                      <button
                        onClick={handleInstallClick}
                        className="inline-flex items-center justify-center rounded-full border border-gray-900 bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 dark:border-white dark:bg-white dark:text-black"
                      >
                        Install
                      </button>
                      <p>
                        If you prefer to do it manually, open your browser menu and look for options such as "Install app", "Add to Home screen", or "Create shortcut".
                      </p>
                    </div>
                  ) : ios ? (
                    <div className="mt-2 space-y-2 text-gray-600 dark:text-gray-400">
                      <p>On iPhone or iPad, open this site in Safari, tap Share, then choose "Add to Home Screen".</p>
                      <p>If you do not see the option right away, scroll the Share sheet list until "Add to Home Screen" appears.</p>
                    </div>
                  ) : (
                    <div className="mt-2 space-y-2 text-gray-600 dark:text-gray-400">
                      <p>If your browser does not show an install prompt, you can usually add the app manually from the browser menu.</p>
                      <p>Look for options such as "Install app", "Add to Home screen", "Create shortcut", or "Install this site as an app".</p>
                      <p>If you do not see an install prompt, this browser may not currently support app installation for this site.</p>
                    </div>
                  )}
                </div>

                <div className="border-t border-gray-200 pt-5 dark:border-gray-800">
                  <div className="font-semibold text-gray-900 dark:text-white">Why it exists</div>
                  <p className="mt-2 text-gray-600 dark:text-gray-400">
                    Regional news matters, but most of it never gets translated. This app fixes that: one feed, multiple countries, everything in English. No accounts, no paywalls, no clutter.
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : null}
        {/* Subscription footer */}
        <div className="mt-8 mb-4 flex justify-center">
          {subscribed ? (
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700 dark:bg-green-500/10 dark:text-green-400">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5"><path fillRule="evenodd" d="M8 15A7 7 0 108 1a7 7 0 000 14zm3.844-8.791a.75.75 0 00-1.188-.918l-3.7 4.79-1.649-1.833a.75.75 0 10-1.114 1.004l2.25 2.5a.75.75 0 001.152-.043l4.25-5.5z" clipRule="evenodd" /></svg>
                Ad-free subscriber
              </span>
              <button
                onClick={handleManageSubscription}
                className="text-xs text-gray-500 underline underline-offset-2 transition hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              >
                Manage subscription
              </button>
            </div>
          ) : !loading && filteredClusters.length > 0 ? (
            <button
              onClick={() => setSubscribeOpen(true)}
              className="text-xs text-gray-400 underline underline-offset-2 transition hover:text-blue-500 dark:text-gray-500 dark:hover:text-blue-400"
            >
              Subscribe to go ad-free and support this app
            </button>
          ) : null}
        </div>
      </main>

      {showStartupSplash ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black px-6">
          <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-blue-500/20 bg-black/95 p-8 text-center shadow-2xl">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.18),transparent_42%),radial-gradient(circle_at_bottom_right,rgba(99,102,241,0.14),transparent_36%)]" />

            <div className="relative flex flex-col items-center">
              <img
                src={BRAND_LOGO_PATH}
                alt={APP_NAME}
                className="h-24 w-24 object-contain sm:h-28 sm:w-28"
              />

              <h2 className="mt-5 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
                <span className="text-blue-500">Regional Pulse</span> News
              </h2>

              <p className="mt-3 text-sm text-gray-300 sm:text-base">{APP_TAGLINE}</p>

              <div className="mt-6 h-1.5 w-40 overflow-hidden rounded-full bg-white/10">
                <div className="h-full w-full animate-pulse rounded-full bg-blue-500" />
              </div>

              <p className="mt-3 text-xs uppercase tracking-[0.2em] text-gray-400">Loading headlines</p>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}