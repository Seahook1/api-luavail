// Portable Lua 5.1 / Luau obfuscator, combined pipeline.
//
//   obfuscateLua(source, opts)
//     ├─ buildAntiTamper({preamble:true})  →  do <probes> end   (optional)
//     ├─ flatten(source)                   →  do <dispatcher> end (optional, safe-bails)
//     ├─ virtualize(...)                   →  used standalone or embedded
//     └─ wrapOnce(source) × N              →  RC4 + decoys + env tests
//
// Non-negotiables:
//   · anti-tamper fails LOUD (error), never silently poisons arithmetic
//   · flatten returns its input untouched if the chunk has duplicate top-level
//     locals, Luau-only syntax, `goto`, or any token mismatch
//   · virtualize() returns a standalone Lua chunk — embed as
//     `(function() <chunk> end)()` if you need to inline it

// ── shared helpers ─────────────────────────────────────────────────────────

const M = 4294967296;

const rng = (): number => {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] ?? 0;
};
const rngRange = (max: number) => (max <= 0 ? 0 : rng() % max);
const pick = <T>(arr: readonly T[]): T => {
  const v = arr[rngRange(arr.length)];
  if (v === undefined) throw new Error("Cannot pick from an empty collection");
  return v;
};
const shuffle = <T>(arr: T[]): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rngRange(i + 1);
    const left = a[i], right = a[j];
    if (left === undefined || right === undefined) throw new Error("Invalid shuffle index");
    [a[i], a[j]] = [right, left];
  }
  return a;
};
const luaByte = (b: number) =>
  b >= 32 && b <= 126 && b !== 34 && b !== 92
    ? String.fromCharCode(b)
    : `\\${String(b).padStart(3, "0")}`;
const roll = (h: number, v: number) => (h * 257 + v) % M;

const ERR_MSGS = [
  "bad header", "invalid bytecode", "corrupt chunk",
  "malformed input", "load failed", "unexpected symbol",
] as const;

const K_CHECKS = 15;

// ── 1. statement-level control-flow flattening ─────────────────────────────

const isIdentStart = (c: string) => /[A-Za-z_]/.test(c);
const isIdentPart  = (c: string) => /[A-Za-z0-9_]/.test(c);

function longBracketLevel(src: string, i: number): number {
  if (src[i] !== "[") return -1;
  let j = i + 1, eq = 0;
  while (src[j] === "=") { eq++; j++; }
  return src[j] === "[" ? eq : -1;
}
function findLongClose(src: string, i: number): number {
  const eq = longBracketLevel(src, i);
  if (eq === -1) return -1;
  const closer = "]" + "=".repeat(eq) + "]";
  const idx = src.indexOf(closer, i + eq + 2);
  return idx === -1 ? -1 : idx + closer.length;
}
function skipQuoted(src: string, i: number): number {
  const q = src[i]; i++;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") { i += 2; continue; }
    if (c === q) return i + 1;
    if (c === "\n") return -1;
    i++;
  }
  return -1;
}

function splitTopLevel(src: string): string[] | null {
  const out: string[] = [];
  const n = src.length;
  let i = 0, depth = 0, stmtStart = 0, pendingElseif = false;
  const pushStmt = (end: number) => {
    const s = src.slice(stmtStart, end).trim();
    if (s) out.push(s);
  };
  while (i < n) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\r") { i++; continue; }
    if (c === "\n") {
      if (depth === 0) { pushStmt(i); stmtStart = i + 1; }
      i++; continue;
    }
    if (c === "-" && src[i + 1] === "-") {
      if (src[i + 2] === "[") {
        const close = findLongClose(src, i + 2);
        if (close !== -1) { i = close; continue; }
      }
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === '"' || c === "'") {
      i = skipQuoted(src, i);
      if (i < 0) return null;
      continue;
    }
    if (c === "[") {
      const close = findLongClose(src, i);
      if (close !== -1) { i = close; continue; }
      i++; continue;
    }
    if (c === ";" && depth === 0) { pushStmt(i); i++; stmtStart = i; continue; }
    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < n && isIdentPart(src[j])) j++;
      const w = src.slice(i, j);
      if (w === "function" || w === "do" || w === "repeat") depth++;
      else if (w === "then") { if (!pendingElseif) depth++; pendingElseif = false; }
      else if (w === "elseif") { pendingElseif = true; }
      else if (w === "end" || w === "until") { depth--; pendingElseif = false; }
      else if (w === "else") { pendingElseif = false; }
      if (depth < 0) return null;
      i = j; continue;
    }
    i++;
  }
  if (depth !== 0) return null;
  pushStmt(n);
  return out;
}

