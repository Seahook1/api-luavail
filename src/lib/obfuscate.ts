// Lua 5.1 / Luau VM-based obfuscator — Luraph-style output.
// Architecture: source → XOR stream-cipher encode → embed in a Lua VM interpreter
// that decodes + loads the payload at runtime. The VM shell uses:
//   · buffer API (Roblox-compatible: buffer.readu8/writeu8/create/len/copy/tostring)
//   · RC4-derived keystream for per-byte XOR
//   · XTEA-style block cipher on the keystream seed
//   · Flattened state-machine dispatcher (randomly ordered, encrypted state IDs)
//   · Opaque-predicate decoys (n*(n+1) always even — guard never fires)
//   · Randomised variable names, chunked string literals
//   · Multi-pass wrapping (each pass re-encrypts with fresh keys)

const rng = () => (Math.random() * 0xffffffff) >>> 0;
const rngRange = (max: number) =>
  max <= 0 ? 0 : ((Math.random() * max) >>> 0) % max;

const shuffle = <T>(arr: T[]): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rngRange(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
};

// Printable bytes stay raw; control bytes become \ddd escapes.
const luaByte = (b: number) =>
  b >= 32 && b <= 126 && b !== 34 && b !== 92
    ? String.fromCharCode(b)
    : `\\${String(b).padStart(3, "0")}`;

// XTEA 1-round mix used to scramble keystream seeds.
const xteaMix = (v: number, key: number[]): number => {
  let sum = 0;
  const delta = 0x9e3779b9 | 0;
  for (let i = 0; i < 8; i++) {
    sum = (sum + delta) >>> 0;
    v =
      (v + (((v << 4) ^ (v >>> 5)) + v) ^ (sum + key[(sum >>> 11) & 3]!)) >>>
      0;
  }
  return v;
};

// RC4-KSA + PRGA encode.
function rc4Encode(
  bytes: Uint8Array,
  key: Uint8Array
): { cipher: Uint8Array; sbox: number[] } {
  const S = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i]! + key[i % key.length]!) & 0xff;
    [S[i], S[j]] = [S[j]!, S[i]!];
  }
  const cipher = new Uint8Array(bytes.length);
  let a = 0,
    b = 0;
  for (let n = 0; n < bytes.length; n++) {
    a = (a + 1) & 0xff;
    b = (b + S[a]!) & 0xff;
    [S[a], S[b]] = [S[b]!, S[a]!];
    cipher[n] = bytes[n]! ^ S[(S[a]! + S[b]!) & 0xff]!;
  }
  return { cipher, sbox: S };
}

