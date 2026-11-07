import { createFileRoute } from "@tanstack/react-router";
import { servePayload } from "@/lib/script-delivery";

export const Route = createFileRoute("/api/public/cdn/payload")({
  server: { handlers: { GET: ({ request }) => servePayload(request) } },
});
