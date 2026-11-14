import { createFileRoute } from "@tanstack/react-router";
import { servePayload } from "@/lib/script-delivery";
import { requireHost } from "@/lib/delivery-links";

export const Route = createFileRoute("/api/public/cdn/payload")({
  server: { handlers: { GET: ({ request }) => requireHost(request, "api.zelvmp.com") ?? servePayload(request) } },
});
