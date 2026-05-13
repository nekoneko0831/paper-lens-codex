"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Zap, BookOpen, Presentation, BookMarked } from "lucide-react";
import { cn } from "@/lib/utils";
import { Mode } from "@/lib/types";

const MODES: { id: Mode; label: string; icon: React.ElementType; desc: string }[] = [
  { id: "speed-read", label: "速览", icon: Zap, desc: "5 分钟消化核心" },
  { id: "paper-reading", label: "精读", icon: BookMarked, desc: "论文级精读文档" },
  { id: "deep-learn", label: "学习", icon: BookOpen, desc: "大白话深度理解" },
  { id: "present", label: "展示", icon: Presentation, desc: "准备 slides 讲解" },
];

interface Props {
  value: Mode | null;
  onChange: (mode: Mode) => void;
  disabled?: boolean;
}

export function ModeSwitcher({ value, onChange, disabled }: Props) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {MODES.map((m) => {
        const active = value === m.id;
        const Icon = m.icon;
        return (
          <button
            key={m.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(m.id)}
            className={cn(
              "group relative flex flex-col items-start gap-1 rounded-xl border border-border/60 bg-card/40 px-3 py-2.5 text-left transition-all",
              "hover:border-primary/40 hover:bg-card hover:shadow-sm",
              active && "border-primary/60 bg-primary/8 shadow-sm ring-1 ring-primary/20",
              disabled && "opacity-50 cursor-not-allowed"
            )}
          >
            {active && (
              <motion.div
                layoutId="mode-active"
                className="absolute inset-0 rounded-xl bg-primary/5"
                transition={{ type: "spring", duration: 0.35 }}
              />
            )}
            <div className="relative flex items-center gap-1.5">
              <Icon className={cn("h-3.5 w-3.5", active ? "text-primary" : "text-muted-foreground")} />
              <span className={cn("text-xs font-semibold", active && "text-primary")}>
                {m.label}
              </span>
            </div>
            <span className="relative text-[10px] text-muted-foreground leading-tight">{m.desc}</span>
          </button>
        );
      })}
    </div>
  );
}
