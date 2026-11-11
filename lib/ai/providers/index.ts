import { localAiSettings } from "../config";
import type { ChatProvider } from "../types";
import { lmStudioProvider } from "./lmstudio";
import { openAiCompatibleProvider } from "./openai-compatible";

/** The local model named in the environment, or null when none is configured. */
export function localProvider(env: Record<string, string | undefined> = process.env, fetchFn: typeof fetch = fetch): ChatProvider | null {
  const settings = localAiSettings(env);
  if (!settings) return null;
  return settings.api === "lmstudio" ? lmStudioProvider(settings, fetchFn) : openAiCompatibleProvider(settings, fetchFn);
}
