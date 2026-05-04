"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Check, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { QuestionMessage } from "@/lib/types";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import { toast } from "sonner";

export function QuestionCard({ message }: { message: QuestionMessage }) {
  const currentPaper = useStore((s) => s.currentPaper);
  const sessionId = useStore((s) =>
    s.currentPaper ? s.sessions[s.currentPaper]?.sessionId ?? null : null
  );
  const pushUser = useStore((s) => s.pushUserMessage);
  const answerQuestion = useStore((s) => s.answerQuestion);

  const [selections, setSelections] = React.useState<Record<string, string[]>>(() => {
    const init: Record<string, string[]> = {};
    message.questions.forEach((q) => (init[questionKey(q)] = []));
    return init;
  });
  const [customInput, setCustomInput] = React.useState<Record<string, string>>({});
  const [submitting, setSubmitting] = React.useState(false);

  function toggle(q: string, option: string, multi: boolean) {
    setSelections((s) => {
      const cur = s[q] ?? [];
      if (multi) {
        return { ...s, [q]: cur.includes(option) ? cur.filter((o) => o !== option) : [...cur, option] };
      }
      return { ...s, [q]: cur[0] === option ? [] : [option] };
    });
  }

  async function submit() {
    if (!sessionId || !currentPaper) return;
    const payload: Record<string, string | string[]> = {};
    message.questions.forEach((q) => {
      const key = questionKey(q);
      const sel = [...(selections[key] ?? [])];
      const custom = (customInput[key] ?? "").trim();
      if (custom) sel.push(custom);
      payload[key] = q.multiSelect === false ? sel[0] ?? "" : sel;
    });
    setSubmitting(true);
    try {
      await api.sendAnswer(sessionId, payload);
      const summary = message.questions
        .map((q) => {
          const key = questionKey(q);
          const v = payload[key];
          return `${q.question}: ${Array.isArray(v) ? v.join(", ") : v}`;
        })
        .join("\n");
      pushUser(currentPaper, summary);
      answerQuestion(currentPaper, message.id);
    } catch (e) {
      toast.error("提交失败", { description: String(e) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <motion.div
      layout
      className={cn(
        "rounded-xl border border-primary/30 bg-gradient-to-br from-primary/5 via-card to-card p-3 shadow-sm",
        message.answered && "opacity-60"
      )}
    >
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-primary">
        <HelpCircle className="h-3 w-3" />
        需要你的确认
      </div>

      {message.questions.map((q, qi) => (
        <div key={qi} className={cn(qi > 0 && "mt-3 border-t border-border/50 pt-3")}>
          <div className="text-[13px] font-medium leading-snug [overflow-wrap:anywhere]">{q.question}</div>
          {q.header && (
            <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              {q.header}
            </div>
          )}

          <div className="mt-2 grid gap-1">
            {(q.options ?? []).map((opt, oi) => {
              const key = questionKey(q);
              const selected = (selections[key] ?? []).includes(opt.label);
              return (
                <button
                  key={oi}
                  disabled={message.answered || submitting}
                  onClick={() => toggle(key, opt.label, q.multiSelect !== false)}
                  className={cn(
                    "group flex items-start gap-2 rounded-lg border border-border/60 bg-background/50 px-2.5 py-1.5 text-left transition-all",
                    "hover:border-primary/40 hover:bg-background/80",
                    selected && "border-primary/60 bg-primary/5 ring-1 ring-primary/20"
                  )}
                >
                  <div
                    className={cn(
                      "mt-[3px] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border",
                      selected ? "border-primary bg-primary text-primary-foreground" : "border-border"
                    )}
                  >
                    {selected && <Check className="h-2.5 w-2.5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-medium leading-tight [overflow-wrap:anywhere]">{opt.label}</div>
                    <div className="mt-0.5 text-[10.5px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">
                      {opt.description}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <Input
            value={customInput[questionKey(q)] ?? ""}
            onChange={(e) => setCustomInput({ ...customInput, [questionKey(q)]: e.target.value })}
            placeholder="其他（可自定义输入）"
            disabled={message.answered || submitting}
            className="mt-1.5 h-7 text-[11px]"
          />
        </div>
      ))}

      <div className="mt-3 flex justify-end">
        <Button
          onClick={submit}
          disabled={message.answered || submitting}
          size="sm"
          className="h-7 text-[11px]"
        >
          {submitting ? "提交中…" : "提交"}
        </Button>
      </div>
    </motion.div>
  );
}

function questionKey(q: QuestionMessage["questions"][number]): string {
  return q.id || q.header || q.question;
}
