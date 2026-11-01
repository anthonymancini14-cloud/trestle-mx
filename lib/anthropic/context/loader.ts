import "server-only";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Loads Planning Mode context from markdown files and caches it per server
 * instance. Context lives in .md files, not TypeScript strings, so standards
 * guidance can be edited and reviewed like documentation.
 *
 *   layer1/                      universal: energy control, electrical safety, permits, planning practice
 *   layer2-<vertical>/           vertical pack chosen by the site's vertical:
 *     layer2-industrial-utility/   utility and industrial plant considerations
 *     layer2-data-center/          data center operations: redundancy, MOPs, cable plant
 *   layer3                       site-specific, built per request from the database (see site-context.ts)
 */
import type { Vertical } from "@/types/domain";

export interface ContextDoc {
  layer: "layer1" | "layer2";
  file: string;
  title: string;
  body: string;
}

const CONTEXT_ROOT = path.join(process.cwd(), "lib", "anthropic", "context");
const LAYER2_DIRS: Record<Vertical, string> = {
  industrial_utility: "layer2-industrial-utility",
  data_center: "layer2-data-center",
};

const cached = new Map<Vertical, Promise<ContextDoc[]>>();

async function loadLayer(layer: ContextDoc["layer"], dirName: string): Promise<ContextDoc[]> {
  const dir = path.join(CONTEXT_ROOT, dirName);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".md")).sort();
  return Promise.all(
    files.map(async (file) => {
      const body = await readFile(path.join(dir, file), "utf8");
      const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? file;
      return { layer, file, title, body };
    }),
  );
}

/** Layer 1 plus the site's vertical pack. Cached per vertical, so each keeps its own prompt cache. */
export function loadStaticContext(vertical: Vertical): Promise<ContextDoc[]> {
  // In development, re-read on every request so edits show up immediately.
  if (process.env.NODE_ENV === "development" || !cached.has(vertical)) {
    cached.set(
      vertical,
      Promise.all([loadLayer("layer1", "layer1"), loadLayer("layer2", LAYER2_DIRS[vertical])]).then((layers) => layers.flat()),
    );
  }
  return cached.get(vertical)!;
}

export function formatStaticContext(docs: ContextDoc[]): string {
  return docs
    .map((d) => `<context_file layer="${d.layer}" name="${d.file}">\n${d.body.trim()}\n</context_file>`)
    .join("\n\n");
}
