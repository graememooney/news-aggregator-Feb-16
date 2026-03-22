import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const backend = process.env.BACKEND_URL || "http://127.0.0.1:8000";
  const url = `${backend}/feedback`;

  try {
    const body = await request.json();
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to reach backend", detail: String(e) },
      { status: 502 }
    );
  }
}
