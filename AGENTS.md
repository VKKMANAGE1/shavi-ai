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

- Keep each chat at a dedicated `/chat/:threadId` page and store its messages in owner-scoped Cloud tables, because reloads and conversation switching must retain distinct histories.
- Stream the user-requested NVIDIA Nemotron model from the authenticated `/api/chat` server route, because its API key and message context must never be trusted to the browser.
