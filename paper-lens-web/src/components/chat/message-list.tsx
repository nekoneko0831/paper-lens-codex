"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { User, Bot, Brain, FilePlus2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useStore, useCurrentSession } from "@/lib/store";
import { Markdown } from "./markdown";
import { ToolCard } from "./tool-card";
import { QuestionCard } from "./question-card";
import { Message } from "@/lib/types";
import { AnimatedShinyText } from "@/components/ui/animated-shiny-text";
import { BlurFade } from "@/components/ui/blur-fade";

export function MessageList() {
  const messages = useCurrentSession().messages;
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Auto scroll
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-6">
        <div className="space-y-4">
          <AnimatePresence initial={false}>
            {messages.map((m) => (
              <MessageBlock key={m.id} message={m} />
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function MessageBlock({ message }: { message: Message }) {
  switch (message.kind) {
    case "user":
      return (
        <BlurFade inView delay={0.02}>
          <div className="flex justify-end">
            <div className="flex max-w-[85%] items-start gap-2">
              <div className="rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground shadow-sm">
                {message.text}
              </div>
              <Avatar kind="user" />
            </div>
          </div>
        </BlurFade>
      );

    case "assistant-text":
      return (
        <BlurFade inView delay={0.02}>
          <div className="flex items-start gap-3">
            <Avatar kind="assistant" />
            <div className="flex-1 min-w-0 pt-0.5">
              {message.streaming && !message.text ? (
                <AnimatedShinyText className="text-sm text-muted-foreground">
                  正在思考…
                </AnimatedShinyText>
              ) : (
                <Markdown>{message.text}</Markdown>
              )}
            </div>
          </div>
        </BlurFade>
      );

    case "thinking":
      return (
        <BlurFade inView delay={0.02}>
          <div className="flex items-start gap-3 opacity-70">
            <Avatar kind="thinking" />
            <div className="flex-1 min-w-0 pt-0.5">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                Thinking
              </div>
              <div className="text-xs italic text-muted-foreground leading-relaxed whitespace-pre-wrap">
                {message.text}
              </div>
            </div>
          </div>
        </BlurFade>
      );

    case "tool":
      return (
        <div className="flex items-start gap-3">
          <div className="w-7" />
          <div className="flex-1 min-w-0">
            <ToolCard message={message} />
          </div>
        </div>
      );

    case "question":
      return (
        <BlurFade inView delay={0.02}>
          <div className="flex items-start gap-3">
            <Avatar kind="assistant" />
            <div className="flex-1 min-w-0">
              <QuestionCard message={message} />
            </div>
          </div>
        </BlurFade>
      );

    case "file-saved":
      return (
        <motion.div
          layout
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-3"
        >
          <div className="w-7" />
          <div className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/5 px-3 py-1 text-[11px] text-emerald-700 dark:text-emerald-400">
            <FilePlus2 className="h-3 w-3" />
            <span>已保存</span>
            <span className="font-mono">{message.path.split("/").slice(-2).join("/")}</span>
          </div>
        </motion.div>
      );

    case "error":
      return (
        <div className="flex items-start gap-3">
          <div className="w-7" />
          <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
            {message.text}
          </div>
        </div>
      );
  }
}

function Avatar({ kind }: { kind: "user" | "assistant" | "thinking" }) {
  const common = "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg shadow-sm";
  if (kind === "user")
    return (
      <div className={cn(common, "bg-secondary text-secondary-foreground")}>
        <User className="h-3.5 w-3.5" />
      </div>
    );
  if (kind === "thinking")
    return (
      <div className={cn(common, "bg-muted text-muted-foreground")}>
        <Brain className="h-3.5 w-3.5" />
      </div>
    );
  return (
    <div className={cn(common, "bg-gradient-to-br from-primary to-primary/70 text-primary-foreground")}>
      <Bot className="h-3.5 w-3.5" />
    </div>
  );
}
