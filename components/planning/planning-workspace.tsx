"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { BookOpen, History, Loader2, MessageSquare, Package, Send, Sparkles, FileText } from "lucide-react";
import { CriticalityBadge, PriorityBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Mono } from "@/components/ui/primitives";
import { commitPlan } from "@/lib/actions";
import type { JobPlan, PlanningMessage } from "@/lib/planning/plan-schema";
import { streamPlanningTurn } from "@/lib/planning/stream-client";
import { cn } from "@/lib/utils";
import type { Criticality, Priority } from "@/types/domain";
import { PlanEditor, type CatalogItem } from "./plan-editor";

export interface PlanningWorkspaceProps {
  workOrder: {
    id: string;
    number: string;
    title: string;
    description: string;
    priority: Priority;
    requiresShutdown: boolean;
    asset: { id: string; floc: string; name: string; criticality: Criticality } | null;
  };
  context: { layer1: string[]; layer2: string[]; history: { number: string; title: string; floc: string }[]; related: string[]; stockItems: number };
  catalog: CatalogItem[];
  assistant: { mode: "live" | "demo"; model: string | null };
  suggestions: string[];
}

interface StoredSession {
  messages: PlanningMessage[];
  plan: JobPlan | null;
}

const storageKey = (woId: string) => `trestle:planning:${woId}`;

export function PlanningWorkspace({ workOrder, context, catalog, assistant, suggestions }: PlanningWorkspaceProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<PlanningMessage[]>([]);
  const [plan, setPlan] = useState<JobPlan | null>(null);
  const [planVersion, setPlanVersion] = useState(0);
  const [changedSeqs, setChangedSeqs] = useState<Set<number>>(new Set());
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<"chat" | "plan">("chat");
  const [committing, startCommit] = useTransition();
  const restored = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const planRef = useRef<JobPlan | null>(null);
  planRef.current = plan;

  // Resume an in-progress session (per browser tab), otherwise kick off a first draft.
  // Deferred a microtask so it runs after hydration, not during the effect body.
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    void Promise.resolve().then(() => {
      try {
        const saved = sessionStorage.getItem(storageKey(workOrder.id));
        const parsed = saved ? (JSON.parse(saved) as StoredSession) : null;
        if (parsed?.messages?.length) {
          setMessages(parsed.messages);
          setPlan(parsed.plan);
          return;
        }
      } catch {
        // Storage unavailable: start fresh.
      }
      void runTurn([]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      if (messages.length) sessionStorage.setItem(storageKey(workOrder.id), JSON.stringify({ messages, plan } satisfies StoredSession));
    } catch {
      // Non-critical.
    }
  }, [messages, plan, workOrder.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  async function runTurn(history: PlanningMessage[]) {
    setStreaming(true);
    setError(null);
    setStatus(assistant.mode === "live" ? "Reading the site context" : null);
    setMessages([...history, { role: "assistant", content: "" }]);
    let reply = "";

    await streamPlanningTurn({ woId: workOrder.id, history, currentPlan: planRef.current }, (event) => {
      switch (event.type) {
        case "text":
          reply += event.delta;
          setStatus(null);
          setMessages([...history, { role: "assistant", content: reply }]);
          break;
        case "status":
          setStatus(event.message);
          break;
        case "plan": {
          // Highlight steps added or reworded since the last version (none on the first draft).
          const previous = planRef.current;
          const before = new Set(previous?.tasks.map((t) => `${t.seq}:${t.description}`) ?? []);
          setChangedSeqs(
            previous
              ? new Set(event.plan.tasks.filter((t) => !before.has(`${t.seq}:${t.description}`)).map((t) => t.seq))
              : new Set(),
          );
          setPlan(event.plan);
          setPlanVersion((v) => v + 1);
          setStatus(null);
          break;
        }
        case "error":
          setError(event.message);
          break;
        case "done":
          break;
      }
    }).catch(() => setError("Lost the connection to the planning assistant. Your plan is unchanged."));

    if (!reply) setMessages(history.length ? history : []);
    setStreaming(false);
    setStatus(null);
  }

  function send(text: string) {
    const content = text.trim();
    if (!content || streaming) return;
    setDraft("");
    void runTurn([...messages.filter((m) => m.content), { role: "user", content }]);
  }

  function onCommit() {
    if (!plan) return;
    const openQs = plan.open_questions.length;
    if (openQs > 0 && !window.confirm(`${openQs} open question${openQs === 1 ? "" : "s"} on this plan. Commit anyway? They stay on the record.`)) return;
    startCommit(async () => {
      const result = await commitPlan(workOrder.id, plan);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      try {
        sessionStorage.removeItem(storageKey(workOrder.id));
      } catch {}
      router.push(`/work-orders/${workOrder.id}`);
    });
  }

  const asked = new Set(messages.filter((m) => m.role === "user").map((m) => m.content));
  const chips = suggestions.filter((s) => !asked.has(s));

  return (
    <div className="space-y-3">
      {/* Work order strip */}
      <div className="flex flex-col gap-3 rounded-[3px] border border-line bg-panel px-4 py-3 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-brass">
              <Sparkles className="size-3.5" aria-hidden /> Planning Mode
            </span>
            <Mono>{workOrder.number}</Mono>
            <PriorityBadge priority={workOrder.priority} compact />
            {workOrder.asset && <CriticalityBadge criticality={workOrder.asset.criticality} />}
          </div>
          <h1 className="mt-1 font-display text-2xl font-semibold leading-tight tracking-wide">{workOrder.title}</h1>
          {workOrder.asset && (
            <p className="text-xs text-tx-3">
              <span className="font-mono text-tx-2">{workOrder.asset.floc}</span> · {workOrder.asset.name}
            </p>
          )}
        </div>
        <ContextChips context={context} />
      </div>

      {/* Mobile tab switch */}
      <div className="grid grid-cols-2 gap-1 rounded-[3px] border border-line bg-panel p-1 lg:hidden">
        {(["chat", "plan"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setMobileTab(tab)}
            className={cn(
              "flex h-9 items-center justify-center gap-1.5 rounded-[2px] text-sm",
              mobileTab === tab ? "bg-panel-3 text-tx" : "text-tx-3",
            )}
          >
            {tab === "chat" ? <MessageSquare className="size-4" aria-hidden /> : <FileText className="size-4" aria-hidden />}
            {tab === "chat" ? "Assistant" : `Job plan${plan ? ` · ${plan.tasks.length} steps` : ""}`}
          </button>
        ))}
      </div>

      <div className="grid gap-3 lg:h-[calc(100dvh-13.5rem)] lg:min-h-[560px] lg:grid-cols-[minmax(340px,5fr)_7fr]">
        {/* Conversation */}
        <section
          className={cn(
            "flex min-h-[520px] flex-col rounded-[3px] border border-line bg-[#0d1722] lg:min-h-0",
            mobileTab !== "chat" && "hidden lg:flex",
          )}
          aria-label="Planning assistant"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-2">
            <span className="font-display text-sm font-semibold uppercase tracking-wide">Planning assistant</span>
            <span className="font-mono text-[10px] text-tx-3">
              {assistant.mode === "live" ? assistant.model : "scripted demo planner"}
            </span>
          </div>
          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {messages.map((m, i) => (
              <ChatMessage key={i} message={m} live={streaming && i === messages.length - 1 && m.role === "assistant"} />
            ))}
            {status && (
              <div className="flex items-center gap-2 text-xs text-brass">
                <Loader2 className="size-3.5 animate-spin" aria-hidden /> {status}…
              </div>
            )}
            {error && (
              <p role="alert" className="rounded-[3px] border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">
                {error}
              </p>
            )}
          </div>
          <div className="space-y-2 border-t border-line p-3">
            {chips.length > 0 && !streaming && (
              <div className="flex flex-wrap gap-1.5">
                {chips.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="rounded-[3px] border border-brass-dim/60 bg-brass/5 px-2.5 py-1.5 text-left text-xs text-brass-bright hover:border-brass hover:bg-brass/10"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(draft);
              }}
              className="flex gap-2"
            >
              <label htmlFor="planning-input" className="sr-only">
                Message the planning assistant
              </label>
              <textarea
                id="planning-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(draft);
                  }
                }}
                rows={2}
                placeholder="Ask about the job, give field findings, or tell it what to change…"
                className="min-h-11 flex-1 resize-none rounded-[3px] border border-line-strong bg-bg px-3 py-2 text-sm placeholder:text-tx-3 focus:border-brass focus:outline-none"
              />
              <Button type="submit" variant="primary" size="icon" className="h-auto w-11" disabled={streaming || !draft.trim()} aria-label="Send">
                <Send aria-hidden />
              </Button>
            </form>
          </div>
        </section>

        {/* Live job plan */}
        <section
          className={cn("min-h-[520px] lg:min-h-0", mobileTab !== "plan" && "hidden lg:block")}
          aria-label="Job plan"
        >
          <PlanEditor
            key={planVersion}
            plan={plan}
            onChange={setPlan}
            catalog={catalog}
            changedSeqs={changedSeqs}
            busy={streaming}
            committing={committing}
            onCommit={onCommit}
          />
        </section>
      </div>
    </div>
  );
}

