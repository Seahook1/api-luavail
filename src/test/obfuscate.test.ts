import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { obfuscateLua } from "@/lib/obfuscate";

function execute(wrapper: string, prelude = "") {
  const result = spawnSync("lua", ["-"], {
    input: `${prelude}\nlocal result=(function(...)\n${wrapper}\nend)("argument")\nif result ~= nil then print(result) end`,
    encoding: "utf8",
    timeout: 5000,
  });
  if (result.error) throw result.error;
  return result;
}

describe("obfuscateLua", () => {
  it("hides source strings and source variable names", () => {
    const out = obfuscateLua('local sensitiveVariable="secret key é 😀"; return sensitiveVariable');
    expect(out).not.toContain("secret");
    expect(out).not.toContain("sensitiveVariable");
  });
  it("executes Unicode source and preserves return values in Lua", () => {
    const result = execute(obfuscateLua('return "secret key é 😀"'));
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("secret key é 😀");
  });
  it("preserves varargs and handles empty source", () => {
    expect(execute(obfuscateLua("return ...")).stdout.trim()).toBe("argument");
    expect(execute(obfuscateLua("")).status).toBe(0);
  });
  it("randomizes names and ciphertext on every call", () => {
    const first = obfuscateLua('return "test"');
    const second = obfuscateLua('return "test"');
    expect(first).not.toBe(second);
    const idents = (s: string) => new Set(s.match(/\b[Il_][Il1O0_]{7,}\b/g) ?? []);
    const a = idents(first);
    const b = idents(second);
    expect(a.size).toBeGreaterThan(20);
    expect([...a].filter((x) => b.has(x)).length).toBe(0);
  });
  it("never leaks library names or the failure message in plain text", () => {
    const out = obfuscateLua('return "x"');
    for (const word of ["loadstring", "pcall", "integrity", "floor", "byte"]) expect(out).not.toContain(word);
  });
  it("rejects modified ciphertext before running the source", () => {
    const out = obfuscateLua('print("PAYLOAD_EXECUTED")');
    const damaged = out.replace(
      /\\(\d{3})/,
      (_, digits: string) => `\\${String((Number(digits) + 1) % 256).padStart(3, "0")}`,
    );
    expect(damaged).not.toBe(out);
    const result = execute(damaged);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("integrity check failed");
    expect(result.stdout).not.toContain("PAYLOAD_EXECUTED");
  });
  it("preserves loader requests and readable server errors", () => {
    const loader = `local k = (getgenv and getgenv().script_key) or script_key or ""
local ok, r = pcall(function() return game:HttpGet("https://api-luavail.lovable.app/api/public/fetch?s=test&k="..k) end)
if not ok then return warn("[Vault] request failed: "..tostring(r)) end
if r:sub(1,6) == "--ERR:" then return warn("[Vault] "..r:sub(7)) end
return loadstring(r)()`;
    const out = obfuscateLua(loader);
    expect(out).not.toContain("script_key");
    expect(out).not.toContain("api-luavail.lovable.app");
    const result = execute(
      out,
      `script_key="TEST_KEY"
game={HttpGet=function(self,url) assert(url=="https://api-luavail.lovable.app/api/public/fetch?s=test&k=TEST_KEY"); return "--ERR:Invalid key" end}
warn=print`,
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("[Vault] Invalid key");
  });
  it("runs correctly through two wrapping layers and rejects damage to either", () => {
    const out = obfuscateLua('print("LAYERED_OK")', 2);
    expect(execute(out).stdout.trim()).toBe("LAYERED_OK");
    const damaged = out.replace(
      /\\(\d{3})/,
      (_, digits: string) => `\\${String((Number(digits) + 1) % 256).padStart(3, "0")}`,
    );
    const result = execute(damaged);
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("LAYERED_OK");
  });
  it("round-trips a large script without exceeding Lua limits", () => {
    const big = Array.from({ length: 2000 }, (_, i) => `x=${i} t=(t or 0)+x`).join("\n") + "\nprint(t)";
    expect(execute(obfuscateLua(big)).stdout.trim()).toBe("1999000");
  });
});

describe("anti-tamper", () => {
  const damage = (out: string, re: RegExp) => out.replace(re, (m) => (m === "0" ? "1" : String(Number(m) + 1)));
  it("a changed encrypted constant changes the key and the payload never runs", () => {
    const out = obfuscateLua('print("PAYLOAD_EXECUTED")');
    const damaged = out.replace(/\(\{(\d+),/, (_m, n: string) => `({${(Number(n) + 1) % 256},`);
    expect(damaged).not.toBe(out);
    const result = execute(damaged);
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("PAYLOAD_EXECUTED");
  });
  it("a hooked string.byte (environment tamper) prevents decryption", () => {
    const out = obfuscateLua('print("PAYLOAD_EXECUTED")');
    const result = execute(out, "local ob=string.byte\nstring.byte=function(s,i,j) if s==\"A\" then return 66 end return ob(s,i,j) end");
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("PAYLOAD_EXECUTED");
  });
  it("a hooked pcall/error pair prevents decryption", () => {
    const out = obfuscateLua('print("PAYLOAD_EXECUTED")', 2);
    const result = execute(out, "local oe=error\nerror=function(m,l) return oe(m,l) end\nlocal op=pcall\npcall=function(f,...) local r={op(f,...)} if f==error then return true,\"x\" end return unpack(r) end");
    expect(result.stdout).not.toContain("PAYLOAD_EXECUTED");
  });
  it("runs through four layers", () => {
    expect(execute(obfuscateLua('print("FOUR_OK")', 4)).stdout.trim()).toBe("FOUR_OK");
  });
  it("is stable across many random builds", () => {
    for (let i = 0; i < 25; i++) expect(execute(obfuscateLua(`print(${i})`, 2)).stdout.trim()).toBe(String(i));
  });
});
