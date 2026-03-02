// ── 日志面板当前激活的 Tab：'audit' | 'server'
let logActiveTab = "audit";
// 日志自动刷新定时器
let logAutoTimer = null;

const state = {
  config: null,
  currentPath: "",
  files: [],
  serverInfo: null,
  clientProfile: null,
  isAdmin: false,
  viewMode: window.localStorage.getItem("pip_kuaichuan_view_mode") === "grid" ? "grid" : "list",
  draggingPath: "",
  selectedPaths: new Set(),
  logPanelOpen: false,
  refreshTimer: null,
};

const DEFAULT_UPLOAD_CONCURRENCY = 8;
const MAX_UPLOAD_CONCURRENCY = 12;

const els = {
  deviceId: document.getElementById("deviceId"),
  userIdInput: document.getElementById("userIdInput"),
  saveConfigBtn: document.getElementById("saveConfigBtn"),
  hostIp: document.getElementById("hostIp"),
  clientIp: document.getElementById("clientIp"),
  localIPv4: document.getElementById("localIPv4"),
  serverStatus: document.getElementById("serverStatus"),
  storageRoot: document.getElementById("storageRoot"),
  serverUrlLabel: document.getElementById("serverUrlLabel"),
  refreshBtn: document.getElementById("refreshBtn"),
  upBtn: document.getElementById("upBtn"),
  newFolderBtn: document.getElementById("newFolderBtn"),
  uploadBtn: document.getElementById("uploadBtn"),
  uploadFolderBtn: document.getElementById("uploadFolderBtn"),
  listViewBtn: document.getElementById("listViewBtn"),
  gridViewBtn: document.getElementById("gridViewBtn"),
  selectAllBtn: document.getElementById("selectAllBtn"),
  clearSelectionBtn: document.getElementById("clearSelectionBtn"),
  downloadSelectedBtn: document.getElementById("downloadSelectedBtn"),
  toggleLogBtn: document.getElementById("toggleLogBtn"),
  fileInput: document.getElementById("fileInput"),
  folderInput: document.getElementById("folderInput"),
  tableWrap: document.getElementById("tableWrap"),
  fileTableBody: document.getElementById("fileTableBody"),
  fileGrid: document.getElementById("fileGrid"),
  emptyState: document.getElementById("emptyState"),
  breadcrumb: document.getElementById("breadcrumb"),
  dropUploadZone: document.getElementById("dropUploadZone"),
  uploadPanel: document.getElementById("uploadPanel"),
  uploadStatusText: document.getElementById("uploadStatusText"),
  uploadSpeedText: document.getElementById("uploadSpeedText"),
  uploadProgressBar: document.getElementById("uploadProgressBar"),
  logPanel: document.getElementById("logPanel"),
  logTabAudit: document.getElementById("logTabAudit"),
  logTabServer: document.getElementById("logTabServer"),
  logAutoRefresh: document.getElementById("logAutoRefresh"),
  refreshLogBtn: document.getElementById("refreshLogBtn"),
  closeLogBtn: document.getElementById("closeLogBtn"),
  logMeta: document.getElementById("logMeta"),
  logText: document.getElementById("logText"),
  serverLogText: document.getElementById("serverLogText"),
  toast: document.getElementById("toast"),
};

function baseUrl() {
  return window.location.origin;
}

function resolveUploadConcurrency(fileCount) {
  const count = Math.max(0, Number(fileCount) || 0);
  if (count <= 1) return Math.max(1, count);
  if (count <= DEFAULT_UPLOAD_CONCURRENCY) return count;
  if (count >= 200) return MAX_UPLOAD_CONCURRENCY;
  if (count >= 80) return 10;
  return DEFAULT_UPLOAD_CONCURRENCY;
}

function setLogPanelVisible(visible) {
  state.logPanelOpen = Boolean(visible);
  if (els.logPanel) {
    els.logPanel.classList.toggle("hidden", !state.logPanelOpen);
  }
  if (els.toggleLogBtn) {
    els.toggleLogBtn.textContent = state.logPanelOpen ? "隐藏日志" : "查看日志";
  }
  if (state.logPanelOpen) {
    startLogAutoRefresh();
  } else {
    stopLogAutoRefresh();
  }
}

function setLogTab(tab) {
  logActiveTab = tab;
  // Tab 按钮激活状态
  if (els.logTabAudit)  els.logTabAudit.classList.toggle("is-active",  tab === "audit");
  if (els.logTabServer) els.logTabServer.classList.toggle("is-active", tab === "server");
  // 显示/隐藏内容区
  if (els.logText)       els.logText.classList.toggle("hidden",       tab !== "audit");
  if (els.serverLogText) els.serverLogText.classList.toggle("hidden", tab !== "server");
  // 立刻刷新当前 Tab
  loadCurrentTabLogs(false);
}

function startLogAutoRefresh() {
  stopLogAutoRefresh();
  const enabled = els.logAutoRefresh ? els.logAutoRefresh.checked : true;
  if (!enabled) return;
  logAutoTimer = setInterval(() => {
    if (state.logPanelOpen) loadCurrentTabLogs(false);
  }, 3000);
}

function stopLogAutoRefresh() {
  if (logAutoTimer) {
    clearInterval(logAutoTimer);
    logAutoTimer = null;
  }
}

