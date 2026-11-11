import { AI_CALL_TIMEOUT_MS, type LocalAiSettings } from "../config";
import type { ChatProvider, ChatRequest, ChatResponse } from "../types";

interface ChatCompletion {
  model?: string;
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Any server with an OpenAI-style /v1/chat/completions endpoint. The reply is
 * constrained to the task's JSON schema through `response_format`, which
 * LM Studio, llama.cpp and vLLM all enforce while the model is writing.
 */
export function openAiCompatibleProvider(settings: LocalAiSettings, fetchFn: typeof fetch = fetch): ChatProvider {
  return {
    name: "openai-compatible",
    model: settings.model,
    async complete(request: ChatRequest): Promise<ChatResponse> {
      const response = await fetchFn(`${settings.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: settings.model,
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.user },
          ],
          temperature: request.temperature,
          max_tokens: request.maxOutputTokens,
          stream: false,
          ...(request.jsonSchema
            ? { response_format: { type: "json_schema", json_schema: { name: request.jsonSchema.name, strict: true, schema: request.jsonSchema.schema } } }
            : {}),
        }),
        signal: AbortSignal.timeout(AI_CALL_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`The model server answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
      }
      const data = (await response.json()) as ChatCompletion;
      const choice = data.choices?.[0];
      const text = choice?.message?.content ?? "";
      if (!text.trim()) {
        // A reasoning model can spend the whole token budget thinking and return nothing.
        throw new Error(
          `The model returned no text (finish reason: ${choice?.finish_reason ?? "unknown"}). If this is a reasoning model on LM Studio, set LOCAL_AI_API=lmstudio so reasoning can be switched off.`,
        );
      }
      return {
        text,
        model: data.model ?? settings.model,
        inputTokens: data.usage?.prompt_tokens ?? null,
        outputTokens: data.usage?.completion_tokens ?? null,
      };
    },
  };
}
