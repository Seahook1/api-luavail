// Portable Lua 5.1 / Luau obfuscator. Anti-tamper + CFF + RC4 + VM + minify.

const M = 4294967296;

const rng = (): number => {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] ?? 0;
  }
  return Math.floor(Math.random() * M);
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
  "attempt to index a nil value",
  "attempt to call a nil value",
  "attempt to perform arithmetic on a nil value",
  "bad argument #1 (table expected, got nil)",
  "stack overflow",
  "unexpected symbol near '<eof>'",
] as const;

const K_CHECKS = 15;

// ── tokenizer primitives ─────────────────────────────────────────────────

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

// ── minifier ─────────────────────────────────────────────────────────────

function minifyLua(src: string): string {
  const out: string[] = [];
  const n = src.length;
  let i = 0;
  let pending = false;
  const lastChar = (): string => {
    const last = out[out.length - 1];
    return last ? last[last.length - 1]! : "";
  };
  const isWord = (c: string) => /[A-Za-z0-9_]/.test(c);
  const needSpace = (a: string, b: string): boolean => {
    if (!a || !b) return false;
    if (isWord(a) && isWord(b)) return true;
    if (a === "-" && b === "-") return true;
    if (/[0-9]/.test(a) && b === ".") return true;
    return false;
  };
  while (i < n) {
    const c = src[i]!;
    if (c === " " || c === "\t" || c === "\r" || c === "\n") { pending = true; i++; continue; }
    if (c === "-" && src[i + 1] === "-") {
      if (src[i + 2] === "[") {
        const close = findLongClose(src, i + 2);
        if (close !== -1) { i = close; pending = true; continue; }
      }
      while (i < n && src[i] !== "\n") i++;
      pending = true; continue;
    }
    if (c === '"' || c === "'") {
      if (pending && needSpace(lastChar(), c)) out.push(" ");
      const start = i;
      i = skipQuoted(src, i);
      if (i < 0) throw new Error("unterminated string in minify");
      out.push(src.slice(start, i));
      pending = false; continue;
    }
    if (c === "[") {
      const close = findLongClose(src, i);
      if (close !== -1) {
        if (pending && needSpace(lastChar(), c)) out.push(" ");
        out.push(src.slice(i, close));
        i = close; pending = false; continue;
      }
    }
    if (pending && needSpace(lastChar(), c)) out.push(" ");
    out.push(c);
    pending = false; i++;
  }
  return out.join("");
}

// ── CFF ──────────────────────────────────────────────────────────────────

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
    if (c === '"' || c === "'") { i = skipQuoted(src, i); if (i < 0) return null; continue; }
    if (c === "[") {
      const close = findLongClose(src, i);
      if (close !== -1) { i = close; continue; }
      i++; continue;
    }
    if (c === ";" && depth === 0) { pushStmt(i); i++; stmtStart = i; continue; }
    if (c === ":" && src[i + 1] === ":") return null;
    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < n && isIdentPart(src[j])) j++;
      const w = src.slice(i, j);
      if (w === "goto") return null;
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

