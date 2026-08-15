const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const queueSection = document.getElementById("queue");
const fileList = document.getElementById("file-list");
const startBtn = document.getElementById("start-btn");
const clearBtn = document.getElementById("clear-btn");
const cancelAllBtn = document.getElementById("cancel-all-btn");
const statusEl = document.getElementById("status");
const simultaneousEl = document.getElementById("simultaneous");
const browseBtn = document.getElementById("browse-btn");
const overallEl = document.getElementById("overall");
const overallPctEl = document.getElementById("overall-pct");
const overallSpeedEl = document.getElementById("overall-speed");
const overallEtaEl = document.getElementById("overall-eta");
const overallBarEl = document.getElementById("overall-bar");

/** Chunk size for parallel upload (8 MB). */
const CHUNK_SIZE = 8 * 1024 * 1024;
/** Parallel HTTP requests per file. */
const CHUNK_CONCURRENCY = 4;

/**
 * @typedef {{
 *   file: File,
 *   state: string,
 *   loaded: number,
 *   total: number,
 *   speed: number,
 *   uploadId: string | null,
 * }} QueueEntry
 */

/** @type {QueueEntry[]} */
let queue = [];
let isUploading = false;
/** @type {Map<number, Set<XMLHttpRequest>>} */
const activeXhrs = new Map();
let cancelAllRequested = false;
let simultaneousMode = false;

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatSpeed(bytesPerSec) {
  return `${formatBytes(bytesPerSec)}/s`;
}

function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 1) return "<1s";
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.ceil(seconds % 60);
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

function setStatus(message) {
  statusEl.textContent = message;
}

function setUploadingUi(uploading) {
  isUploading = uploading;
  startBtn.disabled = uploading || queue.length === 0;
  clearBtn.disabled = uploading || queue.length === 0;
  simultaneousEl.disabled = uploading;
  cancelAllBtn.hidden = !uploading;
  cancelAllBtn.disabled = !uploading;
  if (!uploading) overallEl.hidden = true;
}

function trackXhr(index, xhr) {
  let set = activeXhrs.get(index);
  if (!set) {
    set = new Set();
    activeXhrs.set(index, set);
  }
  set.add(xhr);
}

function untrackXhr(index, xhr) {
  const set = activeXhrs.get(index);
  if (!set) return;
  set.delete(xhr);
  if (set.size === 0) activeXhrs.delete(index);
}

function abortFileXhrs(index) {
  const set = activeXhrs.get(index);
  if (!set) return;
  for (const xhr of set) xhr.abort();
}

function createFileItem(entry, index) {
  const item = document.createElement("li");
  item.className = "file-item";
  item.dataset.index = String(index);

  const meta = document.createElement("div");
  meta.className = "file-meta";

  const name = document.createElement("div");
  name.className = "file-name";
  name.textContent = entry.file.name;

  const size = document.createElement("div");
  size.className = "file-size";
  size.textContent = formatBytes(entry.file.size);

  meta.appendChild(name);
  meta.appendChild(size);

  const fileStatus = document.createElement("div");
  fileStatus.className = "file-status";

  const pill = document.createElement("span");
  pill.className = "status-pill";
  pill.textContent = "Pending";

  const speed = document.createElement("span");
  speed.className = "speed";
  speed.hidden = true;

  const eta = document.createElement("span");
  eta.className = "eta";
  eta.hidden = true;

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn btn-cancel";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    cancelOne(index);
  });

  fileStatus.appendChild(pill);
  fileStatus.appendChild(speed);
  fileStatus.appendChild(eta);
  fileStatus.appendChild(cancelBtn);

  const progress = document.createElement("div");
  progress.className = "progress";
  const bar = document.createElement("div");
  bar.className = "progress-bar";
  progress.appendChild(bar);

  item.appendChild(meta);
  item.appendChild(fileStatus);
  item.appendChild(progress);
  return item;
}

function syncCancelButtons() {
  queue.forEach((entry, index) => {
    const item = fileList.querySelector(`[data-index="${index}"]`);
    if (!item) return;
    const btn = item.querySelector(".btn-cancel");
    const canCancel = entry.state === "pending" || entry.state === "uploading";
    btn.hidden = !canCancel;
    btn.disabled = !canCancel;
  });
}

