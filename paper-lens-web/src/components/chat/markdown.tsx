"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

interface MarkdownProps {
  children: string;
  className?: string;
  paperName?: string;
}

export function Markdown({ children, className, paperName }: MarkdownProps) {
  const imgComponent = React.useMemo(() => {
    if (!paperName) return undefined;
    return function Img({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) {
      const s = typeof src === "string" ? src : undefined;
      const resolvedSrc =
        s && !s.startsWith("http") && !s.startsWith("data:")
          ? api.fileUrl(paperName, s)
          : s;
      return (
        <img
          src={resolvedSrc}
          alt={alt}
          className="max-h-[55vh] rounded-md object-contain"
          {...props}
        />
      );
    };
  }, [paperName]);

  return (
    <div
      className={cn(
        "prose prose-sm max-w-none break-words",
        "prose-headings:font-heading prose-headings:font-semibold",
        "prose-p:leading-relaxed",
        "prose-code:bg-muted prose-code:text-foreground prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none",
        "prose-pre:bg-[#0d1117] prose-pre:text-[#e6edf3] prose-pre:border-none prose-pre:rounded-lg",
        "prose-a:text-primary prose-a:underline prose-a:underline-offset-2 hover:prose-a:text-primary/80",
        "prose-table:border prose-th:border prose-td:border prose-th:bg-muted/40 prose-th:px-2 prose-td:px-2",
        "dark:prose-invert",
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, rehypeKatex, rehypeHighlight]}
        components={imgComponent ? { img: imgComponent } : undefined}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
