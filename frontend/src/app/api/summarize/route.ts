import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const backend = process.env.BACKEND_URL || "http://127.0.0.1:8000";

  let body: any = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const res = await fetch(`${backend}/enrich`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const text = await res.text();

    // Attempt to parse JSON, otherwise return raw text
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    return NextResponse.json(
      {
        backend_url_used: backend,
        backend_status: res.status,
        backend_response: data,
      },
      { status: res.status }
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        error: "Failed to reach backend /enrich",
        backend_url_used: backend,
        detail: String(e),
      },
      { status: 502 }
    );
  }
}
