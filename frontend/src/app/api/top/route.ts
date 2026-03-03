import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const country = searchParams.get("country") ?? "uy";
  const range = searchParams.get("range") ?? "24h";
  const q = searchParams.get("q") ?? "";
  const limit = searchParams.get("limit") ?? "30";

  const backend = process.env.BACKEND_URL || "http://127.0.0.1:8000";

  const url = `${backend}/top?country=${encodeURIComponent(country)}&range=${encodeURIComponent(
    range
  )}&q=${encodeURIComponent(q)}&limit=${encodeURIComponent(limit)}`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();

    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    return NextResponse.json(data, { status: res.status });
  } catch (e: any) {
    return NextResponse.json(
      {
        error: "Failed to reach backend from Next.js API route",
        backend_url_used: backend,
        backend_request_url: url,
        detail: String(e),
      },
      { status: 502 }
    );
  }
}