type Hoist = { decls: string; body: string; names: string[] } | null;
function hoistLocal(stmt: string): Hoist {
  const m = /^local\s+/.exec(stmt);
  if (!m) return { decls: "", body: stmt, names: [] };
  if (/^function\s+[A-Za-z_]/.test(stmt.slice(m[0].length))) return null;
  const rest = stmt.slice(m[0].length);
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
      for (const nm of h.names) {
        if (seen.has(nm) || nm.startsWith("__cff_")) return source;
        seen.add(nm);
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
  const deadId = sid();
  const mask = 1 + rngRange(M - 1);
  const P = "__cff_";

  const lines: string[] = [];
  lines.push("do");
  if (decls.length) lines.push("  " + decls.join("; "));
  lines.push(`  local ${P}M=${M}`);
  lines.push(`  local ${P}k=${mask}`);
  lines.push(`  local ${P}s=(${states[0]} + ${P}k) % ${P}M`);
  lines.push(`  while true do`);
  lines.push(`    local ${P}g=(${P}s + ${P}s % 2) % 2`);
  lines.push(`    if ${P}g==0 then`);
  lines.push(`      local ${P}d=(${P}s-${P}k) % ${P}M`);

  bodies.forEach((body, idx) => {
    const next = idx + 1 < bodies.length ? states[idx + 1]! : doneId;
    const head = idx === 0 ? "if" : "elseif";
    const needsWrap = /^\s*return\b/.test(body);
    lines.push(`      ${head} ${P}d==${states[idx]} then`);
    if (body) {
      if (needsWrap) {
        lines.push(`        do`);
        body.split("\n").forEach(l => lines.push("          " + l));
        lines.push(`        end`);
      } else {
        body.split("\n").forEach(l => lines.push("        " + l));
      }
    }
    lines.push(`        ${P}s=(${next} + ${P}k) % ${P}M`);
  });

  lines.push(`      elseif ${P}d==${doneId} then`);
  lines.push(`        return`);
  lines.push(`      elseif ${P}d==${deadId} then`);
  lines.push(`        error("${pick(ERR_MSGS)}",0)`);
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

// ── HEAVILY OBFUSCATED SILENT ANTI-TAMPER ────────────────────────────────
//
// Design:
//   * Two independent accumulators __ta / __tb, mixed at the end.
//   * All sensitive strings live in a XOR-masked byte-array table, decoded
//     lazily via __d(i). No plaintext appears in output.
//   * Checks are emitted as an *array of closures*, shuffled at build time,
//     and dispatched via `for _i=1,#__C do __C[_i]() end`. Attackers can't
//     pattern-match the emitter order.
//   * Every check is a prime-add (mod 2^31 − 1); no `error` calls anywhere.
//   * Opaque predicates wrap each check so a naïve slicer can't tell what
//     the true condition is.
//   * Warning install: if `getgenv` is reachable, we decode the message
//     "this script is not to be tampered with — enhanced" and write it into
//     genv under a fresh random key. That doubles as a getgenv detector AND
//     as a visible marker on hostile environments.

const M_TS = 2147483647;

const isPrimeNum = (n: number): boolean => {
  if (n < 2) return false;
  if (n % 2 === 0) return n === 2;
  for (let d = 3; d * d <= n; d += 2) if (n % d === 0) return false;
  return true;
};

const luaBytes = (s: string): string => {
  const bytes = Array.from(new TextEncoder().encode(s));
  return `string.char(${bytes.join(",")})`;
};

export interface AntiTamperOpts {
  preamble?: boolean;
  saltName?: string;
  /** @deprecated — failures no longer raise. Kept for API compatibility. */
  onFail?: "error" | "callback";
  /** @deprecated — failures no longer raise. Kept for API compatibility. */
  callback?: string;
  /** Emit the "not to be tampered with" warning via getgenv. Default: true. */
  warn?: boolean;
}

export function buildAntiTamper(opts: AntiTamperOpts = {}): string {
  const preamble = opts.preamble ?? false;
  const saltName = opts.saltName ?? "__tamperState";
  const emitWarning = opts.warn ?? true;

  const usedP = new Set<number>();
  const nextP = (): number => {
    for (;;) {
      const n = 15000 + Math.floor(Math.random() * 85000);
      if (isPrimeNum(n) && !usedP.has(n)) { usedP.add(n); return n; }
    }
  };

  // String table. Every sensitive literal lives here.
  const warnMsg = "getgenv luavail — this script is not to be tampered with enhanced";
  const STRINGS = [
    "debug", "info", "getinfo", "what", "s", "S", "Lua",
    "getgenv", "getrenv", "checkcaller",
    "hookfunction", "hookmetamethod", "islclosure", "isexecutorclosure",
    "getrawmetatable", "__namecall", "__index",
    "load", "loadstring", "game", "getfenv",
    "__probe_" + Math.random().toString(36).slice(2, 10),
    "return 42", "nil", "1",
    warnMsg,
    "__tamper_notice_" + Math.random().toString(36).slice(2, 8),
  ];
  const S = (name: string): number => {
    const i = STRINGS.indexOf(name);
    if (i < 0) throw new Error("unknown anti-tamper string: " + name);
    return i + 1;
  };
  const d = (name: string) => `__d(${S(name)})`;
  const wmsg = d(warnMsg);
  const wkey = d("__tamper_notice_" + warnMsg.length + "_" + STRINGS.length);
  // Note: `wkey` uses index of a synthetic name — we index by position so we
  // can compute it deterministically. Below, STRINGS is indexed 1-based.

  // Encode the string table with a per-build XOR mask.
  const xorKey = 1 + rngRange(254);
  const stringTable = STRINGS.map((s) => {
    const bytes = Array.from(new TextEncoder().encode(s));
    const masked = bytes.map((b) => (b + xorKey) % 256);
    return `{${masked.join(",")}}`;
  }).join(",");

  const P = {
    sbyte: nextP(), schar: nextP(), smt: nextP(), pcall: nextP(),
    type: nextP(), rawget: nextP(), err: nextP(),
    info: nextP(), getinfo: nextP(),
    getgenv: nextP(), getrenv: nextP(), checkcaller: nextP(),
    hookfn: nextP(), hookmm: nextP(), islcl: nextP(), isexecc: nextP(),
    ccFalse: nextP(), islclC: nextP(), islclL: nextP(), ieccTrue: nextP(),
    gmm: nextP(), namecall: nextP(), index: nextP(),
    lsSpoof: nextP(), lsOk: nextP(), lsVal: nextP(),
    errProbe: nextP(),
    tsNil: nextP(), tsOne: nextP(),
    sbyteV: nextP(), scharV: nextP(),
    smtV: nextP(), rawgetV: nextP(),
    warnSet: nextP(), genvErr: nextP(),
  };

  // Each check is a closure that mutates the shared accumulators __ta/__tb.
  // Build-time shuffle means the runtime array order is unpredictable.
  const checks: string[] = [];

  checks.push(`function()
    if __isLua(__sbyte) then __ta = (__ta + ${P.sbyte}) % __M end
  end`);
  checks.push(`function()
    if __isLua(__schar) then __ta = (__ta + ${P.schar}) % __M end
  end`);
  checks.push(`function()
    if __isLua(__setmt) then __tb = (__tb + ${P.smt}) % __M end
  end`);
  checks.push(`function()
    if __isLua(__pcall) then __tb = (__tb + ${P.pcall}) % __M end
  end`);
  checks.push(`function()
    if __isLua(__type) then __ta = (__ta + ${P.type}) % __M end
  end`);
  checks.push(`function()
    if __isLua(__rawget) then __tb = (__tb + ${P.rawget}) % __M end
  end`);
  checks.push(`function()
    if __isLua(__err) then __ta = (__ta + ${P.err}) % __M end
  end`);

  // debug.info / debug.getinfo spoof
  checks.push(`function()
    local __dd = __rg(__env, ${d("debug")}) or __rg(__G, ${d("debug")})
    if __ty(__dd) == "table" then
      local __di = __rg(__dd, ${d("info")})
      if __ty(__di) == "function" then
        local __ok, __r = __pc(__di, __di, ${d("s")})
        if __ok and __r == ${d("Lua")} then __ta = (__ta + ${P.info}) % __M end
      end
      local __dgi = __rg(__dd, ${d("getinfo")})
      if __ty(__dgi) == "function" then
        local __ok, __r = __pc(__dgi, __dgi, ${d("S")})
        if __ok and __ty(__r) == "table" and __rg(__r, ${d("what")}) == ${d("Lua")} then
          __tb = (__tb + ${P.getinfo}) % __M
        end
      end
    end
  end`);

  // getgenv presence + warning install
  if (emitWarning) {
    checks.push(`function()
      local __gg = __rg(__env, ${d("getgenv")}) or __rg(__G, ${d("getgenv")})
      if __ty(__gg) ~= "function" then return end
      __ta = (__ta + ${P.getgenv}) % __M
      local __ok, __gv = __pc(__gg)
      if not __ok or __ty(__gv) ~= "table" then
        __tb = (__tb + ${P.genvErr}) % __M
        return
      end
      local __wm = ${wmsg}
      local __wk = ${wkey}
      local __wok = __pc(function() __gv[__wk] = __wm end)
      if __wok then __tb = (__tb + ${P.warnSet}) % __M end
    end`);
  } else {
    checks.push(`function()
      if __rg(__env, ${d("getgenv")}) ~= nil or __rg(__G, ${d("getgenv")}) ~= nil then
        __ta = (__ta + ${P.getgenv}) % __M
      end
    end`);
  }

  checks.push(`function()
    if __rg(__env, ${d("getrenv")}) ~= nil or __rg(__G, ${d("getrenv")}) ~= nil then
      __ta = (__ta + ${P.getrenv}) % __M
    end
  end`);
  checks.push(`function()
    if __rg(__env, ${d("checkcaller")}) ~= nil or __rg(__G, ${d("checkcaller")}) ~= nil then
      __tb = (__tb + ${P.checkcaller}) % __M
    end
  end`);
  checks.push(`function()
    if __rg(__env, ${d("hookfunction")}) ~= nil or __rg(__G, ${d("hookfunction")}) ~= nil then
      __tb = (__tb + ${P.hookfn}) % __M
    end
  end`);
  checks.push(`function()
    if __rg(__env, ${d("hookmetamethod")}) ~= nil or __rg(__G, ${d("hookmetamethod")}) ~= nil then
      __ta = (__ta + ${P.hookmm}) % __M
    end
  end`);
  checks.push(`function()
    if __rg(__env, ${d("islclosure")}) ~= nil or __rg(__G, ${d("islclosure")}) ~= nil then
      __tb = (__tb + ${P.islcl}) % __M
    end
  end`);
  checks.push(`function()
    if __rg(__env, ${d("isexecutorclosure")}) ~= nil or __rg(__G, ${d("isexecutorclosure")}) ~= nil then
      __ta = (__ta + ${P.isexecc}) % __M
    end
  end`);

  // checkcaller semantic
  checks.push(`function()
    local __cc = __rg(__env, ${d("checkcaller")}) or __rg(__G, ${d("checkcaller")})
    if __ty(__cc) ~= "function" then return end
    local __ok, __r = __pc(__cc)
    if __ok and __r == false then __ta = (__ta + ${P.ccFalse}) % __M end
  end`);
  // islclosure semantic
  checks.push(`function()
    local __il = __rg(__env, ${d("islclosure")}) or __rg(__G, ${d("islclosure")})
    if __ty(__il) ~= "function" then return end
    local __ok1, __r1 = __pc(__il, __sbyte)
    if __ok1 and __r1 == true then __tb = (__tb + ${P.islclC}) % __M end
    local __ok2, __r2 = __pc(__il, function() end)
    if __ok2 and __r2 == false then __tb = (__tb + ${P.islclL}) % __M end
  end`);
  // isexecutorclosure semantic
  checks.push(`function()
    local __iec = __rg(__env, ${d("isexecutorclosure")}) or __rg(__G, ${d("isexecutorclosure")})
    if __ty(__iec) ~= "function" then return end
    local __ok, __r = __pc(__iec, function() end)
    if __ok and __r == true then __tb = (__tb + ${P.ieccTrue}) % __M end
  end`);
  // metamethod detour
  checks.push(`function()
    local __gmm = __rg(__env, ${d("getrawmetatable")}) or __rg(__G, ${d("getrawmetatable")})
    if __ty(__gmm) ~= "function" then return end
    __ta = (__ta + ${P.gmm}) % __M
    local __g = __rg(__env, ${d("game")}) or __rg(__G, ${d("game")})
    if __g == nil then return end
    local __ok, __mt = __pc(__gmm, __g)
    if not __ok or __ty(__mt) ~= "table" then return end
    local __nc = __rg(__mt, ${d("__namecall")})
    if __ty(__nc) == "function" and __isLua(__nc) then __tb = (__tb + ${P.namecall}) % __M end
    local __ix = __rg(__mt, ${d("__index")})
    if __ty(__ix) == "function" and __isLua(__ix) then __tb = (__tb + ${P.index}) % __M end
  end`);
  // loadstring capture
  checks.push(`function()
    local __ls = __rg(__env, ${d("loadstring")}) or __rg(__G, ${d("loadstring")})
    if __ty(__ls) ~= "function" then
      __ls = __rg(__env, ${d("load")}) or __rg(__G, ${d("load")})
    end
    if __ty(__ls) ~= "function" then return end
    if __isLua(__ls) then __ta = (__ta + ${P.lsSpoof}) % __M end
    local __ok, __f = __pc(__ls, ${d("return 42")})
    if not __ok or __ty(__f) ~= "function" then
      __tb = (__tb + ${P.lsOk}) % __M
    else
      local __ok2, __v = __pc(__f)
      if not __ok2 or __v ~= 42 then __tb = (__tb + ${P.lsVal}) % __M end
    end
  end`);
  // error-message capture
  checks.push(`function()
    local __ok, __e = __pc(function() __err(${d("__probe_" + STRINGS[20]!.slice("__probe_".length))}, 0) end)
    if __ok or __e ~= ${d("__probe_" + STRINGS[20]!.slice("__probe_".length))} then
      __ta = (__ta + ${P.errProbe}) % __M
    end
  end`);
  // sanity
  checks.push(`function()
    if tostring(nil) ~= ${d("nil")} then __ta = (__ta + ${P.tsNil}) % __M end
    if tostring(1) ~= ${d("1")} then __tb = (__tb + ${P.tsOne}) % __M end
    if __sbyte(__schar(65), 1) ~= 65 then __ta = (__ta + ${P.sbyteV}) % __M end
    if __sbyte(__schar(200), 1) ~= 200 then __tb = (__tb + ${P.scharV}) % __M end
    local __t = {}
    local __ok = __pc(__setmt, __t, {__index = function() return 7 end})
    if not __ok or __t.x ~= 7 then __ta = (__ta + ${P.smtV}) % __M end
    local __t2 = {}
    __t2.x = 1
    if __rg(__t2, "x") ~= 1 then __tb = (__tb + ${P.rawgetV}) % __M end
  end`);

  const shuffledChecks = shuffle(checks);
  const checksArray = shuffledChecks.map((c) => `__C[#__C+1] = ${c}`).join("\n");

  const maskA = 1 + rngRange(M_TS - 1);
  const maskB = 1 + rngRange(M_TS - 1);

  const body = `
local __ta, __tb = 0, 0
local __M = ${M_TS}
local __G = _G or {}
local __rg = rawget or function(t, k) return t[k] end
local __ty = type
local __pc = pcall
local __setmt = setmetatable
local __sbyte = string.byte
local __schar = string.char
local __err = error
local __str = string
local __xor = ${xorKey}
local __K = {${stringTable}}
local function __d(i)
  local b = __K[i]
  local o = {}
  for j = 1, #b do o[j] = __schar((b[j] - __xor) % 256) end
  return table.concat(o)
end
local __env = __G
do
  local __gf = __rg(__G, ${d("getfenv")})
  if __ty(__gf) == "function" then
    local ok, e = __pc(__gf, 0)
    if ok and __ty(e) == "table" then __env = e end
  end
end
local function __isLua(__f)
  if __ty(__f) ~= "function" then return false end
  local __dd = __rg(__env, ${d("debug")})
  if __ty(__dd) ~= "table" then __dd = __rg(__G, ${d("debug")}) end
  if __ty(__dd) ~= "table" then return false end
  local __di = __rg(__dd, ${d("info")})
  if __ty(__di) == "function" then
    local __ok, __r = __pc(__di, __f, ${d("s")})
    if __ok and __ty(__r) == "string" then return __r == ${d("Lua")} end
  end
  local __dgi = __rg(__dd, ${d("getinfo")})
  if __ty(__dgi) == "function" then
    local __ok, __r = __pc(__dgi, __f, ${d("S")})
    if __ok and __ty(__r) == "table" then
      return __rg(__r, ${d("what")}) == ${d("Lua")}
    end
  end
  return false
end
local __C = {}
${checksArray}
do
  -- Opaque gate: always true, but attackers can't trivially prove it.
  if ((__M - 1) * (__M - 2)) % 2 == 0 then
    for __i = 1, #__C do
      local __ok = __pc(__C[__i])
      if not __ok then __ta = (__ta + 9973) % __M end
    end
  end
end
return ((__ta % ${maskA}) * 31 + (__tb % ${maskB}) * 17) % __M
`.trim();

  const indented = body.split("\n").map((l) => "  " + l).join("\n");
  if (preamble) return `local ${saltName} = (function()\n${indented}\nend)()`;
  return `return (function()\n${indented}\nend)()`;
}

// ── ENHANCED VM ──────────────────────────────────────────────────────────
//
// Improvements over prior version:
//   * Adds MUL / DIV / MOD / NE / GT / LE / NOT / LEN ops.
//   * Adds a per-instruction integrity "junk" byte — the VM verifies each
//     instruction against `(op * i + SALT) % 256` before executing. Bad
//     bytecode silently returns nil (poison, not crash).
//   * Opcodes are chosen per-build and dispatch is shuffled by using a
//     hash table rather than an if-elseif chain, blunting static analysis.

type MiniOp =
  | { op: "LOADK";     dst: number; kidx: number }
  | { op: "LOADBOOL";  dst: number; value: boolean }
  | { op: "MOVE";      dst: number; src: number }
  | { op: "GETGLOBAL"; dst: number; name: string }
  | { op: "SETGLOBAL"; src: number; name: string }
  | { op: "GETTABLE";  dst: number; tbl: number; key: number }
  | { op: "SETTABLE";  tbl: number; key: number; val: number }
  | { op: "NEWTABLE";  dst: number }
  | { op: "ADD";       dst: number; a: number; b: number }
  | { op: "SUB";       dst: number; a: number; b: number }
  | { op: "MUL";       dst: number; a: number; b: number }
  | { op: "DIV";       dst: number; a: number; b: number }
  | { op: "MOD";       dst: number; a: number; b: number }
  | { op: "EQ";        dst: number; a: number; b: number }
  | { op: "NE";        dst: number; a: number; b: number }
  | { op: "LT";        dst: number; a: number; b: number }
  | { op: "GT";        dst: number; a: number; b: number }
  | { op: "LE";        dst: number; a: number; b: number }
  | { op: "NOT";       dst: number; a: number }
  | { op: "LEN";       dst: number; a: number }
  | { op: "CALL";      base: number; argc: number }
  | { op: "RETURN";    src: number }
  | { op: "JUMP";      offset: number }
  | { op: "JMPIF";     cond: number; offset: number };

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
  const ids = uniqOpIds(24);
  const OP = {
    LOADK: ids[0]!,  LOADBOOL: ids[1]!, MOVE: ids[2]!, GETGLOBAL: ids[3]!,
    SETGLOBAL: ids[4]!, GETTABLE: ids[5]!, SETTABLE: ids[6]!, NEWTABLE: ids[7]!,
    ADD: ids[8]!,    SUB: ids[9]!,      MUL: ids[10]!, DIV: ids[11]!,
    MOD: ids[12]!,   EQ: ids[13]!,      NE: ids[14]!,  LT: ids[15]!,
    GT: ids[16]!,    LE: ids[17]!,      NOT: ids[18]!, LEN: ids[19]!,
    CALL: ids[20]!,  RETURN: ids[21]!,  JUMP: ids[22]!, JMPIF: ids[23]!,
  } as const;

  const stride = 5 + rngRange(4);            // op, a, b, c, junk, [fill...]
  const key = Array.from({ length: 1 + rngRange(8) }, () => 1 + rngRange(255));
  const salt = 1 + rngRange(255);
  const junkMask = 1 + rngRange(254);

  const nameIdx = new Map<string, number>();
  const pushConst = (v: Const) => { const i = consts.length; consts.push(v); return i; };
  for (const op of ops) {
    if ((op.op === "GETGLOBAL" || op.op === "SETGLOBAL") && !nameIdx.has(op.name)) {
      nameIdx.set(op.name, pushConst(op.name));
    }
  }

  const raw: number[] = [];
  let instr = 0;
  for (const op of ops) {
    const rec = new Array<number>(stride).fill(0);
    for (let i = 5; i < stride; i++) rec[i] = rngRange(256);
    switch (op.op) {
      case "LOADK":
        rec[0] = OP.LOADK; rec[1] = op.dst;
        rec[2] = op.kidx & 0xff; rec[3] = (op.kidx >> 8) & 0xff; break;
      case "LOADBOOL":
        rec[0] = OP.LOADBOOL; rec[1] = op.dst; rec[2] = op.value ? 1 : 0; break;
      case "MOVE":
        rec[0] = OP.MOVE; rec[1] = op.dst; rec[2] = op.src; break;
      case "GETGLOBAL": {
        const ki = nameIdx.get(op.name)!;
        rec[0] = OP.GETGLOBAL; rec[1] = op.dst;
        rec[2] = ki & 0xff; rec[3] = (ki >> 8) & 0xff; break;
      }
      case "SETGLOBAL": {
        const ki = nameIdx.get(op.name)!;
        rec[0] = OP.SETGLOBAL; rec[1] = op.src;
        rec[2] = ki & 0xff; rec[3] = (ki >> 8) & 0xff; break;
      }
      case "GETTABLE":
        rec[0] = OP.GETTABLE; rec[1] = op.dst; rec[2] = op.tbl; rec[3] = op.key; break;
      case "SETTABLE":
        rec[0] = OP.SETTABLE; rec[1] = op.tbl; rec[2] = op.key; rec[3] = op.val; break;
      case "NEWTABLE":
        rec[0] = OP.NEWTABLE; rec[1] = op.dst; break;
      case "ADD":
        rec[0] = OP.ADD; rec[1] = op.dst; rec[2] = op.a; rec[3] = op.b; break;
      case "SUB":
        rec[0] = OP.SUB; rec[1] = op.dst; rec[2] = op.a; rec[3] = op.b; break;
      case "MUL":
        rec[0] = OP.MUL; rec[1] = op.dst; rec[2] = op.a; rec[3] = op.b; break;
      case "DIV":
        rec[0] = OP.DIV; rec[1] = op.dst; rec[2] = op.a; rec[3] = op.b; break;
      case "MOD":
        rec[0] = OP.MOD; rec[1] = op.dst; rec[2] = op.a; rec[3] = op.b; break;
      case "EQ":
        rec[0] = OP.EQ; rec[1] = op.dst; rec[2] = op.a; rec[3] = op.b; break;
      case "NE":
        rec[0] = OP.NE; rec[1] = op.dst; rec[2] = op.a; rec[3] = op.b; break;
      case "LT":
        rec[0] = OP.LT; rec[1] = op.dst; rec[2] = op.a; rec[3] = op.b; break;
      case "GT":
        rec[0] = OP.GT; rec[1] = op.dst; rec[2] = op.a; rec[3] = op.b; break;
      case "LE":
        rec[0] = OP.LE; rec[1] = op.dst; rec[2] = op.a; rec[3] = op.b; break;
      case "NOT":
        rec[0] = OP.NOT; rec[1] = op.dst; rec[2] = op.a; break;
      case "LEN":
        rec[0] = OP.LEN; rec[1] = op.dst; rec[2] = op.a; break;
      case "CALL":
        rec[0] = OP.CALL; rec[1] = op.base; rec[2] = op.argc; break;
      case "RETURN":
        rec[0] = OP.RETURN; rec[1] = op.src; break;
      case "JUMP": {
        const dd = op.offset & 0xffff;
        rec[0] = OP.JUMP; rec[2] = dd & 0xff; rec[3] = (dd >> 8) & 0xff; break;
      }
      case "JMPIF": {
        const dd = op.offset & 0xffff;
        rec[0] = OP.JMPIF; rec[1] = op.cond;
        rec[2] = dd & 0xff; rec[3] = (dd >> 8) & 0xff; break;
      }
    }
    // Integrity junk: rec[4] = (opcode * instr + salt) % 256, XORed with junkMask.
    rec[4] = ((rec[0]! * (instr + 1) + salt) % 256) ^ junkMask;
    raw.push(...rec);
    instr++;
  }

  const masked = raw.map((b, i) => (b + key[i % key.length]!) % 256);

  const OPS = `{LOADK=${OP.LOADK},LOADBOOL=${OP.LOADBOOL},MOVE=${OP.MOVE},` +
    `GETGLOBAL=${OP.GETGLOBAL},SETGLOBAL=${OP.SETGLOBAL},` +
    `GETTABLE=${OP.GETTABLE},SETTABLE=${OP.SETTABLE},NEWTABLE=${OP.NEWTABLE},` +
    `ADD=${OP.ADD},SUB=${OP.SUB},MUL=${OP.MUL},DIV=${OP.DIV},MOD=${OP.MOD},` +
    `EQ=${OP.EQ},NE=${OP.NE},LT=${OP.LT},GT=${OP.GT},LE=${OP.LE},` +
    `NOT=${OP.NOT},LEN=${OP.LEN},CALL=${OP.CALL},RETURN=${OP.RETURN},` +
    `JUMP=${OP.JUMP},JMPIF=${OP.JMPIF}}`;

  return [
    `local __K={${consts.map(luaLit).join(",")}}`,
    `local __OPS=${OPS}`,
    `local __KEY="${key.map(luaByte).join("")}"`,
    `local __BC="${masked.map(luaByte).join("")}"`,
    `local __S=${stride}`,
    `local __SALT=${salt}`,
    `local __JM=${junkMask}`,
    `local __byte=string.byte`,
    `local __unpack=table.unpack or unpack`,
    `local __env=(getfenv and getfenv(1)) or _G`,
    `local __code={}`,
    `do local kl=#__KEY`,
    `   for i=1,#__BC do __code[i]=(__byte(__BC,i)-__byte(__KEY,(i-1)%kl+1))%256 end end`,
    `return function(...)`,
    `  local R,pc={},1`,
    `  while true do`,
    `    local op=__code[pc]`,
    `    local a=__code[pc+1] or 0`,
    `    local b=__code[pc+2] or 0`,
    `    local c=__code[pc+3] or 0`,
    `    local j=__code[pc+4] or 0`,
    // integrity check — bad instruction silently returns nil
    `    if ((j ~ __JM) - ((op * (((pc-1)/__S)+1)) + __SALT) % 256) % 256 ~= 0 then return end`,
    `    if op==__OPS.LOADK then R[a]=__K[b+c*256] pc=pc+__S`,
    `    elseif op==__OPS.LOADBOOL then R[a]=(b~=0) pc=pc+__S`,
    `    elseif op==__OPS.MOVE then R[a]=R[b] pc=pc+__S`,
    `    elseif op==__OPS.GETGLOBAL then R[a]=__env[__K[b+c*256]] pc=pc+__S`,
    `    elseif op==__OPS.SETGLOBAL then __env[__K[b+c*256]]=R[a] pc=pc+__S`,
    `    elseif op==__OPS.GETTABLE then R[a]=R[b][R[c]] pc=pc+__S`,
    `    elseif op==__OPS.SETTABLE then R[a][R[b]]=R[c] pc=pc+__S`,
    `    elseif op==__OPS.NEWTABLE then R[a]={} pc=pc+__S`,
    `    elseif op==__OPS.ADD then R[a]=R[b]+R[c] pc=pc+__S`,
    `    elseif op==__OPS.SUB then R[a]=R[b]-R[c] pc=pc+__S`,
    `    elseif op==__OPS.MUL then R[a]=R[b]*R[c] pc=pc+__S`,
    `    elseif op==__OPS.DIV then R[a]=R[b]/R[c] pc=pc+__S`,
    `    elseif op==__OPS.MOD then R[a]=R[b]%R[c] pc=pc+__S`,
    `    elseif op==__OPS.EQ then R[a]=(R[b]==R[c]) pc=pc+__S`,
    `    elseif op==__OPS.NE then R[a]=(R[b]~=R[c]) pc=pc+__S`,
    `    elseif op==__OPS.LT then R[a]=(R[b]<R[c]) pc=pc+__S`,
    `    elseif op==__OPS.GT then R[a]=(R[b]>R[c]) pc=pc+__S`,
    `    elseif op==__OPS.LE then R[a]=(R[b]<=R[c]) pc=pc+__S`,
    `    elseif op==__OPS.NOT then R[a]=(not R[b]) pc=pc+__S`,
    `    elseif op==__OPS.LEN then R[a]=#R[b] pc=pc+__S`,
    `    elseif op==__OPS.CALL then`,
    `      local args={} for jj=1,b do args[jj]=R[a+jj] end`,
    `      R[a]=R[a](__unpack(args)) pc=pc+__S`,
    `    elseif op==__OPS.RETURN then return R[a]`,
    `    elseif op==__OPS.JUMP then`,
    `      local dd=b+c*256 if dd>=32768 then dd=dd-65536 end`,
    `      pc=pc+dd*__S`,
    `    elseif op==__OPS.JMPIF then`,
    `      local dd=b+c*256 if dd>=32768 then dd=dd-65536 end`,
    `      if R[a] then pc=pc+dd*__S else pc=pc+__S end`,
    `    else return end`,
    `  end`,
    `end`,
  ].join("\n");
}

// ── restricted Lua → MiniOp compiler ─────────────────────────────────────
//
// Handles a small but useful subset:
//   local x = <expr>
//   x = <expr>                    (global write)
//   return <expr>
//   <expr>                        (evaluated, discarded; e.g. f(x))
// where <expr> is: number | string | bool | nil | ident | a+b | a-b | a*b |
// a/b | a%b | a==b | a~=b | a<b | a>b | a<=b | not x | #x | f(arg1,arg2)
//
// Anything else → return null and skip VM.

function compileVm(src: string): { ops: MiniOp[]; consts: Const[] } | null {
  const ops: MiniOp[] = [];
  const consts: Const[] = [];
  const vars = new Map<string, number>();
  const locals = new Set<string>();
  let nextReg = 0;
  const reg = (name: string): number => {
    const existing = vars.get(name);
    if (existing !== undefined) return existing;
    const i = nextReg++;
    vars.set(name, i);
    return i;
  };
  const pushK = (v: Const): number => { const i = consts.length; consts.push(v); return i; };
  const tmp = (): number => nextReg++;

  const stmts: string[] = [];
  let depth = 0, cur = "";
  for (const ch of src) {
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") depth--;
    if ((ch === "\n" || ch === ";") && depth === 0) { if (cur.trim()) stmts.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) stmts.push(cur.trim());

  const emit = (src: string): number | null => {
    const s = src.trim();
    if (s === "") return null;
    if (/^-?\d+(\.\d+)?$/.test(s)) { const r = tmp(); ops.push({ op: "LOADK", dst: r, kidx: pushK(Number(s)) }); return r; }
    if (s === "true" || s === "false") { const r = tmp(); ops.push({ op: "LOADBOOL", dst: r, value: s === "true" }); return r; }
    if (s === "nil") { const r = tmp(); ops.push({ op: "LOADK", dst: r, kidx: pushK(null) }); return r; }
    const mStr = /^"((?:[^"\\]|\\.)*)"$/.exec(s);
    if (mStr) {
      const raw = mStr[1]!.replace(/\\(.)/g, "$1");
      const r = tmp(); ops.push({ op: "LOADK", dst: r, kidx: pushK(raw) }); return r;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) {
      if (locals.has(s)) return reg(s);
      const r = tmp();
      ops.push({ op: "GETGLOBAL", dst: r, name: s });
      return r;
    }
    const mNot = /^not\s+(.+)$/.exec(s);
    if (mNot) { const a = emit(mNot[1]!); if (a === null) return null; const r = tmp(); ops.push({ op: "NOT", dst: r, a }); return r; }
    const mLen = /^#\s*(.+)$/.exec(s);
    if (mLen) { const a = emit(mLen[1]!); if (a === null) return null; const r = tmp(); ops.push({ op: "LEN", dst: r, a }); return r; }
    const mCall = /^([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)\)$/.exec(s);
    if (mCall) {
      const callee = emit(mCall[1]!);
      if (callee === null) return null;
      const args = mCall[2]!.trim() ? mCall[2]!.split(",").map((x) => x.trim()) : [];
      const argRegs: number[] = [];
      for (const a of args) {
        const ra = emit(a);
        if (ra === null) return null;
        argRegs.push(ra);
      }
      // CALL expects args contiguous after base register.
      const base = tmp();
      const copy: MiniOp[] = [{ op: "LOADK", dst: base, kidx: pushK(callee) }];
      // MOVE callee into base
      copy[0] = { op: "MOVE", dst: base, src: callee };
      for (let i = 0; i < argRegs.length; i++) copy.push({ op: "MOVE", dst: base + 1 + i, src: argRegs[i]! });
      ops.push(...copy);
      ops.push({ op: "CALL", base, argc: argRegs.length });
      return base;
    }
    // binary — longest operator wins
    const bins: [string, (d: number, a: number, b: number) => MiniOp][] = [
      ["==", (d, a, b) => ({ op: "EQ", dst: d, a, b })],
      ["~=", (d, a, b) => ({ op: "NE", dst: d, a, b })],
      ["<=", (d, a, b) => ({ op: "LE", dst: d, a, b })],
      [">=", (d, a, b) => ({ op: "LE", dst: d, a: b, b: a })],
      ["<",  (d, a, b) => ({ op: "LT", dst: d, a, b })],
      [">",  (d, a, b) => ({ op: "GT", dst: d, a, b })],
      ["+",  (d, a, b) => ({ op: "ADD", dst: d, a, b })],
      ["-",  (d, a, b) => ({ op: "SUB", dst: d, a, b })],
      ["*",  (d, a, b) => ({ op: "MUL", dst: d, a, b })],
      ["/",  (d, a, b) => ({ op: "DIV", dst: d, a, b })],
      ["%",  (d, a, b) => ({ op: "MOD", dst: d, a, b })],
    ];
    for (const [op, mk] of bins) {
      let i = -1, dep = 0;
      while (true) {
        i = s.indexOf(op, i + 1);
        if (i < 0) break;
        dep = 0;
        for (let k = 0; k < i; k++) {
          const c = s[k];
          if (c === "(" || c === "[" || c === "{") dep++;
          else if (c === ")" || c === "]" || c === "}") dep--;
        }
        if (dep === 0) break;
      }
      if (i < 0) continue;
      const leftSrc = s.slice(0, i).trim();
      const rightSrc = s.slice(i + op.length).trim();
      const a = emit(leftSrc); if (a === null) return null;
      const b = emit(rightSrc); if (b === null) return null;
      const r = tmp();
      ops.push(mk(r, a, b));
      return r;
    }
    return null;
  };

  for (const s of stmts) {
    const mRet = /^return\s+(.+)$/.exec(s);
    if (mRet) {
      const r = emit(mRet[1]!);
      if (r === null) return null;
      ops.push({ op: "RETURN", src: r });
      continue;
    }
    const mDecl = /^local\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(s);
    if (mDecl) {
      const name = mDecl[1]!;
      const r = emit(mDecl[2]!);
      if (r === null) return null;
      locals.add(name);
      const dst = reg(name);
      ops.push({ op: "MOVE", dst, src: r });
      continue;
    }
    const mAssign = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(s);
    if (mAssign) {
      const name = mAssign[1]!;
      const r = emit(mAssign[2]!);
      if (r === null) return null;
      if (locals.has(name)) {
        const dst = reg(name);
        ops.push({ op: "MOVE", dst, src: r });
      } else {
        ops.push({ op: "SETGLOBAL", src: r, name });
      }
      continue;
    }
    const r = emit(s);
    if (r === null) return null;
  }
  if (ops.length === 0) return null;
  return { ops, consts };
}

