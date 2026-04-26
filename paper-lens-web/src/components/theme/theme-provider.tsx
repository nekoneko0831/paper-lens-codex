"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

export const THEMES = [
  "warm-light",
  "warm-dark",
  "paper-light",
  "paper-dark",
] as const;

export type ThemeName = (typeof THEMES)[number];

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="warm-light"
      themes={[...THEMES]}
      enableSystem={false}
      disableTransitionOnChange={false}
    >
      {children}
    </NextThemesProvider>
  );
}
