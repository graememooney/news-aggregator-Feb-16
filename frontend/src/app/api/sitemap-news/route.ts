import { NextResponse } from "next/server";

/**
 * Google News Sitemap
 *
 * Generates a sitemap in Google News format from the latest headlines
 * across all live regions. Google News sitemaps should only include
 * articles published within the last 48 hours.
 *
 * URL: /api/sitemap-news
 */

const SITE_URL = "https://regionalpulsenews.com";
const REGIONS = ["south-america", "mexico", "central-america", "europe"];

type BackendCluster = {
  cluster_id: string;
  topic: string;
  best_item: {
    title: string;
    link: string;
    source: string;
    published_utc?: string;
    title_en?: string | null;
    summary_en?: string | null;
  };
};

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET() {
  const backend = process.env.BACKEND_URL || "http://127.0.0.1:8000";
  const allEntries: string[] = [];
  const seen = new Set<string>();

  for (const region of REGIONS) {
    try {
      const url = `${backend}/top?region=${region}&range=24h&limit=50`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;

      const data = await res.json();
      const clusters: BackendCluster[] = data?.clusters || [];

      for (const c of clusters) {
        const item = c.best_item;
        if (!item?.link || !item?.title) continue;

        // Deduplicate by original article link
        if (seen.has(item.link)) continue;
        seen.add(item.link);

        const title = item.title_en || item.title;
        const pubDate = item.published_utc || new Date().toISOString();

        // The "loc" URL points to our site with the search query pre-filled,
        // giving Google a crawlable URL that renders the translated headline.
        const loc = `${SITE_URL}/?region=${encodeURIComponent(region)}&q=${encodeURIComponent(
          (item.title_en || item.title).slice(0, 60)
        )}`;

        allEntries.push(`  <url>
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
    } catch {
      // Skip region on failure
    }
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${allEntries.join("\n")}
</urlset>`;

  return new NextResponse(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=900, stale-while-revalidate=1800",
    },
  });
}
