"use client";

import * as React from "react";
import { ArrowUp, Loader2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  busy?: boolean;
  placeholder?: string;
  onStop?: () => void;
}

export function ChatInput({ value, onChange, onSubmit, busy, placeholder, onStop }: Props) {
  const ref = React.useRef<HTMLTextAreaElement>(null);

  // useLayoutEffect runs synchronously before paint so the initial height
  // is correct on first render (avoids brief "huge textarea" flash).
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const h = Math.min(Math.max(el.scrollHeight, 36), 200);
    el.style.height = `${h}px`;
  }, [value]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (value.trim() && !busy) onSubmit();
    }
  }

  return (
    <div
      className={cn(
        "group relative flex items-end gap-2 rounded-2xl border border-border/70 bg-card/80 px-3 py-1.5 shadow-sm backdrop-blur",
        "focus-within:border-primary/50 focus-within:shadow-md focus-within:ring-1 focus-within:ring-primary/20",
        "transition-all"
      )}
    >
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? "告诉我论文路径、arXiv 链接，或直接提问…"}
        rows={1}
        style={{ height: "36px" }}
        className={cn(
          "flex-1 resize-none border-0 bg-transparent py-1.5 text-sm leading-[1.5] outline-none placeholder:text-muted-foreground/70",
          "min-h-[36px] max-h-[200px] [field-sizing:content]"
        )}
      />
      {busy && onStop ? (
        <Button size="icon" variant="ghost" onClick={onStop} className="h-8 w-8 shrink-0 rounded-lg">
          <Square className="h-3.5 w-3.5 fill-current" />
        </Button>
      ) : (
        <Button
          size="icon"
          onClick={onSubmit}
          disabled={!value.trim() || busy}
          className="h-8 w-8 shrink-0 rounded-lg shadow-sm"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
        </Button>
      )}
    </div>
  );
}
