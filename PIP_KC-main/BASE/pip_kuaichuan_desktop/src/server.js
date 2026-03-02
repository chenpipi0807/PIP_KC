const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { pipeline } = require("stream/promises");

const Busboy = require("busboy");
const cors = require("cors");
const express = require("express");

const { CLIENT_PROFILE_FILE, LOG_FILE, META_FILE, STORAGE_ROOT, readJson, writeJson } = require("./config");

const TEMP_FILE_TTL_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const MAX_LOG_READ_LINES = 1000;
const RANDOM_SUFFIX_CHARS = "23456789abcdefghjkmnpqrstuvwxyz";
// 单个上传文件最大体积（字节），这里设置为 500GB
const MAX_UPLOAD_FILE_SIZE_BYTES = 500 * 1024 * 1024 * 1024;
const HOT_WORDS = [
  "苏丹红",
  "奔波霸",
  "打工人",
  "工具人",
  "绝绝子",
  "YYDS",
  "栓Q",
  "破防了",
  "拿捏了",
  "上头",
  "下头",
  "内卷",
  "躺平",
  "摆烂",
  "夺笋",
  "离谱",
  "社死",
  "逆天",
  "真香",
  "细狗",
  "吃瓜",
  "磕到了",
  "笑不活了",
  "油麦",
  "高启强",
  "泰裤辣",
  "小作文",
  "哈基米",
  "纯路人",
  "神金",
  "爆改",
  "尊嘟假嘟",
  "i人",
  "e人",
  "电子榨菜",
  "显眼包",
  "氛围感",
  "松弛感",
  "拉满",
  "稳了",
  "绷不住了",
  "好家伙",
  "叠buff",
  "入坑",
  "退退退",
  "听劝",
  "整活",
  "整顿职场",
  "摸鱼",
  "开摆",
  "扛把子",
  "天花板",
  "主打一个",
  "颜值即正义",
  "破次元",
  "爆金币",
  "回旋镖",
  "反向操作",
  "大冤种",
  "人麻了",
  "这河里吗",
  "别太荒谬",
  "你人还怪好嘞",
  "格局打开",
  "高质量人类",
  "野性消费",
  "疯狂星期四",
  "鸡你太美",
  "小镇做题家",
  "互联网嘴替",
  "拔草",
  "种草",
  "安利",
  "冲鸭",
  "拿来吧你",
  "雪糕刺客",
  "背刺",
  "无痛当妈",
  "城市漫游",
  "狠狠共鸣",
  "浅浅期待",
  "狠狠心动",
  "狠狠拿下",
  "直接封神",
  "一整个爱住",
  "心巴",
  "太会了",
  "颅内高潮",
  "本命",
  "路转粉",
  "破圈",
  "抽象",
  "高能预警",
  "精准踩雷",
  "先码住",
  "梦中情盘",
  "DNA动了",
  "太顶了",
  "灵魂拷问",
  "主播同款",
];

function toSafeRelative(inputPath = "") {
  const normalized = path
    .normalize(inputPath || "")
    .replace(/^([/\\])+/, "")
    .replace(/^(\.\.(?:[/\\]|$))+/, "");

  if (normalized === ".") return "";
  return normalized.replace(/\\/g, "/");
}

function resolveSafePath(relativePath = "") {
  const safeRelative = toSafeRelative(relativePath);
  const absolute = path.resolve(STORAGE_ROOT, safeRelative);
  const root = path.resolve(STORAGE_ROOT);
  const relativeToRoot = path.relative(root, absolute);

  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new Error("非法路径访问");
  }

  return {
    safeRelative,
    absolute,
  };
}

async function getUniqueFileTarget(directoryAbsolute, originalName) {
  const safeBaseName = path.basename(originalName || `file-${Date.now()}`);
  const parsed = path.parse(safeBaseName);

  let counter = 0;
  let candidateName = safeBaseName;
  let candidateAbsolute = path.join(directoryAbsolute, candidateName);

  while (true) {
    try {
      await fs.promises.access(candidateAbsolute, fs.constants.F_OK);
      counter += 1;
      candidateName = `${parsed.name}-${counter}${parsed.ext}`;
      candidateAbsolute = path.join(directoryAbsolute, candidateName);
    } catch {
      return {
        fileName: candidateName,
        absolute: candidateAbsolute,
      };
    }
  }
}

