"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Palette, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { THEMES, ThemeName } from "./theme-provider";

const THEME_META: Record<ThemeName, { label: string; group: string; sub: string; swatch: string[] }> = {
  "warm-light": {
    label: "Claude 暖色",
    group: "Claude Warm",
    sub: "明亮模式",
    swatch: ["#FAF6F1", "#D97706", "#1C1917"],
  },
  "warm-dark": {
    label: "Claude 暖色",
    group: "Claude Warm",
    sub: "夜间模式",
    swatch: ["#1C1917", "#F59E0B", "#FAF6F1"],
  },
  "paper-light": {
    label: "Notion 纸感",
    group: "Paper Notion",
    sub: "明亮模式",
    swatch: ["#FBFAF7", "#334155", "#0F172A"],
  },
  "paper-dark": {
    label: "Notion 纸感",
    group: "Paper Notion",
    sub: "夜间模式",
    swatch: ["#0F0F0E", "#CBD5E1", "#FBFAF7"],
  },
};

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" className="relative" aria-label="切换主题" />
        }
      >
        <Palette className="h-[1.1rem] w-[1.1rem]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs text-muted-foreground">主题风格</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {THEMES.map((t) => {
          const meta = THEME_META[t];
          const selected = mounted && theme === t;
          return (
            <DropdownMenuItem
              key={t}
              onClick={() => setTheme(t)}
              className="flex items-center gap-3 py-2"
            >
              <div className="flex h-6 w-10 overflow-hidden rounded-md border border-border/60 shadow-sm">
                {meta.swatch.map((c, i) => (
                  <div key={i} style={{ background: c }} className="flex-1" />
                ))}
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium leading-tight">{meta.group}</div>
                <div className="text-[11px] text-muted-foreground">{meta.sub}</div>
              </div>
              {selected && <Check className="h-4 w-4 text-primary" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
