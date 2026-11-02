// Portable Lua 5.1/Luau wrapper. This is obfuscation, not a security boundary:
// the decoder and its keys must be delivered to the client along with the code.
const randomInt = (max: number) => (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) % max;

export function obfuscateLua(source: string): string {
  let serial = 0;
  const name = () => `_v${randomInt(0xffffff).toString(16)}_${serial++}`;
  const data = name(),
    output = name(),
    index = name(),
    byte = name();
  const previous = name(),
    decoded = name(),
    sum = name(),
    weighted = name();
  const fn = name(),
    message = name(),
    joined = name();
  const char = name(),
    read = name(),
    concat = name(),
    compile = name();
  const seed = randomInt(256);
  const step = randomInt(255) + 1;
  const salt = randomInt(256);
  const initial = randomInt(256);
  let feedback = initial;
  let a = 1,
    b = 0;
  const encoded: number[] = [];
  const bytes = new TextEncoder().encode(source);
  bytes.forEach((value, offset) => {
    const position = offset + 1;
    const encrypted = (value + seed + position * step + (position % 11) * salt + feedback) % 256;
    encoded.push(encrypted);
    feedback = encrypted;
    a = (a + value) % 65521;
    b = (b + a) % 65521;
  });
  const chunks: string[] = [];
  const chunkSize = 48 + randomInt(49);
  for (let offset = 0; offset < encoded.length; offset += chunkSize) {
    chunks.push(
      `"${encoded
        .slice(offset, offset + chunkSize)
        .map((value) => `\\${String(value).padStart(3, "0")}`)
        .join("")}"`,
    );
  }
  // Bounded, isolated junk has no side effects and does not touch executor APIs.
  const junk = Array.from({ length: 3 + randomInt(4) }, () => {
    const accumulator = name(),
      cursor = name();
    return `do local ${accumulator}=${randomInt(65521)} for ${cursor}=1,${3 + randomInt(8)} do ${accumulator}=(${accumulator}*${3 + randomInt(19)}+${cursor})%65521 end end`;
  });
  return [
    junk[0],
    `local ${char},${read},${concat},${compile}=string.char,string.byte,table.concat,loadstring`,
    `local ${data}=${concat}({${chunks.join(",")}})`,
    `local ${output},${previous},${sum},${weighted}={},${initial},1,0`,
    ...junk.slice(1, 3),
    `for ${index}=1,#${data} do`,
    `local ${byte}=${read}(${data},${index})`,
    `local ${decoded}=(${byte}-(${seed}+${index}*${step}+(${index}%11)*${salt}+${previous}))%256`,
    `${previous}=${byte}`,
    `${sum}=(${sum}+${decoded})%65521`,
    `${weighted}=(${weighted}+${sum})%65521`,
    `${output}[${index}]=${char}(${decoded})`,
    `end`,
    `if #${data}~=${bytes.length} or ${sum}~=${a} or ${weighted}~=${b} then error("[Vault] integrity check failed",0) end`,
    `local ${joined}=${concat}(${output})`,
    `local ${fn},${message}=${compile}(${joined})`,
    `if not ${fn} then error("[Vault] load failed",0) end`,
    ...junk.slice(3),
    `return ${fn}(...)`,
  ].join("\n");
}
