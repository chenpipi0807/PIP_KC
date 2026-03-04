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
  // 本 session 已验证密码的文件夹路径集合（key=folderPath, value=true）
  unlockedFolders: new Set(),
  // 本 session 已验证文件夹的访问 token（Map<folderPath, accessToken>），随请求发送给后端
  folderTokens: new Map(),
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
  // 预览弹窗
  previewOverlay: document.getElementById("previewOverlay"),
  previewTitle: document.getElementById("previewTitle"),
  previewDownloadBtn: document.getElementById("previewDownloadBtn"),
  previewCloseBtn: document.getElementById("previewCloseBtn"),
  previewBody: document.getElementById("previewBody"),
  previewPrevBtn: document.getElementById("previewPrevBtn"),
  previewNextBtn: document.getElementById("previewNextBtn"),
  previewImage: document.getElementById("previewImage"),
  previewVideo: document.getElementById("previewVideo"),
  previewTextWrap: document.getElementById("previewTextWrap"),
  previewText: document.getElementById("previewText"),
  previewMarkdown: document.getElementById("previewMarkdown"),
  previewPdf: document.getElementById("previewPdf"),
  previewUnsupported: document.getElementById("previewUnsupported"),
  previewUnsupportedMsg: document.getElementById("previewUnsupportedMsg"),
  previewUnsupportedDownload: document.getElementById("previewUnsupportedDownload"),
  previewLoading: document.getElementById("previewLoading"),
  // 访客密码验证弹窗
  lockOverlay: document.getElementById("lockOverlay"),
  lockFolderName: document.getElementById("lockFolderName"),
  lockPasswordInput: document.getElementById("lockPasswordInput"),
  lockError: document.getElementById("lockError"),
  lockConfirmBtn: document.getElementById("lockConfirmBtn"),
  lockCancelBtn: document.getElementById("lockCancelBtn"),
  // 管理员加密设置弹窗
  adminLockOverlay: document.getElementById("adminLockOverlay"),
  adminLockIcon: document.getElementById("adminLockIcon"),
  adminLockTitle: document.getElementById("adminLockTitle"),
  adminLockFolderName: document.getElementById("adminLockFolderName"),
  adminLockPasswordInput: document.getElementById("adminLockPasswordInput"),
  adminLockPasswordConfirm: document.getElementById("adminLockPasswordConfirm"),
  adminLockError: document.getElementById("adminLockError"),
  adminLockConfirmBtn: document.getElementById("adminLockConfirmBtn"),
  adminLockRemoveBtn: document.getElementById("adminLockRemoveBtn"),
  adminLockCancelBtn: document.getElementById("adminLockCancelBtn"),
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

// ══════════════════════════════════════════════════════
// ── 文件预览系统 ──────────────────────────────────────
// ══════════════════════════════════════════════════════

const PREVIEW_IMAGE_EXTS = new Set(["png","jpg","jpeg","gif","webp","svg","bmp","ico","avif","tiff","tif"]);
const PREVIEW_VIDEO_EXTS = new Set(["mp4","webm","ogg","mov","avi","mkv","flv","m4v","3gp"]);
const PREVIEW_TEXT_EXTS  = new Set(["txt","log","csv","json","xml","yaml","yml","toml","ini","conf","cfg",
  "sh","bat","js","ts","py","java","c","cpp","h","css","html","htm","sql","rs","go","rb","php","swift","kt"]);
const PREVIEW_MD_EXTS    = new Set(["md","markdown"]);
const PREVIEW_PDF_EXTS   = new Set(["pdf"]);

function getPreviewType(ext) {
  const e = (ext || "").toLowerCase();
  if (PREVIEW_IMAGE_EXTS.has(e)) return "image";
  if (PREVIEW_VIDEO_EXTS.has(e)) return "video";
  if (PREVIEW_MD_EXTS.has(e))    return "markdown";
  if (PREVIEW_TEXT_EXTS.has(e))  return "text";
  if (PREVIEW_PDF_EXTS.has(e))   return "pdf";
  return "unsupported";
}

