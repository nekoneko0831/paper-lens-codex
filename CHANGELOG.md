# Changelog

## v0.1.1 (2026-05-04)

- Hardened Web UI Markdown rendering for long URLs/paths and noisy single-dollar math.
- Sanitized restored browser session state so stale tool/question events cannot white-screen refreshes.
- Fixed React 19 lint blockers in the Web UI.
- Added local development defaults for the Codex backend on port 8766.

## v0.1.0 (2026-04-26)

Initial release. A Codex CLI port of [paper-lens](https://github.com/nekoneko0831/paper-lens) — same Web UI, codex-driven backend.

### Differences from paper-lens

- **Backend talks to `codex app-server` over JSON-RPC 2.0** instead of `claude --sdk-url` over NDJSON. Topology is inverted: codex app-server is the WebSocket host, paper-lens-codex backend is the client.
- **Approval handling** uses `approvalPolicy: "on-request"` and backend-side responses for command/file/permission prompts — paper-reading work doesn't pause for per-command confirmations, while network and note-writing requests can still be granted. AskUserQuestion-style interactive prompts (`item/tool/requestUserInput`) are still surfaced to the user via the Web UI.
- **Default ports**: backend 8766 (paper-lens uses 8765), frontend 3001 (paper-lens uses 3000). Both projects can run on the same machine without conflict.
- **Skill format**: shipped under `.codex/skills/paper-lens/` (codex skill convention) instead of `.claude/skills/paper-lens/`. The skill content itself is adapted (AskUserQuestion → "结构化提问", `/frontend-slides` references replaced with codex's `slides` skill or generic Markdown→Slides tool).

### Caveats

- `codex app-server` is marked **experimental** upstream. The JSON-RPC schema may change between codex CLI versions; if bumping codex breaks something, regenerate the schema (`codex app-server generate-json-schema --out /tmp/schema`) and check method/field names in `paper-lens-backend/adapters/codex_app_server.py`.
- `codex login` (or `OPENAI_API_KEY`) is required before starting the backend. **Don't run the backend with `sudo`** — same footgun as the Claude version: a sudo-spawned codex subprocess can't read `~/.codex` credentials.
- v0.1 doesn't expose `/api/resume-session` (Claude version's "continue an existing thread" affordance). Codex's `thread/resume` works, but the UI plumbing isn't there yet.
