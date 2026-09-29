# auto-testing-frontend

Electron + React UI for Auto Tester. Chromium (Playwright) runs **on this machine**. Data lives on the remote Nest API (`auto-testing-backend`).

## Setup

```bash
cp .env.example .env
npm install
npx playwright install chromium
```

## Connect to a Backend

### Option 1: Login Screen (recommended)

On the login screen, set **Backend URL** to wherever the Nest API is running, then click **Test connection**:

```
http://127.0.0.1:3001          # local dev
https://api.your-company.com   # production server
http://10.0.0.12:3001          # LAN server
```

`/api` is added automatically. The value is persisted for both the Electron main process (uploads, AI, version control) and the React renderer (login, projects, flows).

### Option 2: Environment Variables

Set in `.env` before starting:

```env
API_BACKEND_URL=https://your-server.example.com:3001
VITE_API_BACKEND_URL=https://your-server.example.com:3001
```

- `VITE_API_BACKEND_URL` is compiled into the React UI at build time
- `API_BACKEND_URL` / `NEST_API_URL` is read by Electron main at runtime

## Develop

```bash
npm run desktop:dev
```

This starts Vite + Electron together. Electron alone shows a blank window.

Vite only (no Run/Capture — browser-only UI):

```bash
npm run dev
```

Packaged / built app:

```bash
npm run desktop:start
```

The API must already be reachable at the saved Backend URL.

## Scripts

| Command | What it does |
|---|---|
| `desktop:dev` | Vite + Electron (dev) |
| `desktop:start` | Build UI + open Electron |
| `dev` | Vite only (browser; no Run/Capture) |

## Environment Variables

| Variable | Purpose |
|---|---|
| `API_BACKEND_URL` | Nest API origin (read by Electron main at runtime) |
| `VITE_API_BACKEND_URL` | Same, but compiled into the UI build |
| `NEST_API_URL` | Alias for `API_BACKEND_URL` |
| `VITE_API_URL` | Alias for `VITE_API_BACKEND_URL` |

## Architecture

```
┌─────────────────────────────────────────────┐
│  Electron (this machine)                    │
│  ┌────────────┐  ┌───────────────────────┐  │
│  │ React UI   │  │ Electron Main Process │  │
│  │ (Renderer) │  │ Capture, Run, Upload  │  │
│  └─────┬──────┘  └──────────┬────────────┘  │
│        │ HTTP                │ HTTP          │
└────────┼─────────────────────┼──────────────┘
         │                     │
         ▼                     ▼
   ┌─────────────────────────────────┐
   │  auto-testing-backend (Server)  │
   │  Nest API + MySQL + MinIO      │
   └─────────────────────────────────┘
```

Both the renderer and the main process independently call the Nest API using the saved Backend URL.
