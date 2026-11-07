// Portable Lua 5.1 / Luau obfuscator with layered anti-tamper.
//
// Each layer turns a Lua chunk into another Lua chunk that:
//   · prepends/appends decoy comment lines to the payload, then encrypts the whole stream
//     (real source + decoys) with RC4 + a position-dependent LCG stream
//   · derives the *string* cipher key from a hash of the ciphertext itself — tamper with
//     the payload and all names decode to garbage before the env checks even run
//   · derives the *payload* cipher key from the ciphertext hash, the encrypted-name hash,
//     the runtime env self-test count, and a random per-layer salt
//   · env self-tests decrement a counter from EXPECTED (not increment from 0), so
//     deleting the tests leaves the counter at EXPECTED ≠ 0 and the key is wrong
//   · verifies a dual plaintext hash (over decoys + real source) and fails with a
//     per-layer randomized generic error message
//   · runs as a shuffled state machine whose transitions use a single shared mask
//   · uses randomised confusable identifiers (I, l, 1, O, 0)
// Layers can be stacked; each gets fresh keys, names, state ids, mask, decoy comments,
// T_SALT, and error message.
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

const roll = (h: number, v: number) => (h * 257 + v) % M;

const ERR_MSGS = [
  "bad header",
  "invalid bytecode",
  "corrupt chunk",
  "malformed input",
  "load failed",
  "unexpected symbol",
] as const;