function randomSuffix(length = 4) {
  let result = "";
  for (let i = 0; i < length; i += 1) {
    const index = Math.floor(Math.random() * RANDOM_SUFFIX_CHARS.length);
    result += RANDOM_SUFFIX_CHARS[index];
  }
  return result;
}

function createRandomUserId() {
  const hotWord = HOT_WORDS[Math.floor(Math.random() * HOT_WORDS.length)] || "访客";
  return `${hotWord}${randomSuffix(4)}`;
}

function getClientIP(req, { trustForwarded = false } = {}) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const raw = (trustForwarded ? forwarded : "") || req.socket?.remoteAddress || "";
  if (!raw) return "unknown";
  if (raw.startsWith("::ffff:")) return raw.slice(7);
  if (raw === "::1") return "127.0.0.1";
  return raw;
}

function normalizeIP(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (!value) return "";
  if (value === "localhost" || value === "::1") return "127.0.0.1";
  if (value.startsWith("::ffff:")) return value.slice(7);
  return value;
}

function isAdminClient(clientIP, serverInfo = {}) {
  const normalizedClientIP = normalizeIP(clientIP);
  const normalizedHostIP = normalizeIP(serverInfo.hostAddress || serverInfo.localIPv4);
  if (!normalizedClientIP || !normalizedHostIP) return false;
  if (normalizedClientIP === "127.0.0.1") return true;
  return normalizedClientIP === normalizedHostIP;
}

function getExpireAtISO(uploadedAt) {
  const uploadedAtMs = Date.parse(uploadedAt);
  if (!Number.isFinite(uploadedAtMs)) return null;
  return new Date(uploadedAtMs + TEMP_FILE_TTL_MS).toISOString();
}

function ensureClientProfile(profiles, ip) {
  if (!profiles[ip]) {
    profiles[ip] = {
      userId: createRandomUserId(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
  return profiles[ip];
}

async function cleanupExpiredTempFiles(metadata) {
  const now = Date.now();
  let changed = false;

  for (const [relativePath, meta] of Object.entries(metadata)) {
    if (!meta || meta.isPermanent) continue;

    const uploadedAtMs = Date.parse(meta.uploadedAt || "");
    if (!Number.isFinite(uploadedAtMs)) continue;
    if (now - uploadedAtMs < TEMP_FILE_TTL_MS) continue;

    try {
      const { absolute } = resolveSafePath(relativePath);
      const stat = await fs.promises.stat(absolute);
      if (stat.isFile()) {
        await fs.promises.unlink(absolute);
      }
    } catch {
      // file already removed
    }

    delete metadata[relativePath];
    changed = true;
  }

  return changed;
}

async function listDirectory(relativePath = "", metadata = {}) {
  const { safeRelative, absolute } = resolveSafePath(relativePath);

  await fs.promises.mkdir(absolute, { recursive: true });
  const entries = await fs.promises.readdir(absolute, { withFileTypes: true });

  const mapped = await Promise.all(
    entries.map(async (entry) => {
      const entryRelative = safeRelative
        ? path.posix.join(safeRelative, entry.name)
        : entry.name;
      const entryAbsolute = path.join(absolute, entry.name);
      const stat = await fs.promises.stat(entryAbsolute);
      const meta = metadata[entryRelative] || {};
      const uploadedAt = meta.uploadedAt || stat.mtime.toISOString();
      const isPermanent = entry.isDirectory() ? false : Boolean(meta.isPermanent);
      const expiresAt =
        entry.isDirectory() || isPermanent ? null : getExpireAtISO(uploadedAt);

      return {
        name: entry.name,
        path: entryRelative,
        type: entry.isDirectory() ? "folder" : "file",
        size: entry.isDirectory() ? 0 : stat.size,
        modifiedAt: stat.mtime.toISOString(),
        uploader: meta.uploader || "未知",
        uploaderIP: meta.uploaderIP || null,
        uploadedAt,
        expiresAt,
        storageType: entry.isDirectory() ? "folder" : isPermanent ? "permanent" : "temporary",
      };
    })
  );

  mapped.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name, "zh-CN");
  });

  return mapped;
}