async function loadCurrentTabLogs(showErrorToast = true) {
  if (logActiveTab === "audit") {
    await loadAuditLogs(showErrorToast);
  } else {
    await loadServerLogs(showErrorToast);
  }
}

async function loadAuditLogs(showErrorToast = true) {
  try {
    const payload = await requestJson(`${baseUrl()}/api/logs?limit=300`);
    const lines = Array.isArray(payload.lines) ? payload.lines : [];
    if (els.logText) {
      els.logText.textContent = lines.length
        ? lines.join("\n")
        : "暂无日志（上传/下载/修改/删除后将自动记录）";
    }
    if (els.logMeta) {
      const updatedAt = new Date().toLocaleString("zh-CN", { hour12: false });
      const logFile = payload.file || "log.txt";
      els.logMeta.textContent = `操作审计 · 最新 ${lines.length} 条 · ${updatedAt} · ${logFile}`;
    }
  } catch (error) {
    if (showErrorToast) {
      showToast(`日志读取失败：${error.message}`, "error");
    }
  }
}

// 级别 → CSS 类名
const LOG_LEVEL_CLASS = { error: "log-line-error", warn: "log-line-warn", info: "log-line-info", debug: "log-line-debug" };

async function loadServerLogs(showErrorToast = true) {
  try {
    const payload = await requestJson(`${baseUrl()}/api/server-logs?limit=200`);
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    if (els.serverLogText) {
      // 清空后逐行渲染，带级别颜色
      els.serverLogText.innerHTML = "";
      if (!entries.length) {
        els.serverLogText.textContent = "暂无服务器日志";
      } else {
        const frag = document.createDocumentFragment();
        entries.forEach((entry) => {
          const span = document.createElement("span");
          span.className = LOG_LEVEL_CLASS[entry.level] || "log-line-info";
          const levelTag = entry.level ? `[${entry.level.toUpperCase()}]` : "[INFO]";
          span.textContent = `${entry.ts}  ${levelTag}  ${entry.msg}\n`;
          frag.appendChild(span);
        });
        els.serverLogText.appendChild(frag);
      }
    }
    if (els.logMeta) {
      const updatedAt = new Date().toLocaleString("zh-CN", { hour12: false });
      els.logMeta.textContent = `服务器运行日志 · 最新 ${entries.length} 条（内存缓冲，重启清空）· ${updatedAt}`;
    }
  } catch (error) {
    if (showErrorToast) {
      showToast(`服务器日志读取失败：${error.message}`, "error");
    }
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function encodeDataValue(value) {
  return encodeURIComponent(String(value || ""));
}

function decodeDataValue(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}

function basenameFromRelativePath(value) {
  const parts = String(value || "")
    .split("/")
    .filter(Boolean);
  return parts[parts.length - 1] || "folder";
}

function normalizeIP(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "localhost" || normalized === "::1") return "127.0.0.1";
  if (normalized.startsWith("::ffff:")) return normalized.slice(7);
  return normalized;
}

function buildUploadItem(file, relativePath) {
  const safeRelativePath = String(relativePath || file.name || "").replace(/\\/g, "/");
  return {
    file,
    relativePath: safeRelativePath,
  };
}

function fileListToUploadItems(fileList, useRelativePath = false) {
  return Array.from(fileList || []).map((file) => {
    const relativePath = useRelativePath
      ? file.webkitRelativePath || file.name
      : file.name;
    return buildUploadItem(file, relativePath);
  });
}

function readDirectoryEntries(reader) {
  return new Promise((resolve, reject) => {
    const all = [];

    function readNext() {
      reader.readEntries(
        (entries) => {
          if (!entries.length) {
            resolve(all);
            return;
          }
          all.push(...entries);
          readNext();
        },
        (error) => reject(error)
      );
    }

    readNext();
  });
}

async function collectUploadItemsFromEntry(entry, parentPath = "") {
  if (!entry) return [];

  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    const relativePath = parentPath ? `${parentPath}/${file.name}` : file.name;
    return [buildUploadItem(file, relativePath)];
  }

  if (entry.isDirectory) {
    const nextParent = parentPath ? `${parentPath}/${entry.name}` : entry.name;
    const reader = entry.createReader();
    const children = await readDirectoryEntries(reader);
    const nested = await Promise.all(
      children.map((child) => collectUploadItemsFromEntry(child, nextParent))
    );
    return nested.flat();
  }

  return [];
}

async function getDropUploadItems(dataTransfer) {
  const transferItems = Array.from(dataTransfer?.items || []);
  const entries = transferItems
    .map((item) =>
      item && item.kind === "file" && typeof item.webkitGetAsEntry === "function"
        ? item.webkitGetAsEntry()
        : null
    )
    .filter(Boolean);

  if (entries.length) {
    const nested = await Promise.all(entries.map((entry) => collectUploadItemsFromEntry(entry)));
    const flattened = nested.flat();
    if (flattened.length) {
      return flattened;
    }
  }

  return fileListToUploadItems(dataTransfer?.files || [], false);
}

function showToast(message, type = "") {
  els.toast.textContent = message;
  els.toast.className = `toast show ${type}`.trim();
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    els.toast.className = "toast";
  }, 2600);
}

