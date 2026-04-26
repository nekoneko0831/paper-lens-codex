"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import {
  FileText,
  Folder,
  RefreshCw,
  Loader2,
  Maximize2,
  Minimize2,
  ExternalLink,
  FilePlus,
  Pencil,
  Save,
  X,
  Columns2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useStore, useCurrentSession } from "@/lib/store";
import { api } from "@/lib/api";
import { Markdown } from "@/components/chat/markdown";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { toast } from "sonner";

// MDEditor is client-only; dynamic import avoids SSR errors.
const MDEditor = dynamic(
  () => import("@uiw/react-md-editor").then((m) => m.default),
  { ssr: false }
);

const CANONICAL = new Set([
  "speed-read.md",
  "deep-learn.md",
  "slides-content.md",
  "extracted-text.md",
]);

export function FilePreview() {
  const paper = useStore((s) => s.previewPaper);
  const tabs = useStore((s) => s.previewTabs);
  const activeTab = useStore((s) => s.activeTab);
  const splitTab = useStore((s) => s.splitTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const setSplitTab = useStore((s) => s.setSplitTab);
  const setPreviewTabs = useStore((s) => s.setPreviewTabs);

  const [loading, setLoading] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = React.useState(false);

  const loadFiles = React.useCallback(async () => {
    if (!paper) return;
    setLoading(true);
    try {
      const detail = await api.getPaperDetail(paper);
      const preferredOrder = [
        "deep-learn.md",
        "speed-read.md",
        "slides-content.md",
        "slides-content.html",
        "paper.pdf",
      ];
      const files = detail.files
        .filter((f) => f.is_markdown || f.is_html || f.is_pdf)
        .map((f) => f.name)
        .sort((a, b) => {
          const ai = preferredOrder.indexOf(a);
          const bi = preferredOrder.indexOf(b);
          if (ai !== -1 && bi !== -1) return ai - bi;
          if (ai !== -1) return -1;
          if (bi !== -1) return 1;
          if (a.startsWith("notes-") && !b.startsWith("notes-")) return -1;
          if (!a.startsWith("notes-") && b.startsWith("notes-")) return 1;
          return a.localeCompare(b);
        });
      setPreviewTabs(files);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [paper, setPreviewTabs]);

  React.useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  // Refresh tabs when file_saved events land in the current session
  const session = useCurrentSession();
  const lastFileSavedAt =
    session.messages.filter((m) => m.kind === "file-saved").slice(-1)[0]?.createdAt ?? 0;
  React.useEffect(() => {
    if (lastFileSavedAt) loadFiles();
  }, [lastFileSavedAt, loadFiles]);

  // Fullscreen lifecycle
  React.useEffect(() => {
    const h = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, []);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (rootRef.current) {
        await rootRef.current.requestFullscreen();
      }
    } catch (e) {
      toast.error("全屏失败", { description: String(e) });
    }
  }

  async function handleCreateNote() {
    if (!paper) return;
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    const fname = `notes-${stamp}.md`;
    const initial = `# 笔记 · ${now.toLocaleString("zh-CN")}\n\n`;
    try {
      await api.saveFile(paper, fname, initial);
      toast.success(`已创建 ${fname}`);
      await loadFiles();
      // Open the new notes in the SPLIT pane by default, so the user can
      // read + take notes side by side without extra clicks.
      if (!splitTab) {
        setSplitTab(fname);
      } else {
        setActiveTab(fname);
      }
    } catch (e) {
      toast.error("创建笔记失败", { description: String(e) });
    }
  }

  if (!paper) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        选择一篇论文开始
      </div>
    );
  }

  const activeIsHtml =
    activeTab != null && activeTab.toLowerCase().endsWith(".html");
  const activeIsPdf =
    activeTab != null && activeTab.toLowerCase().endsWith(".pdf");

  return (
    <div
      ref={rootRef}
      className={cn(
        "flex h-full min-w-0 flex-col bg-background/40",
        isFullscreen && "bg-background"
      )}
    >
      {/* Header */}
      <div className="flex min-w-0 shrink-0 items-center gap-2 border-b border-border/60 bg-card/50 px-3 py-2 backdrop-blur">
        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate whitespace-nowrap text-xs font-semibold">
          {paper}
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          <IconBtn
            label="刷新"
            onClick={() => loadFiles()}
            icon={loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          />
          <IconBtn
            label="新建笔记"
            onClick={handleCreateNote}
            icon={<FilePlus className="h-3.5 w-3.5" />}
          />
          {(activeIsHtml || activeIsPdf) && paper && activeTab && (
            <IconBtn
              label="在新标签打开"
              onClick={() => window.open(api.fileUrl(paper, activeTab), "_blank")}
              icon={<ExternalLink className="h-3.5 w-3.5" />}
            />
          )}
          <IconBtn
            label={isFullscreen ? "退出全屏" : "全屏"}
            onClick={toggleFullscreen}
            icon={isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          />
          <IconBtn
            label="在 Finder 中打开"
            onClick={async () => {
              try {
                await api.openExternal(paper, "", "finder");
              } catch (e) {
                toast.error("无法打开 Finder", { description: String(e) });
              }
            }}
            icon={<Folder className="h-3.5 w-3.5" />}
          />
        </div>
      </div>

      {/* Tabs with split-pane icon */}
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border/60 bg-muted/30 px-2 py-1.5">
        {tabs.length === 0 && (
          <span className="px-2 py-1 text-[11px] text-muted-foreground">暂无可预览文件</span>
        )}
        {tabs.map((t) => (
          <TabButton
            key={t}
            file={t}
            active={activeTab === t}
            pinnedRight={splitTab === t}
            onClick={() => setActiveTab(t)}
            onSplit={() => setSplitTab(t)}
          />
        ))}
      </div>

      {/* Content — split view when splitTab is set */}
      <div className="min-h-0 flex-1">
        {activeTab && paper ? (
          splitTab ? (
            <ResizablePanelGroup orientation="horizontal">
              <ResizablePanel id="pane-primary" defaultSize="60%" minSize="25%">
                <FilePane paper={paper} file={activeTab} onReloadFiles={loadFiles} />
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel id="pane-secondary" defaultSize="40%" minSize="25%">
                <FilePane
                  paper={paper}
                  file={splitTab}
                  onReloadFiles={loadFiles}
                  onClose={() => setSplitTab(null)}
                />
              </ResizablePanel>
            </ResizablePanelGroup>
          ) : (
            <FilePane paper={paper} file={activeTab} onReloadFiles={loadFiles} />
          )
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            选择上方 tab
          </div>
        )}
      </div>
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  icon,
}: {
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onClick}
            aria-label={label}
          />
        }
      >
        {icon}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function TabButton({
  file,
  active,
  pinnedRight,
  onClick,
  onSplit,
}: {
  file: string;
  active: boolean;
  pinnedRight: boolean;
  onClick: () => void;
  onSplit: () => void;
}) {
  return (
    <div
      className={cn(
        "group relative flex shrink-0 items-center rounded-md transition-colors",
        "max-w-[210px]",
        active
          ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
          : pinnedRight
          ? "bg-primary/10 text-foreground"
          : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
      )}
    >
      {active && (
        <motion.div
          layoutId="preview-tab-active"
          className="absolute inset-0 rounded-md bg-background shadow-sm ring-1 ring-border/60"
          transition={{ type: "spring", duration: 0.35 }}
        />
      )}
      <button
        onClick={onClick}
        title={file}
        className="relative truncate whitespace-nowrap px-2.5 py-1 text-[11px] font-medium"
      >
        <span className="truncate">{file}</span>
      </button>
      {/* Split pin icon — appears on hover or when pinned */}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSplit();
              }}
              aria-label={pinnedRight ? "取消分屏" : "在分屏中打开"}
              className={cn(
                "relative mr-1 flex h-4 w-4 items-center justify-center rounded transition-opacity",
                pinnedRight
                  ? "text-primary opacity-100"
                  : "text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground"
              )}
            />
          }
        >
          <Columns2 className="h-3 w-3" />
        </TooltipTrigger>
        <TooltipContent>{pinnedRight ? "取消分屏" : "在分屏中打开"}</TooltipContent>
      </Tooltip>
    </div>
  );
}

