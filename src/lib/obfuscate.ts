// Full Luraph-Style Obfuscator (CFF + VM + Anti-Tamper + RC4)

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

// Luraph-style variable names (I, l, O, 0, 1)
const randVar = (): string => {
  const chars = ["I", "l", "O", "0", "1", "_"];
  let s = "";
  const len = 4 + rngRange(8);
  for (let i = 0; i < len; i++) s += pick(chars);
  if (/^[0-9]/.test(s)) s = "_" + s;
  return s;
};

const luaByte = (b: number) =>
  b >= 32 && b <= 126 && b !== 34 && b !== 92
    ? String.fromCharCode(b)
    : `\\${String(b).padStart(3, "0")}`;

function genJunkTable(name: string, size: number): string {
  const keys = ["~", "x", "a", "b", "c", "d", "e", "f", "1", "2", "3", "4", "#", "|", "z", "\"", "!", " ", "}", "{", "$"];
  const chars = `*$@#&"'~%^!()_+-=[]{}|;:,.<>/?`.split("").concat(
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("")
  );
  const entries: string[] = [];
  const used = new Set<string>();
  for (let i = 0; i < size; i++) {
    let k;
    do { k = pick(keys) + pick(keys) + (i % 100); } while (used.has(k));
    used.add(k);
    let v = "";
    const len = 15 + rngRange(40);
    for (let j = 0; j < len; j++) v += pick(chars);
    entries.push(`["${k}"]="${v}"`);
  }
  return `local ${name}={${entries.join(",")}}`;
}

// ── Binary Tree Generator (Luraph Style) ──────────────────────────────────
interface State {
  id: number;
  next: number;
  code: string;
}

function buildBinaryTree(states: State[], varC: string): string {
  // Sort by ID
  states.sort((a, b) => a.id - b.id);

  const build = (arr: State[], indent: string): string => {
    if (arr.length === 0) return "";
    if (arr.length === 1) {
      const s = arr[0];
      return `${indent}if ${varC} == ${s.id} then\n${indent}  ${s.code}\n${indent}  ${varC} = ${s.next}\n${indent}end\n`;
    }
    const mid = Math.floor(arr.length / 2);
    const pivot = arr[mid].id;
    let code = `${indent}if ${varC} <= ${pivot} then\n`;
    code += build(arr.slice(0, mid), indent + "  ");
    code += `${indent}else\n`;
    code += build(arr.slice(mid), indent + "  ");
    code += `${indent}end\n`;
    return code;
  };

  return build(states, "        ");
}

// ── Anti-Tamper (Now integrated with Luraph VM) ───────────────────────────
export function buildAntiTamper(saltName: string = "__tamper"): string {
  const stateId = { count: 1 };
  const states: State[] = [];
  const add = (code: string, nextId: number) => {
    states.push({ id: stateId.count, next: nextId, code });
    stateId.count++;
  };

  const dbg = randVar(), ggenv = randVar(), hook = randVar(), ls = randVar(), pcallV = randVar(), Q = randVar();
  const Yz = randVar(), strTable = genJunkTable(Yz, 25);

  const getStr = (k: string) => `${Yz}["${k}"]`;

  add(`if type(${ggenv}) == "function" then ${Q} = (${Q} + 9973) % 2147483647 end`, 2);
  add(`if type(${dbg}) == "table" and ${dbg}[${getStr("getinfo")}] then local i = ${dbg}[${getStr("getinfo")}](${dbg}[${getStr("getinfo")}]) if i and i[${getStr("what")}] ~= ${getStr("C")} then ${Q} = (${Q} + 9971) % 2147483647 end end`, 3);
  add(`if type(${hook}) == "function" then ${Q} = (${Q} + 9967) % 2147483647 end`, 4);
  add(`if type(getgenv) == "function" then local g = getgenv() if type(g) == "table" then g["${randVar()}"] = "${getStr("warn")}" end end`, 5);
  add(`if ${ls} then local ok, f = ${pcallV}(${ls}, "${getStr("test")}") if not ok or type(f) ~= "function" then ${Q} = (${Q} + 9964) % 2147483647 end end`, 6);
  add(`if type(${dbg}) == "table" and ${dbg}[${getStr("getinfo")}] then local i = ${dbg}[${getStr("getinfo")}](setmetatable) if i and i[${getStr("what")}] ~= ${getStr("C")} then ${Q} = (${Q} + 9963) % 2147483647 end end`, 7);
  add(`if type(${dbg}) == "table" and ${dbg}[${getStr("getinfo")}] then local i = ${dbg}[${getStr("getinfo")}](pcall) if i and i[${getStr("what")}] ~= ${getStr("C")} then ${Q} = (${Q} + 9961) % 2147483647 end end`, 8);

  // Add random junk states
  for (let i = 0; i < 15; i++) {
    const a = rngRange(1000) + 1;
    add(`local x = ${a} + ${Q} if x % 2 == 1 then ${Q} = (${Q} + ${a}) % 2147483647 end`, stateId.count + 1);
  }

  // Exit state
  add(`do end`, 0);

  const ifCode = buildBinaryTree(states, randVar());

  return `
local ${saltName} = (function()
  ${strTable}
  local ${Q} = 0
  local ${dbg} = rawget(_G, "debug")
  local ${ggenv} = rawget(_G, "getgenv")
  local ${hook} = rawget(_G, "hookfunction")
  local ${ls} = rawget(_G, "loadstring") or rawget(_G, "load")
  local ${pcallV} = pcall
  local c = 1
  while true do
${ifCode}
    if c == 0 then break end
  end
  return ${Q}
end)()
`;
}

