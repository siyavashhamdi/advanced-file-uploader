# advanced-file-uploader

Advanced file uploader with parallel chunked uploads, per-file progress, and optional simultaneous multi-file transfer. Express + Multer backend with a static web UI.

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

Open [http://localhost:3000](http://localhost:3000). Uploaded files are stored in `uploads/` (created automatically). Max size is **10 GB** per file.

> **Network error after ~100s:** If the hostname is Cloudflare **proxied (orange cloud)**, Cloudflare cuts long uploads around 100 seconds. Set the record to **DNS only (grey cloud)**, or use a direct/non-proxied host. Nginx/app timeouts alone cannot fix that.

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

`.env` drives `PORT`, `NODE_ENV`, and `APP_ENV` (`production` → PM2 `advanced-file-uploader`, `staging` → `staging-advanced-file-uploader`). Deploy builds into `dist.next`, then promotes to `dist/` before restart.

## API

- `GET /api/health` — health check
- `POST /api/upload/init` — start chunked upload `{ originalName, size, chunkSize, totalChunks }`
- `POST /api/upload/chunk` — multipart `uploadId`, `index`, `chunk`
- `POST /api/upload/complete` — assemble `{ uploadId }`
- `POST /api/upload/abort` — delete temp parts `{ uploadId }`

Each file is split into **8 MB** chunks and up to **4** chunks upload in parallel.
