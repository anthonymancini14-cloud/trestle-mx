import "server-only";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Loads Planning Mode context from markdown files and caches it per server
 * instance. Context lives in .md files, not TypeScript strings, so standards
 * guidance can be edited and reviewed like documentation.
 *
 *   layer1/                      universal: energy control, electrical safety, permits, planning practice
 *   layer2-industrial-utility/   vertical: utility and industrial plant considerations
 *   layer3                       site-specific, built per request from the database (see site-context.ts)
 */
export interface ContextDoc {
  layer: "layer1" | "layer2";
  file: string;
  title: string;
  body: string;
}

const CONTEXT_ROOT = path.join(process.cwd(), "lib", "anthropic", "context");
const LAYER_DIRS = { layer1: "layer1", layer2: "layer2-industrial-utility" } as const;

let cached: Promise<ContextDoc[]> | null = null;

async function loadLayer(layer: keyof typeof LAYER_DIRS): Promise<ContextDoc[]> {
  const dir = path.join(CONTEXT_ROOT, LAYER_DIRS[layer]);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".md")).sort();
  return Promise.all(
    files.map(async (file) => {
      const body = await readFile(path.join(dir, file), "utf8");
      const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? file;
      return { layer, file, title, body };
    }),
  );
}

export function loadStaticContext(): Promise<ContextDoc[]> {
  // In development, re-read on every request so edits show up immediately.
  if (process.env.NODE_ENV === "development" || !cached) {
    cached = Promise.all([loadLayer("layer1"), loadLayer("layer2")]).then((layers) => layers.flat());
  }
  return cached;
}

export function formatStaticContext(docs: ContextDoc[]): string {
  return docs
    .map((d) => `<context_file layer="${d.layer}" name="${d.file}">\n${d.body.trim()}\n</context_file>`)
    .join("\n\n");
}
