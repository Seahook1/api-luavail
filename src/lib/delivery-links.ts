// Same-origin aliases keep public delivery outside published-site authentication.
export const CDN_LOADER_PATH = "/api/public/cdn/loader/";
export const CDN_PAYLOAD_PATH = "/api/public/cdn/payload";
export const DELIVERY_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "CDN-Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
};

export function loaderUrl(origin: string, scriptId: string) {
  return `${origin}${CDN_LOADER_PATH}${scriptId}`;
}