function deleteMetadataTree(metadata, targetRelative) {
  const normalized = toSafeRelative(targetRelative);
  if (!normalized) return metadata;

  for (const key of Object.keys(metadata)) {
    if (key === normalized || key.startsWith(`${normalized}/`)) {
      delete metadata[key];
    }
  }

  return metadata;
}

function renameMetadataTree(metadata, fromRelative, toRelative) {
  const from = toSafeRelative(fromRelative);
  const to = toSafeRelative(toRelative);
  if (!from || !to || from === to) return metadata;

  const next = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (key === from) {
      next[to] = value;
      continue;
    }

    if (key.startsWith(`${from}/`)) {
      next[`${to}${key.slice(from.length)}`] = value;
      continue;
    }

    next[key] = value;
  }

  return next;
}

function sanitizeEntryName(rawName) {
  const normalized = String(rawName || "").normalize("NFC");
  const baseName = path.basename(normalized).trim();

  if (!baseName || baseName === "." || baseName === "..") {
    return "";
  }

  const withoutInvalid = baseName
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/[. ]+$/g, "");

  if (!withoutInvalid) {
    return "";
  }

  const reservedNamePattern = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
  if (reservedNamePattern.test(withoutInvalid)) {
    return `_${withoutInvalid}`;
  }

  return withoutInvalid;
}

// 处理部分浏览器/环境下中文文件名编码为 latin1 后被当作 UTF-8 解析导致的乱码
function tryDecodeUtf8FromLatin1(raw) {
  const value = String(raw || "");
  // 纯 ASCII 不需要处理
  if (!/[^\x00-\x7F]/.test(value)) {
    return value;
  }

  try {
    const buffer = Buffer.from(value, "binary"); // "binary" 等价于 latin1
    const decoded = buffer.toString("utf8");
    // 只有在解码后不相同且包含明显的中文时才采用，避免误伤正常文件名
    if (decoded && decoded !== value && /[\u4e00-\u9fff]/.test(decoded)) {
      return decoded;
    }
  } catch {
    // 忽略解码失败，回退到原始值
  }

  return value;
}

function sanitizeRelativeFilePath(rawPath) {
  const fixedRawPath = tryDecodeUtf8FromLatin1(rawPath);
  const normalizedPath = String(fixedRawPath || "")
    .normalize("NFC")
    .replace(/\\/g, "/");

  const segments = normalizedPath
    .split("/")
    .filter(Boolean)
    .map((segment) => sanitizeEntryName(segment))
    .filter(Boolean);

  return segments.join("/");
}

function sanitizeLogValue(value) {
  return String(value || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

function resolveActorUserId(clientProfiles, clientIP, fallback = "未知用户") {
  const profile = clientProfiles[String(clientIP || "")];
  const profileUserId = profile && profile.userId ? String(profile.userId).trim() : "";
  return profileUserId || fallback;
}

async function appendAuditLog({ action, clientIP, userId, target = "", detail = "" }) {
  const ts = new Date().toISOString();
  const line = [
    ts,
    sanitizeLogValue(action),
    sanitizeLogValue(clientIP || "unknown"),
    sanitizeLogValue(userId || "未知用户"),
    sanitizeLogValue(target),
    sanitizeLogValue(detail),
  ].join(" | ");

  await fs.promises.appendFile(LOG_FILE, `${line}${os.EOL}`, "utf8");
}

async function readAuditLogLines(limit = 300) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 300, MAX_LOG_READ_LINES));

  let content = "";
  try {
    content = await fs.promises.readFile(LOG_FILE, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  return content
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-safeLimit)
    .reverse();
}

