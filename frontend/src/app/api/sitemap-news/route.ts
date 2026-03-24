import { NextResponse } from "next/server";

/**
 * Google News Sitemap
 *
 * Generates a sitemap in Google News format from the latest headlines
 * across all live regions. Google News sitemaps should only include
 * articles published within the last 48 hours.
 *
 * Fetches all regions in parallel to stay within Vercel's 10s function timeout.
 * URL: /api/sitemap-news
 */

const SITE_URL = "https://regionalpulsenews.com";
const REGIONS = ["south-america", "mexico", "central-america", "europe"];
const FETCH_TIMEOUT_MS = 8000;

type BackendItem = {
  title: string;
  link: string;
  source: string;
  published_utc?: string;
  title_en?: string | null;
};

type BackendCluster = {
  cluster_id: string;
  best_item: BackendItem;
};

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function fetchRegion(backend: string, region: string): Promise<BackendCluster[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${backend}/top?region=${region}&range=24h&limit=50`,
      { cache: "no-store", signal: controller.signal }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data?.clusters ?? [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  const backend = process.env.BACKEND_URL || "http://127.0.0.1:8000";

  // Fetch all regions in parallel
  const results = await Promise.all(REGIONS.map((r) => fetchRegion(backend, r)));

  const seen = new Set<string>();
  const entries: string[] = [];

  REGIONS.forEach((region, i) => {
    for (const c of results[i]) {
      const item = c.best_item;
      if (!item?.link || !item?.title) continue;
      if (seen.has(item.link)) continue;
      seen.add(item.link);

      const title = item.title_en || item.title;
      const pubDate = item.published_utc || new Date().toISOString();
      const loc = `${SITE_URL}/?region=${encodeURIComponent(region)}&q=${encodeURIComponent(
        title.slice(0, 60)
      )}`;

      entries.push(`  <url>
    <loc>${escapeXml(loc)}</loc>
    <news:news>
      <news:publication>
        <news:name>Regional Pulse News</news:name>
        <news:language>en</news:language>
      </news:publication>
      <news:publication_date>${escapeXml(pubDate)}</news:publication_date>
      <news:title>${escapeXml(title)}</news:title>
    </news:news>
  </url>`);
    }
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${entries.join("\n")}
</urlset>`;

  return new NextResponse(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=900, stale-while-revalidate=1800",
    },
  });
}
