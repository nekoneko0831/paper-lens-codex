"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { BookOpen, Sparkles, Zap } from "lucide-react";
import { BlurFade } from "@/components/ui/blur-fade";
import { cn } from "@/lib/utils";

export function EmptyState({ hasPaper }: { hasPaper: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-20">
      <BlurFade inView delay={0.1}>
        <motion.div
          animate={{ y: [0, -4, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          className="mb-6 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-primary/20 via-primary/10 to-transparent shadow-inner"
        >
          <Sparkles className="h-7 w-7 text-primary" />
        </motion.div>
      </BlurFade>

      <BlurFade inView delay={0.2}>
        <h1 className="text-3xl md:text-4xl font-heading font-semibold tracking-tight text-foreground/90">
          Ask anything.
        </h1>
      </BlurFade>

      <BlurFade inView delay={0.3}>
        <p className="mt-3 max-w-md text-center text-sm text-muted-foreground leading-relaxed">
          {hasPaper
            ? "关于这篇论文，想到什么问什么 —— 或选一种阅读模式开始"
            : "左侧添加一篇 PDF 或粘贴 arXiv 链接，随时开始"}
        </p>
      </BlurFade>

      <BlurFade inView delay={0.4}>
        <div className="mt-12 grid max-w-2xl grid-cols-1 gap-3 md:grid-cols-3">
          <Tile
            icon={Zap}
            title="速览"
            desc="5 分钟消化核心，快速判断是否值得深读"
          />
          <Tile
            icon={BookOpen}
            title="学习"
            desc="大白话深度理解，适合真正想搞懂的场景"
          />
          <Tile
            icon={Sparkles}
            title="展示"
            desc="生成带图的 slides，准备讲解或汇报"
          />
        </div>
      </BlurFade>

      <BlurFade inView delay={0.5}>
        <p className="mt-6 text-center text-[11px] text-muted-foreground/70">
          选择下方模式按钮开始，或直接在输入框提问
        </p>
      </BlurFade>
    </div>
  );
}

function Tile({
  icon: Icon,
  title,
  desc,
}: {
  icon: React.ElementType;
  title: string;
  desc: string;
}) {
  // Pure descriptive card — no hover / pointer interaction so users don't
  // confuse it with a clickable button. Mode buttons are in the bottom bar.
  return (
    <div
      className={cn(
        "pointer-events-none relative rounded-2xl border border-border/40 bg-card/30 px-4 py-3.5",
        "select-none"
      )}
    >
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className="h-3 w-3" />
        </div>
        <div className="text-xs font-medium text-foreground/90">{title}</div>
      </div>
      <div className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
        {desc}
      </div>
    </div>
  );
}