function formatFileSize(size) {
  if (size === null || size === undefined || Number.isNaN(Number(size))) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Number(size);
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function formatSpeed(bytesPerSecond) {
  if (!bytesPerSecond || bytesPerSecond < 0) return "0 B/s";
  return `${formatFileSize(bytesPerSecond)}/s`;
}

function formatTime(iso) {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function storageBadge(type) {
  if (type === "permanent") {
    return '<span class="tag tag-permanent">永久</span>';
  }
  if (type === "temporary") {
    return '<span class="tag tag-temporary">临时(24h)</span>';
  }
  return "-";
}

function renderConfig() {
  const cfg = state.config;
  els.deviceId.textContent = cfg.deviceId;
  els.userIdInput.value = cfg.userId;
  els.localIPv4.textContent = cfg.localIPv4;
  els.serverStatus.textContent = cfg.serverRunning ? "运行中" : "未运行";
  els.serverStatus.style.color = cfg.serverRunning ? "#16a34a" : "#dc2626";
  els.storageRoot.textContent = cfg.storageRoot;
  const hostIp =
    (state.serverInfo && state.serverInfo.hostAddress) ||
    cfg.localIPv4 ||
    window.location.hostname;
  const clientIp =
    (state.serverInfo && state.serverInfo.clientIP) ||
    (state.clientProfile && state.clientProfile.clientIP) ||
    "-";
  els.hostIp.textContent = hostIp;
  els.clientIp.textContent = clientIp;
  els.serverUrlLabel.textContent = `${baseUrl()} （网页访问）`;
  els.saveConfigBtn.textContent = "保存昵称";
}

function toPathParts(currentPath) {
  return currentPath ? currentPath.split("/").filter(Boolean) : [];
}

function renderBreadcrumb() {
  const parts = toPathParts(state.currentPath);
  els.breadcrumb.innerHTML = "";

  const rootBtn = document.createElement("button");
  rootBtn.textContent = "根目录";
  rootBtn.addEventListener("click", () => {
    state.currentPath = "";
    refreshFiles();
  });
  els.breadcrumb.appendChild(rootBtn);

  let walk = "";
  parts.forEach((part) => {
    const sep = document.createElement("span");
    sep.textContent = "/";
    sep.style.color = "#4a5c7a";
    els.breadcrumb.appendChild(sep);

    walk = walk ? `${walk}/${part}` : part;
    const btn = document.createElement("button");
    btn.textContent = part;
    const targetPath = walk;
    btn.addEventListener("click", () => {
      state.currentPath = targetPath;
      refreshFiles();
    });
    els.breadcrumb.appendChild(btn);
  });
}

function fileTypeTag(type) {
  if (type === "folder") return '<span class="tag tag-folder">文件夹</span>';
  return '<span class="tag tag-file">文件</span>';
}

function getFileExt(name) {
  const input = String(name || "");
  const idx = input.lastIndexOf(".");
  if (idx <= 0 || idx === input.length - 1) return "";
  return input.slice(idx + 1).toLowerCase();
}

function iconClassForEntry(item) {
  if (item.type === "folder") return "entry-icon-folder";
  const ext = getFileExt(item.name);
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].includes(ext)) {
    return "entry-icon-image";
  }
  if (["mp4", "mov", "avi", "mkv", "webm"].includes(ext)) {
    return "entry-icon-video";
  }
  if (["pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "txt", "md"].includes(ext)) {
    return "entry-icon-doc";
  }
  return "entry-icon-file";
}

function iconLabelForEntry(item) {
  if (item.type === "folder") return "DIR";
  const ext = getFileExt(item.name);
  return (ext || "FILE").slice(0, 4).toUpperCase();
}

function renderViewMode() {
  const isGrid = state.viewMode === "grid";
  els.tableWrap.classList.toggle("hidden", isGrid);
  els.fileGrid.classList.toggle("hidden", !isGrid);
  els.listViewBtn.classList.toggle("is-active", !isGrid);
  els.gridViewBtn.classList.toggle("is-active", isGrid);
}

function setViewMode(mode) {
  const nextMode = mode === "grid" ? "grid" : "list";
  state.viewMode = nextMode;
  window.localStorage.setItem("pip_kuaichuan_view_mode", nextMode);
  renderViewMode();
  renderFiles();
}

function updateSelectionUI() {
  const selectedCount = state.selectedPaths.size;
  if (els.downloadSelectedBtn) {
    els.downloadSelectedBtn.textContent = `下载选中(${selectedCount})`;
    els.downloadSelectedBtn.disabled = selectedCount === 0;
  }
  if (els.clearSelectionBtn) {
    els.clearSelectionBtn.disabled = selectedCount === 0;
  }
}

function syncSelectionWithCurrentFiles() {
  const existingPaths = new Set(
    state.files.filter((item) => item.type === "file").map((item) => item.path)
  );
  state.selectedPaths.forEach((selectedPath) => {
    if (!existingPaths.has(selectedPath)) {
      state.selectedPaths.delete(selectedPath);
    }
  });
  updateSelectionUI();
}

function isSelectedPath(pathValue) {
  return state.selectedPaths.has(String(pathValue || ""));
}

function togglePathSelection(pathValue, checked) {
  const key = String(pathValue || "");
  if (!key) return;
  const entry = state.files.find((item) => item.path === key);
  if (!entry || entry.type !== "file") {
    return;
  }
  if (checked) {
    state.selectedPaths.add(key);
  } else {
    state.selectedPaths.delete(key);
  }
  updateSelectionUI();
}

function clearSelection() {
  state.selectedPaths.clear();
  updateSelectionUI();
  renderFiles();
}

function selectAllCurrentEntries() {
  state.files
    .filter((item) => item.type === "file")
    .forEach((item) => {
    state.selectedPaths.add(item.path);
  });
  updateSelectionUI();
  renderFiles();
}

function canMoveToFolder(sourcePath, folderPath) {
  if (!sourcePath || !folderPath) return false;
  if (sourcePath === folderPath) return false;
  if (folderPath.startsWith(`${sourcePath}/`)) return false;
  return true;
}

function clearMoveHighlights() {
  document.querySelectorAll("[data-drop-folder].drop-over").forEach((node) => {
    node.classList.remove("drop-over");
  });
}

async function moveEntryToFolder(sourcePath, folderPath) {
  if (!canMoveToFolder(sourcePath, folderPath)) {
    showToast("不能移动到该目录", "error");
    return;
  }

  try {
    await requestJson(`${baseUrl()}/api/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: sourcePath, targetFolderPath: folderPath }),
    });
    await refreshFiles();
    showToast("移动成功", "success");
  } catch (error) {
    showToast(`移动失败：${error.message}`, "error");
  }
}

function handleEntryActionClick(eventTarget) {
  const selectTarget = eventTarget.closest("[data-select-path]");
  if (selectTarget) {
    const selectPath = decodeDataValue(selectTarget.dataset.selectPath);
    togglePathSelection(selectPath, Boolean(selectTarget.checked));
    renderFiles();
    return true;
  }

  const openTarget = eventTarget.closest("[data-open]");
  if (openTarget) {
    state.currentPath = decodeDataValue(openTarget.dataset.open);
    refreshFiles();
    return true;
  }

  const enterTarget = eventTarget.closest("[data-enter]");
  if (enterTarget) {
    state.currentPath = decodeDataValue(enterTarget.dataset.enter);
    refreshFiles();
    return true;
  }

  const downloadTarget = eventTarget.closest("[data-download]");
  if (downloadTarget) {
    downloadFile(
      decodeDataValue(downloadTarget.dataset.download),
      decodeDataValue(downloadTarget.dataset.filename),
      downloadTarget.dataset.entryType || "file"
    );
    return true;
  }

  const renameTarget = eventTarget.closest("[data-rename]");
  if (renameTarget) {
    renameEntry(
      decodeDataValue(renameTarget.dataset.rename),
      decodeDataValue(renameTarget.dataset.name)
    );
    return true;
  }

  const deleteTarget = eventTarget.closest("[data-delete]");
  if (deleteTarget) {
    deleteEntry(
      decodeDataValue(deleteTarget.dataset.delete),
      deleteTarget.dataset.type,
      decodeDataValue(deleteTarget.dataset.name)
    );
    return true;
  }

  const permanentTarget = eventTarget.closest("[data-permanent]");
  if (permanentTarget) {
    upgradePermanent(
      decodeDataValue(permanentTarget.dataset.permanent),
      decodeDataValue(permanentTarget.dataset.name)
    );
    return true;
  }

  return false;
}

function renderListRows() {
  return state.files
    .map((item) => {
      const encodedPath = encodeDataValue(item.path);
      const encodedName = encodeDataValue(item.name);
      const safeName = escapeHtml(item.name);
      const safeUploader = escapeHtml(item.uploader || "-");
      const iconClass = iconClassForEntry(item);
      const iconLabel = iconLabelForEntry(item);
      const rowClasses = ["file-row"];
      const isFile = item.type === "file";
      const checked = isFile && isSelectedPath(item.path) ? "checked" : "";
      const selectDisabledAttr = isFile ? "" : "disabled";
      if (checked) rowClasses.push("is-selected");
      if (item.type === "folder") rowClasses.push("drop-target-folder");

      const openAction =
        item.type === "folder"
          ? `<button class="entry-name folder" data-open="${encodedPath}">${safeName}</button>`
          : `<span class="entry-name">${safeName}</span>`;

      const actions = [];
      if (item.type === "folder") {
        actions.push(`<button class="btn" data-enter="${encodedPath}">进入</button>`);
        actions.push(
          `<button class="btn btn-primary" data-download="${encodedPath}" data-entry-type="folder" data-filename="${encodedName}">下载zip</button>`
        );
      } else {
        actions.push(
          `<button class="btn btn-primary" data-download="${encodedPath}" data-entry-type="file" data-filename="${encodedName}">下载</button>`
        );
        if (state.isAdmin && item.storageType === "temporary") {
          actions.push(
            `<button class="btn" data-permanent="${encodedPath}" data-name="${encodedName}">升级永久</button>`
          );
        }
      }

      actions.push(
        `<button class="btn" data-rename="${encodedPath}" data-name="${encodedName}">重命名</button>`
      );
      actions.push(
        `<button class="btn btn-danger" data-delete="${encodedPath}" data-type="${item.type}" data-name="${encodedName}">删除</button>`
      );

      const opHtml = actions.join(" ");
      const dropAttrs =
        item.type === "folder" ? ` data-drop-folder="${encodedPath}" title="可拖拽文件/文件夹到此"` : "";
      const folderOpenAttr = item.type === "folder" ? ` data-folder-open="${encodedPath}"` : "";

      return `
      <tr class="${rowClasses.join(" ")}" draggable="true" data-drag-path="${encodedPath}" data-drag-type="${item.type}"${dropAttrs}${folderOpenAttr}>
        <td>
          <div class="entry-main">
            <input class="entry-check" type="checkbox" data-select-path="${encodedPath}" ${checked} ${selectDisabledAttr} />
            <span class="entry-icon ${iconClass}">${iconLabel}</span>
            <div class="entry-name-wrap">
              ${openAction}
              ${item.type === "folder" ? '<div class="entry-sub">拖到这里可移动</div>' : ""}
            </div>
          </div>
        </td>
        <td>${fileTypeTag(item.type)}</td>
        <td>${item.type === "file" ? formatFileSize(item.size) : "-"}</td>
        <td>
          <div>${safeUploader}</div>
          ${item.uploaderIP ? `<div class="uploader-ip">IP: ${escapeHtml(item.uploaderIP)}</div>` : ""}
        </td>
        <td>${item.type === "file" ? formatTime(item.uploadedAt) : "-"}</td>
        <td>
          ${item.type === "file" ? storageBadge(item.storageType) : "-"}
          ${item.type === "file" && item.storageType === "temporary" && item.expiresAt ? `<div class="storage-expire">到期: ${formatTime(item.expiresAt)}</div>` : ""}
        </td>
        <td>${formatTime(item.modifiedAt)}</td>
        <td>${opHtml}</td>
      </tr>`;
    })
    .join("");
}

function renderGridCards() {
  return state.files
    .map((item) => {
      const encodedPath = encodeDataValue(item.path);
      const encodedName = encodeDataValue(item.name);
      const safeName = escapeHtml(item.name);
      const iconClass = iconClassForEntry(item);
      const iconLabel = iconLabelForEntry(item);
      const canDrop = item.type === "folder";
      const isFile = item.type === "file";
      const checked = isFile && isSelectedPath(item.path) ? "checked" : "";
      const selectDisabledAttr = isFile ? "" : "disabled";
      const dropAttrs = canDrop ? ` data-drop-folder="${encodedPath}"` : "";
      const folderOpenAttr = canDrop ? ` data-folder-open="${encodedPath}"` : "";

      const actions = [];
      if (item.type === "folder") {
        actions.push(`<button class="btn" data-enter="${encodedPath}">进入</button>`);
        actions.push(
          `<button class="btn btn-primary" data-download="${encodedPath}" data-entry-type="folder" data-filename="${encodedName}">下载zip</button>`
        );
      } else {
        actions.push(
          `<button class="btn btn-primary" data-download="${encodedPath}" data-entry-type="file" data-filename="${encodedName}">下载</button>`
        );
        if (state.isAdmin && item.storageType === "temporary") {
          actions.push(
            `<button class="btn" data-permanent="${encodedPath}" data-name="${encodedName}">永久</button>`
          );
        }
      }
      actions.push(`<button class="btn" data-rename="${encodedPath}" data-name="${encodedName}">改名</button>`);
      actions.push(
        `<button class="btn btn-danger" data-delete="${encodedPath}" data-type="${item.type}" data-name="${encodedName}">删</button>`
      );

      return `
      <article class="file-card ${canDrop ? "drop-target-folder" : ""} ${checked ? "is-selected" : ""}" draggable="true" data-drag-path="${encodedPath}" data-drag-type="${item.type}"${dropAttrs}${folderOpenAttr}>
        <label class="file-card-check-wrap">
          <input class="entry-check" type="checkbox" data-select-path="${encodedPath}" ${checked} ${selectDisabledAttr} />
        </label>
        <div class="file-card-thumb ${iconClass}">
          <span class="file-card-icon">${iconLabel}</span>
        </div>
        ${item.type === "folder" ? `<button class="file-card-name folder" data-open="${encodedPath}">${safeName}</button>` : `<span class="file-card-name">${safeName}</span>`}
        <div class="file-card-meta">${item.type === "folder" ? "文件夹" : formatFileSize(item.size)}</div>
        <div class="file-card-meta">${item.type === "file" ? (item.storageType === "permanent" ? "永久" : "临时") : "-"}</div>
        <div class="file-card-meta">${formatTime(item.modifiedAt)}</div>
        ${canDrop ? '<div class="file-card-drop-tip">拖拽到这里可移动</div>' : ""}
        <div class="file-card-actions">${actions.join("")}</div>
      </article>`;
    })
    .join("");
}

function renderFiles() {
  renderViewMode();
  els.fileTableBody.innerHTML = renderListRows();
  els.fileGrid.innerHTML = renderGridCards();
  els.emptyState.style.display = state.files.length ? "none" : "block";
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || `请求失败：${response.status}`);
  }

  return payload;
}

async function refreshFiles() {
  renderBreadcrumb();
  try {
    const payload = await requestJson(
      `${baseUrl()}/api/files?path=${encodeURIComponent(state.currentPath)}`
    );
    state.currentPath = payload.path || "";
    state.files = payload.files || [];
    syncSelectionWithCurrentFiles();
    renderBreadcrumb();
    renderFiles();
  } catch (error) {
    showToast(`目录刷新失败：${error.message}`, "error");
    state.files = [];
    syncSelectionWithCurrentFiles();
    renderFiles();
  }
}

async function saveConfig() {
  const userId = (els.userIdInput.value || "").trim();
  if (!userId) {
    showToast("昵称不能为空", "error");
    return;
  }

  try {
    const profile = await requestJson(`${baseUrl()}/api/client-profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    state.clientProfile = profile;
    state.config.userId = profile.userId;
    renderConfig();
    showToast("昵称已保存", "success");
  } catch (error) {
    showToast(`昵称保存失败：${error.message}`, "error");
  }
}

async function createFolder() {
  const name = window.prompt("请输入新文件夹名称");
  if (!name) return;

  try {
    await requestJson(`${baseUrl()}/api/folders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: state.currentPath, name }),
    });
    await refreshFiles();
    showToast("文件夹创建成功", "success");
  } catch (error) {
    showToast(`创建失败：${error.message}`, "error");
  }
}

async function upgradePermanent(targetPath, itemName) {
  if (!state.isAdmin) {
    showToast("仅管理员可升级为永久存储", "error");
    return;
  }

  const ok = window.confirm(`确认将文件「${itemName}」升级为永久存储吗？`);
  if (!ok) return;

  try {
    await requestJson(`${baseUrl()}/api/files/permanent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: targetPath }),
    });
    await refreshFiles();
    showToast("已升级为永久存储", "success");
  } catch (error) {
    showToast(`升级失败：${error.message}`, "error");
  }
}

