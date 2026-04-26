"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText,
  Pencil,
  FilePlus,
  Terminal,
  Search,
  Globe,
  Cog,
  ChevronRight,
  Check,
  X,
  Loader2,
  FolderSearch,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ToolMessage } from "@/lib/types";
import { ElapsedTimer } from "./elapsed-timer";

interface Props {
  message: ToolMessage;
}

const ICON_MAP: Record<string, { icon: React.ElementType; tint: string; label: string }> = {
  Read: { icon: FileText, tint: "text-sky-600 dark:text-sky-400 bg-sky-500/10", label: "Read" },
  Write: { icon: FilePlus, tint: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10", label: "Write" },
  Edit: { icon: Pencil, tint: "text-amber-600 dark:text-amber-400 bg-amber-500/10", label: "Edit" },
  Bash: { icon: Terminal, tint: "text-fuchsia-600 dark:text-fuchsia-400 bg-fuchsia-500/10", label: "Bash" },
  Grep: { icon: Search, tint: "text-indigo-600 dark:text-indigo-400 bg-indigo-500/10", label: "Grep" },
  Glob: { icon: FolderSearch, tint: "text-indigo-600 dark:text-indigo-400 bg-indigo-500/10", label: "Glob" },
  WebSearch: { icon: Globe, tint: "text-violet-600 dark:text-violet-400 bg-violet-500/10", label: "WebSearch" },
  WebFetch: { icon: Globe, tint: "text-violet-600 dark:text-violet-400 bg-violet-500/10", label: "WebFetch" },
  Skill: { icon: Sparkles, tint: "text-orange-600 dark:text-orange-400 bg-orange-500/10", label: "Skill" },
  Agent: { icon: Sparkles, tint: "text-pink-600 dark:text-pink-400 bg-pink-500/10", label: "Agent" },
};

function getMeta(tool: string) {
  return ICON_MAP[tool] ?? { icon: Cog, tint: "text-muted-foreground bg-muted", label: tool };
}

function getSummary(msg: ToolMessage): React.ReactNode {
  const { toolName, input } = msg;
  if (!input) return null;
  switch (toolName) {
    case "Read":
    case "Write":
    case "Edit": {
      const path = (input.file_path as string) ?? "";
      return <span className="font-mono text-[11px] truncate">{path.split("/").slice(-3).join("/")}</span>;
    }
    case "Bash": {
      const cmd = (input.command as string) ?? "";
      return <span className="font-mono text-[11px] truncate">{cmd.slice(0, 80)}</span>;
    }
    case "Grep":
    case "Glob": {
      const pat = (input.pattern as string) ?? "";
      return <span className="font-mono text-[11px] truncate">{pat}</span>;
    }
    case "WebSearch": {
      const q = (input.query as string) ?? "";
      return <span className="text-[11px] truncate">{q}</span>;
    }
    case "WebFetch": {
      const url = (input.url as string) ?? "";
      return <span className="font-mono text-[11px] truncate">{url}</span>;
    }
    case "Skill": {
      const name = (input.skill as string) ?? "";
      return <span className="text-[11px]">{name}</span>;
    }
    default:
      return <span className="text-[11px] text-muted-foreground">…</span>;
  }
}

export function ToolCard({ message }: Props) {
  const [open, setOpen] = React.useState(false);
  const meta = getMeta(message.toolName);
  const Icon = meta.icon;
  const running = message.status === "running";
  const ok = message.status === "success";
  const err = message.status === "error";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "group relative my-2 overflow-hidden rounded-xl border bg-card/70 backdrop-blur transition-all",
        running && "border-primary/30 shadow-[0_0_0_1px_var(--color-primary)]/5",
        ok && "border-border/60 hover:border-border",
        err && "border-destructive/40 bg-destructive/5"
      )}
    >
      {/* Left ribbon */}
      <div
        className={cn(
          "absolute inset-y-0 left-0 w-[3px]",
          running && "bg-primary ribbon-running",
          ok && "bg-emerald-500/60",
          err && "bg-destructive"
        )}
      />

      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 pl-3 pr-3 py-2 text-left"
      >
        <div className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-md", meta.tint)}>
          <Icon className="h-3.5 w-3.5" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold">{meta.label}</span>
            <div className="flex-1 min-w-0 truncate text-muted-foreground">{getSummary(message)}</div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 text-muted-foreground">
          <ElapsedTimer startAt={message.startedAt} endAt={message.endedAt} />
          {running && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
          {ok && <Check className="h-3 w-3 text-emerald-500" />}
          {err && <X className="h-3 w-3 text-destructive" />}
          <ChevronRight className={cn("h-3 w-3 transition-transform", open && "rotate-90")} />
        </div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="border-t border-border/50 bg-background/30 px-4 py-3 space-y-3">
              {message.input && Object.keys(message.input).length > 0 && (
                <DetailBlock title="Input">
                  <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
                    {JSON.stringify(message.input, null, 2)}
                  </pre>
                </DetailBlock>
              )}
              {message.result && (
                <DetailBlock title={err ? "Error" : "Result"}>
                  <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
                    {message.result.length > 4000
                      ? message.result.slice(0, 4000) + "\n… (truncated)"
                      : message.result}
                  </pre>
                </DetailBlock>
              )}
              {running && !message.result && (
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  执行中…
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function DetailBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}
