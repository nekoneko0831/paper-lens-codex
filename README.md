# Paper Lens · Codex Edition

A Codex CLI port of [paper-lens](https://github.com/nekoneko0831/paper-lens) — same Web UI, codex-driven backend.

一个用 OpenAI Codex CLI 驱动的论文阅读 / 学习 / 展示 Web UI（基于 [paper-lens](https://github.com/nekoneko0831/paper-lens) 移植）。

> Looking for the Claude Code original? → [nekoneko0831/paper-lens](https://github.com/nekoneko0831/paper-lens)

---

## Features / 功能概览

| Mode / 模式 | Purpose / 用途 | Time / 耗时 | Interaction / 交互 |
|---|---|---|---|
| **Speed Read / 速览** | Quick digest | ~5 min | One-shot |
| **Deep Learn / 学习** | In-depth study, save-as-you-go | 20–40 min | Multi-turn |
| **Present / 展示** | Slide content prep | 15–30 min | Page-by-page |
| **Batch Search / 批量检索** | Search papers by topic | 3–5 min | Table + select |
| **Batch Download / 批量下载** | Download from arXiv links | 1–3 min | Auto-dedup |

The skill prompts live under `.codex/skills/paper-lens/` (codex skill convention). The Web UI lives under `paper-lens-web/` (Next.js) and `paper-lens-backend/` (FastAPI driving `codex app-server` via JSON-RPC).

---

## Architecture / 架构

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│   Browser  ◀──HTTP/SSE──▶  paper-lens-backend ─spawn▶ codex      │
│   (3001)                   (FastAPI, 8766)            app-server │
│                                  │                       (ws)    │
│                                  │                       │       │
│                                  └──── JSON-RPC 2.0 ─────┘       │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

The backend spawns `codex app-server --listen ws://127.0.0.1:<random-port>` per session, then connects to it as a JSON-RPC client. AskUserQuestion-style prompts surface as `item/tool/requestUserInput` server-requests; tool-call approvals are auto-accepted so paper-reading work isn't interrupted by per-command confirmations.

---

## Quick Start / 快速开始

### Prerequisites / 先决条件

- **Codex CLI**: `brew install --cask codex` or `npm i -g @openai/codex`
- **Codex login**: run `codex login` once (ChatGPT subscription) or set `OPENAI_API_KEY`
- **Node.js 18+** and **Python 3.9+**

> ⚠️ **Do not run the backend with `sudo`.** It spawns `codex app-server`, which inherits the invoking user's credentials. A sudo-spawned subprocess can't read `~/.codex` and every chat will fail. Same footgun as paper-lens; same fix (don't sudo).
>
> ⚠️ **不要用 `sudo` 启动后端**：它会 spawn `codex app-server` 子进程，sudo 会丢登录态，每次对话都会失败。

### Install / 安装

```bash
git clone https://github.com/nekoneko0831/paper-lens-codex.git
cd paper-lens-codex

# Backend
cd paper-lens-backend
pip install -r requirements.txt

# Frontend
cd ../paper-lens-web
cp .env.local.example .env.local   # adjust NEXT_PUBLIC_BACKEND_URL if needed
npm install
```

### Run / 启动

One terminal:

```bash
cd paper-lens-web
npm run dev
```

Then open http://localhost:3001 in your browser.

`npm run dev` starts the FastAPI backend behind the frontend, points Next.js at it, and restarts that backend if it exits while the frontend dev server is still running. Users should not need to start or think about port 8766 in normal use.

### Skill install (optional CLI mode) / Skill 安装（可选 CLI 模式）

If you also want codex CLI to recognize the `paper-lens` skill (CLI mode without Web UI), copy the skill folder into your codex runtime skills directory:

```bash
cp -R .codex/skills/paper-lens ~/.codex/skills/codex-primary-runtime/
```

Then in any directory, ask codex things like "帮我读这篇论文：https://arxiv.org/pdf/2506.07982" and the skill will dispatch.

---

## Usage / 使用

In the Web UI: drop a PDF or paste an arXiv URL on the left panel, pick a paper, then choose **速览 / 精读 / 学习 / 展示** above the chat. The agent runs in `codex app-server`, streams output via SSE, and uses structured question cards for multi-choice questions during deep-learn / present modes.

Session state is intentionally long-lived: the backend keeps Codex sessions until backend shutdown or an explicit stop, while the browser stores conversation history in localStorage. A refresh should not expire an idle paper-reading session.

If you'd rather use codex CLI directly (no Web UI), invoke the skill the same way you would in Claude Code: drop a PDF path or arXiv URL into the conversation.

---

## Why a separate repo? / 为什么单独发一个仓库

The Web UI is identical between paper-lens (Claude) and paper-lens-codex, but the backend adapter is fundamentally different (Claude's `--sdk-url` reverse-WS pattern vs. codex's `app-server` JSON-RPC pattern). Splitting keeps each repo's adapter, default ports, and skill folder coherent without runtime branching. If you want both, install both — they're designed to coexist (different ports, different skill names).

---

## Caveats / 注意事项

- `codex app-server` is **experimental** upstream. Bumping the codex CLI may break the adapter; if so, run `codex app-server generate-json-schema --out /tmp/schema` and reconcile method/field names in `paper-lens-backend/adapters/codex_app_server.py`.
- The backend starts Codex with `approvalPolicy: "on-request"` and answers paper-reading approvals itself, so the browser UI is not interrupted by command/file prompts while network and note-writing requests can still be granted.
- v0.1 ships the same skill content as paper-lens, with surface-level adaptations (AskUserQuestion → 结构化提问, `/frontend-slides` references rewritten). The prompt has not been re-tuned for codex's strengths/weaknesses — there's headroom for codex-specific iteration.

---

## License

[MIT](LICENSE)
