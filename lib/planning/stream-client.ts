import type { JobPlan, PlanningMessage, PlanningStreamEvent } from "./plan-schema";

/** Client side of the Planning Mode NDJSON stream. */
export async function streamPlanningTurn(
  body: { woId: string; history: PlanningMessage[]; currentPlan: JobPlan | null },
  onEvent: (event: PlanningStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch("/api/ai/planning", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok || !response.body) {
    const message = await response
      .json()
      .then((j: { error?: string }) => j.error)
      .catch(() => null);
    onEvent({ type: "error", message: message ?? `Request failed (${response.status})` });
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onEvent(JSON.parse(line) as PlanningStreamEvent);
    }
  }
}
