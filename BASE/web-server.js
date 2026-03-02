const path = require("path");

const {
  STORAGE_ROOT,
  ensureDirectories,
  getLocalIPv4,
  loadConfig,
  saveConfig,
} = require("./src/config");
const { createLanServer } = require("./src/server");

function buildServerInfo(config) {
  return {
    deviceId: config.deviceId,
    hostAddress: config.hostAddress,
    hostPort: config.hostPort,
    localIPv4: getLocalIPv4(),
    storageRoot: STORAGE_ROOT,
  };
}

async function startWebShareServer() {
  ensureDirectories();

  let config = loadConfig();
  config = saveConfig({
    ...config,
    role: "host",
    hostAddress: getLocalIPv4(),
    hostPort: Number(config.hostPort) || 9999,
  });

  createLanServer({
    port: Number(config.hostPort) || 9999,
    staticDir: path.join(__dirname, "renderer"),
    serverInfoProvider: () => buildServerInfo(config),
  });

  console.log(`[PIP_KuaiChuan] Web share ready: http://${config.hostAddress}:${config.hostPort}`);
}

startWebShareServer().catch((error) => {
  console.error("[PIP_KuaiChuan] Failed to start web share server", error);
  process.exit(1);
});
