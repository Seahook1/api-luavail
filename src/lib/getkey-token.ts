// Secret per-checkpoint token baked into the return URL, so people can't skip ads by typing ?cp=N.
export async function checkpointToken(scriptId: string, ownerId: string, cp: number) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`vault-cp:${scriptId}:${ownerId}:${cp}`));
  return Array.from(new Uint8Array(buf).slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Known bypass services — if the buyer came from one of these, reject.
const BYPASS = /(bypass|adbypass|linkvertise-bypass|bypassed|thebypasser|bypass\.vip|bypass\.city|bypass\.pm|adfly-bypass|unshorten|deltabypass|trw\.lat|izen\.lol|solar-x)/i;
export function isBypassReferrer(ref: string) {
  if (!ref) return false;
  try { return BYPASS.test(new URL(ref).hostname); } catch { return false; }
}
