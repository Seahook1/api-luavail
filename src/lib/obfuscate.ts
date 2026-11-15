/**
 * Conservative Lua/Luau source transformer.
 *
 * This implementation deliberately avoids bytecode emulation, control-flow
 * rewriting, runtime decryption, and environment probing. Those techniques
 * made output fragile across Lua/Luau runtimes. The transformer preserves the
 * program and only performs lexical minification plus an optional call wrapper.
 */

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;
const WORD_PART = /[A-Za-z0-9_]/;
const MULTI_OPERATORS = [
  "...", "..=", "//=", "<<=", ">>=", "==", "~=", "<=", ">=", "::",
  "//", "<<", ">>", "..", "+=", "-=", "*=", "/=", "%=", "^=", "&=", "|=",
] as const;

function isLongBracketStart(source: string, index: number): number {
  if (source[index] !== "[") return -1;
  let cursor = index + 1;
  while (source[cursor] === "=") cursor++;
  return source[cursor] === "[" ? cursor - index - 1 : -1;
}

function readLongBracket(source: string, index: number): number {
  const level = isLongBracketStart(source, index);
  if (level < 0) return -1;
  const close = "]" + "=".repeat(level) + "]";
  const found = source.indexOf(close, index + level + 2);
  if (found < 0) throw new Error("Unterminated Lua long string or comment.");
  return found + close.length;
}

function readQuoted(source: string, index: number): number {
  const quote = source[index];
  let cursor = index + 1;
  while (cursor < source.length) {
    const char = source[cursor]!;
    if (char === "\\") {
      cursor += 2;
      continue;
    }
    if (char === quote) return cursor + 1;
    if (char === "\n" || char === "\r") {
      throw new Error("Unterminated Lua quoted string.");
    }
    cursor++;
  }
  throw new Error("Unterminated Lua quoted string.");
}

