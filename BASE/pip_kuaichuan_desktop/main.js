const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");

const { app, BrowserWindow, ipcMain } = require("electron");

const {
  DOWNLOAD_ROOT,
  STORAGE_ROOT,
  ensureDirectories,
  getLocalIPv4,
  loadConfig,
  saveConfig,
} = require("./src/config");
const { createLanServer } = require("./src/server");

let mainWindow = null;
let appConfig = null;
let activeServer = null;

function buildServerInfo() {
  return {
    deviceId: appConfig?.deviceId,
    hostAddress: appConfig?.hostAddress,
    hostPort: appConfig?.hostPort,
    localIPv4: getLocalIPv4(),
    storageRoot: STORAGE_ROOT,
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1200,
    minHeight: 720,
    autoHideMenuBar: true,
    backgroundColor: "#0b1220",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

async function startHostServer() {
  if (activeServer) return;
  activeServer = createLanServer({
    port: Number(appConfig.hostPort) || 9999,
    serverInfoProvider: () => buildServerInfo(),
  });
}

async function stopHostServer() {
  if (!activeServer) return;
  await activeServer.close();
  activeServer = null;
}

async function syncServerWithRole() {
  if (appConfig.role === "host") {
    appConfig.hostAddress = getLocalIPv4();
    appConfig = saveConfig(appConfig);
    await startHostServer();
  } else {
    await stopHostServer();
  }
}

function getPublicConfig() {
  return {
    ...appConfig,
    localIPv4: getLocalIPv4(),
    serverRunning: Boolean(activeServer),
    storageRoot: STORAGE_ROOT,
    downloadRoot: DOWNLOAD_ROOT,
  };
}

function getUniqueDownloadPath(fileName) {
  const safeFileName = path.basename(fileName || `download-${Date.now()}`);
  const parsed = path.parse(safeFileName);

  let counter = 0;
  let target = path.join(DOWNLOAD_ROOT, safeFileName);

  while (fs.existsSync(target)) {
    counter += 1;
    const next = `${parsed.name}-${counter}${parsed.ext}`;
    target = path.join(DOWNLOAD_ROOT, next);
  }

  return target;
}

function downloadToLocal(baseUrl, relativePath, fallbackName) {
  return new Promise((resolve, reject) => {
    const safeUrl = `${baseUrl.replace(/\/$/, "")}/api/download?path=${encodeURIComponent(relativePath)}`;
    const client = safeUrl.startsWith("https") ? https : http;
    const targetPath = getUniqueDownloadPath(fallbackName || path.basename(relativePath));

    const request = client.get(safeUrl, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`下载失败，状态码: ${response.statusCode}`));
        return;
      }

      const fileStream = fs.createWriteStream(targetPath);
      response.pipe(fileStream);

      fileStream.on("finish", () => {
        fileStream.close(() => {
          resolve(targetPath);
        });
      });

      fileStream.on("error", (error) => {
        fs.unlink(targetPath, () => reject(error));
      });
    });

    request.on("error", reject);
  });
}

ipcMain.handle("config:get", async () => getPublicConfig());

ipcMain.handle("config:update", async (event, patch) => {
  appConfig = saveConfig({ ...appConfig, ...patch });
  await syncServerWithRole();
  return getPublicConfig();
});

ipcMain.handle("server:restart", async () => {
  await stopHostServer();
  if (appConfig.role === "host") {
    await startHostServer();
  }
  return getPublicConfig();
});

ipcMain.handle("download:file", async (event, payload) => {
  const { baseUrl, relativePath, fileName } = payload;
  const savedPath = await downloadToLocal(baseUrl, relativePath, fileName);
  return { ok: true, savedPath };
});

app.whenReady().then(async () => {
  ensureDirectories();
  appConfig = loadConfig();
  await syncServerWithRole();
  createWindow();
});

app.on("window-all-closed", async () => {
  await stopHostServer();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
