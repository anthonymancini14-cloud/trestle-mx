import { AI_CALL_TIMEOUT_MS, type LocalAiSettings } from "../config";
import type { ChatProvider, ChatRequest, ChatResponse } from "../types";

interface LmStudioChat {
  model_instance_id?: string;
  output?: { type: string; content?: string }[];
  stats?: { input_tokens?: number; total_output_tokens?: number };
}

/**
 * LM Studio's own API (POST /api/v1/chat). Unlike its OpenAI-style endpoint it
 * takes a `reasoning` setting, so a reasoning model can be told not to think
 * before answering. It has no schema-constrained output, so the reply is
 * plain text here; lib/ai/run.ts parses it and checks it against the schema.
 */
export function lmStudioProvider(settings: LocalAiSettings, fetchFn: typeof fetch = fetch): ChatProvider {
  return {
    name: "lmstudio",
    model: settings.model,
    async complete(request: ChatRequest): Promise<ChatResponse> {
      const response = await fetchFn(`${settings.baseUrl}/api/v1/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: settings.model,
          system_prompt: request.system,
          input: request.user,
          temperature: request.temperature,
          max_output_tokens: request.maxOutputTokens,
          store: false,
          // LM Studio refuses the request if the model has no such setting; LOCAL_AI_REASONING=auto leaves it out.
          ...(settings.reasoning === "off" ? { reasoning: "off" } : {}),
        }),
        signal: AbortSignal.timeout(AI_CALL_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`LM Studio answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
      }
      const data = (await response.json()) as LmStudioChat;
      const text = (data.output ?? [])
        .filter((item) => item.type === "message")
        .map((item) => item.content ?? "")
        .join("");
      if (!text.trim()) throw new Error("LM Studio returned no message text.");
      return {
        text,
        model: data.model_instance_id ?? settings.model,
        inputTokens: data.stats?.input_tokens ?? null,
        outputTokens: data.stats?.total_output_tokens ?? null,
      };
    },
  };
}