function findTopLevelEq(s: string, from: number): number {
  let i = from, depth = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"' || c === "'") { i = skipQuoted(s, i); if (i < 0) return -1; continue; }
    if (c === "[") { const close = findLongClose(s, i); if (close !== -1) { i = close; continue; } }
    if (c === "-" && s[i + 1] === "-") { while (i < s.length && s[i] !== "\n") i++; continue; }
    if (c === "(" || c === "{" || c === "[") { depth++; i++; continue; }
    if (c === ")" || c === "}" || c === "]") { depth--; i++; continue; }
    if (c === "=" && depth === 0 && s[i + 1] !== "=" && s[i - 1] !== "<" && s[i - 1] !== ">" && s[i - 1] !== "~") return i;
    i++;
  }
  return -1;
}

function hoistLocal(stmt: string): { decls: string; body: string; names: string[] } | null {
  const m = /^local\s+/.exec(stmt);
  if (!m) return { decls: "", body: stmt, names: [] };
  const rest = stmt.slice(m[0].length);
  const fn = /^function\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(rest);
  if (fn) {
    const name = fn[1]!;
    return { decls: `local ${name}`, body: `${name}=function${rest.slice(fn[0].length)}`, names: [name] };
  }
  const eq = findTopLevelEq(rest, 0);
  const names = (eq === -1 ? rest : rest.slice(0, eq)).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*(\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*$/.test(names)) return null;
  const list = names.split(/\s*,\s*/);
  if (eq === -1) return { decls: `local ${names}`, body: "", names: list };
  const rhs = rest.slice(eq + 1).trim();
  if (!rhs) return null;
  return { decls: `local ${names}`, body: `${names}=${rhs}`, names: list };
}

function flatten(source: string): string {
  const stmts = splitTopLevel(source);
  if (!stmts || stmts.length < 2) return source;

  const seen = new Set<string>();
  const decls: string[] = [];
  const bodies: string[] = [];
  for (const s of stmts) {
    const h = hoistLocal(s);
    if (!h) return source;
    if (h.decls) {
      for (const n of h.names) {
        if (seen.has(n) || n.startsWith("__cff_")) return source;
        seen.add(n);
      }
      decls.push(h.decls);
    }
    if (h.body) bodies.push(h.body);
  }
  if (bodies.length < 2) return source;

  const ids = new Set<number>();
  const sid = () => {
    for (;;) { const v = 100 + rngRange(900000); if (!ids.has(v)) { ids.add(v); return v; } }
  };
  const states = bodies.map(() => sid());
  const doneId = sid();
  const mask = 1 + rngRange(M - 1);
  const P = "__cff_";

  const lines: string[] = [];
  lines.push("do");
  if (decls.length) lines.push("  " + decls.join("; "));
  lines.push(`  local ${P}M=${M}`);
  lines.push(`  local ${P}k=${mask}`);
  lines.push(`  local ${P}s=(${states[0]} + ${P}k) % ${P}M`);
  lines.push(`  while true do`);
  lines.push(`    local ${P}q=${P}s % 7`);
  lines.push(`    local ${P}p=(${P}q*(${P}q+1)) % 2`);
  lines.push(`    if ${P}p==0 then`);
  lines.push(`      local ${P}d=(${P}s-${P}k) % ${P}M`);

  bodies.forEach((body, idx) => {
    const next = idx + 1 < bodies.length ? states[idx + 1]! : doneId;
    const head = idx === 0 ? "if" : "elseif";
    lines.push(`      ${head} ${P}d==${states[idx]} then`);
    if (body) lines.push(body.split("\n").map(l => "        " + l).join("\n"));
    lines.push(`        ${P}s=(${next} + ${P}k) % ${P}M`);
  });

  lines.push(`      elseif ${P}d==${doneId} then`);
  lines.push(`        return`);
  lines.push(`      else`);
  lines.push(`        error("${pick(ERR_MSGS)}",0)`);
  lines.push(`      end`);
  lines.push(`    else`);
  lines.push(`      error("${pick(ERR_MSGS)}",0)`);
  lines.push(`    end`);
  lines.push(`  end`);
  lines.push(`end`);
  return lines.join("\n");
}