function addFiles(files) {
  if (isUploading) {
    setStatus("Upload in progress — wait until it finishes.");
    return;
  }

  const newFiles = Array.from(files).filter((f) => f.size > 0);
  if (newFiles.length === 0) return;

  const startIndex = queue.length;
  newFiles.forEach((file) => {
    queue.push({
      file,
      state: "pending",
      loaded: 0,
      total: file.size,
      speed: 0,
      uploadId: null,
    });
  });

  queueSection.hidden = false;
  setUploadingUi(false);

  newFiles.forEach((_, i) => {
    const index = startIndex + i;
    fileList.appendChild(createFileItem(queue[index], index));
  });
  syncCancelButtons();
  setStatus(`${queue.length} file${queue.length > 1 ? "s" : ""} in queue`);
}

function updateItem(index, state, text) {
  const item = fileList.querySelector(`[data-index="${index}"]`);
  if (!item) return;
  const pill = item.querySelector(".status-pill");
  pill.textContent = text;
  const visual = state === "uploading" || state === "" ? "" : state;
  pill.className = "status-pill" + (visual ? ` ${visual}` : "");
  if (queue[index] && state && state !== "") queue[index].state = state;
  syncCancelButtons();
}

function setSpeed(index, bytesPerSec) {
  const item = fileList.querySelector(`[data-index="${index}"]`);
  if (!item) return;
  const speed = item.querySelector(".speed");
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) {
    speed.hidden = true;
    speed.textContent = "";
    return;
  }
  speed.hidden = false;
  speed.textContent = formatSpeed(bytesPerSec);
}

function setEta(index, seconds) {
  const item = fileList.querySelector(`[data-index="${index}"]`);
  if (!item) return;
  const eta = item.querySelector(".eta");
  if (!Number.isFinite(seconds) || seconds < 0) {
    eta.hidden = true;
    eta.textContent = "";
    return;
  }
  eta.hidden = false;
  eta.textContent = `ETA ${formatEta(seconds)}`;
}

function clearLiveStats(index) {
  setSpeed(index, 0);
  setEta(index, NaN);
}

function setProgress(index, percent) {
  const item = fileList.querySelector(`[data-index="${index}"]`);
  if (!item) return;
  item.querySelector(".progress-bar").style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function refreshOverall() {
  if (!simultaneousMode || !isUploading) {
    overallEl.hidden = true;
    return;
  }
  overallEl.hidden = false;

  let loaded = 0;
  let total = 0;
  let speedSum = 0;
  let activeUploading = 0;

  for (const entry of queue) {
    if (entry.state === "cancelled" || entry.state === "error") continue;
    const entryTotal = entry.total || entry.file.size;
    total += entryTotal;
    if (entry.state === "done") {
      loaded += entryTotal;
      continue;
    }
    loaded += Math.min(entry.loaded || 0, entryTotal);
    if (entry.state === "uploading" && entry.speed > 0) {
      activeUploading += 1;
      speedSum += entry.speed;
    }
  }

  const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
  overallPctEl.textContent = `${pct}%`;
  overallBarEl.style.width = `${pct}%`;
  overallSpeedEl.textContent =
    activeUploading > 0 && speedSum > 0 ? formatSpeed(speedSum) : "—";

  let remainBytes = 0;
  for (const entry of queue) {
    if (entry.state === "done" || entry.state === "cancelled" || entry.state === "error") {
      continue;
    }
    const entryTotal = entry.total || entry.file.size;
    remainBytes += Math.max(0, entryTotal - (entry.loaded || 0));
  }

  overallEtaEl.textContent =
    speedSum > 0 && remainBytes > 0
      ? `ETA ${formatEta(remainBytes / speedSum)}`
      : "ETA —";
}

async function abortOnServer(uploadId) {
  if (!uploadId) return;
  try {
    await fetch("/api/upload/abort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadId }),
    });
  } catch {
    /* ignore */
  }
}

function cancelOne(index) {
  const entry = queue[index];
  if (!entry) return;
  if (entry.state === "done" || entry.state === "error" || entry.state === "cancelled") {
    return;
  }

  console.warn("[upload] cancel one", entry.file.name);
  if (activeXhrs.has(index)) {
    abortFileXhrs(index);
    return;
  }

  entry.state = "cancelled";
  entry.speed = 0;
  updateItem(index, "cancelled", "Cancelled");
  clearLiveStats(index);
  refreshOverall();
  abortOnServer(entry.uploadId);
  setStatus(`Cancelled: ${entry.file.name}`);
}