// ── RC4 + Luraph Wrapper ──────────────────────────────────────────────────
function rc4Encrypt(source: string, key: number[]): Uint8Array {
  const sbox = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + sbox[i] + key[i % key.length]) % 256;
    [sbox[i], sbox[j]] = [sbox[j], sbox[i]];
  }
  const plain = new TextEncoder().encode(source);
  const cipher = new Uint8Array(plain.length);
  let a = 0, b = 0;
  for (let n = 0; n < plain.length; n++) {
    a = (a + 1) % 256;
    b = (b + sbox[a]) % 256;
    [sbox[a], sbox[b]] = [sbox[b], sbox[a]];
    const r = sbox[(sbox[a] + sbox[b]) % 256];
    cipher[n] = (plain[n] + r) % 256;
  }
  return cipher;
}

function wrapOnce(source: string, saltRef: string | null): string {
  const stateId = { count: 1 };
  const states: State[] = [];
  const add = (code: string, nextId: number) => {
    states.push({ id: stateId.count, next: nextId, code });
    stateId.count++;
  };

  const varC = randVar(), varQ = saltRef || randVar(), payloadVar = randVar();
  const Yz = randVar(), strTable = genJunkTable(Yz, 30);
  const key = Array.from({length: 32}, () => rngRange(256));
  const encrypted = rc4Encrypt(source, key);
  const cipherStr = Array.from(encrypted).map(luaByte).join("");

  // Fake Lua environment table
  const fakeEnv = `
    [71]=buffer and buffer.writeu32 or function() end,
    [96]=bit32 and bit32.bnot or function() end,
    [63]=buffer and buffer.create or function() return {} end,
    [18]=table.create or function(n, v) local t = {} for i=1,n do t[i]=v end return t end,
    [85]=tostring,
    [87]=buffer and buffer.readu8 or function(s,i) return string.byte(s,i) end,
    [99]=bit32 and bit32.bxor or function(a,b) return a end,
    [102]=string.match,
    [1]=unpack or table.unpack,
    [2]=pcall,
    [5]=string.byte,
    [44]=bit32 and bit32.rrotate or function(a,b) return a end,
    [120]=table.clear or function(t) for k in pairs(t) do t[k]=nil end end,
    [26]=buffer and buffer.writef32 or function() end,
    [69]=buffer and buffer.readi8 or function() return 0 end,
  `.trim();

  // Anti-tamper state check
  if (saltRef) {
    add(`if type(${saltRef}) ~= "number" or ${saltRef} ~= 0 then return setmetatable({}, {__call = function() end}) end`, 2);
  } else {
    add(`do end`, 2);
  }

  // Decryption
  add(`
    local K = {${key.join(",")}}
    local S = {}
    for i=0,255 do S[i] = i end
    local j = 0
    for i=0,255 do
      j = (j + S[i] + K[i % 32 + 1]) % 256
      S[i], S[j] = S[j], S[i]
    end
    local a, b = 0, 0
    local out = {}
    local B = "${cipherStr}"
    for i=1,#B do
      a = (a + 1) % 256
      b = (b + S[a]) % 256
      S[a], S[b] = S[b], S[a]
      local r = S[(S[a] + S[b]) % 256]
      out[i] = string.char((string.byte(B, i) - r) % 256)
    end
    ${payloadVar} = table.concat(out)
  `, 3);

  // Execute
  add(`
    local f = (loadstring or load)(${payloadVar})
    if f then 
      local suc, res = pcall(f)
      if suc then return res end
    end
    return setmetatable({}, {__call = function() end})
  `, 0);

  const ifCode = buildBinaryTree(states, varC);

  return `
${strTable}
return setmetatable({
  ${fakeEnv}
  Yz=${Yz},
  z=function(_)
    local ${varC} = 1
    local ${varQ} = 0
    local ${payloadVar}
    while true do
${ifCode}
      if ${varC} == 0 then break end
    end
    return function() end
  end
}, {
  __call=function(self, ...)
    return self.z(...)
  end
})
  `.trim();
}

