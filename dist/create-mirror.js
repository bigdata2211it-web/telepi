import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";

const INSTANCES_DIR = path.join(homedir(), ".config", "telepi", "instances");
const MAIN_CONFIG_PATH = path.join(homedir(), ".config", "telepi", "config.env");
const MAIN_VOICE_CONFIG_PATH = path.join(homedir(), ".config", "telepi", "voice-config.json");
const SYSTEMD_USER_DIR = path.join(homedir(), ".config", "systemd", "user");
const TELEPI_CLI = path.join(homedir(), ".npm-global", "lib", "node_modules", "@futurelab-studio", "telepi", "dist", "cli.js");

function execSystemctl(args) {
  return new Promise((resolve, reject) => {
    execFile("systemctl", ["--user", ...args], (error, stdout, stderr) => {
      if (error) {
        const msg = stderr?.toString().trim() || error.message;
        reject(new Error(msg));
        return;
      }
      resolve(stdout?.toString().trim() || "");
    });
  });
}

function instanceDir(name) {
  return path.join(INSTANCES_DIR, name);
}

function instanceConfigPath(name) {
  return path.join(instanceDir(name), "config.env");
}

function instanceVoiceConfigPath(name) {
  return path.join(instanceDir(name), "voice-config.json");
}

function serviceName(name) {
  return `telepi-${name}.service`;
}

export async function createMirrorInstance(name, botToken, adminUserIds) {
  const dir = instanceDir(name);

  // 1. Create instance directory
  await mkdir(dir, { recursive: true });

  // 2. Read main config, create instance config with overridden values
  const mainConfig = await readFile(MAIN_CONFIG_PATH, "utf-8").catch(() => {
    throw new Error(`Main config not found at ${MAIN_CONFIG_PATH}. Run \`telepi setup\` first.`);
  });

  let instanceConfig = mainConfig;
  // Replace TELEGRAM_BOT_TOKEN
  if (instanceConfig.includes("TELEGRAM_BOT_TOKEN=")) {
    instanceConfig = instanceConfig.replace(
      /^(export\s+)?TELEGRAM_BOT_TOKEN=.*$/m,
      `$1TELEGRAM_BOT_TOKEN=${botToken}`
    );
  } else {
    instanceConfig += `\nTELEGRAM_BOT_TOKEN=${botToken}\n`;
  }
  // Replace TELEGRAM_ALLOWED_USER_IDS
  const idsStr = Array.isArray(adminUserIds) ? adminUserIds.join(",") : String(adminUserIds);
  if (instanceConfig.includes("TELEGRAM_ALLOWED_USER_IDS=")) {
    instanceConfig = instanceConfig.replace(
      /^(export\s+)?TELEGRAM_ALLOWED_USER_IDS=.*$/m,
      `$1TELEGRAM_ALLOWED_USER_IDS=${idsStr}`
    );
  } else {
    instanceConfig += `\nTELEGRAM_ALLOWED_USER_IDS=${idsStr}\n`;
  }
  // Ensure VOICE_CONFIG_PATH points to instance voice-config
  const instVoiceCfg = instanceVoiceConfigPath(name);
  // Remove any existing VOICE_CONFIG_PATH line
  instanceConfig = instanceConfig.replace(/^VOICE_CONFIG_PATH=.*$/m, "");
  instanceConfig += `\nVOICE_CONFIG_PATH=${instVoiceCfg}\n`;

  await writeFile(instanceConfigPath(name), instanceConfig, "utf-8");

  // 3. Copy voice-config.json (if exists)
  if (existsSync(MAIN_VOICE_CONFIG_PATH)) {
    await copyFile(MAIN_VOICE_CONFIG_PATH, instVoiceCfg);
  } else {
    // Create minimal default
    await writeFile(instVoiceCfg, JSON.stringify({ backend: "sherpa-onnx", groq: { apiKey: "" }, openai: { apiKey: "" } }, null, 2), "utf-8");
  }

  // 4. Create systemd unit
  const unitContent = `[Unit]
Description=TelePi Telegram Bot (${name})
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/node ${TELEPI_CLI} start
Environment=TELEPI_CONFIG=${instanceConfigPath(name)}
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
`;

  const unitPath = path.join(SYSTEMD_USER_DIR, serviceName(name));
  await mkdir(SYSTEMD_USER_DIR, { recursive: true });
  await writeFile(unitPath, unitContent, "utf-8");

  // 5. Enable and start via systemctl --user
  await execSystemctl(["daemon-reload"]);
  await execSystemctl(["enable", serviceName(name)]);
  await execSystemctl(["start", serviceName(name)]);

  return {
    name,
    serviceName: serviceName(name),
    configPath: instanceConfigPath(name),
    unitPath,
  };
}

export async function listMirrors() {
  try {
    const dir = INSTANCES_DIR;
    if (!existsSync(dir)) return [];
    const entries = await readFile(dir, "utf-8").catch(() => "");
    // Use fs.readdir instead
    const { readdir } = await import("node:fs/promises");
    const items = await readdir(dir, { withFileTypes: true });
    return items.filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    return [];
  }
}