function cancelAll() {
  if (!isUploading) return;
  cancelAllRequested = true;
  console.warn("[upload] cancel all");
  setStatus("Cancelling…");

  queue.forEach((entry, index) => {
    if (entry.state === "pending") {
      entry.state = "cancelled";
      entry.speed = 0;
      updateItem(index, "cancelled", "Cancelled");
    }
  });

  for (const index of activeXhrs.keys()) {
    abortFileXhrs(index);
  }
  refreshOverall();
}

function xhrJson(method, url, body, index) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    trackXhr(index, xhr);
    xhr.open(method, url);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.timeout = 0;
    xhr.addEventListener("load", () => {
      untrackXhr(index, xhr);
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data?.error || `HTTP ${xhr.status}`));
    });
    xhr.addEventListener("error", () => {
      untrackXhr(index, xhr);
      reject(new Error("Network error"));
    });
    xhr.addEventListener("abort", () => {
      untrackXhr(index, xhr);
      reject(Object.assign(new Error("Cancelled"), { cancelled: true }));
    });
    xhr.send(JSON.stringify(body));
  });
}

function uploadChunkBlob(uploadId, chunkIndex, blob, index, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    // Fields before file so multer sees uploadId/index in destination()
    form.append("uploadId", uploadId);
    form.append("index", String(chunkIndex));
    form.append("chunk", blob, `chunk-${chunkIndex}`);

    trackXhr(index, xhr);
    xhr.open("POST", "/api/upload/chunk");
    xhr.timeout = 0;

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) onProgress(e.loaded, e.total);
    });

    xhr.addEventListener("load", () => {
      untrackXhr(index, xhr);
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data?.error || `HTTP ${xhr.status}`));
    });
    xhr.addEventListener("error", () => {
      untrackXhr(index, xhr);
      reject(new Error("Network error"));
    });
    xhr.addEventListener("abort", () => {
      untrackXhr(index, xhr);
      reject(Object.assign(new Error("Cancelled"), { cancelled: true }));
    });
    xhr.send(form);
  });
}

async function mapPool(count, concurrency, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, count) }, async () => {
    while (next < count) {
      const i = next;
      next += 1;
      await worker(i);
    }
  });
  await Promise.all(runners);
}

