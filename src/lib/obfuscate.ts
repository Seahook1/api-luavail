// Portable Lua 5.1 / Luau obfuscator with layered anti-tamper.
//
// Each layer turns a Lua chunk into another Lua chunk that:
//   · encrypts the payload (real source + decoy bytes) with RC4 + a position-dependent
//     LCG stream (additive, no bit32/buffer)
//   · derives the cipher key from a hash of the ciphertext, of the decoder's own encrypted
//     constants and of runtime environment self-tests. The decoy bytes are load-bearing:
//     editing *any* ciphertext byte (real or decoy) shifts the derived key, so decryption
//     yields garbage and the plaintext hash check fails. There is no single "if tampered"
//     branch to patch out.
//   · verifies a plaintext hash (over the real+decoy plaintext) and fails with a generic,
//     per-layer randomized error message
//   · hides every library / global name behind encrypted strings
//   · runs as a shuffled state machine whose transitions use a shared runtime mask
//   · uses randomised confusable identifiers (I, l, 1, O, 0)
// Layers can be stacked; each gets fresh keys, names, state ids, mask, decoys and error text.
//
// Client-side protection can slow analysis but cannot be an authorization boundary: a
// determined user can still hook loadstring and capture the final plaintext.

const M = 4294967296;

const rng = (): number => {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] ?? 0;
};
const rngRange = (max: number) => (max <= 0 ? 0 : rng() % max);
const pick = <T>(arr: readonly T[]): T => {
  const value = arr[rngRange(arr.length)];
  if (value === undefined) throw new Error("Cannot pick from an empty collection");
  return value;
};

const shuffle = <T>(arr: T[]): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rngRange(i + 1);
    const left = a[i];
    const right = a[j];
    if (left === undefined || right === undefined) throw new Error("Invalid shuffle index");
    [a[i], a[j]] = [right, left];
  }
  return a;
};

// Printable bytes stay raw; everything else becomes a 3-digit \ddd escape.
const luaByte = (b: number) =>
  b >= 32 && b <= 126 && b !== 34 && b !== 92
    ? String.fromCharCode(b)
    : `\\${String(b).padStart(3, "0")}`;

const mod = (n: number, m: number) => ((n % m) + m) % m;
const roll = (h: number, v: number) => (h * 257 + v) % M;

const ERR_MSGS = [
  "bad header",
  "invalid bytecode",
  "corrupt chunk",
  "malformed input",
  "load failed",
  "unexpected symbol",
] as const;

