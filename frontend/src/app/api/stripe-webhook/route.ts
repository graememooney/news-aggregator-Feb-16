import { NextResponse } from "next/server";

/**
 * Stripe webhook handler.
 * Verifies the webhook signature, then handles:
 *   - checkout.session.completed  (new subscription)
 *   - customer.subscription.updated
 *   - customer.subscription.deleted
 *
 * Right now the subscription state is client-side (localStorage),
 * so the webhook mainly exists to ensure Stripe doesn't flag the
 * endpoint as missing and to give us a place to add server-side
 * subscription tracking later.
 */

async function verifySignature(
  payload: string,
  sigHeader: string,
  secret: string
): Promise<boolean> {
  // Stripe signature format: t=<timestamp>,v1=<sig>[,v0=<sig>]
  const parts = sigHeader.split(",").reduce<Record<string, string>>((acc, part) => {
    const [k, v] = part.split("=");
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});

  const timestamp = parts["t"];
  const expectedSig = parts["v1"];
  if (!timestamp || !expectedSig) return false;

  // Tolerance: reject events older than 5 minutes
  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  if (isNaN(age) || Math.abs(age) > 300) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(signedPayload));
  const computed = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return computed === expectedSig;
}

export async function POST(request: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET not set");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const sig = request.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const body = await request.text();

  const valid = await verifySignature(body, sig, webhookSecret);
  if (!valid) {
    console.error("[stripe-webhook] Invalid signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const type = event.type as string;

  switch (type) {
    case "checkout.session.completed": {
      const session = event.data?.object;
      console.log(
        `[stripe-webhook] Checkout completed: customer=${session?.customer}, subscription=${session?.subscription}`
      );
      break;
    }
    case "customer.subscription.updated": {
      const sub = event.data?.object;
      console.log(
        `[stripe-webhook] Subscription updated: id=${sub?.id}, status=${sub?.status}`
      );
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data?.object;
      console.log(
        `[stripe-webhook] Subscription deleted: id=${sub?.id}, customer=${sub?.customer}`
      );
      break;
    }
    default:
      console.log(`[stripe-webhook] Unhandled event type: ${type}`);
  }

  return NextResponse.json({ received: true });
}
