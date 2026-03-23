import { NextResponse } from "next/server";

export async function POST(request: Request) {
  if (process.env.NEXT_PUBLIC_PAYMENTS_ENABLED !== "true") {
    return NextResponse.json({ error: "Payments are not currently available" }, { status: 503 });
  }

  const sk = process.env.STRIPE_SECRET_KEY;
  if (!sk) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
  }

  let plan: string;
  try {
    const body = await request.json();
    plan = body.plan; // "monthly" or "yearly"
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const priceId =
    plan === "yearly"
      ? process.env.STRIPE_YEARLY_PRICE_ID
      : process.env.STRIPE_MONTHLY_PRICE_ID;

  if (!priceId) {
    return NextResponse.json({ error: "Price not configured" }, { status: 500 });
  }

  // Build the origin from the request URL
  const origin = new URL(request.url).origin;

  try {
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sk}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        "mode": "subscription",
        "line_items[0][price]": priceId,
        "line_items[0][quantity]": "1",
        "success_url": `${origin}?subscribe=success&session_id={CHECKOUT_SESSION_ID}`,
        "cancel_url": `${origin}?subscribe=cancel`,
        "allow_promotion_codes": "true",
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        { error: data.error?.message || "Stripe error" },
        { status: res.status }
      );
    }

    return NextResponse.json({ url: data.url });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to create checkout session", detail: String(e) },
      { status: 500 }
    );
  }
}