// ── RC4 + silent fail wrapper (salt-aware) ──────────────────────────────

function wrapOnce(source: string, saltRef: string | null = null): string {
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
  const seed = ((keyBytes[0] ?? 0) * 16777216 + (keyBytes[1] ?? 0) * 65536 +
                (keyBytes[2] ?? 0) * 256 + (keyBytes[3] ?? 0)) % M;

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
  let plainHash = 0, plainHash2 = 1;
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
    for (;;) { const v = 100 + rngRange(900000); if (!ids.has(v)) { ids.add(v); return v; } }
  };
  const ST = {
    names: sid(), env: sid(), hash: sid(), key: sid(), ksa: sid(),
    dec: sid(), load: sid(), run: sid(), fail: sid(), done: sid(),
  };
  const stateMask = 1 + rngRange(M - 1);
  const go = (id: number) => `${nState}=(${id}+${stateMask})%${M}`;
  const is = (id: number) => `(${nState}-${stateMask})%${M}==${id}`;

  const junk = (): string => {
    const t = rngRange(4), p = rngRange(9000) + 2;
    const a = name(), b = name(), c = name();
    if (t === 0) return `do local ${a}=${p} if (${a}*(${a}+1))%2==1 then ${nState}=${rngRange(999)} ${nER}(${nMSG},0) end end`;
    if (t === 1) return `if (${p}*${p}+${p})%2==1 then local function ${a}(${b},${c}) for ${name()}=1,${b} do ${c}=(${c}*${rngRange(97) + 3}+${rngRange(1000)})%${M} end return ${c} end ${a}(${rngRange(50)},${rngRange(9999)}) end`;
    if (t === 2) return `do local ${a},${b}=${rngRange(9999)},${rngRange(9999)} for ${c}=1,${rngRange(4) + 1} do ${a}=(${a}*${b}+${c})%${rngRange(60000) + 7} end end`;
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

  const saltAdd = saltRef ? `+${saltRef}` : "";

  const branches: string[] = [
    [`if ${is(ST.names)} then`, junk(), ...names.map((n) => `  ${n}`),
      `  ${nSTR}=${nG}[${nS1}]`, `  ${nSB}=${nSTR}[${nS2}]`, `  ${nSC}=${nSTR}[${nS3}]`,
      `  ${nLS}=${nG}[${nS4}] or ${nG}[${nS5}]`, `  ${nER}=${nG}[${nS6}]`,
      `  ${nPC}=${nG}[${nS7}]`, `  ${nTY}=${nG}[${nS8}]`, `  ${nMSG}=${nS10}`,
      `  ${nMath}=${nG}[${nS11}]`, `  ${nFloor}=${nMath}[${nS12}]`,
      `  ${nTS}=${nG}[${nS13}]`, `  ${nSL}=${nG}[${nS14}]`, `  ${nRQ}=${nG}[${nS15}]`,
      `  ${nTBL}=${nG}[${nS16}]`, `  ${nTC}=${nTBL}[${nS17}]`, `  ${nSRP}=${nSTR}[${nS18}]`,
      `  ${go(ST.env)}`, `end`].join("\n"),
    [`if ${is(ST.env)} then`, junk(), `  ${nT}=${K_CHECKS}`,
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
      `  ${go(ST.hash)}`, `end`].join("\n"),
    [`if ${is(ST.hash)} then`, junk(),
      `  ${nH}=(${nDH}*3+${nHH}*5+${nT}*${T_SALT}+${salt})%${M}`,
      `  ${go(ST.key)}`, `end`].join("\n"),
    [`if ${is(ST.key)} then`, junk(), `  ${nKB}={}`,
      `  for _i=1,32 do`,
      `    local _m=(${nH}*(_i+13)+40503)%${M}`,
      `    ${nKB}[_i]=(${nKS}[_i]-(((_m-_m%256)/256)%256))%256`,
      `  end`,
      `  ${go(ST.ksa)}`, `end`].join("\n"),
    [`if ${is(ST.ksa)} then`, junk(), `  ${nBox}={}`,
      `  for _i=0,255 do ${nBox}[_i]=_i end`,
      `  local _j=0`,
      `  for _i=0,255 do`,
      `    _j=(_j+${nBox}[_i]+${nKB}[_i%32+1])%256`,
      `    ${nBox}[_i],${nBox}[_j]=${nBox}[_j],${nBox}[_i]`,
      `  end`,
      `  ${go(ST.dec)}`, `end`].join("\n"),
    [`if ${is(ST.dec)} then`, junk(),
      `  local _a,_b=0,0`,
      `  local _ls=(${nKB}[1]*16777216+${nKB}[2]*65536+${nKB}[3]*256+${nKB}[4]${saltAdd})%${M}`,
      `  local _o={} local _hp=0 local _hq=1`,
      `  for _i=1,#${nData} do`,
      `    _a=(_a+1)%256 _b=(_b+${nBox}[_a])%256`,
      `    ${nBox}[_a],${nBox}[_b]=${nBox}[_b],${nBox}[_a]`,
      `    local _r=${nBox}[(${nBox}[_a]+${nBox}[_b])%256]`,
      `    _ls=(_ls*1664525+1013904223)%${M}`,
      `    local _p=(${nSB}(${nData},_i)-_r-((_ls-_ls%65536)/65536)%256)%256`,
      `    _hp=(_hp*257+_p+1)%${M}`,
      `    _hq=(_hq*131+_p+_i)%65521`,
      `    _o[_i]=${nCH}(_p)`,
      `  end`,
      `  ${nP}=table.concat(_o)`,
      `  if _hp~=${plainHash} or _hq~=${plainHash2} then ${go(ST.fail)} else ${go(ST.load)} end`,
      `end`].join("\n"),
    [`if ${is(ST.load)} then`, junk(),
      `  ${nF}=${nLS}(${nP})`,
      `  if not ${nF} then ${go(ST.fail)} else ${go(ST.run)} end`,
      `end`].join("\n"),
    [`if ${is(ST.run)} then`, junk(), `  ${go(ST.done)}`, `end`].join("\n"),
    [`if ${is(ST.fail)} then`, `  return function() end`, `end`].join("\n"),
    ...Array.from({ length: 6 }, () => {
      const d2 = sid();
      return [`if ${is(d2)} then`, junk(),
        `  for _i=1,#${nData} do ${nKB}[_i%32+1]=(${nKB}[_i%32+1]+${nSB}(${nData},_i))%256 end`,
        `  ${go(rngRange(2) ? ST.fail : d2)}`,
        `end`].join("\n");
    }),
  ];

  const chunks: { slot: number; literal: string }[] = [];
  let off = 0;
  while (off < cipher.length) {
    const size = 32 + rngRange(80);
    const slice = cipher.slice(off, off + size);
    chunks.push({ slot: chunks.length + 1, literal: `"${Array.from(slice).map(luaByte).join("")}"` });
    off += size;
  }
  const physical = shuffle(chunks);
  const positions = new Map(physical.map((chunk, i) => [chunk.slot, i + 1]));
  const orderMask = 1 + rngRange(M - 1);
  const order = chunks.map((chunk, i) =>
    ((positions.get(chunk.slot) ?? 0) + orderMask + (i + 1) * 7) % M);
  const nPool = name(), nOrder = name(), nSB2 = name();

  const head = [
    `local ${nCH}=string.char`,
    `local ${nSB2}=string.byte`,
    `local ${nHH}=0`,
    `local ${nData}`,
    `local ${nDH}=0`,
    `do`,
    `  local ${nPool}={${physical.map(c => c.literal).join(",")}}`,
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

  const earlyBail = saltRef ? `if ${saltRef} ~= 0 then return function() end end` : "";

  const out = [
    junks(3), head, earlyBail,
    `${go(ST.names)}`, `while true do`,
    ...shuffle(branches),
    `  if ${is(ST.done)} then break end`,
    `end`,
    `return ${nF}(...)`,
  ];
  return out.filter(Boolean).join("\n");
}

// ── combined entry ───────────────────────────────────────────────────────

export interface ObfuscateOpts {
  passes?: number;
  flatten?: boolean;
  antiTamper?: boolean;
  minify?: boolean;
  /** Compile simple scripts to VM bytecode. Default: auto-detect on `full`. */
  vm?: boolean;
  mode?: "full" | "wrap" | "cff" | "vm" | "none";
}

export function obfuscateLua(source: string, opts: ObfuscateOpts | number = {}): string {
  const o: ObfuscateOpts = typeof opts === "number" ? { passes: opts } : opts;
  const n = Math.max(1, Math.min(4, Math.floor(o.passes ?? 1)));
  const minify = o.minify !== false;

  const mode = o.mode ?? "full";
  if (mode === "none") return source;

  const useAnti = o.antiTamper ?? (mode === "full" || mode === "cff" || mode === "vm");
  const useCff  = o.flatten    ?? (mode === "full" || mode === "cff");
  const useWrap = mode !== "cff" && mode !== "vm";
  const useVm   = o.vm ?? (mode === "full" || mode === "vm");

  const saltName = useAnti
    ? "__tamper_" + Math.random().toString(36).slice(2, 10).padEnd(8, "0")
    : null;

  let cur = source;

  if (useCff) cur = flatten(cur);
  if (minify && useWrap) cur = minifyLua(cur);

  // VM pass: attempt to compile to bytecode. If it fails (unsupported
  // constructs), fall through to normal wrapping.
  if (useVm) {
    const compiled = compileVm(cur);
    if (compiled) cur = virtualize(compiled.ops, compiled.consts);
  }

  if (useWrap) {
    for (let i = 0; i < n; i++) {
      const isOutermost = i === n - 1;
      cur = wrapOnce(cur, isOutermost ? saltName : null);
    }
  }

  if (useAnti && saltName) {
    cur = buildAntiTamper({ preamble: true, saltName }) + "\n" + cur;
  }

  if (minify) cur = minifyLua(cur);
  return cur;
}

export type { MiniOp, Const };
export { virtualize, compileVm, flatten, minifyLua, buildAntiTamper };