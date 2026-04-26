"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ChevronDown, CircleDashed, Loader2, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCurrentSession } from "@/lib/store";
import { useElapsed } from "@/hooks/use-elapsed";
import { formatElapsed, formatTokens } from "@/lib/format";
import { NumberTicker } from "@/components/ui/number-ticker";

export function PlanPanel() {
  const session = useCurrentSession();
  const {
    tasks,
    sessionStartedAt,
    sessionEndedAt,
    sessionStatus,
    inputTokens,
    outputTokens,
  } = session;
  const [expanded, setExpanded] = React.useState(true);

  // Freeze the elapsed timer whenever the assistant is not actively
  // producing output — i.e. done, error, or waiting for user input.
  const frozenAt =
    sessionStatus === "done" || sessionStatus === "error" || sessionStatus === "waiting"
      ? sessionEndedAt
      : null;
  const elapsed = useElapsed(sessionStartedAt, frozenAt);
  const running = sessionStatus === "streaming" || sessionStatus === "starting";
  const current = tasks.find((t) => t.status === "in_progress");

  const statusLabel = current?.subject
    ?? (running
      ? "准备中…"
      : sessionStatus === "done"
      ? "任务完成"
      : sessionStatus === "waiting"
      ? "等待你的下一条消息"
      : sessionStatus === "error"
      ? "出错了"
      : "就绪");

  if (!sessionStartedAt) return null;

  return (
    <motion.div
      layout
      initial={{ y: -8, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className={cn(
        "sticky top-0 z-20 mx-auto w-full max-w-3xl px-6 pt-4"
      )}
    >
      <div
        className={cn(
          "group relative overflow-hidden rounded-2xl border border-border/60 bg-card/85 p-3 shadow-sm backdrop-blur-md",
          running && "border-primary/30"
        )}
      >
        {running && (
          <motion.div
            className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-primary to-transparent"
            animate={{ x: ["-100%", "100%"] }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          />
        )}

        <button
          onClick={() => setExpanded((e) => !e)}
          className="flex w-full items-center gap-3"
        >
          <div
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
              running ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
            )}
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
          </div>

          <div className="flex-1 text-left min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-semibold truncate">{statusLabel}</span>
              <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {formatElapsed(elapsed)}
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-3 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="text-muted-foreground/70">↑</span>
                <NumberTicker value={inputTokens} className="font-mono" />
                <span>in</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="text-muted-foreground/70">↓</span>
                <NumberTicker value={outputTokens} className="font-mono" />
                <span>out</span>
              </span>
              {tasks.length > 0 && (
                <span>
                  {tasks.filter((t) => t.status === "completed").length} / {tasks.length} 完成
                </span>
              )}
            </div>
          </div>

          {tasks.length > 0 && (
            <ChevronDown
              className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")}
            />
          )}
        </button>

        <AnimatePresence initial={false}>
          {expanded && tasks.length > 0 && (
            <motion.ul
              key="tasks"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="mt-3 space-y-1 overflow-hidden border-t border-border/40 pt-3"
            >
              {tasks.map((t) => (
                <TaskRow key={t.id} task={t} />
              ))}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function TaskRow({ task }: { task: { id: string; subject: string; status: string; startedAt?: number; completedAt?: number } }) {
  const elapsed = useElapsed(task.startedAt, task.status === "completed" ? task.completedAt : null);

  let icon: React.ReactNode;
  let textClass = "";
  if (task.status === "completed") {
    icon = (
      <div className="flex h-4 w-4 items-center justify-center rounded-[4px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
        <Check className="h-3 w-3" />
      </div>
    );
    textClass = "text-muted-foreground line-through decoration-muted-foreground/30";
  } else if (task.status === "in_progress") {
    icon = (
      <div className="flex h-4 w-4 items-center justify-center rounded-[4px] bg-primary/15 text-primary">
        <Loader2 className="h-3 w-3 animate-spin" />
      </div>
    );
    textClass = "text-foreground font-medium";
  } else {
    icon = <CircleDashed className="h-4 w-4 text-muted-foreground/60" />;
    textClass = "text-muted-foreground";
  }

  return (
    <motion.li layout className="flex items-center gap-2.5 rounded-md px-1 py-1 text-[11px]">
      {icon}
      <span className={cn("flex-1 truncate", textClass)}>{task.subject}</span>
      {task.startedAt && (
        <span className="tabular-nums font-mono text-[10px] text-muted-foreground">
          {formatElapsed(elapsed)}
        </span>
      )}
    </motion.li>
  );
}
