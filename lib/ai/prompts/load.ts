import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Task prompts live in markdown next to this file, like Planning Mode's
 * context, so they can be read and edited as documentation. Each prompt gets
 * a version made from its text, so a stored run names the exact prompt it used.
 */
const PROMPT_ROOT = path.join(process.cwd(), "lib", "ai", "prompts");
const cache = new Map<string, Promise<{ text: string; hash: string }>>();

export function loadPrompt(file: string): Promise<{ text: string; hash: string }> {
  // In development, re-read on every call so edits show up immediately.
  if (process.env.NODE_ENV === "development" || !cache.has(file)) {
    cache.set(
      file,
      readFile(path.join(PROMPT_ROOT, file), "utf8").then((text) => ({
        text: text.trim(),
        hash: createHash("sha256").update(text.trim()).digest("hex").slice(0, 8),
      })),
    );
  }
  return cache.get(file)!;
}
