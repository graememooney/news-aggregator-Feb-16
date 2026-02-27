import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function stripDangerousTags(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "");
}

function addBasicStyles(bodyHtml: string, title: string) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title || "Article")}</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 24px; line-height: 1.55; }
    h1 { font-size: 22px; margin: 0 0 14px; }
    a { word-break: break-word; }
    img { max-width: 100%; height: auto; }
    figure { margin: 18px 0; }
    .meta { color: #666; font-size: 12px; margin-bottom: 18px; }
    .content { max-width: 900px; }
  </style>
</head>
<body>
  <div class="content">
    ${bodyHtml}
  </div>
</body>
</html>`;
}

function escapeHtml(s: string) {
  return (s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeUrl(raw: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  return u;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get("url") || "";
  const u = safeUrl(raw);
  if (!u) {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }

  const res = await fetch(u.toString(), {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
    cache: "no-store",
  });

  const html = await res.text();
  if (!html) {
    return NextResponse.json({ error: "Empty response" }, { status: 502 });
  }

  let cleaned = stripDangerousTags(html);

  // Best-effort: remove common overlay classes by keyword
  cleaned = cleaned.replace(
    /class="[^"]*(paywall|modal|overlay|subscribe|wall)[^"]*"/gi,
    'class=""'
  );

  const titleMatch = cleaned.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : "Article";

  const bodyMatch = cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyInner = bodyMatch ? bodyMatch[1] : cleaned;

  const header = `
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">
      Source: <a href="${escapeHtml(u.toString())}" target="_blank" rel="noreferrer">${escapeHtml(
    u.hostname
  )}</a>
    </div>
  `;

  const out = addBasicStyles(header + bodyInner, title);

  return new NextResponse(out, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}