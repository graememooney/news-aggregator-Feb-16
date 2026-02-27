import { NextResponse } from "next/server";

/**
 * Best-effort in-memory rate limiter.
 * Note: On Vercel/serverless, memory may not persist across invocations/regions,
 * so treat this as an extra guard — your backend rate limit is the real protection.
 */
const RATE = {
  enabled: process.env.ENRICH_EDGE_RATE_LIMIT_ENABLED !== "false", // default true
  rpm: Number(process.env.ENRICH_EDGE_RPM || "60"), // default 60 requests/min/IP
  windowS: Number(process.env.ENRICH_EDGE_WINDOW_S || "60"), // default 60s window
};

// ip -> timestamps (epoch ms)
const buckets = new Map<string, number[]>();

function getClientIp(request: Request) {
  // If behind proxies, x-forwarded-for typically contains client IP first.
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

function rateLimitOrThrow(ip: string) {
  if (!RATE.enabled) return;
  if (!Number.isFinite(RATE.rpm) || RATE.rpm <= 0) return;

  const now = Date.now();
  const cutoff = now - RATE.windowS * 1000;

  const existing = buckets.get(ip) || [];
  const fresh = existing.filter((t) => t >= cutoff);

  if (fresh.length >= RATE.rpm) {
    const retryAfterS = 5;
    return NextResponse.json(
      {
        error: "Rate limit exceeded (frontend /api/enrich). Please try again shortly.",
        retry_after_s: retryAfterS,
      },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfterS) },
      }
    );
  }

  fresh.push(now);
  buckets.set(ip, fresh);
  return null;
}

function isObject(v: any): v is Record<string, any> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function clampStr(s: any, maxLen: number) {
  const t = String(s ?? "").trim();
  if (!t) return "";
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}

export async function POST(request: Request) {
  const backend = process.env.BACKEND_URL || "http://127.0.0.1:8000";

  // ✅ Best-effort edge rate limit (backend has the real limiter too)
  const ip = getClientIp(request);
  const rl = rateLimitOrThrow(ip);
  if (rl) return rl;

  // ✅ Parse JSON
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // ✅ Basic validation to prevent accidental huge payloads / weird shapes
  if (!isObject(body) || !Array.isArray(body.items)) {
    return NextResponse.json(
      { error: "Invalid body shape. Expected: { items: [...] }" },
      { status: 400 }
    );
  }

  // Hard caps to protect your OpenAI spend
  const MAX_ITEMS = Number(process.env.ENRICH_MAX_ITEMS || "12"); // default 12 per request
  const items = body.items.slice(0, Math.max(0, MAX_ITEMS));

  const sanitized = items
    .map((it: any) => {
      if (!isObject(it)) return null;
      const title = clampStr(it.title, 280);
      const link = clampStr(it.link, 2048);
      const source = clampStr(it.source, 120);
      const snippet = clampStr(it.snippet, 1200);

      if (!title || !link || !source) return null;

      return { title, link, source, snippet };
    })
    .filter(Boolean);

  if (sanitized.length === 0) {
    return NextResponse.json(
      { error: "No valid items to enrich (need title, link, source)." },
      { status: 400 }
    );
  }

  // ✅ Timeout so enrich can’t hang forever
  const timeoutMs = Number(process.env.ENRICH_TIMEOUT_MS || "20000"); // default 20s
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const res = await fetch(`${backend}/enrich`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: sanitized }),
      cache: "no-store",
      signal: ac.signal,
    });

    const retryAfter = res.headers.get("retry-after") || res.headers.get("Retry-After") || null;

    const text = await res.text();

    let data: any;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }

    // ✅ Keep your existing shape so page.tsx continues to work:
    // - backend_response.items still present
    // Also add a top-level items shortcut (nice for future).
    const backendItems = (data && Array.isArray(data.items) && data.items) || null;

    const out = {
      backend_status: res.status,
      backend_response: data,
      items: backendItems, // optional convenience
      rate_limit: retryAfter ? { retry_after: retryAfter } : undefined,
    };

    const headers: Record<string, string> = {};
    if (retryAfter) headers["Retry-After"] = String(retryAfter);

    return NextResponse.json(out, { status: res.status, headers });
  } catch (e: any) {
    const aborted = e?.name === "AbortError";
    return NextResponse.json(
      {
        error: aborted ? "Backend /enrich request timed out" : "Failed to reach backend /enrich",
        detail: String(e),
        backend_url_used: backend,
        timeout_ms: timeoutMs,
      },
      { status: aborted ? 504 : 502 }
    );
  } finally {
    clearTimeout(timer);
  }
}