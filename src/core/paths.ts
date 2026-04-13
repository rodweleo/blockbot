import fs from "fs";
import os from "os";
import path from "path";

export function getBlockbotHome(): string {
  if (process.env.BLOCKBOT_HOME) {
    return path.resolve(process.env.BLOCKBOT_HOME);
  }

  if (process.platform === "win32") {
    const base =
      process.env.PROGRAMDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(base, "blockbot");
  }

  return path.join(os.homedir(), ".blockbot");
}

export function ensureBlockbotHome(): string {
  const dir = getBlockbotHome();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getDefaultRegistryPath(): string {
  return path.join(getBlockbotHome(), "registry.json");
}

export function resolveRegistryPath(registryPath?: string): string {
  if (!registryPath) return getDefaultRegistryPath();
  return path.isAbsolute(registryPath)
    ? registryPath
    : path.join(getBlockbotHome(), registryPath);
}