function ChatMessage({ message, live }: { message: PlanningMessage; live: boolean }) {
  if (message.role === "user") {
    return (
      <div className="ml-8 rounded-[3px] border border-line-strong bg-panel-2 px-3 py-2 text-sm">
        <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-tx-3">Planner</div>
        <p className="whitespace-pre-line">{message.content}</p>
      </div>
    );
  }
  return (
    <div className="border-l-2 border-brass pl-3 text-sm">
      <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-brass">
        <Sparkles className="size-3" aria-hidden /> Assistant
      </div>
      <p className={cn("whitespace-pre-line leading-relaxed text-tx", live && "typing-caret")}>{message.content}</p>
    </div>
  );
}

function ContextChips({ context }: { context: PlanningWorkspaceProps["context"] }) {
  const items = [
    { icon: BookOpen, label: `L1 · ${context.layer1.length} standards`, title: context.layer1.join("\n") },
    { icon: BookOpen, label: `L2 · ${context.layer2.length} industry`, title: context.layer2.join("\n") },
    {
      icon: History,
      label: `L3 · ${context.history.length} past jobs`,
      title: context.history.map((h) => `${h.number} ${h.floc}: ${h.title}`).join("\n") || "No closed history on this train",
    },
    { icon: Package, label: `${context.stockItems} stock items`, title: "Live storeroom availability (on hand minus reserved)" },
  ];
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Context loaded">
      {items.map(({ icon: Icon, label, title }) => (
        <li
          key={label}
          title={title}
          className="inline-flex cursor-help items-center gap-1.5 rounded-[2px] border border-line-strong bg-panel-2 px-2 py-1 text-[11px] text-tx-2"
        >
          <Icon className="size-3 text-brass-dim" aria-hidden /> {label}
        </li>
      ))}
    </ul>
  );
}
