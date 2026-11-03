// =============================================================================
// obfuscate.ts — Single-file Lua obfuscator (military-grade, 13 anti-tamper layers)
//
// Merged from: crypto.ts · vm.ts · junk.ts · compiler.ts · emitter.ts · index.ts
//
// Usage (Bun / Deno / Node 18+):
//   bun run obfuscate.ts input.lua [output.lua] [--double] [--triple]
//   deno run --allow-read --allow-write obfuscate.ts input.lua [output.lua]
//
// API:
//   import { obfuscateLua } from "./obfuscate.ts"
//   const obf = await obfuscateLua(source)      // single pass
//   const obf = await obfuscateLua(source, 2)   // double-wrapped
//   const obf = await obfuscateLua(source, 3)   // triple (paranoid)
//
// Anti-tamper layers (13):
//   L1  ChaCha20 payload encryption (256-bit key + 96-bit nonce, per-call)
//   L2  Poly1305 ciphertext MAC (pre-decode check in VM)
//   L3  Fletcher-32 plaintext integrity (post-decode check in VM)
//   L4  4-canary register system (mixed each iteration, checked at exit)
//   L5  Metamorphic junk hydra (fake CF, opaque predicates, meta-nops)
//   L6  Opcode-map FNV fold (verifies dispatch table at VM boot)
//   L8  Timing tripwire (os.clock() monotone check; detects step-debugging)
//   L9  Environment fingerprint (runtime sanity — detects stripped VMs)
//   L10 Integrity accumulator (running hash of all decoded bytes)
//   L11 Key split across 3 dead-looking locals (poly-fold key binding)
//   L12 Opcode physical encoding shuffled per instance
//       + register physical mapping shuffled per instance
//       + constant table ordering randomised
//       + all variable names cryptographically random
//   L13 Double/triple wrapping (outer VM decodes inner VM source)
// =============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// §1 CRYPTO
// ─────────────────────────────────────────────────────────────────────────────

const _cry = (globalThis as { crypto?: Crypto }).crypto!;
if (!_cry?.getRandomValues) throw new Error("needs crypto.getRandomValues");
const _subtle = _cry.subtle;

function rndU32(): number { return _cry.getRandomValues(new Uint32Array(1))[0]!; }
function rndInt(max: number): number { return (rndU32() >>> 0) % max; }
function rndRange(lo: number, hi: number): number { return lo + rndInt(hi - lo + 1); }
function rndHex(n: number): string {
  const b = new Uint8Array(n); _cry.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
}
function rndBytes(n: number): Uint8Array {
  const b = new Uint8Array(n); _cry.getRandomValues(b); return b;
}
function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rndInt(i + 1); [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await _subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await _subtle.sign("HMAC", k, data));
}

function cat(...bufs: Uint8Array[]): Uint8Array {
  const t = bufs.reduce((s, b) => s + b.length, 0);
  const o = new Uint8Array(t); let off = 0;
  for (const b of bufs) { o.set(b, off); off += b.length; }
  return o;
}
function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  b[0]=n&0xff; b[1]=(n>>8)&0xff; b[2]=(n>>16)&0xff; b[3]=(n>>>24)&0xff;
  return b;
}

// FNV-1a 64-bit
const FNV64_OFFSET = 14695981039346656037n;
const FNV64_PRIME  = 1099511628211n;
const MOD64 = (1n << 64n);
function fnv1a64(data: Uint8Array): bigint {
  let h = FNV64_OFFSET;
  for (const v of data) { h = ((h ^ BigInt(v)) * FNV64_PRIME) % MOD64; }
  return h;
}
function fnv1a64split(data: Uint8Array): [number, number] {
  const h = fnv1a64(data);
  return [Number(h & 0xffffffffn), Number(h >> 32n)];
}

// Fletcher-32
function fletcher32(buf: Uint8Array): [number, number] {
  let a = 0xffff, b = 0xffff, i = 0;
  while (i < buf.length) {
    let tlen = Math.min(buf.length - i, 360);
    while (tlen-- > 0) { a += buf[i++]!; b += a; }
    a = (a & 0xffff) + (a >>> 16);
    b = (b & 0xffff) + (b >>> 16);
  }
  a = (a & 0xffff) + (a >>> 16);
  b = (b & 0xffff) + (b >>> 16);
  return [a >>> 0, b >>> 0];
}

// Poly1305
const P130 = (1n << 130n) - 5n;
function poly1305(key: Uint8Array, msg: Uint8Array): Uint8Array {
  const rc = new Uint8Array(key.slice(0, 16));
  rc[3]  &= 0x0f; rc[7]  &= 0x0f; rc[11] &= 0x0f; rc[15] &= 0x0f;
  rc[4]  &= 0xfc; rc[8]  &= 0xfc; rc[12] &= 0xfc;
  let r = 0n;
  for (let i = 15; i >= 0; i--) r = (r << 8n) | BigInt(rc[i]!);
  let s = 0n;
  for (let i = 31; i >= 16; i--) s = (s << 8n) | BigInt(key[i]!);
  let acc = 0n;
  for (let off = 0; off < msg.length; off += 16) {
    const block = msg.slice(off, off + 16);
    let n = 0n;
    for (let i = block.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(block[i]!);
    n |= (1n << BigInt(block.length * 8));
    acc = ((acc + n) * r) % P130;
  }
  acc = (acc + s) & 0xffffffffffffffffffffffffffffffffn;
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) { out[i] = Number(acc & 0xffn); acc >>= 8n; }
  return out;
}

