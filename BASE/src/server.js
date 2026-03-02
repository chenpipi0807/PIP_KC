const fs = require("fs");
const os = require("os");
const path = require("path");

// 临时 zip 文件存放在项目内的 temp 目录（避免写入系统 C 盘 Temp）
const TEMP_DIR = path.resolve(__dirname, "..", "..", "temp");
const { pipeline } = require("stream/promises");

const Busboy = require("busboy");
const cors = require("cors");
const express = require("express");

const { CLIENT_PROFILE_FILE, LOG_FILE, META_FILE, STORAGE_ROOT, readJson, writeJson } = require("./config");

const TEMP_FILE_TTL_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const MAX_LOG_READ_LINES = 1000;
const RANDOM_SUFFIX_CHARS = "23456789abcdefghjkmnpqrstuvwxyz";

// ── 服务器运行日志：内存环形缓冲区 ──────────────────────────────────────────
// 捕获 console.error / console.warn / console.log，保留最新 500 条
const SERVER_LOG_MAX = 500;
const serverLogBuffer = []; // { ts, level, msg }

function pushServerLog(level, args) {
  const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
  if (serverLogBuffer.length >= SERVER_LOG_MAX) {
    serverLogBuffer.shift();
  }
  serverLogBuffer.push({ ts: new Date().toISOString(), level, msg });
}

// 劫持 console，保留原始输出
const _consoleError = console.error.bind(console);
const _consoleWarn  = console.warn.bind(console);
const _consoleLog   = console.log.bind(console);

console.error = (...args) => { _consoleError(...args); pushServerLog("error", args); };
console.warn  = (...args) => { _consoleWarn(...args);  pushServerLog("warn",  args); };
console.log   = (...args) => { _consoleLog(...args);   pushServerLog("info",  args); };
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

function sanitizeRelativeFilePath(rawPath) {
  const normalizedPath = String(rawPath || "")
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

/**
 * 使用 archiver 包将文件夹打包为标准 ZIP 文件（跨平台，支持中文路径）
 * 文件夹内容直接放在 ZIP 根目录下（不含外层文件夹名），与 Compress-Archive -Path "$src\*" 行为一致
 */
function zipDirectoryWithArchiver(sourceAbsolute, destinationZipAbsolute) {
  const archiver = require("archiver");
  console.log(`[ZIP-ARCHIVER] 开始打包: src=${sourceAbsolute} dst=${destinationZipAbsolute}`);

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destinationZipAbsolute);
    const archive = archiver("zip", { zlib: { level: 6 } });

    output.on("close", () => {
      console.log(`[ZIP-ARCHIVER] 打包完成，总字节数: ${archive.pointer()}`);
      resolve();
    });

    archive.on("warning", (err) => {
      if (err.code === "ENOENT") {
        console.warn(`[ZIP-ARCHIVER] 警告: ${err.message}`);
      } else {
        console.error(`[ZIP-ARCHIVER] 错误(warning): ${err.message}`);
        reject(err);
      }
    });

    archive.on("error", (err) => {
      console.error(`[ZIP-ARCHIVER] 错误: ${err.message}`);
      reject(err);
    });

    archive.on("entry", (entry) => {
      console.log(`[ZIP-ARCHIVER] 添加: ${entry.name}`);
    });

    archive.pipe(output);
    // glob: false → 按目录递归；false 第三参为 false 表示不在 zip 内创建外层文件夹
    archive.directory(sourceAbsolute, false);
    archive.finalize();
  });
}

async function ensureValidZipFile(zipAbsolute) {
  let stat;
  try {
    stat = await fs.promises.stat(zipAbsolute);
  } catch (e) {
    throw new Error(`zip 文件不存在: ${zipAbsolute}`);
  }
  console.log(`[ZIP-VALIDATE] zip file size: ${stat.size} bytes, path: ${zipAbsolute}`);
  if (stat.size === 0) {
    throw new Error("zip 文件大小为 0，压缩结果为空");
  }

  const handle = await fs.promises.open(zipAbsolute, "r");
  try {
    const buffer = Buffer.alloc(4);
    const result = await handle.read(buffer, 0, 4, 0);
    if (!result.bytesRead) {
      throw new Error("zip 为空文件（读取 0 字节）");
    }

    const signature = buffer.toString("hex").toLowerCase();
    const validSignatures = new Set(["504b0304", "504b0506", "504b0708"]);
    if (!validSignatures.has(signature)) {
      throw new Error(`zip 文件头签名异常: ${signature}（期望 504b0304）`);
    }
    console.log(`[ZIP-VALIDATE] zip signature OK: ${signature}`);
  } finally {
    await handle.close();
  }
}

