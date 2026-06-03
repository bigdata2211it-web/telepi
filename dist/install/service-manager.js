/**
 * Platform-agnostic service manager.
 * Linux → systemctl --user
 * Windows → nssm
 */
import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const isWindows = platform() === "win32";

/** Path to nssm.exe — рядом с проектом или в PATH */
function resolveNssm() {
  if (!isWindows) return null;
  const distDir = path.dirname(fileURLToPath(import.meta.url));
  const localNssm = path.resolve(distDir, "..", "..", "nssm.exe");
  if (existsSync(localNssm)) return localNssm;
  // Потом в PATH
  try {
    const which = execFileSync("where", ["nssm.exe"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 3000,
    });
    return which.trim().split("\n")[0];
  } catch {
    return null;
  }
}

function execAsync(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.toString().trim() || error.message));
        return;
      }
      resolve(stdout?.toString().trim() || "");
    });
  });
}

export async function enableInstanceService(name) {
  if (isWindows) {
    const nssm = resolveNssm();
    if (!nssm) throw new Error("NSSM not found. Run install-windows.ps1 first.");

    const distDir = path.dirname(fileURLToPath(import.meta.url));
    const scriptDir = path.resolve(distDir, "..", "..");
    const nodePath = process.execPath;
    const cliPath = path.join(scriptDir, "dist", "cli.js");
    const serviceName = `TelePi-${name}`;
    const configPath = path.join(homedir(), ".config", "telepi", "instances", name, "config.env");
    const logDir = path.join(homedir(), ".local", "state", "telepi", "logs");

    // Останавливаем и удаляем если уже есть
    try { await execAsync(nssm, ["stop", serviceName]); } catch { /* ignore */ }
    try { await execAsync(nssm, ["remove", serviceName, "confirm"]); } catch { /* ignore */ }

    // Устанавливаем
    await execAsync(nssm, ["install", serviceName, nodePath, `${cliPath} start`]);
    await execAsync(nssm, ["set", serviceName, "AppDirectory", scriptDir]);
    await execAsync(nssm, ["set", serviceName, "AppEnvironmentExtra", `TELEPI_CONFIG=${configPath}`]);
    await execAsync(nssm, ["set", serviceName, "AppThrottle", "0"]);
    await execAsync(nssm, ["set", serviceName, "AppExit", "Restart"]);
    await execAsync(nssm, ["set", serviceName, "AppRestartDelay", "10000"]);
    await execAsync(nssm, ["set", serviceName, "AppStdout", path.join(logDir, `telepi-${name}.out.log`)]);
    await execAsync(nssm, ["set", serviceName, "AppStderr", path.join(logDir, `telepi-${name}.err.log`)]);
    await execAsync(nssm, ["set", serviceName, "AppRotateFiles", "1"]);
    await execAsync(nssm, ["set", serviceName, "AppRotateOnline", "1"]);
    await execAsync(nssm, ["set", serviceName, "AppRotateBytes", "10485760"]);

    // Запускаем
    await execAsync(nssm, ["start", serviceName]);

    return { serviceName: `${serviceName}` };
  }

  // Linux — systemd
  await execAsync("systemctl", ["--user", "daemon-reload"]);
  await execAsync("systemctl", ["--user", "enable", `telepi@${name}`, "--now"]);
  return { serviceName: `telepi@${name}.service` };
}

export function getServiceManagerLabel() {
  return isWindows ? "NSSM" : "systemd";
}
