"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { useElapsed } from "@/hooks/use-elapsed";
import { formatElapsed } from "@/lib/format";

interface Props {
  startAt: number;
  endAt?: number | null;
  className?: string;
  showTimeout?: boolean;
  timeoutMs?: number;
}

export function ElapsedTimer({ startAt, endAt, className, showTimeout, timeoutMs = 300_000 }: Props) {
  const elapsed = useElapsed(startAt, endAt);
  return (
    <span className={cn("tabular-nums font-mono text-[11px] text-muted-foreground", className)}>
      {formatElapsed(elapsed)}
      {showTimeout && !endAt && ` · timeout ${formatElapsed(timeoutMs)}`}
    </span>
  );
}