function readNumber(source: string, index: number): number {
  const rest = source.slice(index);
  const match =
    /^(?:0[xX][\da-fA-F]+(?:\.(?!\.)[\da-fA-F]*)?(?:[pP][+-]?\d+)?|(?:\d+(?:\.(?!\.)\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/.exec(rest);
  return index + (match?.[0].length ?? 1);
}

function needsSeparator(previous: string, next: string): boolean {
  if (!previous || !next) return false;
  const a = previous[previous.length - 1]!;
  const b = next[0]!;
  if (WORD_PART.test(a) && WORD_PART.test(b)) return true;
  if (a === "-" && b === "-") return true;
  if (a === "." && b === ".") return true;
  if (/\d/.test(a) && b === ".") return true;
  if (a === "." && /\d/.test(b)) return true;
  return MULTI_OPERATORS.some((operator) =>
    operator.length > 1 && (previous.endsWith(operator[0]!) && next.startsWith(operator.slice(1))),
  );
}

/** Token-aware minifier. Strings and long-bracket literals are copied verbatim. */
export function minifyLua(source: string, singleLine = true): string {
  const tokens: string[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index]!;

    if (/\s/.test(char)) {
      index++;
      continue;
    }

    if (char === "-" && source[index + 1] === "-") {
      const longStart = index + 2;
      if (source[longStart] === "[") {
        const end = readLongBracket(source, longStart);
        if (end >= 0) {
          index = end;
          continue;
        }
      }
      index += 2;
      while (index < source.length && source[index] !== "\n" && source[index] !== "\r") index++;
      continue;
    }

    if (char === '"' || char === "'") {
      const end = readQuoted(source, index);
      tokens.push(source.slice(index, end));
      index = end;
      continue;
    }

    if (char === "[") {
      const level = isLongBracketStart(source, index);
      if (level >= 0) {
        const end = readLongBracket(source, index);
        tokens.push(source.slice(index, end));
        index = end;
        continue;
      }
    }

    if (IDENT_START.test(char)) {
      let end = index + 1;
      while (end < source.length && IDENT_PART.test(source[end]!)) end++;
      tokens.push(source.slice(index, end));
      index = end;
      continue;
    }

    if (/\d/.test(char) || (char === "." && /\d/.test(source[index + 1] ?? ""))) {
      const end = readNumber(source, index);
      tokens.push(source.slice(index, end));
      index = end;
      continue;
    }

    const operator = MULTI_OPERATORS.find((candidate) => source.startsWith(candidate, index));
    if (operator) {
      tokens.push(operator);
      index += operator.length;
      continue;
    }

    tokens.push(char);
    index++;
  }

  let output = "";
  for (const token of tokens) {
    if (needsSeparator(output, token)) output += " ";
    output += token;
  }

  // singleLine is retained for API compatibility; this minifier always emits
  // one line because all source newlines are lexical whitespace.
  void singleLine;
  return output;
}

export function minifyToSingleLine(source: string): string {
  return minifyLua(source, true);
}

export function expandLuaMacros(
  source: string,
  macros: Record<string, string> = {},
): string {
  const entries = Object.entries(macros);
  if (entries.length > 100) throw new Error("A maximum of 100 custom macros is allowed.");

  for (const [name, value] of entries) {
    if (!/^[A-Z_][A-Z0-9_]{0,63}$/.test(name)) {
      throw new Error(`Invalid macro name "${name}". Use A-Z, 0-9 and underscores.`);
    }
    if (typeof value !== "string" || value.length > 16384) {
      throw new Error(`Macro "${name}" must be a string no longer than 16 KB.`);
    }
  }

  return source.replace(/\{\{([A-Z_][A-Z0-9_]*)\}\}/g, (token, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(macros, name)) {
      throw new Error(`Undefined custom macro: ${name}`);
    }
    return macros[name]!;
  });
}

export interface LuaCompatibilityReport {
  vmSupported: boolean;
  recommendedMode: "vm" | "wrap";
  message: string;
}

export function analyzeLuaCompatibility(source: string): LuaCompatibilityReport {
  if (!source.trim()) {
    return { vmSupported: false, recommendedMode: "wrap", message: "The source is empty." };
  }
  return {
    vmSupported: false,
    recommendedMode: "wrap",
    message: "Luavail uses the compatibility-preserving wrapper; VM translation is disabled.",
  };
}

export interface AntiTamperOpts {
  preamble?: boolean;
  saltName?: string;
  warn?: boolean;
}

/** Retained for API compatibility. Runtime anti-tamper probes are intentionally disabled. */
export function buildAntiTamper(_opts: AntiTamperOpts = {}): string {
  return "";
}

export type MiniOp = never;
export type Const = string | number | boolean | null;

/** Legacy exports retained so older imports fail safely instead of silently miscompiling. */
export function compileVm(_source: string): null {
  return null;
}

export function virtualize(_ops: MiniOp[], _consts: Const[]): never {
  throw new Error("Luavail VM output is disabled; use compatibility mode.");
}

export function flatten(source: string): string {
  return source;
}

export interface ObfuscateOpts {
  passes?: number;
  flatten?: boolean;
  antiTamper?: boolean;
  minify?: boolean;
  vm?: boolean;
  mode?: "full" | "wrap" | "cff" | "vm" | "none";
  macros?: Record<string, string>;
}

export function obfuscateLua(source: string, opts: ObfuscateOpts | number = {}): string {
  const options: ObfuscateOpts = typeof opts === "number" ? { passes: opts } : opts;
  if (options.mode === "none") return expandLuaMacros(source, options.macros);

  const expanded = expandLuaMacros(source, options.macros);
  const minified = options.minify === false ? expanded : minifyLua(expanded);
  const passCount = Math.max(1, Math.min(4, Math.floor(options.passes ?? 1)));
  const header = "-- Protected by Zelvmp | compatibility mode\\n";

  // Nested function boundaries add lightweight source wrapping while keeping
  // execution in ordinary Lua/Luau syntax. No runtime probes or environment hooks.
  let body = minified;
  for (let i = 0; i < passCount; i++) {
    body = "return(function(...)\\n" + body + "\\nend)(...)";
  }

  // Restore the named outer callable wrapper used by the previous Zelvmp build.
  const outerName = "IOIIIOIOIOIOIOIIOIIOOI";
  return "local " + outerName + "=(function() return function(...)\\n" +
    header + body + "\\nend end)(); return " + outerName + "(...)";
}

