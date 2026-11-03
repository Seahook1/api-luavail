// Portable Lua 5.1 / Luau wrapper. This is obfuscation, not a security boundary:
// the decoder and its keys must be delivered to the client along with the code.
// Layers: chained stream cipher (any edit garbles everything after it), ciphertext
// checksum, plaintext Adler checksum, timing tripwire, opaque-predicate decoys,
// flattened control flow, randomized names and optional multi-pass wrapping.
const randomInt = (max: number) => (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) % max;

const shuffle = <T>(items: T[]): T[] => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
};

// Printable bytes stay raw; everything else becomes a 3-digit decimal escape.
const luaByte = (value: number) =>
  value >= 32 && value <= 126 && value !== 34 && value !== 92
    ? String.fromCharCode(value)
    : `\\${String(value).padStart(3, "0")}`;

function wrapOnce(source: string): string {
  let serial = 0;
  const used = new Set<string>();
  const name = () => {
    let id: string;
    do id = `_v${randomInt(0xffffff).toString(16)}_${serial++}`;
    while (used.has(id));
    used.add(id);
    return id;
  };
  const n = Array.from({ length: 28 }, name) as string[];
  const [data, output, index, byte, previous, decoded, sum, weighted, fn, message] = n as [
    string, string, string, string, string, string, string, string, string, string,
  ];
  const [joined, char, read, concat, compile, state, clock, started, stream, _unused] = n.slice(10) as [
    string, string, string, string, string, string, string, string, string, string,
  ];
  const [wrapKey, wrapHash, decoy] = n.slice(20) as [string, string, string];

  const seed = randomInt(256);
  const step = randomInt(255) + 1;
  const initial = randomInt(256);
  const lcgSeed = randomInt(65535) + 1;
  const bytes = new TextEncoder().encode(source);
  const encoded: number[] = [];
  let feedback = initial;
  let lcg = lcgSeed;
  let a = 1,
    b = 0;
  bytes.forEach((value, offset) => {
    const position = offset + 1;
    lcg = (lcg * 75 + 74) % 65537;
    const encrypted = (value + (lcg % 256) + seed + position * step + feedback) % 256;
    encoded.push(encrypted);
    feedback = encrypted;
    a = (a + value) % 65521;
    b = (b + a) % 65521;
  });
  let cipherHash = 7;
  for (const value of encoded) cipherHash = (cipherHash * 31 + value) % 65521;

  const chunks: string[] = [];
  const chunkSize = 48 + randomInt(49);
  for (let offset = 0; offset < encoded.length; offset += chunkSize)
    chunks.push(`"${encoded.slice(offset, offset + chunkSize).map(luaByte).join("")}"`);

  const junk = () => {
    const accumulator = name(),
      cursor = name();
    return `do local ${accumulator}=${randomInt(65521)} for ${cursor}=1,${3 + randomInt(8)} do ${accumulator}=(${accumulator}*${3 + randomInt(19)}+${cursor})%65521 end end`;
  };
  // n*(n+1) is always even, so the guarded decoy never runs; it only misleads readers.
  const decoyBlock = () => {
    const probe = randomInt(9000) + 1;
    return `if (${probe}*(${probe}+1))%2==1 then local ${decoy}=${concat}({${read}(${data},1,8)}) ${state}=${randomInt(99999)} error("${randomInt(0xffffff).toString(16)}",0) end`;
  };

  // Control flow is flattened into a randomly numbered state machine.
  const ids = Array.from({ length: 7 }, () => 0);
  const pool = shuffle(Array.from({ length: 90 }, (_, i) => i + 10));
  ids.forEach((_, i) => (ids[i] = pool[i]!));
  const [sInit, sCheck, sDecode, sVerify, sCompile, sRun, sFail] = ids as [
    number, number, number, number, number, number, number,
  ];

  const branches: string[] = [
    `${state}==${sInit} then ${junk()} ${decoyBlock()} ${state}=${sCheck}`,
    [
      `${state}==${sCheck} then`,
      `local ${wrapHash}=7`,
      `for ${wrapKey}=1,#${data} do ${wrapHash}=(${wrapHash}*31+${read}(${data},${wrapKey}))%65521 end`,
      `if #${data}~=${bytes.length} or ${wrapHash}~=${cipherHash} then ${state}=${sFail} else ${state}=${sDecode} end`,
    ].join("\n"),
    [
      `${state}==${sDecode} then`,
      `local ${stream}=${lcgSeed}`,
      `for ${index}=1,#${data} do`,
      `${stream}=(${stream}*75+74)%65537`,
      `local ${byte}=${read}(${data},${index})`,
      `local ${decoded}=(${byte}-(${stream}%256+${seed}+${index}*${step}+${previous}))%256`,
      `${previous}=${byte}`,
      `${sum}=(${sum}+${decoded})%65521`,
      `${weighted}=(${weighted}+${sum})%65521`,
      `${output}[${index}]=${char}(${decoded})`,
      `end`,
      `${state}=${sVerify}`,
    ].join("\n"),
    [
      `${state}==${sVerify} then`,
      `if ${sum}~=${a} or ${weighted}~=${b} then ${state}=${sFail}`,
      `elseif ${clock} and ${clock}()-${started}>30 then ${state}=${sFail}`,
      `else ${decoyBlock()} ${state}=${sCompile} end`,
    ].join("\n"),
    [
      `${state}==${sCompile} then`,
      `${joined}=${concat}(${output})`,
      `${fn},${message}=${compile}(${joined})`,
      `if not ${fn} then error("[Vault] load failed",0) end`,
      `${state}=${sRun}`,
    ].join("\n"),
    `${state}==${sRun} then ${junk()} return ${fn}(...)`,
    `${state}==${sFail} then error("[Vault] integrity check failed",0)`,
  ];
  const body = shuffle(branches)
    .map((branch, i) => `${i === 0 ? "if" : "elseif"} ${branch}`)
    .join("\n");

  return [
    junk(),
    `local ${char},${read},${concat},${compile}=string.char,string.byte,table.concat,loadstring or load`,
    `local ${clock}=os and os.clock`,
    `local ${started}=${clock} and ${clock}() or 0`,
    `local ${data}=${concat}({${chunks.join(",")}})`,
    `local ${output},${previous},${sum},${weighted}={},${initial},1,0`,
    `local ${joined},${fn},${message}`,
    `local ${state}=${sInit}`,
    `while true do`,
    body,
    `end`,
    `end`,
  ]
    .join("\n");
}

// passes > 1 wraps the already-wrapped chunk again, so a cracker must unwrap each layer.
export function obfuscateLua(source: string, passes = 1): string {
  let current = source;
  for (let i = 0; i < Math.max(1, Math.min(3, passes)); i++) current = wrapOnce(current);
  return current;
}
