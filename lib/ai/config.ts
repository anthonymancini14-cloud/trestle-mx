/**
 * Where the local model lives. Any server that speaks the OpenAI chat API
 * works (LM Studio, Ollama, llama.cpp, vLLM). LM Studio's own API is also
 * supported because it is the one that can switch a model's reasoning off.
 *
 *   LOCAL_AI_BASE_URL   http://localhost:1234          required to use a local model
 *   LOCAL_AI_MODEL      the model name the server expects
 *   LOCAL_AI_API        openai (default) | lmstudio
 *   LOCAL_AI_REASONING  off (default) | auto            lmstudio only; auto leaves the model's own setting
 *   LOCAL_AI_API_KEY    optional bearer token
 *   AI_AUTO_EXTRACT     on: queue every close-out debrief for extraction
 */
export type LocalApi = "openai" | "lmstudio";

export interface LocalAiSettings {
  baseUrl: string;
  model: string;
  api: LocalApi;
  reasoning: "off" | "auto";
  apiKey: string | null;
}

type Env = Record<string, string | undefined>;

/** The local model settings, or null when no local model is configured. */
export function localAiSettings(env: Env = process.env): LocalAiSettings | null {
  const raw = (env.LOCAL_AI_BASE_URL ?? "").trim();
  const model = (env.LOCAL_AI_MODEL ?? "").trim();
  if (!raw || !model) return null;
  // Accept the URL with or without a trailing slash or /v1.
  const baseUrl = raw.replace(/\/+$/, "").replace(/\/v1$/, "");
  return {
    baseUrl,
    model,
    api: env.LOCAL_AI_API === "lmstudio" ? "lmstudio" : "openai",
    reasoning: env.LOCAL_AI_REASONING === "auto" ? "auto" : "off",
    apiKey: (env.LOCAL_AI_API_KEY ?? "").trim() || null,
  };
}

export const hasLocalModel = (env: Env = process.env): boolean => localAiSettings(env) !== null;

/** Queue the debrief for extraction whenever a work order closes. Off unless asked for. */
export const autoExtractOnClose = (env: Env = process.env): boolean => env.AI_AUTO_EXTRACT === "on";

/** How long one model call may take before it is abandoned. */
export const AI_CALL_TIMEOUT_MS = 180_000;