function setUploadPanelVisible(visible) {
  if (!els.uploadPanel) return;
  els.uploadPanel.classList.toggle("hidden", !visible);
}

function updateUploadProgress(progressText, speedText, percent) {
  if (els.uploadStatusText) {
    els.uploadStatusText.textContent = progressText;
  }
  if (els.uploadSpeedText) {
    els.uploadSpeedText.textContent = speedText;
  }
  if (els.uploadProgressBar) {
    const safePercent = Math.max(0, Math.min(100, percent || 0));
    els.uploadProgressBar.style.width = `${safePercent}%`;
  }
}

function uploadWithProgress(url, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url, true);

    let lastLoaded = 0;
    let lastAt = Date.now();

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;

      const now = Date.now();
      const deltaBytes = event.loaded - lastLoaded;
      const deltaSeconds = Math.max((now - lastAt) / 1000, 0.001);
      const instantSpeed = deltaBytes / deltaSeconds;

      onProgress({
        loaded: event.loaded,
        total: event.total,
        speed: instantSpeed,
      });

      lastLoaded = event.loaded;
      lastAt = now;
    };

    xhr.onload = () => {
      let payload = {};
      try {
        payload = JSON.parse(xhr.responseText || "{}");
      } catch {
        payload = {};
      }

      if (xhr.status < 200 || xhr.status >= 300 || payload.ok === false) {
        reject(new Error(payload.message || `上传失败：${xhr.status}`));
        return;
      }
      resolve(payload);
    };

    xhr.onerror = () => {
      reject(new Error("网络异常，上传失败"));
    };

    xhr.send(formData);
  });
}