const K_CHECKS = 15;

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

  // ── keys ─────────────────────────────────────────────────────────────────
  const keyBytes = Array.from({ length: 32 }, () => rngRange(256));
  const seed =
    ((keyBytes[0] ?? 0) * 16777216 +
      (keyBytes[1] ?? 0) * 65536 +
      (keyBytes[2] ?? 0) * 256 +
      (keyBytes[3] ?? 0)) %
    M;

  // ── decoy comment lines (valid Lua, indistinguishable from real comments) ─
  const decoyText = (): string => {
    const lines: string[] = [];
    const n = 3 + rngRange(10);
    for (let i = 0; i < n; i++) {
      const len = 20 + rngRange(60);
      let s = "";
      for (let j = 0; j < len; j++) {
        let c = 32 + rngRange(95);
        while (c === 10 || c === 13) c = 32 + rngRange(95);
        s += String.fromCharCode(c);
      }
      lines.push(`-- ${s}`);
    }
    return lines.join("\n");
  };
  const decoyPrefix = decoyText() + "\n";
  const decoySuffix = "\n" + decoyText();

  // ── plaintext = decoys + source + decoys ─────────────────────────────────
  const plain = new TextEncoder().encode(decoyPrefix + source + decoySuffix);

  // ── encrypt (RC4 KSA/PRGA + additive LCG stream) ─────────────────────────
  const sbox = Array.from({ length: 256 }, (_, i) => i);
  {
    let j = 0;
    for (let i = 0; i < 256; i++) {
      j = (j + (sbox[i] ?? 0) + (keyBytes[i % 32] ?? 0)) % 256;
      [sbox[i], sbox[j]] = [sbox[j] ?? 0, sbox[i] ?? 0];
    }
  }
  const cipher = new Uint8Array(plain.length);
  let plainHash = 0;
  let plainHash2 = 1;
  {
    let a = 0, b = 0, ls = seed;
    for (let n = 0; n < plain.length; n++) {
      a = (a + 1) % 256;
      b = (b + (sbox[a] ?? 0)) % 256;
      [sbox[a], sbox[b]] = [sbox[b] ?? 0, sbox[a] ?? 0];
      const r = sbox[((sbox[a] ?? 0) + (sbox[b] ?? 0)) % 256] ?? 0;
      ls = (ls * 1664525 + 1013904223) % M;
      const l = Math.floor(ls / 65536) % 256;
      const byte = plain[n] ?? 0;
      cipher[n] = (byte + r + l) % 256;
      plainHash = roll(plainHash, byte + 1);
      plainHash2 = (plainHash2 * 131 + byte + n + 1) % 65521;
    }
  }
  let dataHash = 0;
  for (const c of cipher) dataHash = roll(dataHash, c + 1);

  // ── encrypted names, keyed off the *ciphertext hash* ─────────────────────
  // If the payload is tampered with, dataHash changes, the string stream changes,
  // every name decodes to garbage, and the chunk fails before env checks even run.
  let constHash = 0;
  const encStr = (s: string): string => {
    const off = rngRange(M);
    let state = (dataHash + off) % M;
    const bytes = Array.from(new TextEncoder().encode(s));
    const out: number[] = [];
    for (const b of bytes) {
      state = (state * 1664525 + 1013904223) % M;
      const l = Math.floor(state / 65536) % 256;
      out.push((b + l) % 256);
    }
    for (const v of out) constHash = roll(constHash, v);
    constHash = roll(constHash, off);
    return `${nDec}({${out.join(",")}},${off})`;
  };

  // ── identifier bag ───────────────────────────────────────────────────────
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
    nDH = name(),
    nTS = name(),
    nSL = name(),
    nRQ = name(),
    nTBL = name(),
    nTC = name(),
    nSRP = name(),
    nMath = name(),
    nFloor = name();

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

  // ── env self-tests: nT starts at K_CHECKS, decrements per passing test ───
  // Clean runtime → nT = 0.  Hooked runtime → nT > 0.  Deleted tests → nT = K_CHECKS.
  // All three of {0} and {1..K_CHECKS} differ, so the key derivation diverges.
  const T_SALT = 1 + rngRange(M - 1);
  const salt = rngRange(M);

  // ── names branch ─────────────────────────────────────────────────────────
  const nS = Array.from({ length: 20 }, () => name());
  const [nS1, nS2, nS3, nS4, nS5, nS6, nS7, nS8, nS9, nS10,
         nS11, nS12, nS13, nS14, nS15, nS16, nS17, nS18, nS19, nS20] = nS as [
    string, string, string, string, string, string, string, string, string, string,
    string, string, string, string, string, string, string, string, string, string
  ];
  const names: string[] = [];
  const decl = (v: string, s: string) => names.push(`${v}=${encStr(s)}`);
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
  decl(nS19, "table");
  decl(nS20, "nil");

  // ── key derivation ───────────────────────────────────────────────────────
  const H = (dataHash * 3 + constHash * 5 + salt) % M;
  const keyStored = keyBytes.map((kb, i) => {
    const m = (H * (i + 1 + 13) + 40503) % M;
    return (kb + (Math.floor(m / 256) % 256)) % 256;
  });

  // ── branches ─────────────────────────────────────────────────────────────
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
      `  ${nTS}=${nG}[${nS13}]`,
      `  ${nSL}=${nG}[${nS14}]`,
      `  ${nRQ}=${nG}[${nS15}]`,
      `  ${nTBL}=${nG}[${nS16}]`,
      `  ${nTC}=${nTBL}[${nS17}]`,
      `  ${nSRP}=${nSTR}[${nS18}]`,
      `  ${go(ST.env)}`,
      `end`,
    ].join("\n"),
    // env — nT starts at K_CHECKS and decrements per passing known-answer test
    [
      `if ${is(ST.env)} then`,
      junk(),
      `  ${nT}=${K_CHECKS}`,
      `  if ${nSB}(${nSC}(65),1)==65 then ${nT}=${nT}-1 end`,
      `  if ${nSC}(${nSB}(${nSC}(66),1)+1)==${nSC}(67) then ${nT}=${nT}-1 end`,
      `  if ${nSB}(${nSC}(200,201,202),2)==201 then ${nT}=${nT}-1 end`,
      `  if ${nFloor}(7.9)==7 and ${nFloor}(-0.5)==-1 then ${nT}=${nT}-1 end`,
      `  if ${nFloor}(2^53)==2^53 then ${nT}=${nT}-1 end`,
      `  if (0.1+0.2)~=0.3 then ${nT}=${nT}-1 end`,
      `  if ${nTY}(${nLS})==${nS9} and ${nTY}(${nSB})==${nS9} and ${nTY}(${nSC})==${nS9} then ${nT}=${nT}-1 end`,
      `  if #${nSC}(0,127,255)==3 and ${nSB}(${nSC}(0,127,255),1)==0 and ${nSB}(${nSC}(0,127,255),3)==255 then ${nT}=${nT}-1 end`,
      `  if ${nTS}(1)=='1' and ${nTS}(nil)==${nS20} then ${nT}=${nT}-1 end`,
      `  if ${nSL}('#',1,2,3)==3 and ${nSL}(2,'a','b','c')=='b' then ${nT}=${nT}-1 end`,
      `  if ${nRQ}(1,1) and not ${nRQ}(1,2) then ${nT}=${nT}-1 end`,
      `  if ${nTC}({'a','b'})=='ab' then ${nT}=${nT}-1 end`,
      `  if ${nSRP}('x',3)=='xxx' then ${nT}=${nT}-1 end`,
      `  do local _ok,_f=${nPC}(${nLS},'return 1') if _ok and ${nTY}(_f)==${nS9} and _f()==1 then ${nT}=${nT}-1 end end`,
      `  do local _ok2,_e2=${nPC}(${nER},'x',0) if _ok2==false and _e2=='x' then ${nT}=${nT}-1 end end`,
      `  ${go(ST.hash)}`,
      `end`,
    ].join("\n"),
    // hash — combine ciphertext hash, name hash, env count, salt
    [
      `if ${is(ST.hash)} then`,
      junk(),
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
    // decrypt — hashes the full decrypted stream (decoys + real source)
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
      `  ${nP}=table.concat(_o)`,
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
    // run
    [`if ${is(ST.run)} then`, junk(), `  ${go(ST.done)}`, `end`].join("\n"),
    // fail
    [`if ${is(ST.fail)} then`, `  ${nER}(${nMSG},0)`, `end`].join("\n"),
    // decoy states (unreachable) — corrupt the key schedule if reached
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

  // ── ciphertext chunks (variable size, shuffled storage) ──────────────────
  const chunks: { slot: number; literal: string }[] = [];
  let off = 0;
  while (off < cipher.length) {
    const size = 32 + rngRange(80);
    const slice = cipher.slice(off, off + size);
    chunks.push({
      slot: chunks.length + 1,
      literal: `"${Array.from(slice).map(luaByte).join("")}"`,
    });
    off += size;
  }
  const physical = shuffle(chunks);
  const positions = new Map(physical.map((chunk, i) => [chunk.slot, i + 1]));
  const orderMask = 1 + rngRange(M - 1);
  const order = chunks.map(
    (chunk, i) => ((positions.get(chunk.slot) ?? 0) + orderMask + (i + 1) * 7) % M,
  );
  const nPool = name(),
    nOrder = name(),
    nSB2 = name();

  // ── head ─────────────────────────────────────────────────────────────────
  const head = [
    `local ${nCH}=string.char`,
    `local ${nSB2}=string.byte`,
    `local ${nHH}=0`,
    `local ${nData}`,
    `local ${nDH}=0`,
    `do`,
    `  local ${nPool}={${physical.map((chunk) => chunk.literal).join(",")}}`,
    `  local ${nOrder}={${order.join(",")}}`,
    `  local _out={}`,
    `  for _i=1,#${nOrder} do _out[_i]=${nPool}[(${nOrder}[_i]-${orderMask}-_i*7)%${M}] end`,
    `  ${nData}=table.concat(_out)`,
    `end`,
    `for _i=1,#${nData} do ${nDH}=(${nDH}*257+${nSB2}(${nData},_i)+1)%${M} end`,
    `local function ${nDec}(t,o)`,
    `  local r,s={},(${nDH}+o)%${M}`,
    `  for i=1,#t do`,
    `    s=(s*1664525+1013904223)%${M}`,
    `    r[i]=${nCH}((t[i]-((s-s%65536)/65536)%256)%256)`,
    `  end`,
    `  for i=1,#t do ${nHH}=(${nHH}*257+t[i])%${M} end`,
    `  ${nHH}=(${nHH}*257+o)%${M}`,
    `  return table.concat(r)`,
    `end`,
    `local ${nG}=(getfenv and getfenv(1)) or _G`,
    `local ${nKS}={${keyStored.join(",")}}`,
    `local ${[
      nState, nF, nP, nT, nH, nKB, nBox, nHP, nSTR, nSB, nSC, nLS, nER, nPC, nTY,
      nMSG, nTS, nSL, nRQ, nTBL, nTC, nSRP, nMath, nFloor,
      ...nS,
    ].join(",")}`,
  ].join("\n");

  const out = [
    junks(3),
    head,
    `${go(ST.names)}`,
    `while true do`,
    ...shuffle(branches),
    `  if ${is(ST.done)} then break end`,
    `end`,
    `return ${nF}(...)`,
  ];
  return out.join("\n");
}

export function obfuscateLua(source: string, passes = 1): string {
  let cur = source;
  const n = Number.isFinite(passes) ? Math.max(1, Math.min(4, Math.floor(passes))) : 1;
  for (let i = 0; i < n; i++) cur = wrapOnce(cur);
  return cur;
}