// ── 2. anti-tamper (fails loud, never poisons) ─────────────────────────────

interface AntiTamperOpts {
  preamble?: boolean;
  onFail?: "error" | "callback";
  callback?: string;
}

function buildAntiTamper(opts: AntiTamperOpts = {}): string {
  const { preamble = false, onFail = "error", callback = "onTamper" } = opts;

  const sbox = Array.from({ length: 8 }, () => 100 + Math.floor(Math.random() * 900));
  const xorKey = 1 + Math.floor(Math.random() * 255);
  const expected = sbox.map(v => ((v * 7 + 13) ^ xorKey) & 0xff);

  const handleFail = onFail === "callback"
    ? `${callback}({ok=false, failures=__F}) error("integrity check failed: " .. __F[1], 0)`
    : `error("integrity check failed: " .. __F[1], 0)`;

  const body = [
    `local __F={}`,
    `local __byte,__char=string.byte,string.char`,
    `local __orig={}`,
    `__orig.pcall=pcall`,
    `__orig.setmeta=setmetatable`,
    `__orig.sbyte=string.byte`,
    `__orig.loadstring=loadstring or load`,
    `__orig.rawget=rawget`,
    `local __probes={${sbox.join(",")}}`,
    `local __expect={${expected.join(",")}}`,
    `local __ks=${xorKey}`,
    `for i=1,#__probes do`,
    `  local v=__byte(__char(__probes[i]),1)`,
    `  if (((v*7+13)~__ks)%256)~=__expect[i] then __F[#__F+1]="string.byte detoured" break end`,
    `end`,
    `if __orig.pcall~=pcall then __F[#__F+1]="pcall replaced" end`,
    `if __orig.setmeta~=setmetatable then __F[#__F+1]="setmetatable replaced" end`,
    `if __orig.sbyte~=string.byte then __F[#__F+1]="string.byte replaced" end`,
    `if __orig.loadstring~=(loadstring or load) then __F[#__F+1]="loadstring replaced" end`,
    `if __orig.rawget~=rawget then __F[#__F+1]="rawget replaced" end`,
    `do local ok,err=pcall(function() error("__probe") end)`,
    `   if ok or err~="__probe" then __F[#__F+1]="pcall semantics changed" end end`,
    `do local d=rawget(_G or {}, "debug")`,
    `   if d and d.getinfo then`,
    `     local ok,info=pcall(d.getinfo,d.getinfo,"S")`,
    `     if ok and info and info.what~="C" then __F[#__F+1]="debug.getinfo hooked" end`,
    `   end end`,
    `if #__F>0 then ${handleFail} end`,
  ];

  return preamble
    ? ["do", ...body.map(l => "  " + l), "end"].join("\n")
    : [...body, `return {ok=true, failures=__F}`].join("\n");
}

// ── 3. mini-VM virtualizer ─────────────────────────────────────────────────

type MiniOp =
  | { op: "LOADK";     dst: number; kidx: number }
  | { op: "MOVE";      dst: number; src: number }
  | { op: "GETGLOBAL"; dst: number; name: string }
  | { op: "CALL";      base: number; argc: number }
  | { op: "JUMP";      offset: number }
  | { op: "RETURN";    src: number };