async function uploadOne(index) {
  const entry = queue[index];
  if (!entry || entry.state === "cancelled" || entry.state === "done") {
    return false;
  }

  const file = entry.file;
  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
  const chunkLoaded = new Array(totalChunks).fill(0);
  let startedAt = performance.now();
  let lastBytes = 0;
  let lastAt = startedAt;

  entry.state = "uploading";
  entry.loaded = 0;
  entry.total = file.size;
  entry.speed = 0;
  updateItem(index, "uploading", "0%");
  clearLiveStats(index);
  refreshOverall();
  console.log(
    "[upload] client start (chunked)",
    file.name,
    formatBytes(file.size),
    `${totalChunks} chunks × ${CHUNK_CONCURRENCY} parallel`,
  );

  const refreshProgress = () => {
    const loaded = chunkLoaded.reduce((a, b) => a + b, 0);
    const now = performance.now();
    const dt = (now - lastAt) / 1000;
    let instant = 0;
    if (dt >= 0.2) {
      instant = (loaded - lastBytes) / dt;
      lastBytes = loaded;
      lastAt = now;
    }
    const elapsed = (now - startedAt) / 1000;
    const average = elapsed > 0 ? loaded / elapsed : 0;
    const speed = instant > 0 ? instant : average;
    const remain = Math.max(0, file.size - loaded);
    const etaSec = speed > 0 ? remain / speed : NaN;
    const pct = file.size > 0 ? Math.round((loaded / file.size) * 100) : 0;

    entry.loaded = loaded;
    entry.speed = speed;
    setProgress(index, pct);
    updateItem(index, "uploading", `${pct}%`);
    setSpeed(index, speed);
    setEta(index, etaSec);
    refreshOverall();
  };

  try {
    const init = await xhrJson(
      "POST",
      "/api/upload/init",
      {
        originalName: file.name,
        size: file.size,
        chunkSize: CHUNK_SIZE,
        totalChunks,
      },
      index,
    );

    const uploadId = init.uploadId;
    entry.uploadId = uploadId;

    await mapPool(totalChunks, CHUNK_CONCURRENCY, async (chunkIndex) => {
      if (cancelAllRequested || entry.state === "cancelled") {
        throw Object.assign(new Error("Cancelled"), { cancelled: true });
      }
      const start = chunkIndex * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const blob = file.slice(start, end);

      await uploadChunkBlob(uploadId, chunkIndex, blob, index, (loaded) => {
        chunkLoaded[chunkIndex] = loaded;
        refreshProgress();
      });
      chunkLoaded[chunkIndex] = blob.size;
      refreshProgress();
    });

    if (cancelAllRequested || entry.state === "cancelled") {
      throw Object.assign(new Error("Cancelled"), { cancelled: true });
    }

    updateItem(index, "uploading", "Assembling…");
    await xhrJson("POST", "/api/upload/complete", { uploadId }, index);

    entry.state = "done";
    entry.loaded = file.size;
    entry.speed = 0;
    entry.uploadId = null;
    setProgress(index, 100);
    updateItem(index, "done", "Done");
    clearLiveStats(index);
    refreshOverall();
    console.log("[upload] client end ok", file.name);
    return true;
  } catch (err) {
    const cancelled = Boolean(err?.cancelled) || cancelAllRequested;
    abortFileXhrs(index);
    if (entry.uploadId) {
      abortOnServer(entry.uploadId);
      entry.uploadId = null;
    }
    entry.speed = 0;
    clearLiveStats(index);

    if (cancelled) {
      entry.state = "cancelled";
      updateItem(index, "cancelled", "Cancelled");
      setStatus(`Cancelled: ${file.name}`);
    } else {
      entry.state = "error";
      const msg = err?.message || "Upload failed";
      setProgress(index, 0);
      updateItem(index, "error", msg);
      setStatus(`Failed: ${file.name} — ${msg}`);
      console.error("[upload failed]", file.name, err);
    }
    refreshOverall();
    return false;
  }
}

async function uploadSequential() {
  simultaneousMode = false;
  overallEl.hidden = true;
  for (let i = 0; i < queue.length; i += 1) {
    if (cancelAllRequested) break;
    if (queue[i].state === "cancelled" || queue[i].state === "done") continue;
    setStatus(`Uploading ${i + 1} of ${queue.length}: ${queue[i].file.name}`);
    await uploadOne(i);
  }
  setUploadingUi(false);
  setStatus(cancelAllRequested ? "Cancelled." : "All uploads completed.");
  cancelAllRequested = false;
}

async function uploadSimultaneous() {
  simultaneousMode = true;
  refreshOverall();
  setStatus(`Uploading ${queue.length} file${queue.length > 1 ? "s" : ""} at once…`);
  await Promise.all(
    queue.map((entry, i) => {
      if (entry.state === "cancelled") return Promise.resolve(false);
      return uploadOne(i);
    }),
  );
  setUploadingUi(false);
  setStatus(cancelAllRequested ? "Cancelled." : "All uploads completed.");
  cancelAllRequested = false;
  simultaneousMode = false;
}

startBtn.addEventListener("click", () => {
  if (isUploading || queue.length === 0) return;
  cancelAllRequested = false;
  setUploadingUi(true);
  syncCancelButtons();
  if (simultaneousEl.checked) uploadSimultaneous();
  else uploadSequential();
});

cancelAllBtn.addEventListener("click", () => cancelAll());

clearBtn.addEventListener("click", () => {
  if (isUploading) return;
  queue = [];
  fileList.innerHTML = "";
  queueSection.hidden = true;
  overallEl.hidden = true;
  setUploadingUi(false);
  startBtn.disabled = true;
  clearBtn.disabled = true;
  setStatus("");
});

fileInput.addEventListener("change", (e) => {
  if (e.target.files) addFiles(e.target.files);
  fileInput.value = "";
});

browseBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  fileInput.click();
});

dropzone.addEventListener("click", (e) => {
  if (e.target.closest("button") || e.target.closest("label") || e.target.closest("input")) {
    return;
  }
  fileInput.click();
});

dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("drag-over");
});

dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("drag-over");
});

dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("drag-over");
  if (e.dataTransfer?.files) addFiles(e.dataTransfer.files);
});
