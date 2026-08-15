import express from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const uploadsDir = path.join(rootDir, "uploads");
const publicDir = path.join(rootDir, "public");

fs.mkdirSync(uploadsDir, { recursive: true });

const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024; // 10 GB
const MAX_FILE_SIZE_LABEL = "10 GB";

function logError(context: string, err: unknown, extra?: Record<string, unknown>) {
  const base =
    err instanceof Error
      ? { name: err.name, message: err.message, stack: err.stack }
      : { err };
  console.error(`[upload-error] ${context}`, { ...base, ...extra });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const safeBase = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 80);
    cb(null, `${Date.now()}-${randomUUID().slice(0, 8)}-${safeBase}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
  },
});

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.static(publicDir));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

/**
 * Single-file endpoint — clients upload one file at a time so each
 * request can report accurate XHR progress without multiplexing.
 */
app.post("/api/upload", (req, res) => {
  const startedAt = Date.now();
  const contentLength = req.headers["content-length"];
  console.log("[upload] start", {
    contentLength,
    contentType: req.headers["content-type"],
    ip: req.ip,
  });

  upload.single("file")(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      const message =
        err.code === "LIMIT_FILE_SIZE"
          ? `File exceeds ${MAX_FILE_SIZE_LABEL} limit`
          : err.message;
      logError("multer", err, {
        code: err.code,
        field: err.field,
        contentLength,
        status,
      });
      res.status(status).json({ ok: false, error: message, code: err.code });
      return;
    }

    if (err) {
      logError("upload-handler", err, { contentLength });
      const message = err instanceof Error ? err.message : "Upload failed";
      res.status(500).json({ ok: false, error: message });
      return;
    }

    if (!req.file) {
      console.error("[upload-error] no file in request", { contentLength });
      res.status(400).json({ ok: false, error: "No file provided" });
      return;
    }

    console.log("[upload] ok", {
      originalName: req.file.originalname,
      storedName: req.file.filename,
      size: req.file.size,
      ms: Date.now() - startedAt,
    });

    res.json({
      ok: true,
      file: {
        originalName: req.file.originalname,
        storedName: req.file.filename,
        size: req.file.size,
        mimeType: req.file.mimetype,
      },
    });
  });
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

app.listen(PORT, () => {
  console.log(`Uploader running at http://localhost:${PORT}`);
  console.log(`Max file size: ${MAX_FILE_SIZE_LABEL}`);
});
