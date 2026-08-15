# advanced-uploader

Sequential multi-file uploader with per-file progress. Express + Multer backend and a static web UI that uploads one file at a time so XHR progress stays accurate.

## Requirements

- Node.js 18+

## Setup

```bash
npm install
```

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the server with `tsx watch` |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run typecheck` | Typecheck without emitting |
| `npm start` | Start with PM2 (`ecosystem.config.cjs`) |
| `npm run stop` / `restart` / `logs` | PM2 process control |
| `npm run deploy` | `npm ci`, staged build, promote `dist/`, PM2 restart |

## Usage

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Uploaded files are stored in `uploads/` (created automatically). Max size is **100 MB** per file.

Override the port with `PORT`:

```bash
PORT=4000 npm run dev
```

## Deploy (PM2)

On the server (needs global `pm2`):

```bash
cp .env.example .env   # once
npm run deploy
```

`.env` drives `PORT`, `NODE_ENV`, and `APP_ENV` (`production` → PM2 `advanced-uploader`, `staging` → `staging-advanced-uploader`). Deploy builds into `dist.next`, then promotes to `dist/` before restart.

## API

- `GET /api/health` — health check
- `POST /api/upload` — multipart field `file` (single file)
