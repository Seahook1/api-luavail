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
- Keep administrative suspension separate from seller enablement and check both on delivery and free-key flows so sellers and API clients cannot bypass moderation.