function buildUploadFormData(item) {
  const formData = new FormData();
  formData.append("files", item.file, item.relativePath || item.file.name);
  return formData;
}

async function uploadSingleItem(item, uploader, onProgress) {
  return uploadWithProgress(
    `${baseUrl()}/api/upload?path=${encodeURIComponent(state.currentPath)}&uploader=${encodeURIComponent(uploader)}`,
    buildUploadFormData(item),
    onProgress
  );
}

async function uploadWithConcurrentQueue(uploadItems, { uploader, concurrency, onProgress }) {
  const maxWorkers = Math.max(1, Math.min(Number(concurrency) || 1, uploadItems.length));
  const loadedByIndex = new Array(uploadItems.length).fill(0);
  const speedByIndex = new Array(uploadItems.length).fill(0);

  let totalLoaded = 0;
  let totalSpeed = 0;
  let uploadedCount = 0;
  const uploaded = [];
  let cursor = 0;
  let firstError = null;

  const publish = () => {
    if (typeof onProgress === "function") {
      onProgress({ loaded: totalLoaded, speed: totalSpeed });
    }
  };

  const updateIndexProgress = (index, loaded, speed, totalHint) => {
    const fileSize = Number(uploadItems[index]?.file?.size || 0);
    const cap = fileSize > 0 ? fileSize : Math.max(Number(totalHint) || 0, Number(loaded) || 0);
    const nextLoaded = Math.max(0, Math.min(cap || Number.MAX_SAFE_INTEGER, Number(loaded) || 0));
    const previousLoaded = loadedByIndex[index];
    loadedByIndex[index] = nextLoaded;
    totalLoaded += nextLoaded - previousLoaded;

    const nextSpeed = Math.max(0, Number(speed) || 0);
    const previousSpeed = speedByIndex[index];
    speedByIndex[index] = nextSpeed;
    totalSpeed += nextSpeed - previousSpeed;

    publish();
  };

  async function worker() {
    while (true) {
      if (firstError) return;

      const index = cursor;
      cursor += 1;
      if (index >= uploadItems.length) return;

      const item = uploadItems[index];
      try {
        const payload = await uploadSingleItem(item, uploader, ({ loaded, total, speed }) => {
          updateIndexProgress(index, loaded, speed, total);
        });

        const finalLoaded = Number(item.file?.size || 0) || loadedByIndex[index];
        updateIndexProgress(index, finalLoaded, 0, finalLoaded);

        uploadedCount += Number(payload.uploadedCount || 0);
        if (Array.isArray(payload.uploaded)) {
          uploaded.push(...payload.uploaded);
        }
      } catch (error) {
        const displayName = item.relativePath || item.file?.name || "未知文件";
        firstError = new Error(`${displayName} 上传失败：${error.message}`);
        return;
      }
    }
  }

  const workers = Array.from({ length: maxWorkers }, () => worker());
  await Promise.all(workers);

  if (firstError) {
    throw firstError;
  }

  return { uploadedCount, uploaded };
}