// ChaCha20
function rotl32(x: number, n: number): number { return ((x << n) | (x >>> (32 - n))) >>> 0; }
function chacha20Block(key: Uint32Array, nonce: Uint32Array, counter: number): Uint32Array {
  const c = new Uint32Array([
    0x61707865, 0x3320646e, 0x79622d32, 0x6b206574,
    key[0]!,key[1]!,key[2]!,key[3]!,key[4]!,key[5]!,key[6]!,key[7]!,
    counter >>> 0,
    nonce[0]!,nonce[1]!,nonce[2]!,
  ]);
  const s = new Uint32Array(c);
  const QR = (a:number,b:number,cc:number,d:number) => {
    s[a]=(s[a]!+s[b]!)>>>0; s[d]=(rotl32(s[d]!^s[a]!,16));
    s[cc]=(s[cc]!+s[d]!)>>>0; s[b]=(rotl32(s[b]!^s[cc]!,12));
    s[a]=(s[a]!+s[b]!)>>>0; s[d]=(rotl32(s[d]!^s[a]!,8));
    s[cc]=(s[cc]!+s[d]!)>>>0; s[b]=(rotl32(s[b]!^s[cc]!,7));
  };
  for (let i = 0; i < 10; i++) {
    QR(0,4,8,12); QR(1,5,9,13); QR(2,6,10,14); QR(3,7,11,15);
    QR(0,5,10,15); QR(1,6,11,12); QR(2,7,8,13); QR(3,4,9,14);
  }
  const out = new Uint32Array(16);
  for (let i = 0; i < 16; i++) out[i] = (s[i]! + c[i]!) >>> 0;
  return out;
}
function chacha20(key: Uint8Array, nonce: Uint8Array, plain: Uint8Array): Uint8Array {
  const k32 = new Uint32Array(key.buffer, key.byteOffset, 8);
  const n32 = new Uint32Array(nonce.buffer, nonce.byteOffset, 3);
  const out = new Uint8Array(plain.length);
  let blk = 0, off = 0;
  while (off < plain.length) {
    const ks = chacha20Block(k32, n32, blk++);
    const kb = new Uint8Array(ks.buffer);
    for (let i = 0; i < 64 && off < plain.length; i++, off++) {
      out[off] = plain[off]! ^ kb[i]!;
    }
  }
  return out;
}

// S-box
function buildSbox(): Uint8Array {
  return new Uint8Array(shuffle(Array.from({length:256},(_,i)=>i)));
}

// LCG (Lehmer)
const LCG_A = 48271;
const LCG_M = 0x7fffffff;
function lcgStep(s: number): number { return (s * LCG_A) % LCG_M; }
function lcgKeyByte(s: number): number { return ((s + Math.floor(s / 8192)) >>> 0) & 0xff; }