/* ---------- FilePane: one viewer/editor tied to one file ---------- */

function FilePane({
  paper,
  file,
  onReloadFiles,
  onClose,
}: {
  paper: string;
  file: string;
  onReloadFiles: () => void;
  onClose?: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [editorContent, setEditorContent] = React.useState("");
  const [editorDirty, setEditorDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [lastSavedAt, setLastSavedAt] = React.useState<number | null>(null);

  // Reset editor state when file changes
  React.useEffect(() => {
    setEditing(false);
    setEditorContent("");
    setEditorDirty(false);
    setLastSavedAt(null);
  }, [file, paper]);

  const isMd = file.toLowerCase().endsWith(".md");
  const canEdit = isMd && !CANONICAL.has(file);

  async function enterEdit() {
    try {
      const { content } = await api.getFileContent(paper, file);
      setEditorContent(content);
      setEditorDirty(false);
      setEditing(true);
      setLastSavedAt(Date.now());
    } catch (e) {
      toast.error("加载失败", { description: String(e) });
    }
  }

  const saveRef = React.useRef<(silent?: boolean) => Promise<void>>(null as any);
  saveRef.current = async (silent?: boolean) => {
    setSaving(true);
    try {
      await api.saveFile(paper, file, editorContent);
      if (!silent) toast.success("已保存");
      setEditorDirty(false);
      setLastSavedAt(Date.now());
      onReloadFiles();
    } catch (e) {
      toast.error("保存失败", { description: String(e) });
    } finally {
      setSaving(false);
    }
  };

  async function saveEdit() {
    await saveRef.current?.(false);
  }

  // Auto-save: debounce 1.5s after the last edit, silent toast
  React.useEffect(() => {
    if (!editing || !editorDirty) return;
    const t = setTimeout(() => {
      saveRef.current?.(true);
    }, 1500);
    return () => clearTimeout(t);
  }, [editorContent, editing, editorDirty]);

  function exitEdit() {
    // With auto-save, unsaved changes are impossible for > 1.5s. Flush once
    // before exiting just in case.
    if (editorDirty) {
      saveRef.current?.(true);
    }
    setEditing(false);
    setEditorDirty(false);
  }

  const saveStatusLabel = editorDirty
    ? saving
      ? "保存中…"
      : "未保存"
    : lastSavedAt
    ? "已保存"
    : "";

  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* Pane header with close button (only in split pane) */}
      {(onClose || editing) && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-2 py-1">
          <div className="flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
            {editing && <Pencil className="h-3 w-3 text-primary" />}
            <span className="truncate font-mono">{file}</span>
            {editing && saveStatusLabel && (
              <span
                className={cn(
                  "shrink-0 text-[10px]",
                  editorDirty ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"
                )}
              >
                · {saveStatusLabel}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {editing ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-5 px-1.5 text-[10px]"
                onClick={exitEdit}
              >
                <X className="mr-0.5 h-2.5 w-2.5" /> 退出
              </Button>
            ) : (
              canEdit && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-5 px-1.5 text-[10px]"
                  onClick={enterEdit}
                >
                  <Pencil className="mr-0.5 h-2.5 w-2.5" />
                  编辑
                </Button>
              )
            )}
            {onClose && (
              <Button
                size="icon"
                variant="ghost"
                className="h-5 w-5"
                onClick={onClose}
                aria-label="关闭"
              >
                <X className="h-2.5 w-2.5" />
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1">
        {editing && canEdit ? (
          <MDEditorPane
            content={editorContent}
            onChange={(v) => {
              setEditorContent(v);
              setEditorDirty(true);
            }}
          />
        ) : (
          <FileViewer
            paper={paper}
            file={file}
            canEdit={canEdit}
            onEnterEdit={enterEdit}
            showEditBadgeInHeader={!!onClose || editing}
          />
        )}
      </div>
    </div>
  );
}

function FileViewer({
  paper,
  file,
  canEdit,
  onEnterEdit,
  showEditBadgeInHeader,
}: {
  paper: string;
  file: string;
  canEdit: boolean;
  onEnterEdit: () => void;
  showEditBadgeInHeader: boolean;
}) {
  const isPdf = file.toLowerCase().endsWith(".pdf");
  const isHtml = file.toLowerCase().endsWith(".html");
  const isMarkdown = file.toLowerCase().endsWith(".md");

  const [content, setContent] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!isMarkdown) return;
    setLoading(true);
    api
      .getFileContent(paper, file)
      .then((r) => setContent(r.content))
      .catch(() => setContent("## 无法加载文件"))
      .finally(() => setLoading(false));
  }, [paper, file, isMarkdown]);

  if (isPdf) {
    return <iframe src={api.fileUrl(paper, file)} className="h-full w-full" title={file} />;
  }
  if (isHtml) {
    return <iframe src={api.fileUrl(paper, file)} className="h-full w-full" title={file} />;
  }
  if (isMarkdown) {
    const isRawDump =
      file === "extracted-text.md" || /^\s*=====\s+PAGE\s+\d+\s+=====/m.test(content);
    return (
      <div className="relative h-full">
        {canEdit && !showEditBadgeInHeader && (
          <Button
            variant="ghost"
            size="sm"
            className="absolute right-3 top-3 z-10 h-7 gap-1 text-[11px]"
            onClick={onEnterEdit}
          >
            <Pencil className="h-3 w-3" />
            编辑
          </Button>
        )}
        <ScrollArea className="h-full">
          <div className="mx-auto min-w-0 max-w-none px-5 py-5">
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> 加载中…
              </div>
            ) : isRawDump ? (
              <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground/80">
                {content.length > 120_000
                  ? content.slice(0, 120_000) + "\n\n... (truncated)"
                  : content}
              </pre>
            ) : (
              <MarkdownWithFallback content={content} paperName={paper} />
            )}
          </div>
        </ScrollArea>
      </div>
    );
  }
  return (
    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
      不支持预览此文件
    </div>
  );
}

class MarkdownErrorBoundary extends React.Component<
  { children: React.ReactNode; fallbackContent: string },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div>
          <div className="mb-2 rounded-md border border-amber-400/40 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-700 dark:text-amber-400">
            Markdown 渲染失败，显示原文：{this.state.error.message.slice(0, 80)}
          </div>
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-foreground/80">
            {this.props.fallbackContent}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

function MarkdownWithFallback({ content, paperName }: { content: string; paperName?: string }) {
  return (
    <MarkdownErrorBoundary fallbackContent={content}>
      <Markdown paperName={paperName}>{content}</Markdown>
    </MarkdownErrorBoundary>
  );
}

function MDEditorPane({
  content,
  onChange,
}: {
  content: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="h-full w-full" data-color-mode="light">
      <MDEditor
        value={content}
        onChange={(v) => onChange(v ?? "")}
        height="100%"
        visibleDragbar={false}
        preview="edit"
      />
    </div>
  );
}
