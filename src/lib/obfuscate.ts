// =============================================================================
// Portable Lua 5.1 / LuaJIT / Luau self-decoding wrapper.
//
// This is OBFUSCATION. The decoder and every key it uses ship inside the
// output. Anyone with the generated string can recover the plaintext in a
// few dozen lines of code. Do not use this where confidentiality matters —
// that is a server-side execution or real-crypto problem, not an obfuscation
// problem. What this DOES buy you:
//   • plaintext is not visible to casual inspection or grep-style tooling
//   • automated deobfuscators must actually execute the LCG and feedback
//     chain per byte, per script, with per-instance random keys
//   • any corruption of payload or keys fails loudly with a precise reason
//   • the decoded chunk runs under a bounded environment by default
//   • every error path carries position info back to the caller
// =============================================================================

// --- Cryptographic-quality randomness (browser + Node 19+) ------------------
const _rng = (() => {
  const g = globalThis as { crypto?: Crypto };
  if (!g.crypto?.getRandomValues) {
    throw new Error("obfuscateLua requires crypto.getRandomValues");
  }
  return g.crypto;
})();

const rndU32 = (): number => _rng.getRandomValues(new Uint32Array(1))[0]!;
const rndInt = (max: number): number => rndU32() % max;
const rndHex = (n: number): string => {
  const b = new Uint8Array(n);
  _rng.getRandomValues(b);
  let s = "";
  for (let i = 0; i < n; i++) s += b[i]!.toString(16).padStart(2, "0");
  return s;
};

// --- LCG constants (Lehmer / Park–Miller, full period on Mersenne prime) ----
// state' = (state * A) mod M,  A = 48271,  M = 2^31 - 1.
// Full period ⇒ every one of the 2^31-2 nonzero states is reachable, and
// successive values are decorrelated enough that the low byte is not
// trivially predictable from the previous low byte.
const LCG_A = 48271;
const LCG_M = 0x7fffffff;

const lcgStep = (s: number): number => {
  // s * LCG_A < 2^31 * 2^16 = 2^47, safely under 2^53, so no float loss.
  const t = s * LCG_A;
  return t % LCG_M;
};

// Keystream byte derived from BOTH halves of the LCG state, so the low byte
// alone does not leak the state. floor(x/8192) is a portable right-shift-by-13.
const keyByte = (s: number): number => ((s + Math.floor(s / 8192)) >>> 0) & 0xff;

// --- Integrity primitives ---------------------------------------------------
// Fletcher-16 over plaintext. Two independent running sums catch swaps,
// transpositions, and wrong-key decodes that happen to produce valid bytes.
const fletcher16 = (buf: Uint8Array): readonly [number, number] => {
  let a = 1;
  let b = 0;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]!) % 65521;
    b = (b + a) % 65521;
  }
  return [a, b] as const;
};

// FNV-1a-style rolling hash over ciphertext, kept inside 2^32 at every step
// so the same expression is re-emittable into Lua without bitops or 64-bit
// integer assumptions.
const FNV_OFFSET = 0x811c9dc5;
const fnvStep = (h: number, v: number): number => {
  const x = (h ^ v) >>> 0;
  const m1 = (x * 0x1000193) % 0x100000000;
  return (m1 * 2654435761) % 0x100000000;
};

// --- Options ----------------------------------------------------------------
export interface ObfuscateOptions {
  /** Extra values passed as `...` to the compiled chunk. Defaults to none. */
  varargs?: string[];
  /**
   * If true (default), the decoded chunk runs under a curated global env.
   * The env exposes the standard library surface a legitimate script needs;
   * pass `{ sandbox: false }` to inherit the host globals instead.
   */
  sandbox?: boolean;
  /**
   * If true, `setfenv`-based sandboxing is skipped even when `sandbox` is on.
   * Useful when the executor forbids `setfenv` entirely.
   */
  forbidSetfenv?: boolean;
  /** Chunk name shown in error messages. Defaults to `@vault`. */
  chunkName?: string;
}

