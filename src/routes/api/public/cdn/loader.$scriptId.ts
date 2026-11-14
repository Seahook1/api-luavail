import { createFileRoute } from "@tanstack/react-router";
import { serveLoader } from "@/lib/script-loader";
import { requireHost } from "@/lib/delivery-links";

export const Route = createFileRoute("/api/public/cdn/loader/$scriptId")({
  server: { handlers: { GET: ({ params, request }) => requireHost(request, "api.zelvmp.com") ?? serveLoader(request, params.scriptId) } },
});
