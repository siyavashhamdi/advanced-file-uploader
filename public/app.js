const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const queueSection = document.getElementById("queue");
const fileList = document.getElementById("file-list");
const startBtn = document.getElementById("start-btn");
const clearBtn = document.getElementById("clear-btn");
const statusEl = document.getElementById("status");
const simultaneousEl = document.getElementById("simultaneous");
const browseBtn = document.getElementById("browse-btn");

let queue = [];
let isUploading = false;

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

function setStatus(message) {
  statusEl.textContent = message;
}

function createFileItem(file, index) {
  const item = document.createElement("li");
  item.className = "file-item";
  item.dataset.index = String(index);

  const meta = document.createElement("div");
  meta.className = "file-meta";

  const name = document.createElement("div");
  name.className = "file-name";
  name.textContent = file.name;

  const size = document.createElement("div");
  size.className = "file-size";
  size.textContent = formatBytes(file.size);

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

  fileStatus.appendChild(pill);
  fileStatus.appendChild(speed);

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

function addFiles(files) {
  if (isUploading) {
    setStatus("Upload in progress — wait until it finishes.");
    return;
  }

  const newFiles = Array.from(files).filter((f) => f.size > 0);
  if (newFiles.length === 0) return;

  const startIndex = queue.length;
  queue.push(...newFiles);

  queueSection.hidden = false;
  startBtn.disabled = false;
  clearBtn.disabled = false;
  simultaneousEl.disabled = false;

  newFiles.forEach((file, i) => {
    fileList.appendChild(createFileItem(file, startIndex + i));
  });

  setStatus(`${queue.length} file${queue.length > 1 ? "s" : ""} in queue`);
}

function updateItem(index, state, text) {
  const item = fileList.querySelector(`[data-index="${index}"]`);
  if (!item) return;
  const pill = item.querySelector(".status-pill");
  pill.textContent = text;
  pill.className = "status-pill" + (state ? ` ${state}` : "");
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

function clearSpeed(index) {
  setSpeed(index, 0);
}

function setProgress(index, percent) {
  const item = fileList.querySelector(`[data-index="${index}"]`);
  if (!item) return;
  const bar = item.querySelector(".progress-bar");
  bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function uploadOne(index) {
  return new Promise((resolve) => {
    const file = queue[index];
    updateItem(index, "", "0%");
    clearSpeed(index);

    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("file", file, file.name);

    let lastLoaded = 0;
    let lastAt = performance.now();
    let startedAt = 0;

    xhr.open("POST", "/api/upload");

    xhr.upload.addEventListener("loadstart", () => {
      startedAt = performance.now();
      lastLoaded = 0;
      lastAt = startedAt;
    });

    xhr.upload.addEventListener("progress", (e) => {
      if (!e.lengthComputable) return;
      const now = performance.now();
      const pct = Math.round((e.loaded / e.total) * 100);
      setProgress(index, pct);

      const dt = (now - lastAt) / 1000;
      let instant = 0;
      if (dt >= 0.2) {
        instant = (e.loaded - lastLoaded) / dt;
        lastLoaded = e.loaded;
        lastAt = now;
      }

      const elapsed = (now - (startedAt || now)) / 1000;
      const average = elapsed > 0 ? e.loaded / elapsed : 0;
      const speed = instant > 0 ? instant : average;

      updateItem(index, "", `${pct}%`);
      setSpeed(index, speed);
    });

    const done = (ok, label, state) => {
      if (ok) {
        setProgress(index, 100);
        updateItem(index, "done", "Done");
      } else {
        setProgress(index, 0);
        updateItem(index, state || "error", label);
      }
      clearSpeed(index);
      resolve(ok);
    };

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        done(true);
        return;
      }
      let detail = `Error ${xhr.status}`;
      try {
        const body = JSON.parse(xhr.responseText);
        if (body?.error) detail = body.error;
      } catch {
        if (xhr.responseText) detail = xhr.responseText.slice(0, 120);
      }
      console.error("[upload failed]", file.name, xhr.status, xhr.responseText);
      setStatus(`Failed: ${file.name} — ${detail}`);
      done(false, detail);
    });

    xhr.addEventListener("error", () => {
      console.error("[upload network error]", file.name);
      setStatus(`Network error: ${file.name}`);
      done(false, "Network error");
    });

    xhr.addEventListener("timeout", () => {
      console.error("[upload timeout]", file.name);
      setStatus(`Timeout: ${file.name}`);
      done(false, "Timeout");
    });

    xhr.timeout = 0;
    xhr.send(form);
  });
}

async function uploadSequential() {
  for (let i = 0; i < queue.length; i += 1) {
    setStatus(`Uploading ${i + 1} of ${queue.length}: ${queue[i].name}`);
    await uploadOne(i);
  }
  isUploading = false;
  startBtn.disabled = false;
  clearBtn.disabled = false;
  simultaneousEl.disabled = false;
  setStatus("All uploads completed.");
}

async function uploadSimultaneous() {
  setStatus(`Uploading ${queue.length} file${queue.length > 1 ? "s" : ""} at once…`);
  await Promise.all(queue.map((_, i) => uploadOne(i)));
  isUploading = false;
  startBtn.disabled = false;
  clearBtn.disabled = false;
  simultaneousEl.disabled = false;
  setStatus("All uploads completed.");
}

startBtn.addEventListener("click", () => {
  if (isUploading || queue.length === 0) return;
  isUploading = true;
  startBtn.disabled = true;
  clearBtn.disabled = true;
  simultaneousEl.disabled = true;

  if (simultaneousEl.checked) {
    uploadSimultaneous();
  } else {
    uploadSequential();
  }
});

clearBtn.addEventListener("click", () => {
  if (isUploading) return;
  queue = [];
  fileList.innerHTML = "";
  queueSection.hidden = true;
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
