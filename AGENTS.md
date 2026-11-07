<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep primary tabs in the shared root shell and select dashboard panels through validated URL search parameters so navigation works from every page and survives refreshes.
- Admin moderation uses authenticated database RPCs with server-validated roles, not browser email checks or broad owner policies; this keeps all-script access isolated from owner dashboards.
- Admin navigation uses the shared authenticated admin-access query and stays hidden until verified; navigation visibility does not replace moderation authorization.
- Keep administrative suspension separate from seller enablement and check both on delivery and free-key flows so sellers and API clients cannot bypass moderation.
- Keep Lua protection in the shared portable obfuscator, with Lua execution and integrity regression tests; client-side obfuscation is not an authorization boundary.
- Script delivery is a loader -> session/init (mints one-time token) -> fetch (atomically consumes token, returns freshly obfuscated payload) -> heartbeat flow; public routes always return HTTP 200 with an --ERR: prefix because Roblox executors crash on non-200, and use the Cloud admin client via dynamic import, never a `~/` alias.
- CDN-style delivery lives under `/api/public/cdn/` and shares loader/payload handlers with legacy URLs; never cache token-bearing payloads or introduce an unlicensed static-source endpoint.
