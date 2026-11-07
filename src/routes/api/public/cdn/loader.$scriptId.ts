import { createFileRoute } from "@tanstack/react-router";
import { serveLoader } from "@/lib/script-loader";

export const Route = createFileRoute("/api/public/cdn/loader/$scriptId")({
  server: { handlers: { GET: ({ params, request }) => serveLoader(request, params.scriptId) } },
});