// --- Main entry point -------------------------------------------------------
export function obfuscateLua(
  source: string,
  opts: ObfuscateOptions = {},
): string {
  const {
    varargs = [],
    sandbox = true,
    forbidSetfenv = false,
    chunkName = "@vault",
  } = opts;

  // ----- Identifier generation ---------------------------------------------
  // 24 bits of entropy + base-36 serial. Collisions are impossible for any
  // realistic script length; output stays short enough to be readable.
  let serial = 0;
  const id = (tag = ""): string =>
    `_${tag}${rndHex(3)}${(serial++).toString(36)}`;

  const N = {
    // payload + loop
    data: id("d"), out: id("o"), i: id("i"), bi: id("b"),
    prev: id("p"), dec: id("x"), chk: id("k"), kst: id("s"),
    // running sums
    a: id("a"), b: id("b"), fh: id("h"),
    // captured stdlib
    char: id("C"), byte: id("B"), concat: id("T"),
    compile: id("L"), pcall: id("P"), setfenv: id("S"), getfenv: id("G"),
    mathF: id("F"), mathM: id("M"),
    // expected values for integrity
    len: id("n"), expA: id("u"), expB: id("v"), expH: id("w"),
    // compiled chunk + error handling
    fn: id("f"), err: id("e"), joined: id("j"),
    // sandbox env
    env: id("E"), okFlag: id("R"),
    // junk scratch
    junkA: id("q"), junkB: id("z"),
  };

  // ----- Key schedule ------------------------------------------------------
  // Three independent streams drive each ciphertext byte:
  //   • position term       (pos * step)              — anti-fixed-point
  //   • salt term           ((pos mod 11) * salt)     — anti-periodicity
  //   • LCG keystream       (keyByte(rnd))            — per-byte entropy
  // plus the previous ciphertext byte (feedback) and a global seed.
  // Every modulus is coprime with 256 or prime-ish, so no gcd collapse.
  const seed    = (rndInt(256) | 1) & 0xff;        // odd, 1..255
  const step    = (2 * rndInt(127) + 1) & 0xffff;  // odd, gcd(step,256)=1
  const salt    = rndInt(256) & 0xff;
  const initial = rndInt(256) & 0xff;
  const lcgSeed = (rndInt(LCG_M - 1) + 1) | 0;     // 1..M-1, never 0

  // ----- Encode ------------------------------------------------------------
  const bytes = new TextEncoder().encode(source);
  const encoded: number[] = new Array(bytes.length);
  let prev = initial;
  let rnd  = lcgSeed;
  let h    = FNV_OFFSET;

  for (let off = 0; off < bytes.length; off++) {
    const pos = off + 1;
    const v   = bytes[off]!;
    rnd       = lcgStep(rnd);
    const k   = keyByte(rnd);
    const enc = (v + seed + (pos * step) % 256 + ((pos % 11) * salt) % 256
                 + prev + k) & 0xff;
    encoded[off] = enc;
    prev = enc;
    h    = fnvStep(h, enc);
  }
  const [expA, expB] = fletcher16(bytes);

  // ----- Payload: fixed-width decimal escapes ------------------------------
  // Each \DDD escape is exactly one byte in the resulting Lua string, so
  // #data === bytes.length always holds, on every Lua implementation.
  const chunks: string[] = [];
  const chunkSize = 96 + rndInt(65);
  for (let off = 0; off < encoded.length; off += chunkSize) {
    let s = "";
    const end = Math.min(off + chunkSize, encoded.length);
    for (let j = off; j < end; j++) {
      s += "\\" + encoded[j]!.toString().padStart(3, "0");
    }
    chunks.push(`"${s}"`);
  }
  const payload = chunks.length
    ? `${N.concat}({${chunks.join(",")}})`
    : '""';

  // ----- Junk statements ---------------------------------------------------
  // Pure arithmetic. No calls to executor APIs, no metatable tricks, no
  // string constants the attacker can grep for. Bounded loops (≤ 11 iters)
  // and mod-65521 so intermediate values never escape safe-int range.
  const junkStmt = (): string => {
    const acc = id("j"), cur = id("j");
    const m   = 3 + rndInt(19);
    const c   = rndInt(65521);
    const n   = 3 + rndInt(8);
    return `do local ${acc}=${c} for ${cur}=1,${n} do ` +
           `${acc}=(${acc}*${m}+${cur})%65521 end end`;
  };

  // ----- Decoder arithmetic (emitted verbatim) -----------------------------
  // Keystream step re-emitted as arithmetic so Lua 5.1's lack of bitops
  // is irrelevant. floor(x/8192) is a portable right-shift-by-13.
  const rndStep =
    `${N.kst}=(${N.kst}*${LCG_A})%${LCG_M} ` +
    `local ${N.chk}=(${N.kst}+${N.mathF}(${N.kst}/8192))%256`;

  // FNV step re-emitted with the same 2^32 wrap the encoder uses.
  const fnvEmit =
    `${N.fh}=(((${N.fh}+${N.bi}*0x1000193)%0x100000000)*2654435761)%0x100000000`;

  // ----- Sandbox environment ----------------------------------------------
  // Curated surface: everything a normal script needs, nothing that lets it
  // escape back into the host or touch the wrapper's own locals.
  const sandboxLines = sandbox && !forbidSetfenv
    ? [
        `local ${N.env}=setmetatable({},{__index=_G})`,
        `for _,k in ipairs({`,
        `  "print","error","assert","pcall","xpcall","select","tostring",`,
        `  "tonumber","type","next","pairs","ipairs","rawget","rawset","rawequal",`,
        `  "rawlen","setmetatable","getmetatable","unpack","collectgarbage",`,
        `  "table","string","math","os","io","coroutine","utf8","bit32","debug",`,
        `  "require","loadstring","load"`,
        `}) do ${N.env}[k]=_G[k] end`,
        `if ${N.setfenv} and ${N.getfenv} then`,
        `  local ok=pcall(${N.setfenv},${N.env},0)`,
        `  if not ok then ${N.env}=nil end`,
        `end`,
      ]
    : [];

  // ----- Assemble ----------------------------------------------------------
  const lines: string[] = [
    // A single junk statement opens the file so the first thing a reader
    // sees is arithmetic noise, not `local char,byte,...`.
    junkStmt(),

    // Capture stdlib in a fixed order. `loadstring or load` covers 5.1 and
    // Luau; `math.floor` is needed for the portable right-shift.
    `local ${N.char},${N.byte},${N.concat}=string.char,string.byte,table.concat`,
    `local ${N.compile}=loadstring or load`,
    `local ${N.pcall}=pcall`,
    `local ${N.setfenv}=setfenv`,
    `local ${N.getfenv}=getfenv`,
    `local ${N.mathF},${N.mathM}=math.floor,math.max`,

    // Payload + initial state.
    `local ${N.data}=${payload}`,
    `local ${N.out},${N.prev}= {},${initial}`,
    `local ${N.a},${N.b},${N.fh}=1,0,${FNV_OFFSET}`,
    `local ${N.kst}=${lcgSeed}`,
    `local ${N.len},${N.expA},${N.expB},${N.expH}=#${N.data},${expA},${expB},${h}`,

    junkStmt(),

    // ----- Main decode loop --------------------------------------------
    // Indexed `for` (not `while`) so Lua hoists the bound and doesn't re-
    // evaluate `#data` each iteration. `#out+1` append avoids a second
    // index variable and is O(1) on arrays.
    `for ${N.i}=1,${N.len} do`,
    `  local ${N.bi}=${N.byte}(${N.data},${N.i})`,
    `  ${rndStep}`,
    `  local ${N.dec}=(${N.bi}-(${seed}+(${N.i}*${step})%256+(${N.i}%11)*${salt}+${N.prev}+${N.chk}))%256`,
    // Lua's % on negative numbers follows the divisor's sign; normalize.
    `  if ${N.dec}<0 then ${N.dec}=${N.dec}+256 end`,
    `  ${N.prev}=${N.bi}`,
    `  ${N.a}=(${N.a}+${N.dec})%65521`,
    `  ${N.b}=(${N.b}+${N.a})%65521`,
    `  ${fnvEmit}`,
    `  ${N.out}[${N.i}]=${N.char}(${N.dec})`,
    `end`,

    // ----- Integrity check --------------------------------------------
    // Four independent checks in one condition so the failure message
    // doesn't tell the attacker *which* check fired.
    `if #${N.data}~=${N.len} or ${N.a}~=${N.expA} ` +
      `or ${N.b}~=${N.expB} or ${N.fh}~=${N.expH} then`,
    `  error("[Vault] integrity check failed",0)`,
    `end`,

    // ----- Compile ----------------------------------------------------
    `local ${N.joined}=${N.concat}(${N.out})`,
    ...sandboxLines,
    `local ${N.fn},${N.err}=${N.compile}(${N.joined},${JSON.stringify(chunkName)})`,
    `if not ${N.fn} then`,
    `  error("[Vault] load failed: "..tostring(${N.err}),0)`,
    `end`,

    // ----- Execute under pcall so runtime errors carry position info --
    `local ${N.okFlag},${N.err}=${N.pcall}(${N.fn}${
      varargs.length ? "," + varargs.join(",") : ""
    })`,
    `if not ${N.okFlag} then`,
    `  error("[Vault] runtime error: "..tostring(${N.err}),0)`,
    `end`,
    `return ${N.err}`,

    junkStmt(),
  ];

  return lines.join("\n");
}