type Const = number | string | boolean | null;

const luaLit = (v: Const): string => {
  if (v === null) return "nil";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  return `"${Array.from(new TextEncoder().encode(v)).map(luaByte).join("")}"`;
};

function uniqOpIds(count: number): number[] {
  const s = new Set<number>();
  while (s.size < count) s.add(1 + rngRange(255));
  return [...s];
}

function virtualize(ops: MiniOp[], consts: Const[]): string {
  const ids = uniqOpIds(6);
  const OP = {
    LOADK: ids[0]!, MOVE: ids[1]!, GETGLOBAL: ids[2]!,
    CALL: ids[3]!, JUMP: ids[4]!, RETURN: ids[5]!,
  } as const;

  const stride = 4 + rngRange(4);
  const key = Array.from({ length: 1 + rngRange(8) }, () => 1 + rngRange(255));

  const nameIndex = new Map<string, number>();
  const pushConst = (v: Const) => {
    const i = consts.length;
    consts.push(v);
    return i;
  };
  for (const op of ops) {
    if (op.op === "GETGLOBAL" && !nameIndex.has(op.name)) {
      nameIndex.set(op.name, pushConst(op.name));
    }
  }

  const raw: number[] = [];
  for (const op of ops) {
    const rec = new Array<number>(stride).fill(0);
    for (let i = 4; i < stride; i++) rec[i] = rngRange(256);
    switch (op.op) {
      case "LOADK":
        rec[0] = OP.LOADK; rec[1] = op.dst;
        rec[2] = op.kidx & 0xff; rec[3] = (op.kidx >> 8) & 0xff;
        break;
      case "MOVE":
        rec[0] = OP.MOVE; rec[1] = op.dst; rec[2] = op.src;
        break;
      case "GETGLOBAL": {
        const ki = nameIndex.get(op.name)!;
        rec[0] = OP.GETGLOBAL; rec[1] = op.dst;
        rec[2] = ki & 0xff; rec[3] = (ki >> 8) & 0xff;
        break;
      }
      case "CALL":
        rec[0] = OP.CALL; rec[1] = op.base; rec[2] = op.argc;
        break;
      case "JUMP": {
        const d = op.offset & 0xffff;
        rec[0] = OP.JUMP;
        rec[2] = d & 0xff; rec[3] = (d >> 8) & 0xff;
        break;
      }
      case "RETURN":
        rec[0] = OP.RETURN; rec[1] = op.src;
        break;
    }
    raw.push(...rec);
  }

  const masked = raw.map((b, i) => (b + key[i % key.length]!) % 256);

  return [
    `local __K={${consts.map(luaLit).join(",")}}`,
    `local __OPS={LOADK=${OP.LOADK},MOVE=${OP.MOVE},GETGLOBAL=${OP.GETGLOBAL},CALL=${OP.CALL},JUMP=${OP.JUMP},RETURN=${OP.RETURN}}`,
    `local __KEY="${key.map(luaByte).join("")}"`,
    `local __BC="${masked.map(luaByte).join("")}"`,
    `local __S=${stride}`,
    `local __byte,__char=string.byte,string.char`,
    `local __unpack=table.unpack or unpack`,
    `local __env=(getfenv and getfenv(1)) or _G`,
    `local __code={}`,
    `do`,
    `  local kl=#__KEY`,
    `  for i=1,#__BC do`,
    `    __code[i]=(__byte(__BC,i)-__byte(__KEY,(i-1)%kl+1))%256`,
    `  end`,
    `end`,
    `return function(...)`,
    `  local R,pc={},1`,
    `  while true do`,
    `    local op=__code[pc]`,
    `    local a=__code[pc+1] or 0`,
    `    local b=__code[pc+2] or 0`,
    `    local c=__code[pc+3] or 0`,
    `    if op==__OPS.LOADK then`,
    `      R[a]=__K[b+c*256]`,
    `      pc=pc+__S`,
    `    elseif op==__OPS.MOVE then`,
    `      R[a]=R[b]`,
    `      pc=pc+__S`,
    `    elseif op==__OPS.GETGLOBAL then`,
    `      R[a]=__env[__K[b+c*256]]`,
    `      pc=pc+__S`,
    `    elseif op==__OPS.CALL then`,
    `      local args={}`,
    `      for j=1,b do args[j]=R[a+j] end`,
    `      R[a]=R[a](__unpack(args))`,
    `      pc=pc+__S`,
    `    elseif op==__OPS.JUMP then`,
    `      local d=b+c*256`,
    `      if d>=32768 then d=d-65536 end`,
    `      pc=pc+d*__S`,
    `    elseif op==__OPS.RETURN then`,
    `      return R[a]`,
    `    else`,
    `      error("bad opcode",0)`,
    `    end`,
    `  end`,
    `end`,
  ].join("\n");
}

