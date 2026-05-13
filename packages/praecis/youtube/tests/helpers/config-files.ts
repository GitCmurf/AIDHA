import { chmod, copyFile, writeFile } from "node:fs/promises";
import { chmodSync, copyFileSync, writeFileSync } from "node:fs";

export const SECURE_CONFIG_MODE = 0o600;
export const INSECURE_CONFIG_MODE = 0o644;

export async function writeSecureConfig(path: string, content: string): Promise<void> {
  await writeFile(path, content, { encoding: "utf-8", mode: SECURE_CONFIG_MODE });
  await chmod(path, SECURE_CONFIG_MODE);
}

export async function writeInsecureConfig(path: string, content: string): Promise<void> {
  await writeFile(path, content, { encoding: "utf-8", mode: INSECURE_CONFIG_MODE });
  await chmod(path, INSECURE_CONFIG_MODE);
}

export async function copySecureConfig(source: string, target: string): Promise<void> {
  await copyFile(source, target);
  await chmod(target, SECURE_CONFIG_MODE);
}

export function writeSecureConfigSync(path: string, content: string): void {
  writeFileSync(path, content, { encoding: "utf-8", mode: SECURE_CONFIG_MODE });
  chmodSync(path, SECURE_CONFIG_MODE);
}

export function copySecureConfigSync(source: string, target: string): void {
  copyFileSync(source, target);
  chmodSync(target, SECURE_CONFIG_MODE);
}