// Adler-32 checksum.
const adler32 = (bytes: Uint8Array): number => {
  let a = 1,
    b = 0;
  for (const v of bytes) {
    a = (a + v) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
};

function wrapOnce(source: string): string {
  // ── name pool ────────────────────────────────────────────────────────────
  let serial = 0;
  const used = new Set<string>();
  const name = (): string => {
    let id: string;
    do {
      id = `_${rng().toString(36)}_${serial++}`;
    } while (used.has(id));
    used.add(id);
    return id;
  };

  // ── derive keys ──────────────────────────────────────────────────────────
  const xteaKey = [rng(), rng(), rng(), rng()];
  const rc4Seed = rng();
  const rc4KeyRaw = new Uint8Array(32);
  let ks = rc4Seed;
  for (let i = 0; i < 32; i++) {
    ks = xteaMix(ks, xteaKey);
    rc4KeyRaw[i] = ks & 0xff;
  }

  // ── encode source ────────────────────────────────────────────────────────
  const plainBytes = new TextEncoder().encode(source);
  const checkPlain = adler32(plainBytes);
  const { cipher } = rc4Encode(plainBytes, rc4KeyRaw);
  const checkCipher = adler32(cipher);

  // ── chunk cipher text into quoted string literals ─────────────────────
  const CHUNK = 48 + rngRange(32);
  const chunks: string[] = [];
  for (let off = 0; off < cipher.length; off += CHUNK) {
    chunks.push(
      `"${Array.from(cipher.slice(off, off + CHUNK)).map(luaByte).join("")}"`
    );
  }

  // ── Lua variable names ───────────────────────────────────────────────────
  const [
    nData,
    nBuf,
    nLen,
    nI,
    nB,
    nSbox,
    nA,
    nV,
    nFn,
    nErr,
    nSrc,
    nState,
    nResult,
    nDecoy,
    nK0,
    nK1,
    nK2,
    nK3,
    nSeed,
    nKstr,
    nKbuf,
    nTmp,
    nChk,
  ] = Array.from({ length: 23 }, name) as string[];

  // ── XTEA constants embedded as runtime computation ───────────────────────
  // Split each key word so it isn't a bare literal.
  const embedU32 = (v: number): string => {
    const lo = v & 0xffff;
    const hi = (v >>> 16) & 0xffff;
    return `(${hi}*65536+${lo})`;
  };
  const kExprs = xteaKey.map(embedU32);

  // ── Opaque-predicate junk (n*(n+1) is always even) ──────────────────────
  const junk = (): string => {
    const probe = rngRange(9000) + 2;
    const acc = name();
    return `do local ${acc}=0;if(${probe}*(${probe}+1))%2==1 then ${acc}=1 end end`;
  };

  // ── State IDs for flattened dispatcher ───────────────────────────────────
  const NUM_STATES = 10;
  const statePool = shuffle(
    Array.from({ length: 100 }, (_, i) => i + 11)
  ).slice(0, NUM_STATES);
  const [sInit, sKsa, sPrga, sVerify, sLoad, sRun, sFail, sXtea, sMkKey, sChkSum] =
    statePool as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number
    ];

  // ── XOR-encrypted state transition values stored in a table ─────────────
  // We pick a random byte mask and XOR each state ID, so they can't be read
  // directly from the source. At runtime we XOR them back.
  const mask = rngRange(255) + 1;
  const encState = (id: number) => id ^ mask;
  const nMask = name();
  const nStates = name();
  const stateEntries = [
    sInit,
    sKsa,
    sPrga,
    sVerify,
    sLoad,
    sRun,
    sFail,
    sXtea,
    sMkKey,
    sChkSum,
  ]
    .map((s, i) => `[${i + 1}]=${encState(s)}`)
    .join(",");

  // ── Dispatcher branches ─────────────────────────────────────────────────
  // Runtime decode: state = _states[k] XOR mask
  const decodeState = (idx: number) =>
    `bit32.bxor(${nStates}[${idx}],${nMask})`;

  // Helper: compare current state using encoded table lookup
  const isSt = (idx: number) =>
    `${nState}==${decodeState(idx)}`;

  const branches: string[] = [
    // ── sInit: validate data length & cipher checksum ──────────────────
    [
      `if ${isSt(1)} then`,
      `  ${junk()}`,
      `  local ${nChk}=0`,
      `  for ${nI}=1,#${nData} do`,
      `    local ${nB}=string.byte(${nData},${nI})`,
      `    ${nChk}=(${nChk}*65521+${nB})%4294967296`,
      `  end`,
      `  if #${nData}~=${cipher.length} or ${nChk}~=${checkCipher} then`,
      `    ${nState}=${decodeState(7)}`,  // sFail
      `  else`,
      `    ${nState}=${decodeState(8)}`,  // sXtea
      `  end`,
      `end`,
    ].join("\n"),

    // ── sXtea: derive RC4 key seed via XTEA ──────────────────────────
    [
      `if ${isSt(8)} then`,
      `  ${junk()}`,
      `  local ${nSeed}=${embedU32(rc4Seed)}`,
      `  local ${nK0},${nK1},${nK2},${nK3}=${kExprs[0]},${kExprs[1]},${kExprs[2]},${kExprs[3]}`,
      `  local _sum,_delta=0,${embedU32(0x9e3779b9)}`,
      `  for _=1,8 do`,
      `    _sum=(_sum+_delta)%4294967296`,
      `    local _ki=_sum%4`,
      `    local _kw=_ki==0 and ${nK0} or _ki==1 and ${nK1} or _ki==2 and ${nK2} or ${nK3}`,
      `    local _r11=_sum%2048`,
      `    local _kw2=math.floor(_sum/2048)%4`,
      `    local _kw2v=_kw2==0 and ${nK0} or _kw2==1 and ${nK1} or _kw2==2 and ${nK2} or ${nK3}`,
      `    ${nSeed}=(${nSeed}+(bit32.bxor(bit32.lshift(${nSeed},4),bit32.rshift(${nSeed},5))+${nSeed})`,
      `       %4294967296+bit32.bxor(_sum,_kw))%4294967296`,
      `  end`,
      `  ${nSeed}=${nSeed}%256`,
      `  ${nState}=${decodeState(9)}`,  // sMkKey
      `  ${nResult}=${nSeed}`,
      `end`,
    ].join("\n"),

    // ── sMkKey: RC4-KSA to build sbox ───────────────────────────────
    [
      `if ${isSt(9)} then`,
      `  ${junk()}`,
      `  local _seed=${nResult}`,
      `  ${nSbox}={}`,
      `  for ${nI}=0,255 do ${nSbox}[${nI}]=${nI} end`,
      `  local _j,_ks=0,_seed`,
      `  ${nKbuf}=buffer.create(32)`,
      `  for _ki=0,31 do`,
      `    _ks=(_ks*1664525+1013904223)%4294967296`,
      `    buffer.writeu8(${nKbuf},_ki,_ks%256)`,
      `  end`,
      `  for ${nI}=0,255 do`,
      `    _j=(_j+${nSbox}[${nI}]+buffer.readu8(${nKbuf},${nI}%32))%256`,
      `    ${nSbox}[${nI}],${nSbox}[_j]=${nSbox}[_j],${nSbox}[${nI}]`,
      `  end`,
      `  ${nState}=${decodeState(2)}`,  // sKsa done → sPrga
      `end`,
    ].join("\n"),

    // ── sKsa (state 2 → sPrga) is handled inline above; reuse slot for sPrga ─
    // ── sPrga: RC4 keystream + XOR decrypt ───────────────────────────────
    [
      `if ${isSt(2)} then`,
      `  ${junk()}`,
      `  local _a,_b=0,0`,
      `  local _sbox=${nSbox}`,
      `  local _plain={}`,
      `  local _datab=buffer.fromstring(${nData})`,
      `  for ${nI}=0,${cipher.length - 1} do`,
      `    _a=(_a+1)%256`,
      `    _b=(_b+_sbox[_a])%256`,
      `    _sbox[_a],_sbox[_b]=_sbox[_b],_sbox[_a]`,
      `    local _ks=_sbox[(_sbox[_a]+_sbox[_b])%256]`,
      `    _plain[${nI}+1]=buffer.readu8(_datab,${nI})%256`,
      `    _plain[${nI}+1]=bit32.bxor(_plain[${nI}+1],_ks)`,
      `  end`,
      `  ${nSrc}=table.concat(table.move(_plain,1,#_plain,1,{}),",")`,
      `  local _pb=buffer.create(${cipher.length})`,
      `  for _pi=1,${cipher.length} do buffer.writeu8(_pb,_pi-1,_plain[_pi]) end`,
      `  ${nSrc}=buffer.tostring(_pb)`,
      `  ${nState}=${decodeState(10)}`,  // sChkSum
      `end`,
    ].join("\n"),

    // ── sChkSum: verify plaintext Adler-32 ───────────────────────────────
    [
      `if ${isSt(10)} then`,
      `  ${junk()}`,
      `  local _a,_b=1,0`,
      `  for _i=1,#${nSrc} do`,
      `    local _bv=string.byte(${nSrc},_i)`,
      `    _a=(_a+_bv)%65521`,
      `    _b=(_b+_a)%65521`,
      `  end`,
      `  local _chk=(_b*65536+_a)%4294967296`,
      `  if _chk~=${checkPlain} then`,
      `    ${nState}=${decodeState(7)}`,  // sFail
      `  else`,
      `    ${nState}=${decodeState(5)}`,  // sLoad
      `  end`,
      `end`,
    ].join("\n"),

    // ── sLoad: compile plaintext ──────────────────────────────────────────
    [
      `if ${isSt(5)} then`,
      `  ${junk()}`,
      `  ${nFn},${nErr}=(loadstring or load)(${nSrc})`,
      `  if not ${nFn} then ${nState}=${decodeState(7)} else ${nState}=${decodeState(6)} end`,
      `end`,
    ].join("\n"),

    // ── sRun: execute ────────────────────────────────────────────────────
    [
      `if ${isSt(6)} then`,
      `  ${junk()}`,
      `  return ${nFn}(...)`,
      `end`,
    ].join("\n"),

    // ── sFail: integrity error ────────────────────────────────────────────
    [
      `if ${isSt(7)} then`,
      `  error("[VM] integrity check failed",0)`,
      `end`,
    ].join("\n"),
  ];

  // ── Shuffle branch order ─────────────────────────────────────────────────
  const shuffled = shuffle(branches);

  // ── Assemble the wrapper ─────────────────────────────────────────────────
  return [
    junk(),
    `local ${nMask}=${mask}`,
    `local ${nStates}={${stateEntries}}`,
    `local ${nData}=table.concat({${chunks.join(",")}})`,
    `local ${nSbox},{${nFn},${nErr},${nSrc},${nResult},${nKbuf}}`,
    `local ${nState}=${decodeState(1)}`,  // sInit
    `${junk()}`,
    `while true do`,
    ...shuffled,
    `  if ${nState}==${decodeState(6)} then break end`,
    `  if ${nState}==${decodeState(7)} then error("[VM] integrity check failed",0) end`,
    `end`,
    `return ${nFn}(...)`,
  ].join("\n");
}

export function obfuscateLua(source: string, passes = 1): string {
  let cur = source;
  const n = Math.max(1, Math.min(3, passes));
  for (let i = 0; i < n; i++) cur = wrapOnce(cur);
  return cur;
}