// ── Minifier ──────────────────────────────────────────────────────────────
function minifyLua(src: string): string {
  const out: string[] = [];
  let i = 0;
  let pending = false;
  const isWord = (c: string) => /[A-Za-z0-9_]/.test(c);
  const needSpace = (a: string, b: string): boolean => {
    if (!a || !b) return false;
    if (isWord(a) && isWord(b)) return true;
    if (a === "-" && b === "-") return true;
    if (/[0-9]/.test(a) && b === ".") return true;
    return false;
  };

  while (i < src.length) {
    const c = src[i]!;
    if (c === " " || c === "\t" || c === "\r" || c === "\n") { pending = true; i++; continue; }
    if (c === "-" && src[i + 1] === "-") {
      if (src[i + 2] === "[") {
        const close = src.indexOf("]]", i);
        if (close !== -1) { i = close + 2; pending = true; continue; }
      }
      while (i < src.length && src[i] !== "\n") i++;
      pending = true; continue;
    }
    if (c === '"' || c === "'") {
      if (pending && needSpace(out[out.length - 1]?.slice(-1) || "", c)) out.push(" ");
      let s = c; i++;
      while (i < src.length) {
        s += src[i];
        if (src[i] === "\\") { i++; s += src[i]; }
        else if (src[i] === c) { i++; break; }
        i++;
      }
      out.push(s); pending = false; continue;
    }
    if (pending && needSpace(out[out.length - 1]?.slice(-1) || "", c)) out.push(" ");
    out.push(c);
    pending = false; i++;
  }
  return out.join("");
}

// ── Main Entry ────────────────────────────────────────────────────────────
export interface ObfuscateOpts {
  passes?: number;
  flatten?: boolean;
  antiTamper?: boolean;
  minify?: boolean;
  vm?: boolean;
  mode?: "full" | "wrap" | "cff" | "vm" | "none";
}

export function obfuscateLua(source: string, opts: ObfuscateOpts | number = {}): string {
  const o: ObfuscateOpts = typeof opts === "number" ? { passes: opts } : opts;
  const minify = o.minify !== false;
  const n = Math.max(1, Math.min(4, Math.floor(o.passes ?? 1)));

  const useAnti = o.antiTamper ?? true;
  const saltName = useAnti ? randVar() : null;

  let cur = source;
  if (minify) cur = minifyLua(cur);

  // Wrap with RC4 multiple times
  for (let i = 0; i < n; i++) {
    const isOutermost = i === n - 1;
    cur = wrapOnce(cur, isOutermost ? saltName : null);
  }

  // Prepend anti-tamper
  if (useAnti && saltName) {
    const anti = buildAntiTamper(saltName);
    cur = anti + "\n" + cur;
  }

  if (minify) cur = minifyLua(cur);
  return cur;
}