function wrapOnce(source: string): string {
  // ── identifiers ──────────────────────────────────────────────────────────
  const used = new Set<string>();
  const name = (): string => {
    for (;;) {
      let id = pick(["I", "l", "_"]);
      const len = 8 + rngRange(10);
      for (let i = 0; i < len; i++) id += pick(["I", "l", "1", "O", "0", "_"]);
      if (!used.has(id)) {
        used.add(id);
        return id;
      }
    }
  };

  // ── keys & combined plaintext (real source + decoy) ──────────────────────
  const keyBytes = Array.from({ length: 32 }, () => rngRange(256));
  const seed =
    ((keyBytes[0] ?? 0) * 16777216 +
      (keyBytes[1] ?? 0) * 65536 +
      (keyBytes[2] ?? 0) * 256 +
      (keyBytes[3] ?? 0)) %
    M;

  const plain = new TextEncoder().encode(source);
  const decoyLen = 128 + rngRange(384);
  const decoyPlain = new Uint8Array(decoyLen);
  crypto.getRandomValues(decoyPlain);

  // Encrypt real source + decoy bytes together. The whole thing participates in both
  // the plaintext hash and the ciphertext hash, so decoys are load-bearing for integrity.
  const combined = new Uint8Array(plain.length + decoyLen);
  combined.set(plain);
  combined.set(decoyPlain, plain.length);
  const realLen = plain.length;

  const sbox = Array.from({ length: 256 }, (_, i) => i);
  {
    let j = 0;
    for (let i = 0; i < 256; i++) {
      j = (j + (sbox[i] ?? 0) + (keyBytes[i % 32] ?? 0)) % 256;
      [sbox[i], sbox[j]] = [sbox[j] ?? 0, sbox[i] ?? 0];
    }
  }
  const cipher = new Uint8Array(combined.length);
  let plainHash = 0;
  // Independent prime-modulus checksum: corruption must satisfy both recurrences.
  let plainHash2 = 1;
  {
    let a = 0,
      b = 0,
      ls = seed;
    for (let n = 0; n < combined.length; n++) {
      a = (a + 1) % 256;
      b = (b + (sbox[a] ?? 0)) % 256;
      [sbox[a], sbox[b]] = [sbox[b] ?? 0, sbox[a] ?? 0];
      const r = sbox[((sbox[a] ?? 0) + (sbox[b] ?? 0)) % 256] ?? 0;
      ls = (ls * 1664525 + 1013904223) % M;
      const l = Math.floor(ls / 65536) % 256;
      const byte = combined[n] ?? 0;
      cipher[n] = (byte + r + l) % 256;
      plainHash = roll(plainHash, byte + 1);
      plainHash2 = (plainHash2 * 131 + byte + n + 1) % 65521;
    }
  }
  let dataHash = 0;
  for (const c of cipher) dataHash = roll(dataHash, c + 1);

  // ── encrypted names / strings (mirrors decoder S in Lua) ─────────────────
  let constHash = 0;
  const encStr = (s: string): string => {
    const k = 1 + rngRange(250);
    const bytes = Array.from(new TextEncoder().encode(s));
    const out = bytes.map((b, i) => (b + k + (i + 1) * 3) % 256);
    for (const v of out) constHash = roll(constHash, v);
    constHash = roll(constHash, k);
    return `${nDec}({${out.join(",")}},${k})`;
  };

  const nCH = name(),
    nG = name(),
    nHH = name(),
    nDec = name(),
    nData = name(),
    nState = name(),
    nF = name(),
    nP = name(),
    nT = name(),
    nH = name(),
    nKS = name(),
    nKB = name(),
    nBox = name(),
    nHP = name(),
    nSTR = name(),
    nSB = name(),
    nSC = name(),
    nLS = name(),
    nER = name(),
    nPC = name(),
    nTY = name(),
    nMSG = name(),
    nDH = name();

  // ── state ids, single shared runtime mask ────────────────────────────────
  const ids = new Set<number>();
  const sid = () => {
    for (;;) {
      const v = 100 + rngRange(900000);
      if (!ids.has(v)) {
        ids.add(v);
        return v;
      }
    }
  };
  const ST = {
    names: sid(),
    env: sid(),
    hash: sid(),
    key: sid(),
    ksa: sid(),
    dec: sid(),
    load: sid(),
    run: sid(),
    fail: sid(),
    done: sid(),
  };
  // A single runtime mask shared by all transitions. Every branch compares with the
  // same opaque (state - mask) % M == id predicate; there is no per-branch constant
  // the attacker can lift and generalize.
  const stateMask = 1 + rngRange(M - 1);
  const go = (id: number) => `${nState}=(${id}+${stateMask})%${M}`;
  const is = (id: number) => `(${nState}-${stateMask})%${M}==${id}`;

  // ── junk generators ──────────────────────────────────────────────────────
  const junk = (): string => {
    const t = rngRange(4);
    const p = rngRange(9000) + 2;
    const a = name(),
      b = name(),
      c = name();
    if (t === 0)
      return `do local ${a}=${p} if (${a}*(${a}+1))%2==1 then ${nState}=${rngRange(999)} ${nER}(${nMSG},0) end end`;
    if (t === 1)
      return `if (${p}*${p}+${p})%2==1 then local function ${a}(${b},${c}) for ${name()}=1,${b} do ${c}=(${c}*${rngRange(97) + 3}+${rngRange(1000)})%${M} end return ${c} end ${a}(${rngRange(50)},${rngRange(9999)}) end`;
    if (t === 2)
      return `do local ${a},${b}=${rngRange(9999)},${rngRange(9999)} for ${c}=1,${rngRange(4) + 1} do ${a}=(${a}*${b}+${c})%${rngRange(60000) + 7} end end`;
    return `if ${p}%${p}~=0 then local ${a}={${rngRange(99)},${rngRange(99)}} while true do ${a}[1]=${a}[1]+1 end end`;
  };
  const junks = (n: number) => Array.from({ length: n }, junk).join("\n");

  // ── environment self-tests (T counts anomalies; 0 in a clean runtime) ────
  // Known-answer checks on core functions — a hook that changes behaviour shifts the key.
  const T_SALT = 104729;
  const salt = rngRange(M);

  // ── branches ─────────────────────────────────────────────────────────────
  const names: string[] = [];
  const decl = (v: string, s: string) => names.push(`${v}=${encStr(s)}`);
  const nS1 = name(),
    nS2 = name(),
    nS3 = name(),
    nS4 = name(),
    nS5 = name(),
    nS6 = name(),
    nS7 = name(),
    nS8 = name(),
    nS9 = name(),
    nS10 = name(),
    nS11 = name(),
    nS12 = name(),
    nS13 = name(),
    nS14 = name(),
    nS15 = name(),
    nS16 = name(),
    nS17 = name(),
    nS18 = name(),
    nS19 = name(),
    nS20 = name();
  decl(nS1, "string");
  decl(nS2, "byte");
  decl(nS3, "char");
  decl(nS4, "loadstring");
  decl(nS5, "load");
  decl(nS6, "error");
  decl(nS7, "pcall");
  decl(nS8, "type");
  decl(nS9, "function");
  decl(nS10, pick(ERR_MSGS));
  decl(nS11, "math");
  decl(nS12, "floor");
  decl(nS13, "tostring");
  decl(nS14, "select");
  decl(nS15, "rawequal");
  decl(nS16, "table");
  decl(nS17, "concat");
  decl(nS18, "rep");
  decl(nS19, "table"); // the *type* name, distinct use
  decl(nS20, "nil");

  const H = (dataHash * 3 + constHash * 5 + salt) % M;
  const keyStored = keyBytes.map((kb, i) => {
    const m = (H * (i + 1 + 13) + 40503) % M;
    return (kb + (Math.floor(m / 256) % 256)) % 256;
  });

  const nMath = name(),
    nFloor = name();

  const branches: string[] = [
    // names
    [
      `if ${is(ST.names)} then`,
      junk(),
      ...names.map((n) => `  ${n}`),
      `  ${nSTR}=${nG}[${nS1}]`,
      `  ${nSB}=${nSTR}[${nS2}]`,
      `  ${nSC}=${nSTR}[${nS3}]`,
      `  ${nLS}=${nG}[${nS4}] or ${nG}[${nS5}]`,
      `  ${nER}=${nG}[${nS6}]`,
      `  ${nPC}=${nG}[${nS7}]`,
      `  ${nTY}=${nG}[${nS8}]`,
      `  ${nMSG}=${nS10}`,
      `  ${nMath}=${nG}[${nS11}]`,
      `  ${nFloor}=${nMath}[${nS12}]`,
      `  ${go(ST.env)}`,
      `end`,
    ].join("\n"),
    // env — broader known-answer surface (hooks on any of these shift the key)
    [
      `if ${is(ST.env)} then`,
      junk(),
      `  ${nT}=0`,
      `  if ${nSB}(${nCH}(65),1)~=65 then ${nT}=${nT}+1 end`,
      `  if ${nSC}(${nSB}(${nCH}(66),1)+1)~=${nCH}(67) then ${nT}=${nT}+1 end`,
      `  if ${nSB}(${nSC}(200,201,202),2)~=201 then ${nT}=${nT}+1 end`,
      `  if ${nFloor}(7.9)~=7 or ${nFloor}(-0.5)~=-1 then ${nT}=${nT}+1 end`,
      `  if ${nFloor}(2^53)~=2^53 then ${nT}=${nT}+1 end`,
      `  if (0.1+0.2)==0.3 then ${nT}=${nT}+1 end`,
      `  if ${nTY}(${nLS})~=${nS9} or ${nTY}(${nSB})~=${nS9} or ${nTY}(${nSC})~=${nS9} then ${nT}=${nT}+1 end`,
      `  do local _s=${nSC}(0,127,255) if #_s~=3 or ${nSB}(_s,1)~=0 or ${nSB}(_s,3)~=255 then ${nT}=${nT}+1 end end`,
      `  do local _a,_b=${nPC}(${nER},${nCH}(120),0) if _a~=false or _b~=${nCH}(120) then ${nT}=${nT}+1 end end`,
      `  do local _ts=${nG}[${nS13}] if ${nTY}(_ts)~=${nS9} or _ts(1)~='1' or _ts(nil)~=${nS20} then ${nT}=${nT}+1 end end`,
      `  do local _sel=${nG}[${nS14}] if ${nTY}(_sel)~=${nS9} or _sel('#',1,2,3)~=3 or _sel(2,'a','b','c')~='b' then ${nT}=${nT}+1 end end`,
      `  do local _req=${nG}[${nS15}] if ${nTY}(_req)~=${nS9} or _req(1,1)~=true or _req(1,2)~=false then ${nT}=${nT}+1 end end`,
      `  do local _tb=${nG}[${nS16}] if ${nTY}(_tb)~=${nS19} then ${nT}=${nT}+1 else local _tc=_tb[${nS17}] if ${nTY}(_tc)~=${nS9} or _tc({'a','b'})~='ab' then ${nT}=${nT}+1 end end end`,
      `  do local _sr=${nSTR}[${nS18}] if ${nTY}(_sr)~=${nS9} or _sr('x',3)~='xxx' then ${nT}=${nT}+1 end end`,
      `  ${go(ST.hash)}`,
      `end`,
    ].join("\n"),
    // hash data + combine
    [
      `if ${is(ST.hash)} then`,
      junk(),
      `  ${nDH}=0`,
      `  for _i=1,#${nData} do ${nDH}=(${nDH}*257+${nSB}(${nData},_i)+1)%${M} end`,
      `  ${nH}=(${nDH}*3+${nHH}*5+${nT}*${T_SALT}+${salt})%${M}`,
      `  ${go(ST.key)}`,
      `end`,
    ].join("\n"),
    // key
    [
      `if ${is(ST.key)} then`,
      junk(),
      `  ${nKB}={}`,
      `  for _i=1,32 do`,
      `    local _m=(${nH}*(_i+13)+40503)%${M}`,
      `    ${nKB}[_i]=(${nKS}[_i]-(((_m-_m%256)/256)%256))%256`,
      `  end`,
      `  ${go(ST.ksa)}`,
      `end`,
    ].join("\n"),
    // ksa
    [
      `if ${is(ST.ksa)} then`,
      junk(),
      `  ${nBox}={}`,
      `  for _i=0,255 do ${nBox}[_i]=_i end`,
      `  local _j=0`,
      `  for _i=0,255 do`,
      `    _j=(_j+${nBox}[_i]+${nKB}[_i%32+1])%256`,
      `    ${nBox}[_i],${nBox}[_j]=${nBox}[_j],${nBox}[_i]`,
      `  end`,
      `  ${go(ST.dec)}`,
      `end`,
    ].join("\n"),
    // decrypt — hash runs over the FULL decrypted stream (real+decoy), plaintext
    // uses only the first <realLen> bytes. Any tamper on any byte breaks the check.
    [
      `if ${is(ST.dec)} then`,
      junk(),
      `  local _a,_b=0,0`,
      `  local _ls=(${nKB}[1]*16777216+${nKB}[2]*65536+${nKB}[3]*256+${nKB}[4])%${M}`,
      `  local _o={}`,
      `  local _hp=0`,
      `  local _hq=1`,
      `  for _i=1,#${nData} do`,
      `    _a=(_a+1)%256`,
      `    _b=(_b+${nBox}[_a])%256`,
      `    ${nBox}[_a],${nBox}[_b]=${nBox}[_b],${nBox}[_a]`,
      `    local _r=${nBox}[(${nBox}[_a]+${nBox}[_b])%256]`,
      `    _ls=(_ls*1664525+1013904223)%${M}`,
      `    local _p=(${nSB}(${nData},_i)-_r-((_ls-_ls%65536)/65536)%256)%256`,
      `    _hp=(_hp*257+_p+1)%${M}`,
      `    _hq=(_hq*131+_p+_i)%65521`,
      `    _o[_i]=${nCH}(_p)`,
      `  end`,
      `  ${nP}=table.concat(_o,'',1,${realLen})`,
      `  ${nHP}=_hp`,
      `  if ${nHP}~=${plainHash} or _hq~=${plainHash2} then ${go(ST.fail)} else ${go(ST.load)} end`,
      `end`,
    ].join("\n"),
    // load
    [
      `if ${is(ST.load)} then`,
      junk(),
      `  ${nF}=${nLS}(${nP})`,
      `  if not ${nF} then ${go(ST.fail)} else ${go(ST.run)} end`,
      `end`,
    ].join("\n"),
    // run (deferred to final return to preserve vararg passthrough)
    [`if ${is(ST.run)} then`, junk(), `  ${go(ST.done)}`, `end`].join("\n"),
    // fail
    [`if ${is(ST.fail)} then`, `  ${nER}(${nMSG},0)`, `end`].join("\n"),
    // decoy states (unreachable) — also corrupt the key schedule if reached
    ...Array.from({ length: 6 }, () => {
      const d = sid();
      return [
        `if ${is(d)} then`,
        junk(),
        `  for _i=1,#${nData} do ${nKB}[_i%32+1]=(${nKB}[_i%32+1]+${nSB}(${nData},_i))%256 end`,
        `  ${go(rngRange(2) ? ST.fail : d)}`,
        `end`,
      ].join("\n");
    }),
  ];

  // ── ciphertext literal chunks ────────────────────────────────────────────
  const CHUNK = 48 + rngRange(48);
  const chunks: { slot: number; literal: string }[] = [];
  for (let off = 0; off < cipher.length; off += CHUNK)
    chunks.push({
      slot: chunks.length + 1,
      literal: `"${Array.from(cipher.slice(off, off + CHUNK))
        .map(luaByte)
        .join("")}"`,
    });
  // Scatter physical storage; independently encoded permutation reassembles it.
  // Modulus is M (2^32) — never wraps to 0, so no pathological index.
  const physical = shuffle(chunks);
  const positions = new Map(physical.map((chunk, i) => [chunk.slot, i + 1]));
  const orderMask = 1 + rngRange(M - 1);
  const order = chunks.map(
    (chunk, i) => ((positions.get(chunk.slot) ?? 0) + orderMask + (i + 1) * 7) % M,
  );
  const nPool = name(),
    nOrder = name();

  const head = [
    `local ${nCH}=string.char`,
    `local ${nG}=(getfenv and getfenv(1)) or _G`,
    `local ${nHH}=0`,
    `local function ${nDec}(t,k)`,
    `  local o={}`,
    `  for i=1,#t do`,
    `    ${nHH}=(${nHH}*257+t[i])%${M}`,
    `    o[i]=${nCH}((t[i]-k-i*3)%256)`,
    `  end`,
    `  ${nHH}=(${nHH}*257+k)%${M}`,
    `  return table.concat(o)`,
    `end`,
    `local ${nData}`,
    `do`,
    `  local ${nPool}={${physical.map((chunk) => chunk.literal).join(",")}}`,
    `  local ${nOrder}={${order.join(",")}}`,
    `  local _out={}`,
    `  for _i=1,#${nOrder} do _out[_i]=${nPool}[(${nOrder}[_i]-${orderMask}-_i*7)%${M}] end`,
    `  ${nData}=table.concat(_out)`,
    `end`,
    `local ${nKS}={${keyStored.join(",")}}`,
    `local ${[
      nState,
      nF,
      nP,
      nT,
      nH,
      nKB,
      nBox,
      nHP,
      nSTR,
      nSB,
      nSC,
      nLS,
      nER,
      nPC,
      nTY,
      nMSG,
      nDH,
      nMath,
      nFloor,
      nS1,
      nS2,
      nS3,
      nS4,
      nS5,
      nS6,
      nS7,
      nS8,
      nS9,
      nS10,
      nS11,
      nS12,
      nS13,
      nS14,
      nS15,
      nS16,
      nS17,
      nS18,
      nS19,
      nS20,
    ].join(",")}`,
  ].join("\n");

  const lines = [
    junks(3),
    head,
    `${go(ST.names)}`,
    `while true do`,
    ...shuffle(branches),
    `  if ${is(ST.done)} then break end`,
    `end`,
    `return ${nF}(...)`,
  ];
  return lines.join("\n");
}

export function obfuscateLua(source: string, passes = 1): string {
  let cur = source;
  const n = Number.isFinite(passes) ? Math.max(1, Math.min(4, Math.floor(passes))) : 1;
  for (let i = 0; i < n; i++) cur = wrapOnce(cur);
  return cur;
}
