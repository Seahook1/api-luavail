import { describe, it, expect } from "vitest";
import { obfuscateLua } from "@/lib/obfuscate";

function decode(out: string): string {
  const data = /local \S+="([^"]*)"/.exec(out)?.[1];
  const nums = /\((\d+)\+\S+\*(\d+)\+\(\S+%7\)\*(\d+)\)%256/.exec(out);
  if (data === undefined || !nums) throw new Error("Invalid wrapper");
  const [k1, k2, k3] = [Number(nums[1]), Number(nums[2]), Number(nums[3])];
  const bytes = [...data.matchAll(/\\(\d{3})/g)].map((m, idx) => {
    const i = idx + 1;
    const key = (k1 + i * k2 + (i % 7) * k3) % 256;
    return (Number(m[1]) - key + 256) % 256;
  });
  return new TextDecoder().decode(new Uint8Array(bytes));
}

describe("obfuscateLua", () => {
  const src = 'print("secret key é 😀")\nlocal x = 1';
  it("hides the plain source", () => {
    const out = obfuscateLua(src);
    expect(out).not.toContain("secret");
    expect(out).not.toContain("print");
  });
  it("round-trips through the decoder", () => {
    expect(decode(obfuscateLua(src))).toBe(src);
  });
  it("differs on every call", () => {
    expect(obfuscateLua(src)).not.toBe(obfuscateLua(src));
  });
});