async function buildFolderZip(sourceAbsolute, destinationZipAbsolute) {
  console.log(`[ZIP] buildFolderZip start: src=${sourceAbsolute} dst=${destinationZipAbsolute} platform=${process.platform}`);

  // 检查源目录是否存在
  try {
    const stat = await fs.promises.stat(sourceAbsolute);
    if (!stat.isDirectory()) {
      throw new Error(`源路径不是目录: ${sourceAbsolute}`);
    }
    const entries = await fs.promises.readdir(sourceAbsolute);
    console.log(`[ZIP] source directory entries count: ${entries.length}, entries: ${entries.slice(0, 10).join(", ")}`);
  } catch (e) {
    console.error(`[ZIP] source stat error: ${e.message}`);
    throw e;
  }

  // 使用 archiver 打包（跨平台，真正的 ZIP 格式）
  const packers = [zipDirectoryWithArchiver];
  const errors = [];

  for (const pack of packers) {
    console.log(`[ZIP] trying packer: ${pack.name}`);
    try {
      await fs.promises.unlink(destinationZipAbsolute).catch(() => { /* noop */ });
      await pack(sourceAbsolute, destinationZipAbsolute);
      await ensureValidZipFile(destinationZipAbsolute);
      console.log(`[ZIP] buildFolderZip success with packer: ${pack.name}`);
      return;
    } catch (error) {
      const msg = `${pack.name}: ${error.message}`;
      console.error(`[ZIP] packer failed: ${msg}`);
      errors.push(msg);
    }
  }

  throw new Error(`文件夹打包全部失败。${errors.join(" | ")}`);
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

  // 服务器运行日志（内存缓冲，包含 error/warn/info 级别）
  app.get("/api/server-logs", (req, res) => {
    const limit = Math.max(1, Math.min(Number(req.query.limit || 200), SERVER_LOG_MAX));
    const entries = serverLogBuffer.slice(-limit).reverse(); // 最新在前
    res.json({ ok: true, entries, total: serverLogBuffer.length });
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
      const busboy = Busboy({ headers: req.headers, preservePath: true });
      const writeTasks = [];

      busboy.on("file", (fieldName, file, fileInfo) => {
        const fallbackName = `file-${Date.now()}`;
        // Busboy 1.x 以 latin1 解码 multipart header 中的文件名，导致中文变成乱码。
        // 修复：将 latin1 字符串重新按字节解释为 UTF-8；若解码后与原字符串相同（纯 ASCII）则不变。
        // 同时兼容浏览器发送的 percent-encoded 文件名（%E4%B8%AD%E6%96%87 等）。
        const rawFilename = fileInfo.filename || "";
        let decodedFilename = rawFilename;
        try {
          const asLatin1 = Buffer.from(rawFilename, "latin1");
          const asUtf8 = asLatin1.toString("utf8");
          // 如果 UTF-8 解码后字节数与 latin1 字节数相同（纯 ASCII），直接用原值；
          // 否则用 UTF-8 解码结果（中文等多字节字符）。
          decodedFilename = asUtf8;
        } catch {
          // 解码失败则保留原值
        }
        // 兼容浏览器发送的 percent-encoded 文件名
        try {
          if (/%[0-9A-Fa-f]{2}/.test(decodedFilename)) {
            decodedFilename = decodeURIComponent(decodedFilename);
          }
        } catch {
          // 非合法 percent-encode，保留当前值
        }
        const normalizedRelativePath = sanitizeRelativeFilePath(decodedFilename);
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
        res.status(500).json({ ok: false, message: error.message });
      });

      req.pipe(busboy);
    } catch (error) {
      res.status(400).json({ ok: false, message: error.message });
    }
  });

  // 两步下载方案：
  // 步骤1 POST /api/zip  — 触发打包，返回临时 token
  // 步骤2 GET  /api/download?token=xxx 或 path=xxx — 流式传输文件/zip
  //
  // 这样浏览器端可以用 fetch() 等待打包完成获取 token，
  // 再用 <a href="/api/download?token=xxx"> 或 Blob URL 触发真正的文件下载，
  // 彻底解决打包耗时期间的连接超时和进度感知问题。

  // 内存中维护临时 zip token 映射（进程级别，重启后失效）
  const zipTokenMap = new Map(); // token -> { zipPath, zipFileName, expireAt }

  // 定期清理过期 token（30分钟内未下载则删除临时文件）
  setInterval(() => {
    const now = Date.now();
    for (const [token, info] of zipTokenMap.entries()) {
      if (info.expireAt < now) {
        fs.promises.unlink(info.zipPath).catch(() => { /* noop */ });
        zipTokenMap.delete(token);
      }
    }
  }, 5 * 60 * 1000);

  // 步骤1：POST /api/zip — 打包文件夹，返回 token
  app.post("/api/zip", async (req, res) => {
    const clientIP = getClientIP(req);
    const rawPath = String(req.body?.path || "");
    console.log(`[API /api/zip] 收到请求: clientIP=${clientIP} rawPath="${rawPath}" body=${JSON.stringify(req.body)}`);
    try {
      const targetPath = rawPath;
      if (!targetPath) {
        console.warn(`[API /api/zip] 拒绝: 路径为空`);
        res.status(400).json({ ok: false, message: "路径不能为空" });
        return;
      }
      const { absolute } = resolveSafePath(targetPath);
      console.log(`[API /api/zip] 解析绝对路径: "${absolute}"`);

      let stat;
      try {
        stat = await fs.promises.stat(absolute);
      } catch (e) {
        console.error(`[API /api/zip] stat失败: ${e.message}`);
        res.status(400).json({ ok: false, message: `路径不存在: ${targetPath}` });
        return;
      }
      if (!stat.isDirectory()) {
        console.warn(`[API /api/zip] 拒绝: 目标不是文件夹 isFile=${stat.isFile()}`);
        res.status(400).json({ ok: false, message: "目标不是文件夹" });
        return;
      }

      const folderName = path.basename(absolute);
      const zipFileName = `${folderName}.zip`;
      await fs.promises.mkdir(TEMP_DIR, { recursive: true });
      const tempZipPath = path.join(
        TEMP_DIR,
        `pip_kuaichuan_${Date.now()}_${Math.random().toString(16).slice(2)}.zip`
      );
      console.log(`[API /api/zip] 开始打包: folderName="${folderName}" tempZipPath="${tempZipPath}"`);

      const t0 = Date.now();
      await buildFolderZip(absolute, tempZipPath);
      const elapsed = Date.now() - t0;

      // 打包完成后验证临时文件大小
      const zipStat = await fs.promises.stat(tempZipPath);
      console.log(`[API /api/zip] 打包完成: 耗时${elapsed}ms 临时zip大小=${zipStat.size}字节 文件名="${zipFileName}"`);

      // 生成 token（32位随机十六进制）
      const token = `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`.slice(0, 32);
      zipTokenMap.set(token, {
        zipPath: tempZipPath,
        zipFileName,
        expireAt: Date.now() + 30 * 60 * 1000, // 30 分钟有效
      });
      console.log(`[API /api/zip] 生成token: token=${token} 有效期30分钟`);

      res.json({ ok: true, token, zipFileName });
    } catch (error) {
      console.error(`[API /api/zip] 异常: ${error.message}`, error.stack || "");
      res.status(500).json({ ok: false, message: error.message || "文件夹打包失败" });
    }
  });

  app.get("/api/download", async (req, res) => {
    try {
      // 支持 token 模式（文件夹zip下载）
      const token = String(req.query.token || "");
      if (token) {
        const info = zipTokenMap.get(token);
        if (!info) {
          res.status(404).json({ ok: false, message: "下载链接已过期或无效，请重新点击下载" });
          return;
        }
        if (info.expireAt < Date.now()) {
          zipTokenMap.delete(token);
          fs.promises.unlink(info.zipPath).catch(() => { /* noop */ });
          res.status(410).json({ ok: false, message: "下载链接已过期，请重新点击下载" });
          return;
        }
        // 发送前再次确认文件存在
        let zipStat;
        try {
          zipStat = await fs.promises.stat(info.zipPath);
        } catch (e) {
          zipTokenMap.delete(token);
          res.status(410).json({ ok: false, message: "临时文件已丢失，请重新点击下载" });
          return;
        }
        console.log(`[API /api/download] token=${token} zipPath=${info.zipPath} size=${zipStat.size}`);
        const encodedZipFileName = encodeURIComponent(info.zipFileName);
        // 用 res.sendFile 发送，express 会正确设置 Content-Length，迅雷/IDM 等多线程下载器需要此字段
        // 不能在 sendFile 前手动 setHeader Content-Disposition，否则 express 内部会冲突；
        // 改用 res.attachment() 设置文件名，再 sendFile
        res.attachment(info.zipFileName);
        res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodedZipFileName}`);
        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Length", zipStat.size);
        res.sendFile(info.zipPath, { dotfiles: "allow" }, (err) => {
          if (err) {
            console.error(`[API /api/download] sendFile error: ${err.message}`);
          } else {
            console.log(`[API /api/download] download complete: ${info.zipFileName}`);
          }
          zipTokenMap.delete(token);
          fs.promises.unlink(info.zipPath).catch(() => { /* noop */ });
        });
        return;
      }

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

      // 直接下载文件夹（老路径，IPC/桌面端 fallback）
      const folderName = path.basename(absolute);
      const zipFileName = `${folderName}.zip`;
      await fs.promises.mkdir(TEMP_DIR, { recursive: true });
      const tempZipPath = path.join(
        TEMP_DIR,
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

      const encodedZipFileName = encodeURIComponent(zipFileName);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodedZipFileName}`
      );
      res.setHeader("Content-Type", "application/zip");
      res.download(tempZipPath, zipFileName, () => {
        fs.promises.unlink(tempZipPath).catch(() => {
          // noop
        });
      });
    } catch (error) {
      console.error("[PIP_KuaiChuan] /api/download error:", error);
      const status = error && error.code === "ENOENT" ? 404 : 400;
      res.status(status).json({ ok: false, message: error.message || "下载失败" });
    }
  });

  const server = app.listen(port, "0.0.0.0", () => {
    console.log(`[PIP_KuaiChuan] LAN server started at 0.0.0.0:${port}`);
  });

  // 移除上传/下载的超时限制，允许传输任意大小的文件
  // Node.js 默认 requestTimeout=300000ms(5分钟)，大文件上传会被强制中断
  server.requestTimeout = 0;  // 禁用请求超时（0 = 无限制）
  server.timeout = 0;         // 禁用 socket 空闲超时
  server.headersTimeout = 0;  // 禁用 headers 接收超时

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
