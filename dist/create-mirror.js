import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { enableInstanceService } from "./install/service-manager.js";

const INSTANCES_DIR = path.join(homedir(), ".config", "telepi", "instances");
const MAIN_CONFIG_PATH = path.join(homedir(), ".config", "telepi", "config.env");
const MAIN_VOICE_CONFIG_PATH = path.join(homedir(), ".config", "telepi", "voice-config.json");

function instanceDir(name) {
  return path.join(INSTANCES_DIR, name);
}

function instanceConfigPath(name) {
  return path.join(instanceDir(name), "config.env");
}

function instanceVoiceConfigPath(name) {
  return path.join(instanceDir(name), "voice-config.json");
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
  instanceConfig = instanceConfig.replace(/^VOICE_CONFIG_PATH=.*$/m, "");
  instanceConfig += `\nVOICE_CONFIG_PATH=${instVoiceCfg}\n`;

  await writeFile(instanceConfigPath(name), instanceConfig, "utf-8");

  // 3. Copy voice-config.json (if exists)
  if (existsSync(MAIN_VOICE_CONFIG_PATH)) {
    await copyFile(MAIN_VOICE_CONFIG_PATH, instVoiceCfg);
  } else {
    await writeFile(instVoiceCfg, JSON.stringify({ backend: "sherpa-onnx", groq: { apiKey: "" }, openai: { apiKey: "" } }, null, 2), "utf-8");
  }

  // 4. Enable and start via systemd (Linux) or NSSM (Windows)
  const result = await enableInstanceService(name);

  return {
    name,
    serviceName: result.serviceName,
    configPath: instanceConfigPath(name),
  };
}

export async function listMirrors() {
  try {
    const dir = INSTANCES_DIR;
    if (!existsSync(dir)) return [];
    const { readdir } = await import("node:fs/promises");
    const items = await readdir(dir, { withFileTypes: true });
    return items.filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    return [];
  }
}
