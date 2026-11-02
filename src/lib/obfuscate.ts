// =============================================================================
// obfuscateLua.ts
// Language: TypeScript  |  Runtime: Node 18+ / Bun / Deno  |  No deps
//
// Pipeline:
//   1. Encode: XOR-chain + S-box keystream → ciphertext bytes
//   2. Compile: ciphertext → VM bytecode (register machine, ~24 opcodes)
//   3. Emit: bytecode → self-contained Lua 5.1/LuaJIT/Luau source
//
// Per-call randomness:
//   • S-box (Fisher-Yates, crypto.getRandomValues)
//   • Opcode permutation (shuffled encoding)
//   • Physical register permutation
//   • LCG seed / cipher seed / step / salt
//   • Variable names (random hex identifiers)
//
// Integrity: Fletcher-16 over plaintext; verified inside VM before load().
// Security model: obfuscation only — see module docstring.
// =============================================================================

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

const _cry = (globalThis as { crypto?: Crypto }).crypto;
if (!_cry?.getRandomValues) throw new Error("obfuscateLua: needs crypto.getRandomValues");

function rndU32(): number { return _cry!.getRandomValues(new Uint32Array(1))[0]!; }
function rndInt(max: number): number { return rndU32() % max; }
function rndRange(lo: number, hi: number): number { return lo + rndInt(hi - lo + 1); }
function rndHex(n: number): string {
  const b = new Uint8Array(n); _cry!.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
}
function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rndInt(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

// ---------------------------------------------------------------------------
// LCG (Lehmer, 2^31-1 Mersenne prime)
// ---------------------------------------------------------------------------

const LCG_A = 48271;
const LCG_M = 0x7fffffff;
function lcgStep(s: number): number { return (s * LCG_A) % LCG_M; }
function lcgKeyByte(s: number): number { return ((s + Math.floor(s / 8192)) >>> 0) & 0xff; }

// ---------------------------------------------------------------------------
// Fletcher-16 (plaintext integrity)
// ---------------------------------------------------------------------------

function fletcher16(buf: Uint8Array): [number, number] {
  let a = 1, b = 0;
  for (const v of buf) { a = (a + v) % 65521; b = (b + a) % 65521; }
  return [a, b];
}

// ---------------------------------------------------------------------------
// S-box builder
// ---------------------------------------------------------------------------

function buildSbox(): Uint8Array {
  const s = new Uint8Array(256).map((_, i) => i);
  return new Uint8Array(shuffle(Array.from(s)));
}

// ---------------------------------------------------------------------------
// Encoder: XOR-chain + LCG keystream + S-box lookup
//
//   key_i = sbox[lcgKeyByte(lcg_i) & 0xff]
//   enc_i = (plain_i + seed + i*step + (i%11)*salt + prev_enc + key_i) & 0xff
//   prev_enc starts at `initial`
// ---------------------------------------------------------------------------

interface CipherParams {
  seed: number;
  step: number;
  salt: number;
  initial: number;
  lcgSeed: number;
}

function encode(plain: Uint8Array, sbox: Uint8Array, p: CipherParams): Uint8Array {
  const out = new Uint8Array(plain.length);
  let prev = p.initial;
  let lcg = p.lcgSeed;
  for (let i = 0; i < plain.length; i++) {
    lcg = lcgStep(lcg);
    const k = sbox[lcgKeyByte(lcg) & 0xff]!;
    const enc = (plain[i]! + p.seed + (i + 1) * p.step + ((i + 1) % 11) * p.salt + prev + k) & 0xff;
    out[i] = enc;
    prev = enc;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Opcodes — semantic constants (shuffled per instance)
// ---------------------------------------------------------------------------

const enum Op {
  LOADK   = 0,   // Rd = K[k]
  LOADB   = 1,   // Rd = byte(Ra[Rb])  — 1-indexed
  ADD     = 2,   // Rd = Ra + Rb
  ADDK    = 3,   // Rd = Ra + K[k]
  SUB     = 4,   // Rd = Ra - Rb
  MUL     = 5,   // Rd = Ra * Rb
  MULK    = 6,   // Rd = Ra * K[k]
  MOD     = 7,   // Rd = Ra % Rb
  MODK    = 8,   // Rd = Ra % K[k]
  IDIVK   = 9,   // Rd = floor(Ra / K[k])
  MOV     = 10,  // Rd = Ra
  LTK     = 11,  // flag = Ra < K[k]
  LEK     = 12,  // flag = Ra <= K[k]
  EQR     = 13,  // flag = Ra == Rb
  NEK     = 14,  // flag = Ra != K[k]
  JMP     = 15,  // pc = K[k]
  JNZ     = 16,  // if flag then pc = K[k]
  JZ      = 17,  // if !flag then pc = K[k]
  SBOX    = 18,  // Rd = sbox[Ra & 0xff]
  APPEND  = 19,  // out[#out+1] = string.char(Ra)
  INC     = 20,  // Rd = Rd + 1
  LOADLEN = 21,  // Rd = #data  (injected by loader)
  RET     = 22,  // return table.concat(out)
  RETNIL  = 23,  // return nil  (integrity failure)
}

const ALL_OPS: Op[] = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23];

function buildOpcodeMap(): Map<Op, number> {
  const enc = shuffle(ALL_OPS.slice());
  return new Map(ALL_OPS.map((op, i) => [op, enc[i]!]));
}

// ---------------------------------------------------------------------------
// Instruction record
// ---------------------------------------------------------------------------

interface Instr {
  op: Op;
  rd: number;   // dest register (-1 = unused)
  ra: number;   // src A register (-1 = unused)
  rb: number;   // src B register (-1 = unused)
  k: number;    // constant-table index (-1 = unused)
}

// ---------------------------------------------------------------------------
// Assembler
// ---------------------------------------------------------------------------

class Asm {
  readonly instrs: Instr[] = [];
  readonly consts: number[] = [];
  private readonly patchList: Array<{ at: number; label: symbol }> = [];
  private readonly labels: Map<symbol, number> = new Map();

  K(v: number): number {
    const i = this.consts.indexOf(v);
    if (i >= 0) return i;
    this.consts.push(v);
    return this.consts.length - 1;
  }

  emit(op: Op, rd = -1, ra = -1, rb = -1, k = -1): number {
    this.instrs.push({ op, rd, ra, rb, k });
    return this.instrs.length - 1;
  }

  makeLabel(): symbol { return Symbol(); }

  placeLabel(l: symbol): void { this.labels.set(l, this.instrs.length); }

  jmp(op: Op, label: symbol): void {
    const at = this.emit(op);
    this.patchList.push({ at, label });
  }

  finish(): void {
    for (const { at, label } of this.patchList) {
      const pos = this.labels.get(label);
      if (pos === undefined) throw new Error("unresolved label");
      this.instrs[at]!.k = this.K(pos);
    }
  }
}

// ---------------------------------------------------------------------------
// Compiler: build the decoder program as VM bytecode
//
// Register layout (logical → shuffled to physical at emit time):
//   0  data_len    1  i (1-based)  2  bi (current ciphertext byte)
//   3  prev        4  lcg          5  k (sbox out)
//   6  dec (plain) 7  tmp          8  flet_a         9  flet_b
//  10  exp_a      11  exp_b       12  scratch
// ---------------------------------------------------------------------------

const NREGS = 14;

interface CompiledVM {
  instrs: Instr[];
  consts: number[];
  sbox: Uint8Array;
  physRegs: number[]; // logical→physical permutation
  opcodeMap: Map<Op, number>;
}

function compile(
  encoded: Uint8Array,
  sbox: Uint8Array,
  p: CipherParams,
  expA: number,
  expB: number,
): CompiledVM {
  const as = new Asm();
  const opcodeMap = buildOpcodeMap();

  // Physical register shuffle
  const physRegs = shuffle(Array.from({ length: NREGS }, (_, i) => i));
  const r = (l: number) => physRegs[l]!;

  const L = {
    loopTop:  as.makeLabel(),
    loopBody: as.makeLabel(),
    exit:     as.makeLabel(),
    ok:       as.makeLabel(),
    fail:     as.makeLabel(),
  };

  const N = encoded.length;

  // Logical slots
  const RL = { len: 0, i: 1, bi: 2, prev: 3, lcg: 4, k: 5, dec: 6, tmp: 7, fa: 8, fb: 9, expa: 10, expb: 11, sc: 12 };

  // Prologue
  as.emit(Op.LOADK,  r(RL.len),  -1, -1, as.K(N));
  as.emit(Op.LOADK,  r(RL.i),    -1, -1, as.K(1));
  as.emit(Op.LOADK,  r(RL.prev), -1, -1, as.K(p.initial));
  as.emit(Op.LOADK,  r(RL.lcg),  -1, -1, as.K(p.lcgSeed));
  as.emit(Op.LOADK,  r(RL.fa),   -1, -1, as.K(1));
  as.emit(Op.LOADK,  r(RL.fb),   -1, -1, as.K(0));

  // Loop test: if i > N goto exit
  as.placeLabel(L.loopTop);
  as.emit(Op.LTK,   -1,  r(RL.len), -1, as.K(0)); // flag = len < 0 → always false
  // Need: flag = (i <= N). Use: tmp = N - i + 1; flag = tmp > 0 → LEK: i <= N
  as.emit(Op.LEK,   -1,  r(RL.i),   -1, as.K(N));  // flag = i <= N
  as.jmp(Op.JZ, L.exit);                            // if !flag (i > N) → exit

  // Loop body
  as.placeLabel(L.loopBody);
  as.emit(Op.LOADB, r(RL.bi), r(RL.i), -1, -1);   // bi = data[i] (1-indexed)

  // lcg = (lcg * LCG_A) % LCG_M
  as.emit(Op.MULK,  r(RL.lcg), r(RL.lcg), -1, as.K(LCG_A));
  as.emit(Op.MODK,  r(RL.lcg), r(RL.lcg), -1, as.K(LCG_M));

  // keyIdx = (lcg + floor(lcg / 8192)) & 0xff
  as.emit(Op.IDIVK, r(RL.tmp), r(RL.lcg), -1, as.K(8192));
  as.emit(Op.ADD,   r(RL.tmp), r(RL.lcg), r(RL.tmp), -1);
  as.emit(Op.MODK,  r(RL.tmp), r(RL.tmp), -1, as.K(256));
  as.emit(Op.SBOX,  r(RL.k),   r(RL.tmp), -1, -1);   // k = sbox[keyIdx]

  // subtrahend = seed + i*step + (i%11)*salt + prev + k  (all mod 256)
  as.emit(Op.MULK,  r(RL.dec), r(RL.i),   -1, as.K(p.step));
  as.emit(Op.MODK,  r(RL.dec), r(RL.dec), -1, as.K(256));
  as.emit(Op.ADDK,  r(RL.dec), r(RL.dec), -1, as.K(p.seed));
  as.emit(Op.MODK,  r(RL.sc),  r(RL.i),   -1, as.K(11));      // sc = i % 11
  as.emit(Op.MULK,  r(RL.sc),  r(RL.sc),  -1, as.K(p.salt));
  as.emit(Op.ADD,   r(RL.dec), r(RL.dec), r(RL.sc),  -1);
  as.emit(Op.ADD,   r(RL.dec), r(RL.dec), r(RL.prev), -1);
  as.emit(Op.ADD,   r(RL.dec), r(RL.dec), r(RL.k),   -1);

  // dec = (bi - subtrahend) & 0xff — guaranteed non-negative via +256
  as.emit(Op.SUB,   r(RL.dec), r(RL.bi),  r(RL.dec), -1);
  as.emit(Op.ADDK,  r(RL.dec), r(RL.dec), -1, as.K(256));
  as.emit(Op.MODK,  r(RL.dec), r(RL.dec), -1, as.K(256));

  // prev = bi
  as.emit(Op.MOV,   r(RL.prev), r(RL.bi), -1, -1);

  // Fletcher update: fa = (fa + dec) % 65521; fb = (fb + fa) % 65521
  as.emit(Op.ADD,   r(RL.fa),  r(RL.fa), r(RL.dec), -1);
  as.emit(Op.MODK,  r(RL.fa),  r(RL.fa), -1, as.K(65521));
  as.emit(Op.ADD,   r(RL.fb),  r(RL.fb), r(RL.fa), -1);
  as.emit(Op.MODK,  r(RL.fb),  r(RL.fb), -1, as.K(65521));

  // out[#out+1] = char(dec)
  as.emit(Op.APPEND, -1, r(RL.dec), -1, -1);

  // i = i + 1; goto loopTop
  as.emit(Op.INC,   r(RL.i), -1, -1, -1);
  as.jmp(Op.JMP, L.loopTop);

  // Integrity check
  as.placeLabel(L.exit);
  as.emit(Op.LOADK,  r(RL.expa), -1, -1, as.K(expA));
  as.emit(Op.LOADK,  r(RL.expb), -1, -1, as.K(expB));
  as.emit(Op.EQR,   -1, r(RL.fa), r(RL.expa), -1);
  as.jmp(Op.JZ, L.fail);
  as.emit(Op.EQR,   -1, r(RL.fb), r(RL.expb), -1);
  as.jmp(Op.JZ, L.fail);

  as.placeLabel(L.ok);
  as.emit(Op.RET);

  as.placeLabel(L.fail);
  as.emit(Op.RETNIL);

  as.finish();
  return { instrs: as.instrs, consts: as.consts, sbox, physRegs, opcodeMap };
}

// ---------------------------------------------------------------------------
// Emitter: compiled VM → self-contained Lua source
// ---------------------------------------------------------------------------

function varName(): string { return "_" + rndHex(4); }

/**
 * Emit the full Lua source for the obfuscated script.
 *
 * Structure of emitted code:
 *   1. Constant table literal
 *   2. S-box literal (compact byte-string, parsed to table at load time)
 *   3. Bytecode table literal  [{op,rd,ra,rb,k}, ...]
 *   4. Opcode-map table        {[encoded]=semantic, ...}
 *   5. Data payload            (encoded as a sequence of \ddd escapes)
 *   6. VM interpreter function
 *   7. Boot: `local s = vm(data); if s then (load or loadstring)(s)() end`
 */
function emitLua(vm: CompiledVM, encoded: Uint8Array): string {
  const { instrs, consts, sbox, physRegs, opcodeMap } = vm;
  const NREGS_EMIT = NREGS;

  // --- Variable names (prevent trivial rename-based attacks) ---------------
  const vConsts   = varName();
  const vSbox     = varName();
  const vCode     = varName();
  const vOpMap    = varName();
  const vData     = varName();
  const vVM       = varName();
  const vRegs     = varName();
  const vOut      = varName();
  const vFlag     = varName();
  const vPc       = varName();
  const vInstr    = varName();
  const vOp       = varName();
  const vRd       = varName();
  const vRa       = varName();
  const vRb       = varName();
  const vK        = varName();
  const vLen      = varName();
  const vRes      = varName();

  // Reverse opcode map: encoded → semantic (what the VM switch reads)
  const revMap = new Map<number, Op>();
  for (const [sem, enc] of opcodeMap) revMap.set(enc, sem);

  // --- 1. Constant table ---------------------------------------------------
  const constsLit = "[" + consts.map(String).join(",") + "]";

  // --- 2. S-box literal: escaped byte string, parsed at runtime -----------
  let sboxEsc = '"';
  for (let i = 0; i < 256; i++) sboxEsc += "\\" + sbox[i];
  sboxEsc += '"';
  // Runtime parser: {string.byte(s,1,256)}

  // --- 3. Bytecode literal -------------------------------------------------
  const codeLit = "{\n" + instrs.map(ins => {
    const enc = opcodeMap.get(ins.op)!;
    return `  {${enc},${ins.rd},${ins.ra},${ins.rb},${ins.k}}`;
  }).join(",\n") + "\n}";

  // --- 4. Opcode map (encoded → semantic) for the VM switch ----------------
  // We encode the switch as a chain of elseif in Lua (avoids table overhead
  // in Luau AOT). We build the cases sorted by encoded value.
  const opCases: string[] = [];

  // Helpers for register-operand access in emit
  // Physical register index in the emitted regs table: physRegs[logical] → physical
  // The VM just reads vRegs[physical+1] (1-indexed Lua table).
  const getRa = `${vRegs}[${vRa}+1]`;
  const getRb = `${vRegs}[${vRb}+1]`;
  const setRd = (expr: string) => `${vRegs}[${vRd}+1]=${expr}`;
  const getK  = `${vConsts}[${vK}+1]`;

  for (const [enc, sem] of [...revMap.entries()].sort((a, b) => a[0] - b[0])) {
    let body: string;
    switch (sem) {
      case Op.LOADK:
        body = `${setRd(getK)}`;
        break;
      case Op.LOADB:
        // Rd = string.byte(data, Ra) — Ra holds the 1-based index
        body = `${setRd(`string.byte(${vData},${getRa})`)}`;
        break;
      case Op.ADD:
        body = `${setRd(`${getRa}+${getRb}`)}`;
        break;
      case Op.ADDK:
        body = `${setRd(`${getRa}+${getK}`)}`;
        break;
      case Op.SUB:
        body = `${setRd(`${getRa}-${getRb}`)}`;
        break;
      case Op.MUL:
        body = `${setRd(`${getRa}*${getRb}`)}`;
        break;
      case Op.MULK:
        body = `${setRd(`${getRa}*${getK}`)}`;
        break;
      case Op.MOD:
        body = `${setRd(`${getRa}%${getRb}`)}`;
        break;
      case Op.MODK:
        body = `${setRd(`${getRa}%${getK}`)}`;
        break;
      case Op.IDIVK:
        body = `${setRd(`math.floor(${getRa}/${getK})`)}`;
        break;
      case Op.MOV:
        body = `${setRd(getRa)}`;
        break;
      case Op.LTK:
        body = `${vFlag}=${getRa}<${getK}`;
        break;
      case Op.LEK:
        body = `${vFlag}=${getRa}<=${getK}`;
        break;
      case Op.EQR:
        body = `${vFlag}=${getRa}==${getRb}`;
        break;
      case Op.NEK:
        body = `${vFlag}=${getRa}~=${getK}`;
        break;
      case Op.JMP:
        body = `${vPc}=${getK}-1`;
        break;
      case Op.JNZ:
        body = `if ${vFlag} then ${vPc}=${getK}-1 end`;
        break;
      case Op.JZ:
        body = `if not ${vFlag} then ${vPc}=${getK}-1 end`;
        break;
      case Op.SBOX:
        body = `${setRd(`${vSbox}[(${getRa})%256+1]`)}`;
        break;
      case Op.APPEND:
        body = `${vOut}[#${vOut}+1]=string.char(${getRa})`;
        break;
      case Op.INC:
        body = `${vRegs}[${vRd}+1]=${vRegs}[${vRd}+1]+1`;
        break;
      case Op.LOADLEN:
        body = `${setRd(`#${vData}`)}`;
        break;
      case Op.RET:
        body = `return table.concat(${vOut})`;
        break;
      case Op.RETNIL:
        body = `return nil`;
        break;
      default:
        body = `-- nop`;
    }
    opCases.push(`  elseif ${vOp}==${enc} then ${body}`);
  }
  // Replace first 'elseif' with 'if'
  if (opCases.length > 0) {
    opCases[0] = opCases[0]!.replace("  elseif", "  if");
  }
  opCases.push("  end");

  // --- 5. Data payload (escaped) -------------------------------------------
  let dataLit = '"';
  for (let i = 0; i < encoded.length; i++) dataLit += "\\" + encoded[i];
  dataLit += '"';

  // --- 6. VM interpreter function ------------------------------------------
  // Dispatches on opcodes, handles pc increment at bottom of loop.
  const interpreterBody = `
local function ${vVM}(${vData})
  local ${vRegs}={}
  for _i=1,${NREGS_EMIT} do ${vRegs}[_i]=0 end
  local ${vOut}={}
  local ${vFlag}=false
  local ${vPc}=1
  local ${vLen}=#${vCode}
  while ${vPc}<=${vLen} do
    local ${vInstr}=${vCode}[${vPc}]
    local ${vOp}=${vInstr}[1]
    local ${vRd}=${vInstr}[2]
    local ${vRa}=${vInstr}[3]
    local ${vRb}=${vInstr}[4]
    local ${vK}=${vInstr}[5]
${opCases.join("\n")}
    ${vPc}=${vPc}+1
  end
end
`.trim();

  // --- 7. Boot block -------------------------------------------------------
  const boot = `local ${vRes}=${vVM}(${vData})
if ${vRes}~=nil then
  local _ld=load or loadstring
  local _fn,_err=_ld(${vRes})
  if _fn then _fn() else error(_err) end
end`;

  // --- Assemble final output -----------------------------------------------
  const lines: string[] = [
    `-- obfuscated by 6larping7/obfuscateLua`,
    `local ${vConsts}=${constsLit}`,
    `local ${vSbox}={string.byte(${sboxEsc},1,256)}`,
    `local ${vCode}=${codeLit}`,
    `local ${vData}=${dataLit}`,
    interpreterBody,
    boot,
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ObfuscateOptions {
  /** Extra passes (1 = single, 2 = wrap result in second layer). Default: 1 */
  passes?: 1 | 2;
}

export function obfuscateLua(source: string, opts: ObfuscateOptions = {}): string {
  const passes = opts.passes ?? 1;
  let current = source;
  for (let pass = 0; pass < passes; pass++) {
    current = _obfuscateOnce(current);
  }
  return current;
}

function _obfuscateOnce(source: string): string {
  const plain = new TextEncoder().encode(source);

  // Cipher parameters — all random per call
  const p: CipherParams = {
    seed:    rndRange(1,   255),
    step:    rndRange(1,   127),
    salt:    rndRange(1,   63),
    initial: rndInt(256),
    lcgSeed: rndRange(1,   LCG_M - 1),
  };
  const sbox = buildSbox();

  // Encode
  const encoded = encode(plain, sbox, p);

  // Integrity: Fletcher-16 of the plaintext; VM recomputes & checks
  const [expA, expB] = fletcher16(plain);

  // Compile VM bytecode
  const vm = compile(encoded, sbox, p, expA, expB);

  // Emit Lua
  return emitLua(vm, encoded);
}

// ---------------------------------------------------------------------------
// CLI entry point (Node / Bun / Deno)
// ---------------------------------------------------------------------------

if (
  (typeof process !== "undefined" && process.argv[1] && import.meta.url.endsWith(process.argv[1])) ||
  (typeof Deno !== "undefined" && (Deno as unknown as { mainModule?: string }).mainModule === import.meta.url)
) {
  const { readFileSync, writeFileSync } = await import("node:fs");
  const args = (typeof process !== "undefined" ? process.argv.slice(2) : []);
  const passes = args.includes("--double") ? 2 : 1;

  if (args.length === 0 || args[0] === "--help") {
    console.error("Usage: obfuscateLua <input.lua> [output.lua] [--double]");
    process.exit(0);
  }

  const inPath  = args.find(a => !a.startsWith("--"))!;
  const outPath = args.filter(a => !a.startsWith("--"))[1] ?? inPath.replace(/\.lua$/, ".obf.lua");
  const src     = readFileSync(inPath, "utf8");
  const result  = obfuscateLua(src, { passes });
  writeFileSync(outPath, result, "utf8");
  console.log(`[obfuscateLua] ${inPath} → ${outPath}  (passes=${passes}, ${src.length}b → ${result.length}b)`);
}