async function uploadSelectedFiles(uploadItems) {
  if (!uploadItems.length) return;

  const fileCount = uploadItems.length;
  const fileBytes = uploadItems.reduce((sum, item) => sum + (item.file.size || 0), 0);
  const uploadConcurrency = resolveUploadConcurrency(fileCount);

  try {
    setUploadPanelVisible(true);
    updateUploadProgress(
      `正在上传 ${fileCount} 个文件（并发 ${uploadConcurrency}）...`,
      "0 B/s",
      0
    );

    const uploader = state.config.userId || "匿名用户";
    const payload = await uploadWithConcurrentQueue(uploadItems, {
      uploader,
      concurrency: uploadConcurrency,
      onProgress: ({ loaded, speed }) => {
        const percent = fileBytes > 0 ? (loaded / fileBytes) * 100 : 0;
        updateUploadProgress(
          `正在上传 ${fileCount} 个文件 · ${percent.toFixed(1)}% (${formatFileSize(loaded)} / ${formatFileSize(fileBytes)})`,
          formatSpeed(speed),
          percent
        );
      },
    });

    updateUploadProgress(`上传完成：${payload.uploadedCount} 个文件`, "完成", 100);
    await refreshFiles();
    showToast(`上传完成：${payload.uploadedCount} 个文件`, "success");
    setTimeout(() => setUploadPanelVisible(false), 1200);
  } catch (error) {
    updateUploadProgress(`上传失败：${error.message}`, "0 B/s", 0);
    showToast(`上传失败：${error.message}`, "error");
  }
}