function escapePowerShellSingleQuote(value) {
  return String(value || "").replace(/'/g, "''");
}

function zipDirectoryWithPowerShell(sourceAbsolute, destinationZipAbsolute) {
  if (process.platform !== "win32") {
    return Promise.reject(new Error("当前环境不支持文件夹打包下载"));
  }

  const source = escapePowerShellSingleQuote(sourceAbsolute);
  const destination = escapePowerShellSingleQuote(destinationZipAbsolute);
  const script =
    `$ErrorActionPreference='Stop'; ` +
    `Compress-Archive -LiteralPath '${source}' -DestinationPath '${destination}' -Force`;

  return new Promise((resolve, reject) => {
    const command = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
    });

    let stderr = "";
    command.stderr.on("data", (chunk) => {
      stderr += String(chunk || "");
    });

    command.on("error", (error) => {
      reject(error);
    });

    command.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `压缩失败，退出码：${code}`));
    });
  });
}

async function ensureValidZipFile(zipAbsolute) {
  const handle = await fs.promises.open(zipAbsolute, "r");
  try {
    const buffer = Buffer.alloc(4);
    const result = await handle.read(buffer, 0, 4, 0);
    if (!result.bytesRead) {
      throw new Error("zip为空文件");
    }

    const signature = buffer.toString("hex").toLowerCase();
    const validSignatures = new Set(["504b0304", "504b0506", "504b0708"]);
    if (!validSignatures.has(signature)) {
      throw new Error(`zip签名异常: ${signature}`);
    }
  } finally {
    await handle.close();
  }
}

async function buildFolderZip(sourceAbsolute, destinationZipAbsolute) {
  const packers = process.platform === "win32"
    ? [zipDirectoryWithTar, zipDirectoryWithPowerShell]
    : [zipDirectoryWithTar];
  const errors = [];

  for (const pack of packers) {
    try {
      await fs.promises.unlink(destinationZipAbsolute).catch(() => {
        // noop
      });
      await pack(sourceAbsolute, destinationZipAbsolute);
      await ensureValidZipFile(destinationZipAbsolute);
      return;
    } catch (error) {
      errors.push(`${pack.name}: ${error.message}`);
    }
  }

  throw new Error(`文件夹打包失败。${errors.join("; ")}`);
}

function zipDirectoryWithTar(sourceAbsolute, destinationZipAbsolute) {
  const parentAbsolute = path.dirname(sourceAbsolute);
  const folderName = path.basename(sourceAbsolute);

  return new Promise((resolve, reject) => {
    const command = spawn(
      "tar",
      ["-a", "-c", "-f", destinationZipAbsolute, "-C", parentAbsolute, folderName],
      {
        windowsHide: true,
      }
    );

    let stderr = "";
    command.stderr.on("data", (chunk) => {
      stderr += String(chunk || "");
    });

    command.on("error", (error) => {
      reject(error);
    });

    command.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `tar打包失败，退出码：${code}`));
    });
  });
}

