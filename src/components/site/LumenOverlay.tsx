import { useState, useRef, useEffect, type ReactNode } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import {
  X,
  Send,
  Search,
  Lightbulb,
  Package,
  ArrowRight,
  Check,
  Cpu,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { LumenMascot } from "./LumenMascot";
import { WalletBalance } from "./WalletBalance";
import { brokerChat, createRent } from "@/lib/broker/server-fns";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Provider } from "@services/domain";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

type Role = "user" | "lumen";

interface BaseMsg {
  id: string;
  role: Role;
}

interface TextMsg extends BaseMsg {
  role: "user" | "lumen";
  kind: "text";
  text: string;
}

interface ConfirmMsg extends BaseMsg {
  role: "lumen";
  kind: "confirm";
  title: string;
  details: { label: string; value: string }[];
  cta: string;
  provider: Provider;
}

type Msg = TextMsg | ConfirmMsg;

/* -------------------------------------------------------------------------- */
/* Quick actions                                                              */
/* -------------------------------------------------------------------------- */

const quickActions = [
  { icon: Search, label: "Find me a GPU provider" },
  { icon: Lightbulb, label: "What can Lumen do?" },
  { icon: Package, label: "Check my active orders" },
] as const;

/* -------------------------------------------------------------------------- */
/* Main overlay component                                                     */
/* -------------------------------------------------------------------------- */

