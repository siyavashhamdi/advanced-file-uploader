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

const MAX_FILE_SIZE = 100 * 1024 * 1024 * 1024; // 100 GB

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
  upload.single("file")(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      res.status(status).json({
        ok: false,
        error:
          err.code === "LIMIT_FILE_SIZE"
            ? `File exceeds ${MAX_FILE_SIZE / (1024 * 1024)} MB limit`
            : err.message,
      });
      return;
    }

    if (err) {
      res.status(500).json({ ok: false, error: "Upload failed" });
      return;
    }

    if (!req.file) {
      res.status(400).json({ ok: false, error: "No file provided" });
      return;
    }

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
    console.error(err);
    res.status(500).json({ ok: false, error: "Internal server error" });
  },
);

app.listen(PORT, () => {
  console.log(`Uploader running at http://localhost:${PORT}`);
});
