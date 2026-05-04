# Paper Lens Codex Web

Next.js frontend for `paper-lens-codex`. It talks to the FastAPI backend over REST and SSE.

## Setup

```bash
cp .env.local.example .env.local
npm install
npm run dev
```

Open http://localhost:3001.

The default backend is `http://localhost:8766`. Change `NEXT_PUBLIC_BACKEND_URL` in `.env.local` if the backend runs elsewhere.

## Checks

```bash
npm run lint
npx tsc --noEmit
```