export function LumenOverlay({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [messages, setMessages] = useState<Msg[]>([
    {
      id: "intro",
      role: "lumen",
      kind: "text",
      text: "Hi there! 👋\nI'm Lumen — your AI assistant for prime compute.",
    },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const appendLumen = (text: string) =>
    setMessages((m) => [...m, { id: cryptoId(), role: "lumen", kind: "text", text }]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, thinking]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;

    const userMsg: TextMsg = { id: cryptoId(), role: "user", kind: "text", text: trimmed };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setThinking(true);

    try {
      const { data: sess } = await supabaseBrowser.auth.getSession();
      const result = await brokerChat({
        data: { accessToken: sess.session?.access_token, message: trimmed },
      });

      if (result.action === "recommend_provider" && result.provider) {
        const p = result.provider;
        const gpu = p.specs.gpu as string | undefined;
        const vramGb = p.specs.vramGb as number | undefined;
        const hardware = gpu ? `${gpu}${vramGb ? ` · ${vramGb}GB VRAM` : ""}` : p.resourceType;
        setMessages((m) => [
          ...m,
          { id: cryptoId(), role: "lumen", kind: "text", text: result.reply },
          {
            id: cryptoId(),
            role: "lumen",
            kind: "confirm",
            title: `Rent from ${p.alias}?`,
            details: [
              { label: "Provider", value: p.alias },
              { label: "Hardware", value: hardware },
              { label: "Rate", value: `$${p.pricePerCharge.toFixed(7)}/s` },
              { label: "Compute Score", value: `${p.computeScore} / 100` },
              { label: "Region", value: p.region },
            ],
            cta: "Confirm & queue rent",
            provider: p,
          },
        ]);
      } else {
        setMessages((m) => [...m, { id: cryptoId(), role: "lumen", kind: "text", text: result.reply }]);
      }
    } catch {
      setMessages((m) => [
        ...m,
        { id: cryptoId(), role: "lumen", kind: "text", text: "Something went wrong reaching the broker. Try again in a moment." },
      ]);
    } finally {
      setThinking(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-opacity duration-200",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />

      {/* Centered modal */}
      <div
        className={cn(
          "fixed inset-0 z-50 flex items-center justify-center p-4 transition-opacity duration-200",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        aria-hidden={!open}
      >
        <aside
          className={cn(
            "flex h-[85vh] max-h-[640px] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl transition-all duration-200",
            open ? "scale-100 opacity-100" : "scale-95 opacity-0",
          )}
          role="dialog"
          aria-label="Lumen AI assistant"
          aria-hidden={!open}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 ring-1 ring-primary/30">
                <LumenMascot className="h-6 w-6" />
              </span>
              <div>
                <div className="text-sm font-semibold text-white">Lumen</div>
                <div className="text-[10px] text-white/50">AI broker</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <WalletBalance className="text-white/80" />
              <button
                onClick={() => onOpenChange(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-white/60 hover:text-white hover:bg-white/5"
                aria-label="Close Lumen"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {messages.map((m) => (
              <MessageBubble key={m.id} msg={m} onQueued={appendLumen} />
            ))}
            {thinking && (
              <div className="flex items-center gap-2 text-xs text-white/50">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/15">
                  <LumenMascot className="h-4 w-4" />
                </span>
                <span className="flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/40 [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/40 [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/40" />
                </span>
              </div>
            )}
          </div>

          {/* Quick actions + input */}
          <div className="border-t border-border/60 p-3 space-y-3">
            {messages.length <= 1 && (
              <div className="space-y-2">
                <div className="text-[10px] uppercase tracking-[0.15em] text-white/40">
                  Quick actions
                </div>
                <div className="grid gap-2">
                  {quickActions.map((a) => (
                    <button
                      key={a.label}
                      onClick={() => send(a.label)}
                      className="flex items-center gap-3 rounded-lg border border-border bg-card/60 px-3 py-2.5 text-left text-sm text-white/80 transition hover:border-primary/40 hover:bg-primary/5"
                    >
                      <a.icon className="h-4 w-4 text-glow" />
                      <span>{a.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
              className="flex items-center gap-2"
            >
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type what you need…"
                className="flex-1 bg-card border-border"
              />
              <Button
                type="submit"
                size="icon"
                className="bg-primary text-primary-foreground hover:bg-primary/90"
                aria-label="Send"
              >
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </aside>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Message bubble                                                             */
/* -------------------------------------------------------------------------- */

function MessageBubble({ msg, onQueued }: { msg: Msg; onQueued: (text: string) => void }) {
  if (msg.kind === "confirm") {
    return <ConfirmCard msg={msg} onQueued={onQueued} />;
  }

  const isUser = msg.role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-line",
          isUser
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-card text-card-foreground rounded-bl-sm border border-border/60",
        )}
      >
        {msg.text}
      </div>
    </div>
  );
}

function ConfirmCard({ msg, onQueued }: { msg: ConfirmMsg; onQueued: (text: string) => void }) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    const { data: sess } = await supabaseBrowser.auth.getSession();
    if (!sess.session) {
      router.navigate({ to: "/onboarding", search: { redirect: router.state.location.pathname } });
      return;
    }
    setBusy(true);
    try {
      const p = msg.provider;
      await createRent({
        data: {
          accessToken: sess.session.access_token,
          name: `lumen-${p.alias}`,
          spec: { resourceType: p.resourceType, region: p.region },
          estimatedUsage: null,
        },
      });
      setConfirmed(true);
      onQueued("Rent queued. The broker will match it when it processes the queue — track it on the Dashboard.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] w-full rounded-2xl rounded-bl-sm border border-primary/30 bg-card overflow-hidden">
        <div className="flex items-center gap-2 bg-primary/10 px-4 py-2.5 border-b border-primary/20">
          <Zap className="h-4 w-4 text-glow" />
          <span className="text-sm font-medium text-white">{msg.title}</span>
        </div>
        <div className="px-4 py-3 space-y-2">
          {msg.details.map((d) => (
            <div key={d.label} className="flex items-center justify-between text-xs">
              <span className="text-white/50">{d.label}</span>
              <span className="text-white font-mono">{d.value}</span>
            </div>
          ))}
        </div>
        <div className="px-4 pb-3">
          {confirmed ? (
            <div className="flex items-center justify-center gap-2 rounded-lg bg-success/15 py-2.5 text-sm text-success">
              <Check className="h-4 w-4" /> Rent queued
            </div>
          ) : (
            <Button
              onClick={confirm}
              disabled={busy}
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {msg.cta} <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Floating action button                                                     */
/* -------------------------------------------------------------------------- */

export function LumenFab({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-20 right-4 z-30 md:bottom-6 md:right-6 inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:scale-105 active:scale-95"
      aria-label="Open Lumen AI assistant"
    >
      <LumenMascot className="h-7 w-7" />
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Sidebar entry (rendered inside the existing Sidebar nav)                   */
/* -------------------------------------------------------------------------- */

export function LumenSidebarEntry({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/60 transition hover:text-sidebar-foreground hover:bg-white/5"
    >
      <LumenMascot className="h-4 w-4 shrink-0" />
      <span>Lumen</span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Utils                                                                      */
/* -------------------------------------------------------------------------- */

function cryptoId(): string {
  return Math.random().toString(36).slice(2, 10);
}