// ── 4. RC4 + decoy + env-test wrapper (original, preserved verbatim) ──────

function wrapOnce(source: string): string {
  const used = new Set<string>();
  const name = (): string => {
    for (;;) {
      let id = pick(["I", "l", "_"]);
      const len = 8 + rngRange(10);
      for (let i = 0; i < len; i++) id += pick(["I", "l", "1", "O", "0", "_"]);
      if (!used.has(id)) { used.add(id); return id; }
    }
  };

  const keyBytes = Array.from({ length: 32 }, () => rngRange(256));
  const seed =
    ((keyBytes[0] ?? 0) * 16777216 +
      (keyBytes[1] ?? 0) * 65536 +
      (keyBytes[2] ?? 0) * 256 +
      (keyBytes[3] ?? 0)) % M;

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

  const plain = new TextEncoder().encode(decoyPrefix + source + decoySuffix);

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

  const nCH = name(), nG = name(), nHH = name(), nDec = name(), nData = name(),
    nState = name(), nF = name(), nP = name(), nT = name(), nH = name(),
    nKS = name(), nKB = name(), nBox = name(), nHP = name(), nSTR = name(),
    nSB = name(), nSC = name(), nLS = name(), nER = name(), nPC = name(),
    nTY = name(), nMSG = name(), nDH = name(), nTS = name(), nSL = name(),
    nRQ = name(), nTBL = name(), nTC = name(), nSRP = name(), nMath = name(),
    nFloor = name();

  const ids = new Set<number>();
  const sid = () => {
    for (;;) {
      const v = 100 + rngRange(900000);
      if (!ids.has(v)) { ids.add(v); return v; }
    }
  };
  const ST = {
    names: sid(), env: sid(), hash: sid(), key: sid(), ksa: sid(),
    dec: sid(), load: sid(), run: sid(), fail: sid(), done: sid(),
  };
  const stateMask = 1 + rngRange(M - 1);
  const go = (id: number) => `${nState}=(${id}+${stateMask})%${M}`;
  const is = (id: number) => `(${nState}-${stateMask})%${M}==${id}`;

  const junk = (): string => {
    const t = rngRange(4);
    const p = rngRange(9000) + 2;
    const a = name(), b = name(), c = name();
    if (t === 0)
      return `do local ${a}=${p} if (${a}*(${a}+1))%2==1 then ${nState}=${rngRange(999)} ${nER}(${nMSG},0) end end`;
    if (t === 1)
      return `if (${p}*${p}+${p})%2==1 then local function ${a}(${b},${c}) for ${name()}=1,${b} do ${c}=(${c}*${rngRange(97) + 3}+${rngRange(1000)})%${M} end return ${c} end ${a}(${rngRange(50)},${rngRange(9999)}) end`;
    if (t === 2)
      return `do local ${a},${b}=${rngRange(9999)},${rngRange(9999)} for ${c}=1,${rngRange(4) + 1} do ${a}=(${a}*${b}+${c})%${rngRange(60000) + 7} end end`;
    return `if ${p}%${p}~=0 then local ${a}={${rngRange(99)},${rngRange(99)}} while true do ${a}[1]=${a}[1]+1 end end`;
  };
  const junks = (n: number) => Array.from({ length: n }, junk).join("\n");

  const T_SALT = 1 + rngRange(M - 1);
  const salt = rngRange(M);

  const nS = Array.from({ length: 20 }, () => name());
  const [nS1, nS2, nS3, nS4, nS5, nS6, nS7, nS8, nS9, nS10,
         nS11, nS12, nS13, nS14, nS15, nS16, nS17, nS18, nS19, nS20] = nS as [
    string, string, string, string, string, string, string, string, string, string,
    string, string, string, string, string, string, string, string, string, string
  ];
  const names: string[] = [];
  const decl = (v: string, s: string) => names.push(`${v}=${encStr(s)}`);
  decl(nS1, "string"); decl(nS2, "byte"); decl(nS3, "char");
  decl(nS4, "loadstring"); decl(nS5, "load"); decl(nS6, "error");
  decl(nS7, "pcall"); decl(nS8, "type"); decl(nS9, "function");
  decl(nS10, pick(ERR_MSGS)); decl(nS11, "math"); decl(nS12, "floor");
  decl(nS13, "tostring"); decl(nS14, "select"); decl(nS15, "rawequal");
  decl(nS16, "table"); decl(nS17, "concat"); decl(nS18, "rep");
  decl(nS19, "table"); decl(nS20, "nil");

  const H = (dataHash * 3 + constHash * 5 + salt) % M;
  const keyStored = keyBytes.map((kb, i) => {
    const m = (H * (i + 1 + 13) + 40503) % M;
    return (kb + (Math.floor(m / 256) % 256)) % 256;
  });

  const branches: string[] = [
    [
      `if ${is(ST.names)} then`, junk(), ...names.map((n) => `  ${n}`),
      `  ${nSTR}=${nG}[${nS1}]`, `  ${nSB}=${nSTR}[${nS2}]`, `  ${nSC}=${nSTR}[${nS3}]`,
      `  ${nLS}=${nG}[${nS4}] or ${nG}[${nS5}]`, `  ${nER}=${nG}[${nS6}]`,
      `  ${nPC}=${nG}[${nS7}]`, `  ${nTY}=${nG}[${nS8}]`, `  ${nMSG}=${nS10}`,
      `  ${nMath}=${nG}[${nS11}]`, `  ${nFloor}=${nMath}[${nS12}]`,
      `  ${nTS}=${nG}[${nS13}]`, `  ${nSL}=${nG}[${nS14}]`, `  ${nRQ}=${nG}[${nS15}]`,
      `  ${nTBL}=${nG}[${nS16}]`, `  ${nTC}=${nTBL}[${nS17}]`, `  ${nSRP}=${nSTR}[${nS18}]`,
      `  ${go(ST.env)}`, `end`,
    ].join("\n"),
    [
      `if ${is(ST.env)} then`, junk(), `  ${nT}=${K_CHECKS}`,
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
      `  ${go(ST.hash)}`, `end`,
    ].join("\n"),
    [
      `if ${is(ST.hash)} then`, junk(),
      `  ${nH}=(${nDH}*3+${nHH}*5+${nT}*${T_SALT}+${salt})%${M}`,
      `  ${go(ST.key)}`, `end`,
    ].join("\n"),
    [
      `if ${is(ST.key)} then`, junk(), `  ${nKB}={}`,
      `  for _i=1,32 do`,
      `    local _m=(${nH}*(_i+13)+40503)%${M}`,
      `    ${nKB}[_i]=(${nKS}[_i]-(((_m-_m%256)/256)%256))%256`,
      `  end`,
      `  ${go(ST.ksa)}`, `end`,
    ].join("\n"),
    [
      `if ${is(ST.ksa)} then`, junk(), `  ${nBox}={}`,
      `  for _i=0,255 do ${nBox}[_i]=_i end`,
      `  local _j=0`,
      `  for _i=0,255 do`,
      `    _j=(_j+${nBox}[_i]+${nKB}[_i%32+1])%256`,
      `    ${nBox}[_i],${nBox}[_j]=${nBox}[_j],${nBox}[_i]`,
      `  end`,
      `  ${go(ST.dec)}`, `end`,
    ].join("\n"),
    [
      `if ${is(ST.dec)} then`, junk(),
      `  local _a,_b=0,0`,
      `  local _ls=(${nKB}[1]*16777216+${nKB}[2]*65536+${nKB}[3]*256+${nKB}[4])%${M}`,
      `  local _o={}`, `  local _hp=0`, `  local _hq=1`,
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
      `  ${nP}=table.concat(_o)`, `  ${nHP}=_hp`,
      `  if ${nHP}~=${plainHash} or _hq~=${plainHash2} then ${go(ST.fail)} else ${go(ST.load)} end`,
      `end`,
    ].join("\n"),
    [
      `if ${is(ST.load)} then`, junk(),
      `  ${nF}=${nLS}(${nP})`,
      `  if not ${nF} then ${go(ST.fail)} else ${go(ST.run)} end`,
      `end`,
    ].join("\n"),
    [`if ${is(ST.run)} then`, junk(), `  ${go(ST.done)}`, `end`].join("\n"),
    [`if ${is(ST.fail)} then`, `  ${nER}(${nMSG},0)`, `end`].join("\n"),
    ...Array.from({ length: 6 }, () => {
      const d = sid();
      return [
        `if ${is(d)} then`, junk(),
        `  for _i=1,#${nData} do ${nKB}[_i%32+1]=(${nKB}[_i%32+1]+${nSB}(${nData},_i))%256 end`,
        `  ${go(rngRange(2) ? ST.fail : d)}`,
        `end`,
      ].join("\n");
    }),
  ];

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
  const nPool = name(), nOrder = name(), nSB2 = name();

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
      nMSG, nTS, nSL, nRQ, nTBL, nTC, nSRP, nMath, nFloor, ...nS,
    ].join(",")}`,
  ].join("\n");

  const out = [
    junks(3), head, `${go(ST.names)}`, `while true do`,
    ...shuffle(branches),
    `  if ${is(ST.done)} then break end`,
    `end`,
    `return ${nF}(...)`,
  ];
  return out.join("\n");
}

// ── 5. combined entry ──────────────────────────────────────────────────────

export interface ObfuscateOpts {
  passes?: number;       // wrapOnce iterations (1..4), default 1
  flatten?: boolean;     // default true  — safe-bails on unflattenable source
  antiTamper?: boolean;  // default true  — prepended as `do <probes> end`
}

export function obfuscateLua(source: string, opts: ObfuscateOpts | number = {}): string {
  const o: ObfuscateOpts = typeof opts === "number" ? { passes: opts } : opts;
  const n = Math.max(1, Math.min(4, Math.floor(o.passes ?? 1)));

  let cur = source;

  // 1. Anti-tamper as a single `do...end` block — runs before user code and
  //    lives *inside* the RC4 envelope, so removing it requires breaking the
  //    wrapper first. Fails loud: `error("integrity check failed: …", 0)`.
  if (o.antiTamper !== false) {
    cur = buildAntiTamper({ preamble: true }) + "\n" + cur;
  }

  // 2. Statement-level CFF. Bails unchanged if it sees duplicate top-level
  //    locals, Luau-only syntax, `goto`, or any token mismatch — so the
  //    anti-tamper is preserved even when flattening itself is skipped.
  if (o.flatten !== false) {
    cur = flatten(cur);
  }

  // 3. RC4 + decoy + env-test wrapper, applied N times.
  for (let i = 0; i < n; i++) cur = wrapOnce(cur);

  return cur;
}

// ── 6. re-exports for callers who virtualize ahead of time ────────────────

export type { MiniOp, Const };
export { virtualize, buildAntiTamper, flatten };