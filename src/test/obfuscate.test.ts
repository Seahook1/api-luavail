import { describe, expect, it } from "vitest";
import {
  analyzeLuaCompatibility,
  expandLuaMacros,
  minifyLua,
  obfuscateLua,
} from "@/lib/obfuscate";

describe("Lua minifier", () => {
  it("removes comments and whitespace without changing quoted strings", () => {
    const input = 'local message = "keep -- this"; -- remove this\nreturn message';
    const output = minifyLua(input);
    expect(output).toContain('"keep -- this"');
    expect(output).not.toContain("remove this");
    expect(output).toContain("return");
  });

  it("preserves long strings and long comments", () => {
    const input = 'local text = [=[line 1\n-- still text\nline 3]=] --[=[comment]=]\nreturn text';
    const output = minifyLua(input);
    expect(output).toContain("[=[line 1\n-- still text\nline 3]=]");
    expect(output).not.toContain("comment");
  });

  it("does not merge minus tokens into a comment", () => {
    expect(minifyLua("value = left - -right")).toBe("value=left- -right");
  });

  it("preserves concatenation next to numeric literals", () => {
    expect(minifyLua('local value = 1 .. "x"')).toBe('local value=1 .."x"');
  });

  it("throws for unterminated quoted and long-bracket strings", () => {
    expect(() => minifyLua('return "unfinished')).toThrow("Unterminated Lua quoted string");
    expect(() => minifyLua("return [=[unfinished")).toThrow("Unterminated Lua long string");
  });
});

describe("Lua macros", () => {
  it("expands explicitly configured macros", () => {
    expect(expandLuaMacros("return {{VALUE}}", { VALUE: "42" })).toBe("return 42");
  });

  it("rejects missing or invalid macros", () => {
    expect(() => expandLuaMacros("return {{MISSING}}")).toThrow("Undefined custom macro");
    expect(() => expandLuaMacros("return 1", { "bad-name": "2" })).toThrow("Invalid macro name");
  });
});

describe("obfuscateLua", () => {
  it("returns a compatibility wrapper and minifies source", () => {
    const output = obfuscateLua('local value = "hello" -- comment\nreturn value');
    expect(output.startsWith("local IOIIIOIOIOIOIOIIOIIOOI=")).toBe(true);
    expect(output).toContain("-- Protected by Zelvmp");
    expect(output).toContain("return(function(...)");
    expect(output).toContain('local value="hello"');
    expect(output).not.toContain("comment");
  });

  it("preserves source text when minification is disabled", () => {
    const source = "local value = 1\nreturn value";
    expect(obfuscateLua(source, { minify: false })).toContain(source);
  });

  it("supports the legacy numeric passes argument without generating broken layers", () => {
    const output = obfuscateLua('return "ok"', 4);
    expect(output).toContain('return "ok"');
    expect(output.match(/return\(function/g)).toHaveLength(4);
  });

  it("supports macro expansion through the main API", () => {
    expect(obfuscateLua("return {{MESSAGE}}", { macros: { MESSAGE: '"macro-ok"' } }))
      .toContain('return"macro-ok"');
  });

  it("supports the explicit no-transform mode", () => {
    expect(obfuscateLua("return 1", { mode: "none" })).toBe("return 1");
  });
});

describe("Lua compatibility analysis", () => {
  it("always recommends the compatibility-preserving path", () => {
    const report = analyzeLuaCompatibility("while true do break end");
    expect(report.vmSupported).toBe(false);
    expect(report.recommendedMode).toBe("wrap");
    expect(report.message).toContain("compatibility");
  });

  it("handles empty input", () => {
    expect(analyzeLuaCompatibility(" ").vmSupported).toBe(false);
  });
});
