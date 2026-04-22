import { rename, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Writes a string to a file atomically by writing to a temporary file first
 * and then renaming it.
 */
export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });

  const tempPath = `${filePath}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await writeFile(tempPath, content, "utf-8");
    await rename(tempPath, filePath);
  } catch (error) {
    // Attempt cleanup of temp file
    try {
      const { rm } = await import("node:fs/promises");
      await rm(tempPath, { force: true });
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

/**
 * Writes a JSON object to a file atomically.
 */
export async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  await writeFileAtomic(filePath, JSON.stringify(data, null, 2));
}
