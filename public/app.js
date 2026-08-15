const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const queueSection = document.getElementById("queue");
const fileList = document.getElementById("file-list");
const startBtn = document.getElementById("start-btn");
const clearBtn = document.getElementById("clear-btn");
const statusEl = document.getElementById("status");

let queue = [];
let isUploading = false;

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
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

  fileStatus.appendChild(pill);

  const progress = document.createElement("div");
  progress.className = "progress";
  const bar = document.createElement("div");
  bar.className = "progress-bar";
  progress.appendChild(bar);

  item.appendChild(meta);
  item.appendChild(fileStatus);
  item.appendChild(progress);

  return { item, pill, bar };
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

  newFiles.forEach((file, i) => {
    const { item, pill, bar } = createFileItem(file, startIndex + i);
    fileList.appendChild(item);
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

function setProgress(index, percent) {
  const item = fileList.querySelector(`[data-index="${index}"]`);
  if (!item) return;
  const bar = item.querySelector(".progress-bar");
  bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function uploadNext(currentIndex = 0) {
  if (currentIndex >= queue.length) {
    isUploading = false;
    startBtn.disabled = false;
    clearBtn.disabled = false;
    setStatus("All uploads completed.");
    return;
  }

  const file = queue[currentIndex];
  updateItem(currentIndex, "", "Uploading");
  setStatus(`Uploading ${currentIndex + 1} of ${queue.length}: ${file.name}`);

  const xhr = new XMLHttpRequest();
  const form = new FormData();
  form.append("file", file, file.name);

  xhr.open("POST", "/api/upload");

  xhr.upload.addEventListener("progress", (e) => {
    if (e.lengthComputable) {
      const pct = Math.round((e.loaded / e.total) * 100);
      setProgress(currentIndex, pct);
      updateItem(currentIndex, "", `${pct}%`);
    }
  });

  xhr.addEventListener("load", () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      setProgress(currentIndex, 100);
      updateItem(currentIndex, "done", "Done");
    } else {
      setProgress(currentIndex, 0);
      updateItem(currentIndex, "error", `Error ${xhr.status}`);
    }
    uploadNext(currentIndex + 1);
  });

  xhr.addEventListener("error", () => {
    setProgress(currentIndex, 0);
    updateItem(currentIndex, "error", "Error");
    uploadNext(currentIndex + 1);
  });

  xhr.send(form);
}

startBtn.addEventListener("click", () => {
  if (isUploading || queue.length === 0) return;
  isUploading = true;
  startBtn.disabled = true;
  clearBtn.disabled = true;
  uploadNext(0);
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

dropzone.addEventListener("click", (e) => {
  if (e.target === startBtn || e.target === clearBtn) return;
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