/** 简易 Markdown → HTML 渲染（无外部依赖） */
function renderMarkdown(text) {
  // 先转义 HTML，再做 md 转换
  const escaped = text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  return escaped
    // 标题 h1-h6
    .replace(/^######\s+(.+)$/gm, "<h6>$1</h6>")
    .replace(/^#####\s+(.+)$/gm,  "<h5>$1</h5>")
    .replace(/^####\s+(.+)$/gm,   "<h4>$1</h4>")
    .replace(/^###\s+(.+)$/gm,    "<h3>$1</h3>")
    .replace(/^##\s+(.+)$/gm,     "<h2>$1</h2>")
    .replace(/^#\s+(.+)$/gm,      "<h1>$1</h1>")
    // 代码块 ```
    .replace(/```[\w]*\n?([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
    // 行内代码
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    // 粗斜体
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    // 粗体
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // 斜体
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // 删除线
    .replace(/~~(.+?)~~/g, "<del>$1</del>")
    // 链接 [text](url)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    // 无序列表
    .replace(/^[-*+]\s+(.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
    // 有序列表
    .replace(/^\d+\.\s+(.+)$/gm, "<li>$1</li>")
    // 水平线
    .replace(/^---+$/gm, "<hr/>")
    // 换行
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br/>");
}

function hideAllPreviewPanels() {
  els.previewImage.classList.add("hidden");
  els.previewVideo.classList.add("hidden");
  els.previewTextWrap.classList.add("hidden");
  els.previewMarkdown.classList.add("hidden");
  els.previewPdf.classList.add("hidden");
  els.previewUnsupported.classList.add("hidden");
  els.previewLoading.classList.add("hidden");
  // 停止视频播放
  els.previewVideo.pause();
  els.previewVideo.src = "";
  // 清理 pdf iframe
  els.previewPdf.src = "";
}

// 当前预览的文件在 state.files 中的索引（-1 表示未打开）
let previewCurrentIndex = -1;

function closePreview() {
  hideAllPreviewPanels();
  els.previewOverlay.classList.add("hidden");
  // 防止视频/音频继续播放
  els.previewVideo.pause();
  els.previewVideo.src = "";
  document.body.style.overflow = "";
  previewCurrentIndex = -1;
}

/** 获取已解锁文件夹 token 的 query 参数字符串（含前缀 & 或为空） */
function getFolderTokensParam() {
  const tokenValues = Array.from(state.folderTokens.values());
  return tokenValues.length
    ? `&folder_tokens=${encodeURIComponent(tokenValues.join(","))}`
    : "";
}

/** 在当前预览列表中切换到下一个（delta=+1）或上一个（delta=-1）文件 */
function previewNavigate(delta) {
  const previewableFiles = state.files.filter(f => f.type === "file");
  if (!previewableFiles.length) return;
  // 在所有文件中找索引
  const allFiles = state.files;
  let idx = previewCurrentIndex;
  // 找下一个方向的文件
  let newIdx = idx + delta;
  while (newIdx >= 0 && newIdx < allFiles.length) {
    if (allFiles[newIdx].type === "file") {
      openPreview(allFiles[newIdx]);
      return;
    }
    newIdx += delta;
  }
}

async function openPreview(item) {
  if (!item || item.type === "folder") return;

  // 记录当前 item 在 state.files 中的索引（用于左右翻页）
  const idxInFiles = state.files.indexOf(item);
  previewCurrentIndex = idxInFiles >= 0 ? idxInFiles : -1;

  // 更新翻页按钮可见性
  if (els.previewPrevBtn && els.previewNextBtn) {
    const allFiles = state.files;
    // 向前找有没有文件
    let hasPrev = false;
    for (let i = previewCurrentIndex - 1; i >= 0; i--) {
      if (allFiles[i].type === "file") { hasPrev = true; break; }
    }
    let hasNext = false;
    for (let i = previewCurrentIndex + 1; i < allFiles.length; i++) {
      if (allFiles[i].type === "file") { hasNext = true; break; }
    }
    els.previewPrevBtn.style.visibility = hasPrev ? "visible" : "hidden";
    els.previewNextBtn.style.visibility = hasNext ? "visible" : "hidden";
  }

  const ext = getFileExt(item.name);
  const previewType = getPreviewType(ext);

  // 携带已解锁的文件夹 token（img/video/iframe 无法加请求头，用 query 参数）
  const tokenParam = getFolderTokensParam();

  const previewUrl = `${baseUrl()}/api/preview?path=${encodeURIComponent(item.path)}${tokenParam}`;
  const downloadUrl = `${baseUrl()}/api/download?path=${encodeURIComponent(item.path)}${tokenParam}`;

  // 打开弹窗
  els.previewOverlay.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  els.previewTitle.textContent = item.name;
  els.previewDownloadBtn.href = downloadUrl;
  els.previewDownloadBtn.download = item.name;

  hideAllPreviewPanels();
  els.previewLoading.classList.remove("hidden");

  try {
    if (previewType === "image") {
      const img = els.previewImage;
      img.src = "";
      img.onload = () => {
        els.previewLoading.classList.add("hidden");
        img.classList.remove("hidden");
      };
      img.onerror = () => {
        els.previewLoading.classList.add("hidden");
        els.previewUnsupportedMsg.textContent = "图片加载失败";
        els.previewUnsupported.classList.remove("hidden");
        els.previewUnsupportedDownload.href = downloadUrl;
        els.previewUnsupportedDownload.download = item.name;
      };
      img.src = previewUrl;
      return;
    }

    if (previewType === "video") {
      const video = els.previewVideo;
      video.src = previewUrl;
      video.load();
      els.previewLoading.classList.add("hidden");
      video.classList.remove("hidden");
      return;
    }

    if (previewType === "pdf") {
      els.previewPdf.src = previewUrl;
      els.previewLoading.classList.add("hidden");
      els.previewPdf.classList.remove("hidden");
      return;
    }

    if (previewType === "text" || previewType === "markdown") {
      const response = await fetch(previewUrl);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || `加载失败：${response.status}`);
      }
      const text = await response.text();
      els.previewLoading.classList.add("hidden");

      if (previewType === "markdown") {
        els.previewMarkdown.innerHTML = `<div class="md-body">${renderMarkdown(text)}</div>`;
        els.previewMarkdown.classList.remove("hidden");
      } else {
        els.previewText.textContent = text;
        els.previewTextWrap.classList.remove("hidden");
      }
      return;
    }

    // 不支持
    els.previewLoading.classList.add("hidden");
    els.previewUnsupportedMsg.textContent = `不支持预览 .${ext || "未知"} 格式的文件`;
    els.previewUnsupportedDownload.href = downloadUrl;
    els.previewUnsupportedDownload.download = item.name;
    els.previewUnsupported.classList.remove("hidden");

  } catch (error) {
    els.previewLoading.classList.add("hidden");
    if (error && error.message && error.message.includes("不支持")) {
      els.previewUnsupportedMsg.textContent = error.message;
    } else {
      els.previewUnsupportedMsg.textContent = `预览失败：${error.message}`;
    }
    els.previewUnsupportedDownload.href = downloadUrl;
    els.previewUnsupportedDownload.download = item.name;
    els.previewUnsupported.classList.remove("hidden");
  }
}

// ══════════════════════════════════════════════════════
// ── 文件夹密码验证（访客） ────────────────────────────
// ══════════════════════════════════════════════════════

let lockResolve = null;      // Promise resolve 回调
let currentLockPath = "";    // 当前正在验证的文件夹路径

function showLockDialog(folderPath, folderName) {
  return new Promise((resolve) => {
    lockResolve = resolve;
    currentLockPath = folderPath;
    els.lockFolderName.textContent = `文件夹：${folderName || folderPath}`;
    els.lockPasswordInput.value = "";
    els.lockError.classList.add("hidden");
    els.lockOverlay.classList.remove("hidden");
    els.lockPasswordInput.focus();
  });
}

function hideLockDialog() {
  els.lockOverlay.classList.add("hidden");
  els.lockPasswordInput.value = "";
  els.lockError.classList.add("hidden");
  if (lockResolve) {
    lockResolve(false);
    lockResolve = null;
  }
}

async function submitLockPassword(folderPath) {
  const password = els.lockPasswordInput.value.trim();
  if (!password) {
    els.lockError.textContent = "请输入密码";
    els.lockError.classList.remove("hidden");
    return;
  }
  try {
    const result = await requestJson(`${baseUrl()}/api/folder-lock/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: folderPath, password }),
    });
    if (result.verified) {
      state.unlockedFolders.add(folderPath);
      // 存储后端颁发的 accessToken，后续请求 /api/files 时携带
      if (result.accessToken) {
        state.folderTokens.set(folderPath, result.accessToken);
      }
      els.lockOverlay.classList.add("hidden");
      els.lockPasswordInput.value = "";
      if (lockResolve) { lockResolve(true); lockResolve = null; }
    } else {
      els.lockError.textContent = "密码错误，请重试";
      els.lockError.classList.remove("hidden");
      els.lockPasswordInput.select();
    }
  } catch (error) {
    els.lockError.textContent = `验证失败：${error.message}`;
    els.lockError.classList.remove("hidden");
  }
}

// ══════════════════════════════════════════════════════
// ── 管理员：文件夹加密设置 ────────────────────────────
// ══════════════════════════════════════════════════════

let adminLockCurrentPath = "";
let adminLockCurrentName = "";
let adminLockIsCurrentlyLocked = false;

async function openAdminLockDialog(folderPath, folderName, isLocked) {
  adminLockCurrentPath = folderPath;
  adminLockCurrentName = folderName;
  adminLockIsCurrentlyLocked = isLocked;

  els.adminLockFolderName.textContent = `文件夹：${folderName || folderPath}`;
  els.adminLockPasswordInput.value = "";
  els.adminLockPasswordConfirm.value = "";
  els.adminLockError.classList.add("hidden");
  els.adminLockError.textContent = "";

  if (isLocked) {
    els.adminLockIcon.textContent = "🔒";
    els.adminLockTitle.textContent = "修改文件夹密码";
    els.adminLockRemoveBtn.classList.remove("hidden");
    els.adminLockConfirmBtn.textContent = "更新密码";
  } else {
    els.adminLockIcon.textContent = "🔓";
    els.adminLockTitle.textContent = "设置文件夹密码";
    els.adminLockRemoveBtn.classList.add("hidden");
    els.adminLockConfirmBtn.textContent = "设置密码";
  }

  els.adminLockOverlay.classList.remove("hidden");
  els.adminLockPasswordInput.focus();
}

function hideAdminLockDialog() {
  els.adminLockOverlay.classList.add("hidden");
  els.adminLockPasswordInput.value = "";
  els.adminLockPasswordConfirm.value = "";
  els.adminLockError.classList.add("hidden");
}

async function submitAdminLockPassword() {
  const password = els.adminLockPasswordInput.value.trim();
  const confirm = els.adminLockPasswordConfirm.value.trim();

  if (!password) {
    els.adminLockError.textContent = "密码不能为空";
    els.adminLockError.classList.remove("hidden");
    return;
  }
  if (password.length < 4) {
    els.adminLockError.textContent = "密码至少需要 4 位";
    els.adminLockError.classList.remove("hidden");
    return;
  }
  if (password !== confirm) {
    els.adminLockError.textContent = "两次密码输入不一致";
    els.adminLockError.classList.remove("hidden");
    return;
  }

  try {
    await requestJson(`${baseUrl()}/api/folder-lock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: adminLockCurrentPath, password }),
    });
    hideAdminLockDialog();
    await refreshFiles();
    showToast(`文件夹「${adminLockCurrentName}」已设置密码`, "success");
  } catch (error) {
    els.adminLockError.textContent = `设置失败：${error.message}`;
    els.adminLockError.classList.remove("hidden");
  }
}

async function removeAdminLock() {
  const ok = window.confirm(`确认移除文件夹「${adminLockCurrentName}」的访问密码吗？`);
  if (!ok) return;

  try {
    await requestJson(`${baseUrl()}/api/folder-lock?path=${encodeURIComponent(adminLockCurrentPath)}`, {
      method: "DELETE",
    });
    hideAdminLockDialog();
    state.unlockedFolders.delete(adminLockCurrentPath);
    await refreshFiles();
    showToast(`文件夹「${adminLockCurrentName}」已解除加密`, "success");
  } catch (error) {
    els.adminLockError.textContent = `解除失败：${error.message}`;
    els.adminLockError.classList.remove("hidden");
  }
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

  // 文件名点击 → 预览
  const previewTarget = eventTarget.closest("[data-preview]");
  if (previewTarget) {
    const previewPath = decodeDataValue(previewTarget.dataset.preview);
    const item = state.files.find((f) => f.path === previewPath);
    if (item) openPreview(item);
    return true;
  }

  const openTarget = eventTarget.closest("[data-open]");
  if (openTarget) {
    enterFolder(decodeDataValue(openTarget.dataset.open));
    return true;
  }

  const enterTarget = eventTarget.closest("[data-enter]");
  if (enterTarget) {
    enterFolder(decodeDataValue(enterTarget.dataset.enter));
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
      decodeDataValue(permanentTarget.dataset.name),
      permanentTarget.dataset.entryType || "file"
    );
    return true;
  }

  const lockTarget = eventTarget.closest("[data-lock-folder]");
  if (lockTarget) {
    const lockPath = decodeDataValue(lockTarget.dataset.lockFolder);
    const lockName = decodeDataValue(lockTarget.dataset.name);
    const isLocked = lockTarget.dataset.isLocked === "true";
    openAdminLockDialog(lockPath, lockName, isLocked);
    return true;
  }

  return false;
}

// ── 进入文件夹（带加密检查） ─────────────────────────────────────────────────
async function enterFolder(folderPath) {
  if (state.isAdmin) {
    state.currentPath = folderPath;
    refreshFiles();
    return;
  }

  // 找到顶级路径（只有顶级文件夹才可能被锁定）
  const topLevel = folderPath.split("/")[0];

  // 已在本 session 解锁
  if (state.unlockedFolders.has(topLevel)) {
    state.currentPath = folderPath;
    refreshFiles();
    return;
  }

  // 查询服务端是否被锁
  try {
    const result = await requestJson(`${baseUrl()}/api/folder-lock?path=${encodeURIComponent(topLevel)}`);
    if (!result.isLocked) {
      state.currentPath = folderPath;
      refreshFiles();
      return;
    }
    // 需要密码
    const folderItem = state.files.find((f) => f.path === topLevel);
    const folderName = folderItem ? folderItem.name : topLevel;
    const verified = await showLockDialog(topLevel, folderName);
    if (verified) {
      state.currentPath = folderPath;
      refreshFiles();
    }
  } catch (error) {
    showToast(`进入文件夹失败：${error.message}`, "error");
  }
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
      const isFolder = item.type === "folder";
      const checked = isFile && isSelectedPath(item.path) ? "checked" : "";
      const selectDisabledAttr = isFile ? "" : "disabled";
      if (checked) rowClasses.push("is-selected");
      if (isFolder) rowClasses.push("drop-target-folder");

      // 是否是根目录下的直接子文件夹（可加密/可永久）
      const isTopLevelFolder = isFolder && !item.path.includes("/");
      const lockIcon = item.isLocked ? ' <span class="lock-badge" title="已加密">🔒</span>' : "";
      const permanentBadge = isFolder && item.storageType === "permanent"
        ? ' <span class="tag tag-permanent" title="永久存储">永久</span>' : "";

      // 文件名：文件点击触发预览，文件夹点击进入
      const openAction = isFolder
        ? `<button class="entry-name folder" data-open="${encodedPath}">${safeName}${lockIcon}${permanentBadge}</button>`
        : `<button class="entry-name entry-name-file" data-preview="${encodedPath}" title="点击预览">${safeName}</button>`;

      const actions = [];
      if (isFolder) {
        actions.push(`<button class="btn" data-enter="${encodedPath}">进入</button>`);
        actions.push(
          `<button class="btn btn-primary" data-download="${encodedPath}" data-entry-type="folder" data-filename="${encodedName}">下载zip</button>`
        );
        // 管理员：文件夹加密（仅顶级）
        if (state.isAdmin && isTopLevelFolder) {
          const isLocked = Boolean(item.isLocked);
          actions.push(
            `<button class="btn ${isLocked ? "btn-lock-active" : ""}" data-lock-folder="${encodedPath}" data-name="${encodedName}" data-is-locked="${isLocked}">${isLocked ? "🔒改密" : "🔓加密"}</button>`
          );
        }
        // 管理员：文件夹升级永久
        if (state.isAdmin && item.storageType !== "permanent") {
          actions.push(
            `<button class="btn" data-permanent="${encodedPath}" data-name="${encodedName}" data-entry-type="folder">升级永久</button>`
          );
        }
      } else {
        actions.push(
          `<button class="btn btn-primary" data-download="${encodedPath}" data-entry-type="file" data-filename="${encodedName}">下载</button>`
        );
        if (state.isAdmin && item.storageType === "temporary") {
          actions.push(
            `<button class="btn" data-permanent="${encodedPath}" data-name="${encodedName}" data-entry-type="file">升级永久</button>`
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
        isFolder ? ` data-drop-folder="${encodedPath}" title="可拖拽文件/文件夹到此"` : "";
      const folderOpenAttr = isFolder ? ` data-folder-open="${encodedPath}"` : "";

      // 图片文件缩略图（列表视图显示小正方形缩略图）
      const isImageFile = isFile && PREVIEW_IMAGE_EXTS.has(getFileExt(item.name));
      const listThumbHtml = isImageFile
        ? `<img class="entry-thumb" src="${baseUrl()}/api/preview?path=${encodeURIComponent(item.path)}${getFolderTokensParam()}" alt="" loading="lazy" />`
        : `<span class="entry-icon ${iconClass}">${iconLabel}</span>`;

      return `
      <tr class="${rowClasses.join(" ")}" draggable="true" data-drag-path="${encodedPath}" data-drag-type="${item.type}"${dropAttrs}${folderOpenAttr}>
        <td>
          <div class="entry-main">
            <input class="entry-check" type="checkbox" data-select-path="${encodedPath}" ${checked} ${selectDisabledAttr} />
            ${listThumbHtml}
            <div class="entry-name-wrap">
              ${openAction}
              ${isFolder ? '<div class="entry-sub">拖到这里可移动</div>' : ""}
            </div>
          </div>
        </td>
        <td>${fileTypeTag(item.type)}</td>
        <td>${isFile ? formatFileSize(item.size) : "-"}</td>
        <td>
          <div>${safeUploader}</div>
          ${item.uploaderIP ? `<div class="uploader-ip">IP: ${escapeHtml(item.uploaderIP)}</div>` : ""}
        </td>
        <td>${isFile ? formatTime(item.uploadedAt) : "-"}</td>
        <td>
          ${isFile ? storageBadge(item.storageType) : (item.storageType === "permanent" ? '<span class="tag tag-permanent">永久</span>' : "-")}
          ${isFile && item.storageType === "temporary" && item.expiresAt ? `<div class="storage-expire">到期: ${formatTime(item.expiresAt)}</div>` : ""}
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
      const isFolder = item.type === "folder";
      const isFile = item.type === "file";
      const isTopLevelFolder = isFolder && !item.path.includes("/");
      const checked = isFile && isSelectedPath(item.path) ? "checked" : "";
      const selectDisabledAttr = isFile ? "" : "disabled";
      const dropAttrs = isFolder ? ` data-drop-folder="${encodedPath}"` : "";
      const folderOpenAttr = isFolder ? ` data-folder-open="${encodedPath}"` : "";
      const lockIcon = item.isLocked ? ' 🔒' : "";

      const actions = [];
      if (isFolder) {
        actions.push(`<button class="btn" data-enter="${encodedPath}">进入</button>`);
        actions.push(
          `<button class="btn btn-primary" data-download="${encodedPath}" data-entry-type="folder" data-filename="${encodedName}">zip</button>`
        );
        if (state.isAdmin && isTopLevelFolder) {
          const isLocked = Boolean(item.isLocked);
          actions.push(
            `<button class="btn ${isLocked ? "btn-lock-active" : ""}" data-lock-folder="${encodedPath}" data-name="${encodedName}" data-is-locked="${isLocked}">${isLocked ? "🔒" : "🔓"}</button>`
          );
        }
        if (state.isAdmin && item.storageType !== "permanent") {
          actions.push(
            `<button class="btn" data-permanent="${encodedPath}" data-name="${encodedName}" data-entry-type="folder">永久</button>`
          );
        }
      } else {
        actions.push(
          `<button class="btn btn-primary" data-download="${encodedPath}" data-entry-type="file" data-filename="${encodedName}">下载</button>`
        );
        if (state.isAdmin && item.storageType === "temporary") {
          actions.push(
            `<button class="btn" data-permanent="${encodedPath}" data-name="${encodedName}" data-entry-type="file">永久</button>`
          );
        }
      }
      actions.push(`<button class="btn" data-rename="${encodedPath}" data-name="${encodedName}">改名</button>`);
      actions.push(
        `<button class="btn btn-danger" data-delete="${encodedPath}" data-type="${item.type}" data-name="${encodedName}">删</button>`
      );

      // 文件名区域：文件夹点击进入，文件点击预览
      const nameEl = isFolder
        ? `<button class="file-card-name folder" data-open="${encodedPath}">${safeName}${lockIcon}</button>`
        : `<button class="file-card-name entry-name-file" data-preview="${encodedPath}" title="点击预览">${safeName}</button>`;

      // 网格视图：图片直接作为缩略图，文件名显示在缩略图下方（与普通文件一致）
      const isGridImage = isFile && PREVIEW_IMAGE_EXTS.has(getFileExt(item.name));
      const gridThumbEl = isGridImage
        ? `<div class="file-card-thumb file-card-thumb-img" data-preview="${encodedPath}">
             <img class="file-card-img-thumb" src="${baseUrl()}/api/preview?path=${encodeURIComponent(item.path)}${getFolderTokensParam()}" alt="${safeName}" loading="lazy" />
           </div>`
        : `<div class="file-card-thumb ${iconClass}">
             <span class="file-card-icon">${iconLabel}</span>
           </div>`;

      return `
      <article class="file-card ${isFolder ? "drop-target-folder" : ""} ${checked ? "is-selected" : ""}" draggable="true" data-drag-path="${encodedPath}" data-drag-type="${item.type}"${dropAttrs}${folderOpenAttr}>
        <label class="file-card-check-wrap">
          <input class="entry-check" type="checkbox" data-select-path="${encodedPath}" ${checked} ${selectDisabledAttr} />
        </label>
        ${gridThumbEl}
        ${nameEl}
        <div class="file-card-meta">${isFolder ? "文件夹" : formatFileSize(item.size)}</div>
        <div class="file-card-meta">${isFile ? (item.storageType === "permanent" ? "永久" : "临时") : (item.storageType === "permanent" ? "永久" : "-")}</div>
        <div class="file-card-meta">${formatTime(item.modifiedAt)}</div>
        ${isFolder ? '<div class="file-card-drop-tip">拖拽到这里可移动</div>' : ""}
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

function getFolderTokensHeader() {
  // 将所有已验证的 accessToken 拼接为逗号分隔字符串，发送给后端
  const tokens = Array.from(state.folderTokens.values());
  return tokens.length ? { "X-Folder-Tokens": tokens.join(",") } : {};
}

async function refreshFiles() {
  renderBreadcrumb();
  try {
    const payload = await requestJson(
      `${baseUrl()}/api/files?path=${encodeURIComponent(state.currentPath)}`,
      { headers: getFolderTokensHeader() }
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

async function upgradePermanent(targetPath, itemName, entryType = "file") {
  if (!state.isAdmin) {
    showToast("仅管理员可升级为永久存储", "error");
    return;
  }

  const label = entryType === "folder" ? "文件夹" : "文件";
  const note = entryType === "folder" ? "（包含文件夹下所有子级文件）" : "";
  const ok = window.confirm(`确认将${label}「${itemName}」升级为永久存储吗？${note}`);
  if (!ok) return;

  try {
    const result = await requestJson(`${baseUrl()}/api/files/permanent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: targetPath }),
    });
    await refreshFiles();
    if (entryType === "folder") {
      showToast(`文件夹已升级为永久存储（含 ${result.fileCount || 0} 个文件）`, "success");
    } else {
      showToast("已升级为永久存储", "success");
    }
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

  // 将已解锁的 token 拼成 query 参数（<a> 标签无法加自定义请求头）
  const folderTokensParam = getFolderTokensParam();

  // 普通文件：直接用 <a> 标签下载
  if (!isFolder) {
    const link = document.createElement("a");
    link.href = `${baseUrl()}/api/download?path=${encodeURIComponent(relativePath)}${folderTokensParam}`;
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
      headers: { "Content-Type": "application/json", ...getFolderTokensHeader() },
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

  // ── 预览弹窗关闭 & 翻页
  if (els.previewCloseBtn) {
    els.previewCloseBtn.addEventListener("click", closePreview);
  }
  if (els.previewOverlay) {
    // 点击背景（previewOverlay 层本身）关闭
    els.previewOverlay.addEventListener("click", (e) => {
      if (e.target === els.previewOverlay) closePreview();
    });
  }
  // 点击 previewBody 空白处关闭（previewBody 本身被点中时）
  if (els.previewBody) {
    els.previewBody.addEventListener("click", (e) => {
      if (e.target === els.previewBody) closePreview();
    });
  }
  // 翻页按钮
  if (els.previewPrevBtn) {
    els.previewPrevBtn.addEventListener("click", () => previewNavigate(-1));
  }
  if (els.previewNextBtn) {
    els.previewNextBtn.addEventListener("click", () => previewNavigate(1));
  }

  // ── 全局键盘：ESC 关闭弹窗，左右翻页
  document.addEventListener("keydown", (e) => {
    const previewOpen = els.previewOverlay && !els.previewOverlay.classList.contains("hidden");
    if (e.key === "Escape") {
      if (previewOpen) {
        closePreview();
      } else if (els.lockOverlay && !els.lockOverlay.classList.contains("hidden")) {
        hideLockDialog();
      } else if (els.adminLockOverlay && !els.adminLockOverlay.classList.contains("hidden")) {
        hideAdminLockDialog();
      }
      return;
    }
    if (previewOpen) {
      if (e.key === "ArrowLeft")  { e.preventDefault(); previewNavigate(-1); }
      if (e.key === "ArrowRight") { e.preventDefault(); previewNavigate(1); }
    }
  });

  // ── 访客文件夹密码弹窗
  if (els.lockConfirmBtn) {
    els.lockConfirmBtn.addEventListener("click", () => {
      submitLockPassword(currentLockPath);
    });
  }
  if (els.lockCancelBtn) {
    els.lockCancelBtn.addEventListener("click", hideLockDialog);
  }
  if (els.lockPasswordInput) {
    els.lockPasswordInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitLockPassword(currentLockPath);
    });
  }

  // ── 管理员文件夹密码弹窗
  if (els.adminLockConfirmBtn) {
    els.adminLockConfirmBtn.addEventListener("click", submitAdminLockPassword);
  }
  if (els.adminLockRemoveBtn) {
    els.adminLockRemoveBtn.addEventListener("click", removeAdminLock);
  }
  if (els.adminLockCancelBtn) {
    els.adminLockCancelBtn.addEventListener("click", hideAdminLockDialog);
  }
  if (els.adminLockPasswordInput) {
    els.adminLockPasswordInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitAdminLockPassword();
    });
  }

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
      enterFolder(folderPath);
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