async function downloadFile(relativePath, fileName, entryType = "file") {
  const isFolder = entryType === "folder";
  // 文件夹下载时服务端返回 zip，确保保存文件名带 .zip 后缀
  const resolvedFileName = isFolder ? `${fileName || "folder"}.zip` : (fileName || "");

  // 普通文件：直接用 <a> 标签下载
  if (!isFolder) {
    const link = document.createElement("a");
    link.href = `${baseUrl()}/api/download?path=${encodeURIComponent(relativePath)}`;
    link.download = resolvedFileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    showToast("已开始浏览器下载", "success");
    return true;
  }

  // 文件夹：两步走
  // 步骤1：POST /api/zip，等待服务端打包完成，拿到 token
  // 步骤2：用 token 构建下载 URL，用 <a> 触发下载
  showToast("正在打包文件夹，请稍候…", "success");
  try {
    const zipRes = await requestJson(`${baseUrl()}/api/zip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: relativePath }),
    });
    if (!zipRes.ok) {
      showToast(`打包失败：${zipRes.message || "未知错误"}`, "error");
      return false;
    }
    const { token, zipFileName } = zipRes;
    const downloadUrl = `${baseUrl()}/api/download?token=${encodeURIComponent(token)}`;
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = zipFileName || resolvedFileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    showToast("文件夹已打包，正在下载…", "success");
    return true;
  } catch (error) {
    showToast(`下载失败：${error.message}`, "error");
    return false;
  }
}

async function downloadSelectedEntries() {
  const selected = state.files.filter(
    (item) => item.type === "file" && state.selectedPaths.has(item.path)
  );
  if (!selected.length) {
    showToast("请先选择要下载的文件", "error");
    return;
  }

  let success = 0;
  for (const item of selected) {
    const ok = await downloadFile(item.path, item.name, "file");
    if (ok) {
      success += 1;
    }
  }

  showToast(`批量下载完成：成功 ${success}/${selected.length}`, success ? "success" : "error");
}

async function renameEntry(targetPath, oldName) {
  const newName = window.prompt("请输入新名称", oldName || "");
  if (!newName) return;

  try {
    const payload = await requestJson(`${baseUrl()}/api/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: targetPath, newName }),
    });
    await refreshFiles();
    showToast(`重命名成功：${payload.newPath || targetPath}`, "success");
  } catch (error) {
    showToast(`重命名失败：${error.message}`, "error");
  }
}

async function deleteEntry(targetPath, itemType, itemName) {
  const label = itemType === "folder" ? "文件夹" : "文件";
  const ok = window.confirm(`确认删除${label}「${itemName}」？此操作不可撤销。`);
  if (!ok) return;

  try {
    await requestJson(`${baseUrl()}/api/files?path=${encodeURIComponent(targetPath)}`, {
      method: "DELETE",
    });
    await refreshFiles();
    showToast("删除成功", "success");
  } catch (error) {
    showToast(`删除失败：${error.message}`, "error");
  }
}

