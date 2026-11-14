import { createFileRoute } from "@tanstack/react-router";

const MAX_BODY_BYTES = 1_000_000;
const MAX_CLOCK_SKEW_SECONDS = 300;

function decodeBase64(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function verifyPolarSignature(
  body: string,
  request: Request,
  secret: string,
): Promise<boolean> {
  const id = request.headers.get("webhook-id");
  const timestamp = request.headers.get("webhook-timestamp");
  const signatureHeader = request.headers.get("webhook-signature");

  if (!id || !timestamp || !signatureHeader) return false;
  if (!/^\d+$/.test(timestamp)) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds)) return false;
  if (Math.abs(Date.now() / 1000 - timestampSeconds) > MAX_CLOCK_SKEW_SECONDS) return false;

  // Polar signs the exact raw body with HMAC-SHA256. Keep the secret exactly
  // as supplied by Polar (including its prefix); do not JSON-stringify the body.
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signedContent = new TextEncoder().encode(`${id}.${timestamp}.${body}`);

  for (const item of signatureHeader.split(" ")) {
    const match = /^v1,([A-Za-z0-9+/]+={0,2})$/.exec(item);
    if (!match) continue;
    const signature = decodeBase64(match[1]);
    if (signature && await crypto.subtle.verify("HMAC", key, signature, signedContent)) {
      return true;
    }
  }
  return false;
}

export const Route = createFileRoute("/api/webhooks/polar")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["POLAR_WEBHOOK_SECRET"];
        if (!secret) {
          console.error("[Polar webhook] POLAR_WEBHOOK_SECRET is not configured.");
          return Response.json({ error: "Webhook is not configured" }, { status: 503 });
        }

        const declaredLength = Number(request.headers.get("content-length") ?? "0");
        if (declaredLength > MAX_BODY_BYTES) {
          return Response.json({ error: "Payload too large" }, { status: 413 });
        }

        const body = await request.text();
        if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
          return Response.json({ error: "Payload too large" }, { status: 413 });
        }

        try {
          if (!(await verifyPolarSignature(body, request, secret))) {
            return Response.json({ error: "Invalid webhook signature" }, { status: 403 });
          }

          const event = JSON.parse(body) as { type?: unknown };
          const eventId = request.headers.get("webhook-id");
          if (typeof event.type !== "string" || !event.type || !eventId) {
            return Response.json({ error: "Invalid webhook event" }, { status: 400 });
          }

          const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
          const { error } = await (db as any)
            .from("polar_webhook_events")
            .insert({ event_id: eventId, event_type: event.type });

          // Polar may retry deliveries. A previously recorded event is already
          // safely received, so acknowledge the duplicate without processing it twice.
          if (error?.code === "23505") {
            return Response.json({ received: true, duplicate: true }, { status: 200 });
          }
          if (error) {
            console.error("[Polar webhook] Could not record event:", error.message);
            return Response.json({ error: "Could not record webhook" }, { status: 500 });
          }

          // Payment-to-account entitlement updates are intentionally not performed
          // until checkout creation securely binds a Polar checkout to a Supabase user.
          return Response.json({ received: true }, { status: 200 });
        } catch (error) {
          if (error instanceof SyntaxError) {
            return Response.json({ error: "Invalid JSON payload" }, { status: 400 });
          }
          console.error("[Polar webhook] Handler failed:", error);
          return Response.json({ error: "Webhook processing failed" }, { status: 500 });
        }
      },
    },
  },
});
