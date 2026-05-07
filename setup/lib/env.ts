import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

/** 本番アプリ（親ディレクトリ）の .env ファイルパス */
const ENV_PATH = resolve(process.cwd(), "..", ".env");

/** .env ファイルを読み込み、key=value の Map を返す */
export function readEnv(): Map<string, string> {
  const map = new Map<string, string>();
  if (!existsSync(ENV_PATH)) return map;

  const content = readFileSync(ENV_PATH, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    // Remove surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    map.set(key, value);
  }
  return map;
}

/** .env ファイルに key=value を追加・更新する */
export function writeEnvValues(values: Record<string, string>): void {
  const existing = readEnv();

  // Update existing values
  for (const [key, value] of Object.entries(values)) {
    existing.set(key, value);
  }

  // Write back
  const lines: string[] = [];
  for (const [key, value] of existing) {
    lines.push(`${key}="${value}"`);
  }
  writeFileSync(ENV_PATH, lines.join("\n") + "\n", "utf-8");
}

/** 指定キーの値を取得 */
export function getEnvValue(key: string): string | undefined {
  return readEnv().get(key);
}