function createLanServer({ port, staticDir, serverInfoProvider }) {
  const app = express();
  const metadata = readJson(META_FILE, {});
  const clientProfiles = readJson(CLIENT_PROFILE_FILE, {});

  fs.promises.appendFile(LOG_FILE, "", "utf8").catch(() => {
    // noop
  });

  app.use(cors());
  app.use(express.json());

  if (staticDir) {
    app.use(express.static(staticDir));
    app.get("/", (req, res) => {
      res.sendFile(path.join(staticDir, "index.html"));
    });
  }

  app.get("/api/server-info", (req, res) => {
    const info = typeof serverInfoProvider === "function" ? serverInfoProvider() : {};
    const clientIP = getClientIP(req);
    res.json({ ok: true, ...info, clientIP, isAdmin: isAdminClient(clientIP, info) });
  });

  app.get("/api/client-profile", (req, res) => {
    const clientIP = getClientIP(req);
    const profile = ensureClientProfile(clientProfiles, clientIP);
    writeJson(CLIENT_PROFILE_FILE, clientProfiles);
    res.json({ ok: true, clientIP, userId: profile.userId, updatedAt: profile.updatedAt || null });
  });

  app.post("/api/client-profile", (req, res) => {
    const clientIP = getClientIP(req);
    const nextUserId = String(req.body.userId || "").trim();
    if (!nextUserId) {
      res.status(400).json({ ok: false, message: "用户名称不能为空" });
      return;
    }

    const profile = ensureClientProfile(clientProfiles, clientIP);
    profile.userId = nextUserId.slice(0, 48);
    profile.updatedAt = new Date().toISOString();
    writeJson(CLIENT_PROFILE_FILE, clientProfiles);

    res.json({ ok: true, clientIP, userId: profile.userId, updatedAt: profile.updatedAt });
  });

  app.get("/api/health", (req, res) => {
    res.json({ ok: true, now: new Date().toISOString() });
  });

  app.get("/api/logs", async (req, res) => {
    try {
      const limit = Number(req.query.limit || 300);
      const lines = await readAuditLogLines(limit);
      res.json({ ok: true, lines, file: LOG_FILE });
    } catch (error) {
      res.status(500).json({ ok: false, message: error.message || "读取日志失败" });
    }
  });

  app.get("/api/files", async (req, res) => {
    try {
      if (await cleanupExpiredTempFiles(metadata)) {
        writeJson(META_FILE, metadata);
      }
      const currentPath = String(req.query.path || "");
      const files = await listDirectory(currentPath, metadata);
      res.json({ ok: true, path: toSafeRelative(currentPath), files });
    } catch (error) {
      res.status(400).json({ ok: false, message: error.message });
    }
  });

  app.post("/api/files/permanent", async (req, res) => {
    try {
      const info = typeof serverInfoProvider === "function" ? serverInfoProvider() : {};
      const clientIP = getClientIP(req);
      if (!isAdminClient(clientIP, info)) {
        res.status(403).json({ ok: false, message: "仅管理员可升级为永久存储" });
        return;
      }

      const targetPath = toSafeRelative(String(req.body.path || ""));
      if (!targetPath) {
        res.status(400).json({ ok: false, message: "文件路径不能为空" });
        return;
      }

      const { absolute } = resolveSafePath(targetPath);
      const stat = await fs.promises.stat(absolute);
      if (!stat.isFile()) {
        res.status(400).json({ ok: false, message: "仅支持文件升级为永久存储" });
        return;
      }

      const prev = metadata[targetPath] || {};
      metadata[targetPath] = {
        ...prev,
        uploadedAt: prev.uploadedAt || stat.mtime.toISOString(),
        isPermanent: true,
        upgradedAt: new Date().toISOString(),
      };
      writeJson(META_FILE, metadata);
      await appendAuditLog({
        action: "升级永久",
        clientIP,
        userId: resolveActorUserId(clientProfiles, clientIP),
        target: targetPath,
      });

      res.json({ ok: true, path: targetPath, storageType: "permanent" });
    } catch (error) {
      res.status(400).json({ ok: false, message: error.message || "升级永久存储失败" });
    }
  });

  app.post("/api/folders", async (req, res) => {
    try {
      const parentPath = toSafeRelative(req.body.path || "");
      const folderName = sanitizeEntryName(req.body.name || "");
      const clientIP = getClientIP(req);
      const userId = resolveActorUserId(clientProfiles, clientIP);
      if (!folderName) {
        res.status(400).json({ ok: false, message: "目录名称非法或为空" });
        return;
      }

      const targetRelative = parentPath
        ? path.posix.join(parentPath, folderName)
        : folderName;
      const { absolute } = resolveSafePath(targetRelative);
      await fs.promises.mkdir(absolute, { recursive: true });
      await appendAuditLog({
        action: "新建目录",
        clientIP,
        userId,
        target: targetRelative,
      });

      res.json({ ok: true, folder: targetRelative });
    } catch (error) {
      res.status(400).json({ ok: false, message: error.message });
    }
  });

  app.delete("/api/files", async (req, res) => {
    try {
      const targetPath = toSafeRelative(String(req.query.path || ""));
      const clientIP = getClientIP(req);
      const userId = resolveActorUserId(clientProfiles, clientIP);
      if (!targetPath) {
        res.status(400).json({ ok: false, message: "不允许删除根目录" });
        return;
      }

      const { absolute } = resolveSafePath(targetPath);
      const stat = await fs.promises.stat(absolute);
      const entryType = stat.isDirectory() ? "文件夹" : "文件";

      if (stat.isDirectory()) {
        await fs.promises.rm(absolute, { recursive: true, force: false });
      } else {
        await fs.promises.unlink(absolute);
      }

      deleteMetadataTree(metadata, targetPath);
      writeJson(META_FILE, metadata);
      await appendAuditLog({
        action: "删除",
        clientIP,
        userId,
        target: targetPath,
        detail: entryType,
      });

      res.json({ ok: true, deleted: targetPath });
    } catch (error) {
      res.status(400).json({ ok: false, message: error.message || "删除失败" });
    }
  });

  app.post("/api/rename", async (req, res) => {
    try {
      const oldPath = toSafeRelative(String(req.body.path || ""));
      const newName = sanitizeEntryName(req.body.newName || "");
      const clientIP = getClientIP(req);
      const userId = resolveActorUserId(clientProfiles, clientIP);

      if (!oldPath) {
        res.status(400).json({ ok: false, message: "路径不能为空" });
        return;
      }

      if (!newName) {
        res.status(400).json({ ok: false, message: "新名称非法或为空" });
        return;
      }

      const parent = path.posix.dirname(oldPath);
      const targetPath = parent === "." ? newName : path.posix.join(parent, newName);

      if (targetPath === oldPath) {
        res.json({ ok: true, renamed: oldPath });
        return;
      }

      const { absolute: oldAbsolute } = resolveSafePath(oldPath);
      const { absolute: targetAbsolute } = resolveSafePath(targetPath);
      const sourceStat = await fs.promises.stat(oldAbsolute);

      try {
        await fs.promises.access(targetAbsolute, fs.constants.F_OK);
        res.status(409).json({ ok: false, message: "目标名称已存在" });
        return;
      } catch {
        // target path available
      }

      await fs.promises.rename(oldAbsolute, targetAbsolute);

      const renamedMeta = renameMetadataTree(metadata, oldPath, targetPath);
      Object.keys(metadata).forEach((key) => delete metadata[key]);
      Object.assign(metadata, renamedMeta);
      writeJson(META_FILE, metadata);
      await appendAuditLog({
        action: "重命名",
        clientIP,
        userId,
        target: oldPath,
        detail: `${sourceStat.isDirectory() ? "文件夹" : "文件"} -> ${targetPath}`,
      });

      res.json({ ok: true, oldPath, newPath: targetPath });
    } catch (error) {
      res.status(400).json({ ok: false, message: error.message || "重命名失败" });
    }
  });

  app.post("/api/move", async (req, res) => {
    try {
      const sourcePath = toSafeRelative(String(req.body.path || ""));
      const targetFolderPath = toSafeRelative(String(req.body.targetFolderPath || ""));
      const clientIP = getClientIP(req);
      const userId = resolveActorUserId(clientProfiles, clientIP);

      if (!sourcePath) {
        res.status(400).json({ ok: false, message: "源路径不能为空" });
        return;
      }

      if (sourcePath === targetFolderPath || targetFolderPath.startsWith(`${sourcePath}/`)) {
        res.status(400).json({ ok: false, message: "不能移动到自身或子目录" });
        return;
      }

      const sourceName = path.posix.basename(sourcePath);
      const destinationPath = targetFolderPath
        ? path.posix.join(targetFolderPath, sourceName)
        : sourceName;

      if (destinationPath === sourcePath) {
        res.json({ ok: true, oldPath: sourcePath, newPath: destinationPath });
        return;
      }

      const sourceParent = path.posix.dirname(sourcePath);
      const normalizedParent = sourceParent === "." ? "" : sourceParent;
      if (normalizedParent === targetFolderPath) {
        res.json({ ok: true, oldPath: sourcePath, newPath: destinationPath });
        return;
      }

      const { absolute: sourceAbsolute } = resolveSafePath(sourcePath);
      const { absolute: targetFolderAbsolute } = resolveSafePath(targetFolderPath);
      const { absolute: destinationAbsolute } = resolveSafePath(destinationPath);

      const sourceStat = await fs.promises.stat(sourceAbsolute);
      const targetFolderStat = await fs.promises.stat(targetFolderAbsolute);

      if (!targetFolderStat.isDirectory()) {
        res.status(400).json({ ok: false, message: "目标位置必须是文件夹" });
        return;
      }

      if (sourceStat.isDirectory()) {
        if (targetFolderPath === sourcePath || targetFolderPath.startsWith(`${sourcePath}/`)) {
          res.status(400).json({ ok: false, message: "文件夹不能移动到自身内部" });
          return;
        }
      }

      try {
        await fs.promises.access(destinationAbsolute, fs.constants.F_OK);
        res.status(409).json({ ok: false, message: "目标文件夹内已存在同名项目" });
        return;
      } catch {
        // destination path available
      }

      await fs.promises.rename(sourceAbsolute, destinationAbsolute);

      const movedMeta = renameMetadataTree(metadata, sourcePath, destinationPath);
      Object.keys(metadata).forEach((key) => delete metadata[key]);
      Object.assign(metadata, movedMeta);
      writeJson(META_FILE, metadata);
      await appendAuditLog({
        action: "移动",
        clientIP,
        userId,
        target: sourcePath,
        detail: `${sourceStat.isDirectory() ? "文件夹" : "文件"} -> ${destinationPath}`,
      });

      res.json({ ok: true, oldPath: sourcePath, newPath: destinationPath });
    } catch (error) {
      res.status(400).json({ ok: false, message: error.message || "移动失败" });
    }
  });

  app.post("/api/upload", async (req, res) => {
    try {
      const targetPath = String(req.query.path || "");
      const uploaderFromQuery = String(req.query.uploader || "").trim();
      const uploaderFromHeader = String(req.headers["x-user-id"] || "").trim();
      const uploader = uploaderFromQuery || uploaderFromHeader || "匿名用户";
      const clientIP = getClientIP(req);

      const { safeRelative, absolute } = resolveSafePath(targetPath);
      await fs.promises.mkdir(absolute, { recursive: true });

      const uploaded = [];
      const busboy = Busboy({
        headers: req.headers,
        preservePath: true,
        limits: {
          fileSize: MAX_UPLOAD_FILE_SIZE_BYTES,
        },
      });
      const writeTasks = [];

      busboy.on("file", (fieldName, file, fileInfo) => {
        let truncated = false;
        file.on("limit", () => {
          truncated = true;
        });
        const fallbackName = `file-${Date.now()}`;
        const normalizedRelativePath = sanitizeRelativeFilePath(fileInfo.filename || "");
        const safeRelativePath = normalizedRelativePath || fallbackName;
        const fileNameOnly = path.posix.basename(safeRelativePath) || fallbackName;
        const fileDirRelative = path.posix.dirname(safeRelativePath);
        const safeDirRelative = fileDirRelative === "." ? "" : fileDirRelative;
        const targetDirAbsolute = safeDirRelative
          ? path.join(absolute, safeDirRelative)
          : absolute;

        const task = fs.promises
          .mkdir(targetDirAbsolute, { recursive: true })
          .then(() => getUniqueFileTarget(targetDirAbsolute, fileNameOnly))
          .then(({ fileName, absolute: targetFileAbsolute }) => {
            const targetRelative = path.posix.join(
              ...(safeRelative ? [safeRelative] : []),
              ...(safeDirRelative ? [safeDirRelative] : []),
              fileName
            );

            const writeStream = fs.createWriteStream(targetFileAbsolute, {
              highWaterMark: 4 * 1024 * 1024,
            });

            return pipeline(file, writeStream).then(() => {
              if (truncated) {
                throw new Error(
                  `文件体积超过服务器限制（单个文件最大支持 ${(
                    MAX_UPLOAD_FILE_SIZE_BYTES /
                    (1024 * 1024 * 1024)
                  ).toFixed(0)}GB）`
                );
              }

              const uploadedAt = new Date().toISOString();
              metadata[targetRelative] = {
                uploader,
                uploaderIP: clientIP,
                uploadedAt,
                expiresAt: getExpireAtISO(uploadedAt),
                isPermanent: false,
              };
              uploaded.push(targetRelative);
            });
          });

        // 避免在 Busboy 提前报错时出现未捕获的 Promise 拒绝导致进程崩溃
        task.catch(() => {
          // 具体错误会在 busboy 的 "error" 事件里统一处理
        });

        writeTasks.push(task);
      });

      busboy.on("finish", async () => {
        try {
          await Promise.all(writeTasks);
          writeJson(META_FILE, metadata);
          await Promise.all(
            uploaded.map((itemPath) =>
              appendAuditLog({
                action: "上传",
                clientIP,
                userId: uploader,
                target: itemPath,
                detail: "文件",
              })
            )
          );
          res.json({ ok: true, uploadedCount: uploaded.length, uploaded });
        } catch (error) {
          res.status(500).json({ ok: false, message: error.message });
        }
      });

      busboy.on("error", (error) => {
        // 打印到控制台方便排查，比如 “Unexpected end of form”
        console.error("[PIP_KuaiChuan] Upload error:", error);
        if (!res.headersSent) {
          res.status(500).json({ ok: false, message: error.message || "上传过程中连接中断" });
        }
      });

      req.pipe(busboy);
    } catch (error) {
      res.status(400).json({ ok: false, message: error.message });
    }
  });

  app.get("/api/download", async (req, res) => {
    try {
      if (await cleanupExpiredTempFiles(metadata)) {
        writeJson(META_FILE, metadata);
      }
      const targetPath = String(req.query.path || "");
      const { absolute } = resolveSafePath(targetPath);
      const clientIP = getClientIP(req);
      const userId = resolveActorUserId(clientProfiles, clientIP);

      const stat = await fs.promises.stat(absolute);
      if (stat.isFile()) {
        await appendAuditLog({
          action: "下载",
          clientIP,
          userId,
          target: toSafeRelative(targetPath),
          detail: "文件",
        });
        res.download(absolute, path.basename(absolute));
        return;
      }

      if (!stat.isDirectory()) {
        res.status(400).json({ ok: false, message: "目标既不是文件也不是文件夹" });
        return;
      }

      const folderName = path.basename(absolute);
      const tempZipPath = path.join(
        os.tmpdir(),
        `pip_kuaichuan_${Date.now()}_${Math.random().toString(16).slice(2)}.zip`
      );

      await buildFolderZip(absolute, tempZipPath);
      await appendAuditLog({
        action: "下载",
        clientIP,
        userId,
        target: toSafeRelative(targetPath),
        detail: "文件夹(zip)",
      });

      res.download(tempZipPath, `${folderName}.zip`, () => {
        fs.promises.unlink(tempZipPath).catch(() => {
          // noop
        });
      });
    } catch (error) {
      const status = error && error.code === "ENOENT" ? 404 : 400;
      res.status(status).json({ ok: false, message: error.message || "下载失败" });
    }
  });

  const server = app.listen(port, "0.0.0.0", () => {
    console.log(`[PIP_KuaiChuan] LAN server started at 0.0.0.0:${port}`);
  });

  const cleanupTimer = setInterval(() => {
    cleanupExpiredTempFiles(metadata)
      .then((changed) => {
        if (changed) {
          writeJson(META_FILE, metadata);
        }
      })
      .catch(() => {
        // noop
      });
  }, CLEANUP_INTERVAL_MS);

  return {
    close: () =>
      new Promise((resolve, reject) => {
        clearInterval(cleanupTimer);
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

module.exports = {
  createLanServer,
};