function bindEvents() {
  els.saveConfigBtn.addEventListener("click", saveConfig);
  els.refreshBtn.addEventListener("click", refreshFiles);
  els.listViewBtn.addEventListener("click", () => setViewMode("list"));
  els.gridViewBtn.addEventListener("click", () => setViewMode("grid"));
  els.selectAllBtn.addEventListener("click", selectAllCurrentEntries);
  els.clearSelectionBtn.addEventListener("click", clearSelection);
  els.downloadSelectedBtn.addEventListener("click", downloadSelectedEntries);
  els.toggleLogBtn.addEventListener("click", async () => {
    const willOpen = !state.logPanelOpen;
    setLogPanelVisible(willOpen);
    if (willOpen) {
      await loadCurrentTabLogs(true);
    }
  });
  if (els.logTabAudit) {
    els.logTabAudit.addEventListener("click", () => setLogTab("audit"));
  }
  if (els.logTabServer) {
    els.logTabServer.addEventListener("click", () => setLogTab("server"));
  }
  if (els.logAutoRefresh) {
    els.logAutoRefresh.addEventListener("change", () => {
      if (els.logAutoRefresh.checked) {
        startLogAutoRefresh();
      } else {
        stopLogAutoRefresh();
      }
    });
  }
  els.refreshLogBtn.addEventListener("click", () => loadCurrentTabLogs(true));
  els.closeLogBtn.addEventListener("click", () => setLogPanelVisible(false));

  els.upBtn.addEventListener("click", () => {
    const parts = toPathParts(state.currentPath);
    parts.pop();
    state.currentPath = parts.join("/");
    refreshFiles();
  });

  els.newFolderBtn.addEventListener("click", createFolder);
  els.uploadBtn.addEventListener("click", () => els.fileInput.click());
  els.uploadFolderBtn.addEventListener("click", () => els.folderInput.click());
  els.fileInput.addEventListener("change", async (event) => {
    const uploadItems = fileListToUploadItems(event.target.files || [], false);
    await uploadSelectedFiles(uploadItems);
    event.target.value = "";
  });

  els.folderInput.addEventListener("change", async (event) => {
    const uploadItems = fileListToUploadItems(event.target.files || [], true);
    await uploadSelectedFiles(uploadItems);
    event.target.value = "";
  });

  els.dropUploadZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    els.dropUploadZone.classList.add("dragover");
  });

  els.dropUploadZone.addEventListener("dragleave", () => {
    els.dropUploadZone.classList.remove("dragover");
  });

  els.dropUploadZone.addEventListener("drop", async (event) => {
    event.preventDefault();
    els.dropUploadZone.classList.remove("dragover");

    try {
      const uploadItems = await getDropUploadItems(event.dataTransfer);
      if (!uploadItems.length) {
        showToast("未检测到可上传的文件", "error");
        return;
      }
      await uploadSelectedFiles(uploadItems);
    } catch (error) {
      showToast(`拖拽上传失败：${error.message}`, "error");
    }
  });

  const bindEntryContainer = (container) => {
    if (!container) return;

    container.addEventListener("click", (event) => {
      handleEntryActionClick(event.target);
    });

    container.addEventListener("dblclick", (event) => {
      const folderNode = event.target.closest("[data-folder-open]");
      if (!folderNode) return;
      const folderPath = decodeDataValue(folderNode.dataset.folderOpen);
      if (!folderPath) return;
      state.currentPath = folderPath;
      refreshFiles();
    });

    container.addEventListener("dragstart", (event) => {
      const dragNode = event.target.closest("[data-drag-path]");
      if (!dragNode) return;

      const dragPath = decodeDataValue(dragNode.dataset.dragPath);
      if (!dragPath) return;

      state.draggingPath = dragPath;
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", dragPath);
      }
    });

    container.addEventListener("dragend", () => {
      state.draggingPath = "";
      clearMoveHighlights();
    });

    container.addEventListener("dragover", (event) => {
      const folderNode = event.target.closest("[data-drop-folder]");
      if (!folderNode) return;

      const folderPath = decodeDataValue(folderNode.dataset.dropFolder);
      if (!canMoveToFolder(state.draggingPath, folderPath)) return;

      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
      clearMoveHighlights();
      folderNode.classList.add("drop-over");
    });

    container.addEventListener("dragleave", (event) => {
      const folderNode = event.target.closest("[data-drop-folder]");
      if (!folderNode) return;
      const nextTarget = event.relatedTarget;
      if (nextTarget && folderNode.contains(nextTarget)) return;
      folderNode.classList.remove("drop-over");
    });

    container.addEventListener("drop", async (event) => {
      const folderNode = event.target.closest("[data-drop-folder]");
      if (!folderNode) return;

      event.preventDefault();
      clearMoveHighlights();

      const folderPath = decodeDataValue(folderNode.dataset.dropFolder);
      const droppedPath =
        state.draggingPath ||
        decodeDataValue(event.dataTransfer?.getData("text/plain") || "");
      state.draggingPath = "";

      if (!droppedPath) return;
      await moveEntryToFolder(droppedPath, folderPath);
    });
  };

  bindEntryContainer(els.fileTableBody);
  bindEntryContainer(els.fileGrid);
}

async function bootstrap() {
  const info = await requestJson(`${baseUrl()}/api/server-info`);
  const profile = await requestJson(`${baseUrl()}/api/client-profile`);
  state.serverInfo = info;
  state.clientProfile = profile;
  state.isAdmin = Boolean(info.isAdmin);
  state.config = {
    deviceId: info.deviceId || "WEB_CLIENT",
    userId: profile.userId || "访客",
    localIPv4: info.localIPv4 || window.location.hostname,
    serverRunning: true,
    storageRoot: info.storageRoot || "共享目录",
  };

  renderConfig();
  updateSelectionUI();
  setLogPanelVisible(false);
  bindEvents();
  await refreshFiles();

  clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(refreshFiles, 4000);
}

bootstrap().catch((error) => {
  showToast(`初始化失败：${error.message}`, "error");
});
