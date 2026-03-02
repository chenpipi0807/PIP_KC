const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Web-only 版本：
//   源码根目录 = __dirname/..   (即 BASE/)
//   数据根目录 = __dirname/../.. (即 D:\PIP_KC/)  下的 download/
const APP_ROOT = path.resolve(__dirname, "..", "..", "download");
const STORAGE_ROOT = path.join(APP_ROOT, "shared_disk");
const DATA_ROOT = path.join(APP_ROOT, "data");
const CONFIG_FILE = path.join(DATA_ROOT, "config.json");
const META_FILE = path.join(DATA_ROOT, "file_meta.json");
const CLIENT_PROFILE_FILE = path.join(DATA_ROOT, "client_profiles.json");
const LOG_FILE = path.join(DATA_ROOT, "log.txt");

function getLocalIPv4() {
  const interfaces = os.networkInterfaces();

  const candidates = [];
  const virtualNamePattern = /virtual|vmware|hyper-v|vethernet|loopback|tailscale|vpn|docker|wsl/i;
  const physicalHintPattern = /ethernet|wi-?fi|wlan|lan|以太网|无线/i;

  for (const [adapterName, details] of Object.entries(interfaces)) {
    if (!details) continue;
    for (const net of details) {
      if (net.family !== "IPv4" || net.internal) continue;

      const address = net.address;
      const octets = address.split(".").map((part) => Number(part));
      let score = 0;

      if (octets[0] === 10) score += 500;
      if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) score += 420;
      if (octets[0] === 192 && octets[1] === 168) score += 400;
      if (octets[0] === 169 && octets[1] === 254) score -= 200;

      if (virtualNamePattern.test(adapterName)) score -= 300;
      if (physicalHintPattern.test(adapterName)) score += 80;

      candidates.push({ address, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.length > 0 ? candidates[0].address : "127.0.0.1";
}

function generateDeviceId() {
  const interfaces = os.networkInterfaces();
  const macSeed = [];
  for (const details of Object.values(interfaces)) {
    if (!details) continue;
    for (const net of details) {
      if (net.mac && net.mac !== "00:00:00:00:00:00") {
        macSeed.push(net.mac);
      }
    }
  }

  const raw = `${os.hostname()}|${os.platform()}|${os.arch()}|${macSeed.sort().join(",")}`;
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

function ensureDirectories() {
  for (const dir of [APP_ROOT, STORAGE_ROOT, DATA_ROOT]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readJson(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function getDefaultConfig() {
  const deviceId = generateDeviceId();
  return {
    deviceId,
    userId: `device_${deviceId.slice(-6)}`,
    role: "host",
    hostAddress: getLocalIPv4(),
    hostPort: 9999,
    localIPv4: getLocalIPv4(),
  };
}

function loadConfig() {
  ensureDirectories();
  const defaults = getDefaultConfig();
  const existing = readJson(CONFIG_FILE, {});
  const existingPort = Number(existing.hostPort);
  const normalizedHostPort =
    Number.isFinite(existingPort) && existingPort > 0 ? existingPort : defaults.hostPort;

  const merged = {
    ...defaults,
    ...existing,
    deviceId: existing.deviceId || defaults.deviceId,
    hostPort: normalizedHostPort,
    localIPv4: getLocalIPv4(),
  };

  writeJson(CONFIG_FILE, merged);
  return merged;
}

function saveConfig(config) {
  ensureDirectories();
  const merged = {
    ...config,
    localIPv4: getLocalIPv4(),
  };
  writeJson(CONFIG_FILE, merged);
  return merged;
}

module.exports = {
  APP_ROOT,
  STORAGE_ROOT,
  DATA_ROOT,
  CONFIG_FILE,
  META_FILE,
  CLIENT_PROFILE_FILE,
  LOG_FILE,
  ensureDirectories,
  loadConfig,
  saveConfig,
  readJson,
  writeJson,
  getLocalIPv4,
};

// 路径说明（相对关系，不硬编码）：
// src/config.js (__dirname)
//   ../          → BASE/          （源码根）
//   ../../       → D:\PIP_KC\     （仓库根）
//   ../../download → download/    （数据根 APP_ROOT）
