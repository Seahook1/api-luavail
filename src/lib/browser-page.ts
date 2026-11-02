// Shown instead of the raw Lua when someone opens a loader/fetch link in a normal browser tab.
// Detection uses navigation headers browsers always send and Roblox executors don't.
export function isBrowserNavigation(request: Request) {
  const dest = request.headers.get("sec-fetch-dest");
  const mode = request.headers.get("sec-fetch-mode");
  if (dest === "document" || mode === "navigate") return true;
  return (request.headers.get("accept") ?? "").includes("text/html");
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

export function browserBlockedPage(loaderUrl: string) {
  const snippet = `script_key = "KEY"; -- A key might be required, if not, delete this line.\nloadstring(game:HttpGet("${loaderUrl}"))()`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Loadstring</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:#1b1e30;color:#fff;font-family:system-ui,sans-serif;padding:16px}
h1{font-size:22px;margin:0}
.box{position:relative;width:min(720px,100%);background:#12141f;border-radius:10px;padding:20px;font:15px/1.6 ui-monospace,Menlo,monospace;overflow-x:auto;white-space:pre}
.c{color:#6a9955}.k{color:#569cd6}.s{color:#ce9178}
button{position:absolute;top:10px;right:10px;background:#2b3050;color:#fff;border:0;border-radius:6px;padding:8px 14px;cursor:pointer}
p{color:#b8bccf;font-size:14px;margin:0}
</style></head><body>
<h1>📜 Loadstring</h1>
<div class="box"><button id="b">Copy</button><span class="k">script_key</span> = <span class="s">"KEY"</span>; <span class="c">-- A key might be required, if not, delete this line.</span>
<span class="k">loadstring</span>(<span class="k">game</span>:<span class="k">HttpGet</span>(<span class="s">"${esc(loaderUrl)}"</span>))()</div>
<p>Contents can not be displayed on browser</p>
<script>document.getElementById("b").onclick=function(){navigator.clipboard.writeText(${JSON.stringify(snippet).replace(/</g, "\\u003c")});this.textContent="Copied!"}</script>
</body></html>`;
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" },
  });
}