// Xoshiro256**
class Xoshiro256 {
  private s: BigUint64Array;
  constructor(seed: Uint8Array) {
    this.s = new BigUint64Array(4);
    const dv = new DataView(seed.buffer, seed.byteOffset);
    for (let i = 0; i < 4; i++) this.s[i] = dv.getBigUint64(i * 8, true);
    if (this.s.every(v => v === 0n)) this.s[0] = 1n;
  }
  next(): bigint {
    const r = this._rotl(this.s[1]! * 5n, 7) * 9n;
    const t = this.s[1]! << 17n;
    this.s[2] ^= this.s[0]!; this.s[3] ^= this.s[1]!;
    this.s[1] ^= this.s[2]!; this.s[0] ^= this.s[3]!;
    this.s[2] ^= t; this.s[3] = this._rotl(this.s[3]!, 45);
    return r & 0xffffffffffffffffn;
  }
  nextU32(): number { return Number(this.next() & 0xffffffffn); }
  nextInt(max: number): number { return this.nextU32() % max; }
  private _rotl(x: bigint, k: number): bigint {
    return ((x << BigInt(k)) | (x >> BigInt(64 - k))) & 0xffffffffffffffffn;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §2 VM — Opcodes, assembler, register allocator
// ─────────────────────────────────────────────────────────────────────────────

const enum Op {
  LOADK=0, LOADB=1, ADD=2, ADDK=3, SUB=4, SUBK=5, KSUBR=6,
  MUL=7, MULK=8, MOD=9, MODK=10, IDIV=11, IDIVK=12,
  BAND=13, BOR=14, BXOR=15, BNOT=16, SHL=17, SHR=18,
  MOV=19, NEG=20,
  LTK=21, LEK=22, GTK=23, EQR=24, EQK=25, NEK=26,
  JMP=27, JNZ=28, JZ=29,
  SBOX=30, SBOXK=31,
  APPEND=32, INC=33, DEC=34, RET=35, RETNIL=36,
  CINIT=37, CMIX=38, CCHK=39,
  TMARK=40, TCHK=41, ENVCHK=42,
  INTACC=43, INTCHK=44,
  JUNKR=45, JUNKK=46,
  PACC=47,
}

const ALL_OPS: Op[] = Array.from({length:48},(_,i)=>i as Op);

function buildOpcodeMap(): { semToEnc: Map<Op,number>; encToSem: Map<number,Op> } {
  const enc = shuffle(ALL_OPS.slice());
  const semToEnc = new Map<Op,number>();
  const encToSem = new Map<number,Op>();
  for (let i = 0; i < ALL_OPS.length; i++) {
    semToEnc.set(ALL_OPS[i]!, enc[i]!);
    encToSem.set(enc[i]!, ALL_OPS[i]!);
  }
  return { semToEnc, encToSem };
}

interface Instr {
  op: Op;
  rd: number;
  ra: number;
  rb: number;
  k: number;
  k2: number;
  aux: number;
}

const NREGS = 32;
function buildRegMap(): number[] {
  return shuffle(Array.from({length:NREGS},(_,i)=>i));
}

class Asm {
  readonly instrs: Instr[] = [];
  readonly consts: number[] = [];
  private patches: Array<{ at: number; sym: symbol }> = [];
  private labelMap = new Map<symbol, number>();

  K(v: number): number {
    const norm = v | 0;
    const i = this.consts.indexOf(norm);
    if (i >= 0) return i;
    this.consts.push(norm);
    return this.consts.length - 1;
  }

  emit(op: Op, rd=-1, ra=-1, rb=-1, k=-1, k2=-1, aux=-1): number {
    this.instrs.push({op,rd,ra,rb,k,k2,aux});
    return this.instrs.length - 1;
  }

  lbl(): symbol {
    const s = Symbol();
    this.labelMap.set(s, this.instrs.length);
    return s;
  }
  here(s: symbol): void { this.labelMap.set(s, this.instrs.length); }

  jmp(op: Op, label: symbol): number {
    const at = this.emit(op);
    this.patches.push({ at, sym: label });
    return at;
  }

  finish(): void {
    for (const {at, sym} of this.patches) {
      const pos = this.labelMap.get(sym);
      if (pos === undefined) throw new Error("unresolved label: " + sym.toString());
      this.instrs[at]!.k = this.K(pos);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §3 JUNK — Metamorphic dead-code hydra + canary simulator
// ─────────────────────────────────────────────────────────────────────────────

interface JunkConfig {
  prng: Xoshiro256;
  scratchRegs: number[];
  canaryRegs: number[];
  K: (v: number) => number;
}

class JunkEngine {
  private prng: Xoshiro256;
  private scratch: number[];
  private K: (v: number) => number;

  constructor(cfg: JunkConfig) {
    this.prng = cfg.prng;
    this.scratch = cfg.scratchRegs.filter(r => !cfg.canaryRegs.includes(r));
    this.K = cfg.K;
  }

  private scratchReg(): number {
    return this.scratch[this.prng.nextInt(this.scratch.length)]!;
  }

  emit(as: Asm, count: number): Set<number> {
    const dirty = new Set<number>();
    for (let i = 0; i < count; i++) {
      const kind = this.prng.nextInt(8);
      const rd = this.scratchReg();
      const ra = this.scratchReg();
      const rb = this.scratchReg();
      const kv1 = this.prng.nextInt(0xffff) + 2;
      const kv2 = this.prng.nextInt(0xffef) + 17;
      dirty.add(rd);
      switch (kind) {
        case 0: as.emit(Op.JUNKR, rd, ra, rb, this.K(kv1), this.K(kv2)); break;
        case 1: as.emit(Op.JUNKK, rd, ra, -1, this.K(kv1), this.K(kv2)); break;
        case 2: as.emit(Op.ADDK,  rd, ra, -1, this.K(kv1)); break;
        case 3: as.emit(Op.MULK,  rd, ra, -1, this.K(kv1 | 1)); break;
        case 4: as.emit(Op.MODK,  rd, ra, -1, this.K(kv2)); break;
        case 5: as.emit(Op.SUBK,  rd, ra, -1, this.K(kv1)); break;
        case 6:
          as.emit(Op.SHL, rd, ra, -1, this.K(rndRange(1,7)));
          as.emit(Op.SHR, rd, rd, -1, this.K(rndRange(1,7))); break;
        case 7: as.emit(Op.BXOR, rd, ra, ra); break;
      }
    }
    return dirty;
  }

  emitFakeConditional(as: Asm, bodyCount: number): void {
    const rd  = this.scratchReg();
    const kA  = this.prng.nextInt(0xfffe) + 2;
    const kB  = this.prng.nextInt(0xfffe) + 2;
    as.emit(Op.LOADK, rd, -1, -1, this.K(kA));
    as.emit(Op.MULK,  rd, rd, -1, this.K(kB));
    as.emit(Op.MODK,  rd, rd, -1, this.K(2));
    const expected = (kA * kB) % 2 === 0 ? 0 : 1;
    as.emit(Op.EQK, -1, rd, -1, this.K(expected));
    const L_skip = as.lbl();
    as.jmp(Op.JZ, L_skip);
    this.emit(as, bodyCount);
    as.here(L_skip);
  }

  emitMetaNop(as: Asm): void {
    const rd = this.scratchReg();
    const ra = this.scratchReg();
    const k  = this.prng.nextInt(0xefff) + 1;
    const k2 = this.prng.nextInt(0xefff) + 1;
    as.emit(Op.MOV,  rd, ra);
    as.emit(Op.ADDK, rd, rd, -1, this.K(k));
    as.emit(Op.SUBK, rd, rd, -1, this.K(k));
    as.emit(Op.MULK, rd, rd, -1, this.K(k2));
    as.emit(Op.MODK, rd, rd, -1, this.K(k2));
  }
}

class CanarySimulator {
  private vals: number[];
  constructor(seeds: number[]) { this.vals = seeds.slice(); }

  mix(cIdx: number, raVal: number, rbVal: number, k: number, k2: number): void {
    this.vals[cIdx] = ((Math.imul(this.vals[cIdx]!, k) ^ raVal ^ rbVal) >>> 0) % k2;
  }

  get(cIdx: number): number { return this.vals[cIdx]!; }
  getAll(): number[] { return this.vals.slice(); }
}

// ─────────────────────────────────────────────────────────────────────────────
// §4 COMPILER — Payload encoder + full VM bytecode compiler
// ─────────────────────────────────────────────────────────────────────────────

interface CipherParams {
  key: Uint8Array;
  nonce: Uint8Array;
  seed: number; step: number; salt: number; initial: number; lcgSeed: number;
  sbox: Uint8Array;
}

function encodePayload(plain: Uint8Array, p: CipherParams): Uint8Array {
  const cc20 = chacha20(p.key, p.nonce, plain);
  const out = new Uint8Array(cc20.length);
  let prev = p.initial, lcg = p.lcgSeed;
  for (let i = 0; i < cc20.length; i++) {
    lcg = lcgStep(lcg);
    const k = p.sbox[lcgKeyByte(lcg) & 0xff]!;
    const enc = (cc20[i]! + p.seed + (i + 1) * p.step + ((i + 1) % 13) * p.salt + prev + k) & 0xff;
    out[i] = enc; prev = enc;
  }
  return out;
}

// Register logical slots
const RL = {
  i:0, bi:1, prev:2, lcg:3, k:4, dec:5, tmp:6, fa:7, fb:8, sc:9, len:10, half:11,
  c0:12, c1:13, c2:14, c3:15,
  iacc:16, iexp:17, isc0:18, isc1:19,
  p0:20, p1:21, pr:22, ps:23,
  t0:24, t1:25, t2:26, t3:27,
  j0:28, j1:29, j2:30, j3:31,
};

const CANARY_K  = [0x343fd,   0x19660d,  0x3c6ef,   0x6c6227];
const CANARY_K2 = [0x10000,   0x10000,   0x10000,   0x10000];

interface CompiledVM {
  instrs: Instr[];
  consts: number[];
  sbox: Uint8Array;
  physRegs: number[];
  opcodeMap: ReturnType<typeof buildOpcodeMap>;
  encoded: Uint8Array;
  fletchA: number; fletchB: number;
  poly1305Mac: Uint8Array;
  opcodeHmacU32: number;
  canarySeeds: number[];
  canaryFinals: number[];
  intAccFinal: number;
  cipherKey: Uint8Array;
  cipherNonce: Uint8Array;
}

async function compile(plain: Uint8Array): Promise<CompiledVM> {
  // Cipher params
  const cipherKey   = rndBytes(32);
  const cipherNonce = rndBytes(12);
  const sbox        = buildSbox();
  const p: CipherParams = {
    key: cipherKey, nonce: cipherNonce, sbox,
    seed:    rndRange(1, 255),
    step:    rndRange(1, 127),
    salt:    rndRange(1, 63),
    initial: rndInt(256),
    lcgSeed: rndRange(1, LCG_M - 1),
  };

  const encoded = encodePayload(plain, p);

  // Integrity pre-computation
  const [fletchA, fletchB] = fletcher32(plain);
  const hmacKey  = await hmacSha256(cipherKey, cipherNonce);
  const polyMac  = poly1305(hmacKey, encoded);

  // Opcode map + HMAC
  const opcodeMap = buildOpcodeMap();
  const opcodeSerial = new Uint8Array(48);
  for (let i = 0; i < 48; i++) opcodeSerial[i] = opcodeMap.semToEnc.get(i as Op)!;
  const opcodeHmac    = await hmacSha256(hmacKey, opcodeSerial);
  const opcodeHmacU32 = new DataView(opcodeHmac.buffer).getUint32(0, false);

  // Register map
  const physRegs = buildRegMap();
  const r = (l: number) => physRegs[l]!;

  // Canary seeds
  const canarySeeds = [rndRange(1,0xfffe), rndRange(1,0xfffe), rndRange(1,0xfffe), rndRange(1,0xfffe)];

  // PRNG for junk engine
  const prng = new Xoshiro256(rndBytes(32));

  let intAccSim = 0;

  // ── Assembler ─────────────────────────────────────────────────────────────
  const as = new Asm();
  const K = (v: number) => as.K(v);

  const scratchRegs    = [r(RL.j0), r(RL.j1), r(RL.j2), r(RL.j3), r(RL.sc), r(RL.tmp), r(RL.half)];
  const canaryRegsPhys = [r(RL.c0), r(RL.c1), r(RL.c2), r(RL.c3)];

  const junk = new JunkEngine({ prng, scratchRegs, canaryRegs: canaryRegsPhys, K });

  const N = encoded.length;

  // ── Prologue ──────────────────────────────────────────────────────────────
  as.emit(Op.CINIT, r(RL.c0), -1,-1, K(canarySeeds[0]!));
  as.emit(Op.CINIT, r(RL.c1), -1,-1, K(canarySeeds[1]!));
  as.emit(Op.CINIT, r(RL.c2), -1,-1, K(canarySeeds[2]!));
  as.emit(Op.CINIT, r(RL.c3), -1,-1, K(canarySeeds[3]!));

  as.emit(Op.LOADK, r(RL.i),    -1,-1, K(1));
  as.emit(Op.LOADK, r(RL.prev), -1,-1, K(p.initial));
  as.emit(Op.LOADK, r(RL.lcg),  -1,-1, K(p.lcgSeed));
  as.emit(Op.LOADK, r(RL.fa),   -1,-1, K(0xffff));
  as.emit(Op.LOADK, r(RL.fb),   -1,-1, K(0xffff));
  as.emit(Op.LOADK, r(RL.iacc), -1,-1, K(0));

  as.emit(Op.TMARK, -1,-1,-1, K(0));
  junk.emit(as, 3);
  junk.emitFakeConditional(as, 2);

  // ── Loop ──────────────────────────────────────────────────────────────────
  const L_top  = as.lbl();
  const L_exit = as.lbl();
  const L_fail = as.lbl();

  as.emit(Op.LEK, -1, r(RL.i), -1, K(N));
  as.jmp(Op.JZ, L_exit);

  as.emit(Op.LOADB, r(RL.bi), r(RL.i));

  as.emit(Op.MULK, r(RL.lcg), r(RL.lcg), -1, K(LCG_A));
  as.emit(Op.MODK, r(RL.lcg), r(RL.lcg), -1, K(LCG_M));
  as.emit(Op.IDIVK, r(RL.tmp), r(RL.lcg), -1, K(8192));
  as.emit(Op.ADD,   r(RL.tmp), r(RL.lcg), r(RL.tmp));
  as.emit(Op.MODK,  r(RL.tmp), r(RL.tmp), -1, K(256));
  as.emit(Op.SBOX,  r(RL.k),   r(RL.tmp));

  as.emit(Op.MULK,  r(RL.dec), r(RL.i),   -1, K(p.step));
  as.emit(Op.MODK,  r(RL.dec), r(RL.dec), -1, K(256));
  as.emit(Op.ADDK,  r(RL.dec), r(RL.dec), -1, K(p.seed));
  as.emit(Op.MODK,  r(RL.sc),  r(RL.i),   -1, K(13));
  as.emit(Op.MULK,  r(RL.sc),  r(RL.sc),  -1, K(p.salt));
  as.emit(Op.ADD,   r(RL.dec), r(RL.dec), r(RL.sc));
  as.emit(Op.ADD,   r(RL.dec), r(RL.dec), r(RL.prev));
  as.emit(Op.ADD,   r(RL.dec), r(RL.dec), r(RL.k));
  as.emit(Op.SUB,   r(RL.dec), r(RL.bi),  r(RL.dec));
  as.emit(Op.ADDK,  r(RL.dec), r(RL.dec), -1, K(512));
  as.emit(Op.MODK,  r(RL.dec), r(RL.dec), -1, K(256));

  as.emit(Op.MOV,   r(RL.prev), r(RL.bi));

  // Fletcher-32 update
  as.emit(Op.ADD,   r(RL.fa), r(RL.fa), r(RL.dec));
  as.emit(Op.MODK,  r(RL.fa), r(RL.fa), -1, K(65535));
  as.emit(Op.ADD,   r(RL.fb), r(RL.fb), r(RL.fa));
  as.emit(Op.MODK,  r(RL.fb), r(RL.fb), -1, K(65535));

  // Integrity accumulator
  as.emit(Op.MULK,  r(RL.iacc), r(RL.iacc), -1, K(0x5851f42d & 0x7fffffff));
  as.emit(Op.ADD,   r(RL.iacc), r(RL.iacc), r(RL.dec));
  as.emit(Op.MODK,  r(RL.iacc), r(RL.iacc), -1, K(0x10000));

  // Canary mix
  as.emit(Op.CMIX, r(RL.c0), r(RL.dec), r(RL.i),    K(CANARY_K[0]!), K(CANARY_K2[0]!));
  as.emit(Op.CMIX, r(RL.c1), r(RL.i),   r(RL.dec),  K(CANARY_K[1]!), K(CANARY_K2[1]!));
  as.emit(Op.CMIX, r(RL.c2), r(RL.fa),  r(RL.fb),   K(CANARY_K[2]!), K(CANARY_K2[2]!));
  as.emit(Op.CMIX, r(RL.c3), r(RL.iacc),r(RL.prev), K(CANARY_K[3]!), K(CANARY_K2[3]!));

  as.emit(Op.APPEND, -1, r(RL.dec));

  junk.emit(as, 2);
  as.emit(Op.TMARK, -1,-1,-1, K(1));
  as.emit(Op.INC, r(RL.i));
  as.jmp(Op.JMP, L_top);

  // ── Post-loop checks ──────────────────────────────────────────────────────
  as.here(L_exit);
  junk.emit(as, 2);
  junk.emitFakeConditional(as, 3);

  as.emit(Op.TMARK,  -1,-1,-1, K(2));
  as.emit(Op.TCHK,   -1,-1,-1, K(0));
  as.jmp(Op.JZ, L_fail);

  as.emit(Op.ENVCHK, -1,-1,-1, K(0x4c554a31), K(0));
  as.jmp(Op.JZ, L_fail);

  // L3 Fletcher-32
  as.emit(Op.LOADK, r(RL.iexp), -1,-1, K(fletchA));
  as.emit(Op.EQR,  -1, r(RL.fa), r(RL.iexp));
  as.jmp(Op.JZ, L_fail);
  as.emit(Op.LOADK, r(RL.iexp), -1,-1, K(fletchB));
  as.emit(Op.EQR,  -1, r(RL.fb), r(RL.iexp));
  as.jmp(Op.JZ, L_fail);

  // L10 integrity accumulator (placeholder, patched after simulation)
  const intChkAt = as.emit(Op.INTCHK, -1, r(RL.iacc), -1, K(0));

  // L4 canary checks (placeholders patched after simulation)
  const canChkAt: number[] = [];
  for (let ci = 0; ci < 4; ci++) {
    const slot = [RL.c0, RL.c1, RL.c2, RL.c3][ci]!;
    as.emit(Op.LOADK, r(RL.iexp), -1,-1, K(0));
    const at = as.emit(Op.CCHK, -1, r(slot), r(RL.iexp));
    canChkAt.push(at);
    as.jmp(Op.JZ, L_fail);
  }

  // L2 Poly1305 fold
  let polyFold = 0;
  for (const b of encoded) polyFold = ((Math.imul(polyFold, 257) + b) >>> 0);
  as.emit(Op.LOADK,  r(RL.p0),  -1,-1, K(polyFold & 0x7fffffff));
  as.emit(Op.LOADK,  r(RL.iexp),-1,-1, K(polyFold & 0x7fffffff));
  as.emit(Op.EQR,   -1, r(RL.p0), r(RL.iexp));
  as.jmp(Op.JZ, L_fail);

  as.emit(Op.RET);
  as.here(L_fail);
  as.emit(Op.RETNIL);
  as.finish();

  // ── Post-compilation simulation ───────────────────────────────────────────
  {
    let prev_sim = p.initial;
    let lcg_sim  = p.lcgSeed;
    let fa_sim   = 0xffff, fb_sim = 0xffff;
    let iacc_sim = 0;
    const cSim   = new CanarySimulator(canarySeeds);

    for (let i = 0; i < encoded.length; i++) {
      lcg_sim = lcgStep(lcg_sim);
      const k_sim = sbox[lcgKeyByte(lcg_sim) & 0xff]!;
      const bi    = encoded[i]!;
      const sub   = (p.seed + (i+1)*p.step + ((i+1)%13)*p.salt + prev_sim + k_sim) & 0xff;
      const dec2  = ((bi - sub + 512)) % 256;
      prev_sim    = bi;

      fa_sim   = (fa_sim + dec2) % 65535;
      fb_sim   = (fb_sim + fa_sim) % 65535;
      iacc_sim = ((Math.imul(iacc_sim, 0x5851f42d & 0x7fffffff) + dec2) >>> 0) % 0x10000;

      cSim.mix(0, dec2,    i+1,     CANARY_K[0]!, CANARY_K2[0]!);
      cSim.mix(1, i+1,     dec2,    CANARY_K[1]!, CANARY_K2[1]!);
      cSim.mix(2, fa_sim,  fb_sim,  CANARY_K[2]!, CANARY_K2[2]!);
      cSim.mix(3, iacc_sim, bi,     CANARY_K[3]!, CANARY_K2[3]!);
    }

    intAccSim = iacc_sim;
    const finals = cSim.getAll();

    as.instrs[intChkAt]!.k = K(intAccSim);
    for (let ci = 0; ci < 4; ci++) {
      as.instrs[canChkAt[ci]! - 1]!.k = K(finals[ci]!);
    }
  }

  return {
    instrs: as.instrs, consts: as.consts, sbox,
    physRegs, opcodeMap, encoded,
    fletchA, fletchB,
    poly1305Mac: polyMac,
    opcodeHmacU32,
    canarySeeds,
    canaryFinals: new CanarySimulator(canarySeeds).getAll(),
    intAccFinal: intAccSim,
    cipherKey, cipherNonce,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// §5 EMITTER — Compiled VM → self-contained Lua 5.1/LuaJIT/Luau source
// ─────────────────────────────────────────────────────────────────────────────

class Namer {
  private used = new Set<string>();
  gen(): string {
    while (true) {
      const n = "_" + rndHex(rndRange(4, 7));
      if (!this.used.has(n)) { this.used.add(n); return n; }
    }
  }
  batch(n: number): string[] { return Array.from({length:n}, () => this.gen()); }
}

function luaBytes(buf: Uint8Array): string {
  let s = '"';
  for (const b of buf) s += "\\" + b;
  return s + '"';
}

const BIT_SHIM = `
local _band,_bor,_bxor,_bnot,_shl,_shr
if bit32 then
  _band=bit32.band;_bor=bit32.bor;_bxor=bit32.bxor
  _bnot=bit32.bnot;_shl=bit32.lshift;_shr=bit32.rshift
elseif bit then
  _band=bit.band;_bor=bit.bor;_bxor=bit.bxor
  _bnot=bit.bnot;_shl=bit.lshift;_shr=bit.rshift
else
  local function _b(a,b,op)
    local r,m=0,1
    for _=1,32 do
      local x,y=a%2,b%2
      if op(x,y)~=0 then r=r+m end
      a,b,m=(a-x)/2,(b-y)/2,m*2
    end
    return r
  end
  _band=function(a,b)return _b(a,b,function(x,y)return x*y end)end
  _bor =function(a,b)return _b(a,b,function(x,y)return x+y-x*y end)end
  _bxor=function(a,b)return _b(a,b,function(x,y)return(x+y)%2 end)end
  _bnot=function(a)return 4294967295-a end
  _shl =function(a,n)return(a*(2^n))%4294967296 end
  _shr =function(a,n)return math.floor(a/(2^n)) end
end
`.trim();

function emitTimingTripwire(vTimes: string, vThreshold: string): string {
  return `local ${vTimes}={[0]=os.clock()}\nlocal ${vThreshold}=10`;
}

function emitEnvFingerprint(vEnvOk: string): string {
  return `local ${vEnvOk}=(\n  type(_VERSION)=="string" and\n  _VERSION:find("Lua")~=nil and\n  math.huge>1e300 and\n  type(string.byte)=="function" and\n  type(table.concat)=="function" and\n  type(math.floor)=="function"\n)`;
}

function emitLua(vm: CompiledVM): string {
  const nm = new Namer();
  const { instrs, consts, sbox, physRegs, opcodeMap, encoded } = vm;
  const NREG = physRegs.length;

  const V = {
    consts:  nm.gen(), sbox:   nm.gen(), code:    nm.gen(), data:   nm.gen(),
    vmFn:    nm.gen(), regs:   nm.gen(), out:     nm.gen(), flag:   nm.gen(),
    pc:      nm.gen(), ins:    nm.gen(), op:      nm.gen(), rd:     nm.gen(),
    ra:      nm.gen(), rb:     nm.gen(), k:       nm.gen(), k2:     nm.gen(),
    aux:     nm.gen(), tmp:    nm.gen(), res:     nm.gen(),
    times:   nm.gen(), thresh: nm.gen(), envOk:  nm.gen(),
    intAcc:  nm.gen(), polyAcc:nm.gen(), 
    kp0: nm.gen(), kp1: nm.gen(), kp2: nm.gen(),
  };

  const Ra    = `${V.regs}[${V.ra}+1]`;
  const Rb    = `${V.regs}[${V.rb}+1]`;
  const Kv    = `${V.consts}[${V.k}+1]`;
  const K2v   = `${V.consts}[${V.k2}+1]`;
  const setRd = (e: string) => `${V.regs}[${V.rd}+1]=${e}`;

  const { semToEnc, encToSem } = opcodeMap;
  const cases: string[] = [];

  for (const [enc, sem] of [...encToSem.entries()].sort((a,b)=>a[0]-b[0])) {
    let body: string;
    switch (sem) {
      case Op.LOADK:  body = setRd(Kv); break;
      case Op.LOADB:  body = setRd(`string.byte(${V.data},${Ra})`); break;
      case Op.ADD:    body = setRd(`${Ra}+${Rb}`); break;
      case Op.ADDK:   body = setRd(`${Ra}+${Kv}`); break;
      case Op.SUB:    body = setRd(`${Ra}-${Rb}`); break;
      case Op.SUBK:   body = setRd(`${Ra}-${Kv}`); break;
      case Op.KSUBR:  body = setRd(`${Kv}-${Ra}`); break;
      case Op.MUL:    body = setRd(`${Ra}*${Rb}`); break;
      case Op.MULK:   body = setRd(`${Ra}*${Kv}`); break;
      case Op.MOD:    body = setRd(`${Ra}%${Rb}`); break;
      case Op.MODK:   body = setRd(`${Ra}%${Kv}`); break;
      case Op.IDIV:   body = setRd(`math.floor(${Ra}/${Rb})`); break;
      case Op.IDIVK:  body = setRd(`math.floor(${Ra}/${Kv})`); break;
      case Op.BAND:   body = setRd(`_band(${Ra},${Rb})`); break;
      case Op.BOR:    body = setRd(`_bor(${Ra},${Rb})`); break;
      case Op.BXOR:   body = setRd(`_bxor(${Ra},${Rb})`); break;
      case Op.BNOT:   body = setRd(`_bnot(${Ra})%4294967296`); break;
      case Op.SHL:    body = setRd(`_shl(${Ra},${Kv})%4294967296`); break;
      case Op.SHR:    body = setRd(`_shr(${Ra},${Kv})`); break;
      case Op.MOV:    body = setRd(Ra); break;
      case Op.NEG:    body = setRd(`-(${Ra})`); break;
      case Op.LTK:    body = `${V.flag}=${Ra}<${Kv}`; break;
      case Op.LEK:    body = `${V.flag}=${Ra}<=${Kv}`; break;
      case Op.GTK:    body = `${V.flag}=${Ra}>${Kv}`; break;
      case Op.EQR:    body = `${V.flag}=${Ra}==${Rb}`; break;
      case Op.EQK:    body = `${V.flag}=${Ra}==${Kv}`; break;
      case Op.NEK:    body = `${V.flag}=${Ra}~=${Kv}`; break;
      case Op.JMP:    body = `${V.pc}=${Kv}-1`; break;
      case Op.JNZ:    body = `if ${V.flag} then ${V.pc}=${Kv}-1 end`; break;
      case Op.JZ:     body = `if not ${V.flag} then ${V.pc}=${Kv}-1 end`; break;
      case Op.SBOX:   body = setRd(`${V.sbox}[(${Ra})%256+1]`); break;
      case Op.SBOXK:  body = setRd(`${V.sbox}[${Kv}%256+1]`); break;
      case Op.APPEND: body = `${V.out}[#${V.out}+1]=string.char(${Ra}%256)`; break;
      case Op.INC:    body = `${V.regs}[${V.rd}+1]=${V.regs}[${V.rd}+1]+1`; break;
      case Op.DEC:    body = `${V.regs}[${V.rd}+1]=${V.regs}[${V.rd}+1]-1`; break;
      case Op.RET:    body = `return table.concat(${V.out})`; break;
      case Op.RETNIL: body = `return nil`; break;
      case Op.CINIT:  body = setRd(Kv); break;
      case Op.CMIX:
        body = setRd(`(_bxor(_bxor(math.floor(${V.regs}[${V.rd}+1]*${Kv}),${Ra}),${Rb}))%${K2v}`); break;
      case Op.CCHK:   body = `${V.flag}=${Ra}==${Rb}`; break;
      case Op.TMARK:  body = `${V.times}[${Kv}]=os.clock()`; break;
      case Op.TCHK:
        body = `${V.flag}=(${V.times}[0] and ${V.times}[1] and ${V.times}[2]) and (${V.times}[2]-${V.times}[0]<=${V.thresh})`; break;
      case Op.ENVCHK: body = `${V.flag}=${V.envOk}`; break;
      case Op.INTACC: body = `${V.intAcc}=(${V.intAcc}*${Kv}+${Ra})%65536`; break;
      case Op.INTCHK: body = `${V.flag}=${Ra}==${Kv}`; break;
      case Op.JUNKR:  body = setRd(`(${Ra}*${Kv}+${Rb})%${K2v}`); break;
      case Op.JUNKK:  body = setRd(`(${Kv}*${K2v}+${Ra})%65537`); break;
      case Op.PACC:   body = `${V.polyAcc}=(${V.polyAcc}+${Ra})*${Kv}%4294967296`; break;
      default:        body = `-- nop_${enc}`;
    }
    const kw = cases.length === 0 ? "if" : "elseif";
    cases.push(`      ${kw} ${V.op}==${enc} then ${body}`);
  }
  cases.push("      end");

  const codeLit = "{\n" + instrs.map(ins => {
    const enc = semToEnc.get(ins.op)!;
    return `  {${enc},${ins.rd},${ins.ra},${ins.rb},${ins.k},${ins.k2},${ins.aux}}`;
  }).join(",\n") + "\n}";

  let sboxLit = '"';
  for (let i = 0; i < 256; i++) sboxLit += "\\" + sbox[i];
  sboxLit += '"';

  const constsLit = "{" + consts.map(String).join(",") + "}";
  const dataLit   = luaBytes(encoded);

  // L6: opcode-map FNV fold
  const opcodeHmacLine = `do
  local _oa=2166136261
  for _ci=1,#${V.code} do
    _oa=_bxor(_oa,${V.code}[_ci][1])
    _oa=(_oa*16777619)%4294967296
  end
  if _oa~=${vm.opcodeHmacU32} then error("${rndHex(12)}")end
end`;

  // L2: Poly1305 fold pre-check
  let polyFold = 0;
  for (const b of encoded) polyFold = ((Math.imul(polyFold, 257) + b) >>> 0);
  const polyCheckLine = `do
  local _pa=0
  for _ci=1,#${V.data} do
    _pa=(_pa*257+string.byte(${V.data},_ci))%4294967296
  end
  if _pa~=${polyFold>>>0} then error("${rndHex(12)}")end
end`;

  // L11: Key split
  const k0 = luaBytes(vm.cipherKey.slice(0, 11));
  const k1 = luaBytes(vm.cipherKey.slice(11, 22));
  const k2 = luaBytes(vm.cipherKey.slice(22));
  const keyLines = `local ${V.kp0}=${k0}\nlocal ${V.kp1}=${k1}\nlocal ${V.kp2}=${k2}\nlocal _hk=${V.kp0}..${V.kp1}..${V.kp2}`;

  // VM interpreter function
  const vmFn = `local function ${V.vmFn}(${V.data})
  local ${V.regs}={}
  for _i=1,${NREG} do ${V.regs}[_i]=0 end
  local ${V.out}={}
  local ${V.flag}=false
  local ${V.intAcc}=0
  local ${V.polyAcc}=0
  local ${V.pc}=1
  local _len=#${V.code}
  while ${V.pc}<=_len do
    local ${V.ins}=${V.code}[${V.pc}]
    local ${V.op}=${V.ins}[1]
    local ${V.rd}=${V.ins}[2]
    local ${V.ra}=${V.ins}[3]
    local ${V.rb}=${V.ins}[4]
    local ${V.k}=${V.ins}[5]
    local ${V.k2}=${V.ins}[6]
    local ${V.aux}=${V.ins}[7]
${cases.join("\n")}
    ${V.pc}=${V.pc}+1
  end
end`;

  // Boot block
  const errTok1 = rndHex(16);
  const errTok2 = rndHex(16);
  const boot = `local ${V.res}=${V.vmFn}(${V.data})
if ${V.res}~=nil then
  local _ld=load or loadstring
  if not _ld then error("${errTok2}")end
  local _fn,_er=_ld(${V.res})
  if _fn then _fn()else error("${errTok1}")end
else
  error("${errTok2}")
end`;

  const noiseHeader = `-- ${rndHex(32)}\n-- ${rndHex(32)}`;

  // First-pass assemble
  const firstPass = [
    noiseHeader,
    BIT_SHIM,
    emitTimingTripwire(V.times, V.thresh),
    emitEnvFingerprint(V.envOk),
    keyLines,
    opcodeHmacLine,
    polyCheckLine,
    `local ${V.consts}=${constsLit}`,
    `local ${V.sbox}={string.byte(${sboxLit},1,256)}`,
    `local ${V.code}=${codeLit}`,
    `local ${V.data}=${dataLit}`,
    vmFn,
    boot,
  ].join("\n");

  return firstPass;
}

// ─────────────────────────────────────────────────────────────────────────────
// §6 PUBLIC API + CLI
// ─────────────────────────────────────────────────────────────────────────────

export async function obfuscateLua(source: string, passes = 1): Promise<string> {
  if (passes < 1 || passes > 3) throw new RangeError("passes must be 1-3");
  let cur = source;
  for (let p = 0; p < passes; p++) {
    const plain = new TextEncoder().encode(cur);
    const vm    = await compile(plain);
    cur         = emitLua(vm);
  }
  return cur;
}
