import express from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createWriteStream, createReadStream } from "node:fs";
import { finished } from "node:stream/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const uploadsDir = path.join(rootDir, "uploads");
const partsDir = path.join(uploadsDir, ".parts");
const publicDir = path.join(rootDir, "public");

fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(partsDir, { recursive: true });

const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024; // 10 GB
const MAX_FILE_SIZE_LABEL = "10 GB";
const MAX_CHUNK_SIZE = 32 * 1024 * 1024; // 32 MB per chunk
const REQUEST_TIMEOUT_MS = 0;

type UploadMeta = {
  uploadId: string;
  originalName: string;
  size: number;
  chunkSize: number;
  totalChunks: number;
  createdAt: number;
};

function logError(context: string, err: unknown, extra?: Record<string, unknown>) {
  const base =
    err instanceof Error
      ? { name: err.name, message: err.message, stack: err.stack }
      : { err };
  console.error(`[upload-error] ${context}`, { ...base, ...extra });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${(s / 60).toFixed(1)}m`;
}

function safeBaseName(originalName: string): string {
  const ext = path.extname(originalName);
  const safeBase = path
    .basename(originalName, ext)
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 80);
  return `${Date.now()}-${randomUUID().slice(0, 8)}-${safeBase}${ext}`;
}

function partDir(uploadId: string): string {
  return path.join(partsDir, uploadId);
}

function metaPath(uploadId: string): string {
  return path.join(partDir(uploadId), "meta.json");
}

function chunkPath(uploadId: string, index: number): string {
  return path.join(partDir(uploadId), String(index));
}

async function readMeta(uploadId: string): Promise<UploadMeta | null> {
  try {
    const raw = await fsp.readFile(metaPath(uploadId), "utf8");
    return JSON.parse(raw) as UploadMeta;
  } catch {
    return null;
  }
}

async function removeUploadDir(uploadId: string): Promise<void> {
  await fsp.rm(partDir(uploadId), { recursive: true, force: true });
}

const chunkUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const uploadId = String(req.body?.uploadId || "");
      if (!uploadId || uploadId.includes("..") || uploadId.includes("/") || uploadId.includes("\\")) {
        cb(new Error("Invalid uploadId"), "");
        return;
      }
      const dir = partDir(uploadId);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, _file, cb) => {
      const index = Number(req.body?.index);
      if (!Number.isInteger(index) || index < 0) {
        cb(new Error("Invalid chunk index"), "");
        return;
      }
      cb(null, `chunk-${index}.part`);
    },
  }),
  limits: {
    fileSize: MAX_CHUNK_SIZE,
    files: 1,
  },
});

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(publicDir));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    maxFileSize: MAX_FILE_SIZE_LABEL,
    maxChunkSize: MAX_CHUNK_SIZE,
  });
});

/** Start a chunked upload session. */
app.post("/api/upload/init", async (req, res) => {
  try {
    const originalName = String(req.body?.originalName || "file");
    const size = Number(req.body?.size);
    const chunkSize = Number(req.body?.chunkSize);
    const totalChunks = Number(req.body?.totalChunks);

    if (!Number.isFinite(size) || size <= 0 || size > MAX_FILE_SIZE) {
      res.status(400).json({
        ok: false,
        error: `Invalid size (max ${MAX_FILE_SIZE_LABEL})`,
      });
      return;
    }
    if (!Number.isFinite(chunkSize) || chunkSize <= 0 || chunkSize > MAX_CHUNK_SIZE) {
      res.status(400).json({ ok: false, error: "Invalid chunkSize" });
      return;
    }
    if (!Number.isInteger(totalChunks) || totalChunks <= 0) {
      res.status(400).json({ ok: false, error: "Invalid totalChunks" });
      return;
    }

    const expectedChunks = Math.ceil(size / chunkSize);
    if (totalChunks !== expectedChunks) {
      res.status(400).json({
        ok: false,
        error: `totalChunks mismatch (expected ${expectedChunks})`,
      });
      return;
    }

    const uploadId = randomUUID();
    const dir = partDir(uploadId);
    await fsp.mkdir(dir, { recursive: true });

    const meta: UploadMeta = {
      uploadId,
      originalName,
      size,
      chunkSize,
      totalChunks,
      createdAt: Date.now(),
    };
    await fsp.writeFile(metaPath(uploadId), JSON.stringify(meta, null, 2));

    console.log("[upload] init", {
      uploadId,
      originalName,
      size,
      chunkSize,
      totalChunks,
    });

    res.json({ ok: true, uploadId, maxChunkSize: MAX_CHUNK_SIZE });
  } catch (err) {
    logError("init", err);
    res.status(500).json({ ok: false, error: "Failed to init upload" });
  }
});

/** Upload one chunk (parallel-safe). */
app.post("/api/upload/chunk", (req, res) => {
  const startedAt = Date.now();

  chunkUpload.single("chunk")(req, res, async (err) => {
    try {
      if (err instanceof multer.MulterError) {
        const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
        logError("chunk-multer", err, { code: err.code });
        res.status(status).json({ ok: false, error: err.message, code: err.code });
        return;
      }
      if (err) {
        logError("chunk", err);
        res.status(500).json({
          ok: false,
          error: err instanceof Error ? err.message : "Chunk upload failed",
        });
        return;
      }

      const uploadId = String(req.body?.uploadId || "");
      const index = Number(req.body?.index);
      const meta = await readMeta(uploadId);

      if (!meta) {
        if (req.file?.path) await fsp.rm(req.file.path, { force: true });
        res.status(404).json({ ok: false, error: "Unknown uploadId" });
        return;
      }
      if (!Number.isInteger(index) || index < 0 || index >= meta.totalChunks) {
        if (req.file?.path) await fsp.rm(req.file.path, { force: true });
        res.status(400).json({ ok: false, error: "Invalid chunk index" });
        return;
      }
      if (!req.file) {
        res.status(400).json({ ok: false, error: "No chunk provided" });
        return;
      }

      const dest = chunkPath(uploadId, index);
      await fsp.rename(req.file.path, dest);

      console.log("[upload] chunk ok", {
        uploadId,
        index,
        bytes: req.file.size,
        elapsed: formatDuration(Date.now() - startedAt),
      });

      res.json({ ok: true, index, size: req.file.size });
    } catch (e) {
      logError("chunk-handler", e);
      res.status(500).json({ ok: false, error: "Chunk upload failed" });
    }
  });
});

/** Assemble chunks into the final file. */
app.post("/api/upload/complete", async (req, res) => {
  const startedAt = Date.now();
  const uploadId = String(req.body?.uploadId || "");

  try {
    const meta = await readMeta(uploadId);
    if (!meta) {
      res.status(404).json({ ok: false, error: "Unknown uploadId" });
      return;
    }

    for (let i = 0; i < meta.totalChunks; i += 1) {
      try {
        await fsp.access(chunkPath(uploadId, i));
      } catch {
        res.status(400).json({
          ok: false,
          error: `Missing chunk ${i}/${meta.totalChunks - 1}`,
        });
        return;
      }
    }

    const storedName = safeBaseName(meta.originalName);
    const finalPath = path.join(uploadsDir, storedName);
    const out = createWriteStream(finalPath);

    try {
      await new Promise<void>((resolve, reject) => {
        out.on("error", reject);

        const writeNext = (i: number) => {
          if (i >= meta.totalChunks) {
            out.end(() => resolve());
            return;
          }
          const inp = createReadStream(chunkPath(uploadId, i));
          inp.on("error", reject);
          inp.on("end", () => writeNext(i + 1));
          inp.pipe(out, { end: false });
        };

        writeNext(0);
      });
      await finished(out).catch(() => undefined);
    } catch (e) {
      out.destroy();
      await fsp.rm(finalPath, { force: true });
      throw e;
    }

    const st = await fsp.stat(finalPath);
    if (st.size !== meta.size) {
      await fsp.rm(finalPath, { force: true });
      res.status(500).json({
        ok: false,
        error: `Size mismatch (got ${st.size}, expected ${meta.size})`,
      });
      return;
    }

    await removeUploadDir(uploadId);

    const elapsedMs = Date.now() - startedAt;
    console.log("[upload] complete ok", {
      uploadId,
      originalName: meta.originalName,
      storedName,
      size: st.size,
      chunks: meta.totalChunks,
      elapsed: formatDuration(elapsedMs),
    });

    res.json({
      ok: true,
      file: {
        originalName: meta.originalName,
        storedName,
        size: st.size,
      },
    });
  } catch (err) {
    logError("complete", err, { uploadId });
    res.status(500).json({ ok: false, error: "Failed to complete upload" });
  }
});

/** Abort and delete temp chunks. */
app.post("/api/upload/abort", async (req, res) => {
  const uploadId = String(req.body?.uploadId || "");
  if (!uploadId) {
    res.status(400).json({ ok: false, error: "uploadId required" });
    return;
  }
  console.log("[upload] abort", { uploadId });
  await removeUploadDir(uploadId);
  res.json({ ok: true });
});

app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    logError("express", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    res.status(500).json({ ok: false, error: message });
  },
);

const server = app.listen(PORT, () => {
  console.log(`[boot] Uploader http://localhost:${PORT}`);
  console.log(`[boot] Max file size ${MAX_FILE_SIZE_LABEL}`);
  console.log(`[boot] Chunked parallel upload enabled (max chunk ${MAX_CHUNK_SIZE / (1024 * 1024)} MB)`);
  console.log(`[boot] Node requestTimeout=${REQUEST_TIMEOUT_MS || "disabled"}`);
});

server.requestTimeout = REQUEST_TIMEOUT_MS;
server.headersTimeout = REQUEST_TIMEOUT_MS === 0 ? 0 : REQUEST_TIMEOUT_MS + 60_000;
server.timeout = REQUEST_TIMEOUT_MS;
server.keepAliveTimeout = 120_000;
