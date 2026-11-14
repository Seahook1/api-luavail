// api.zelvmp.com serves loader and Lua payloads; cdn.zelvmp.com handles authorization only.
export const API_DELIVERY_BASE = "https://api.zelvmp.com";
export const CDN_LOADER_PATH = "/api/public/cdn/loader/";
export const CDN_PAYLOAD_PATH = "/api/public/cdn/payload";
export const KEY_CHECK_BASE = "https://cdn.zelvmp.com";
export const DELIVERY_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "CDN-Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
};

export function loaderUrl(_origin: string, scriptId: string) {
  return `${API_DELIVERY_BASE}${CDN_LOADER_PATH}${scriptId}?hop=4`;
}

function isDevelopmentHost(request: Request) {
  const hostname = new URL(request.url).hostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" ||
    hostname.endsWith(".lovable.app") || hostname.endsWith(".pages.dev") ||
    hostname.endsWith(".workers.dev");
}

export function requireHost(request: Request, expectedHost: string) {
  const hostname = new URL(request.url).hostname.toLowerCase();
  if (hostname === expectedHost || isDevelopmentHost(request)) return null;
  return new Response("--ERR:Endpoint unavailable on this host", {
    status: 404,
    headers: DELIVERY_HEADERS,
  });
}
