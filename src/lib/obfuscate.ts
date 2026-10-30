// Serve-time Lua wrapper: encrypts the script bytes with a fresh random key on every
// request and emits a Lua stub that decrypts and runs it. Output differs each time.

const ident = () => {
  const b = crypto.getRandomValues(new Uint8Array(6));
  return "_" + Array.from(b, (x) => "Il1O0".charAt(x % 5)).join("") + ((b.at(0) ?? 0) % 90 + 10);
};

export function obfuscateLua(source: string): string {
  const bytes = new TextEncoder().encode(source);
  const r = crypto.getRandomValues(new Uint8Array(3));
  const k1 = r.at(0) ?? 0;
  const k2 = ((r.at(1) ?? 0) | 1) % 256;
  const k3 = r.at(2) ?? 0;
  const enc: string[] = [];
  bytes.forEach((byte, index) => {
    const position = index + 1;
    const key = (k1 + position * k2 + (position % 7) * k3) % 256;
    enc.push("\\" + String((byte + key) % 256).padStart(3, "0"));
  });
  const [d, t, i, b, k, f, e] = Array.from({ length: 7 }, (_, index) => `${ident()}_${index}`);
  return (
    `local ${d}="${enc.join("")}"\n` +
    `local ${t}={}\n` +
    `for ${i}=1,#${d} do local ${b}=string.byte(${d},${i}) ` +
    `local ${k}=(${k1}+${i}*${k2}+(${i}%7)*${k3})%256 ` +
    `${t}[${i}]=string.char((${b}-${k})%256) end\n` +
    `local ${f},${e}=loadstring(table.concat(${t}))\n` +
    `if not ${f} then return end\n` +
    `return ${f}(...)`
  );
}
