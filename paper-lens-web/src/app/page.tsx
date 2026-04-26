"use client";

import * as React from "react";
import { PanelRightOpen, PanelRightClose, FileText, Trash2, Columns2, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { AppSidebar } from "@/components/sidebar/app-sidebar";
import { MessageList } from "@/components/chat/message-list";
import { ModeSwitcher } from "@/components/chat/mode-switcher";
import { ChatInput } from "@/components/chat/chat-input";
import { EmptyState } from "@/components/chat/empty-state";
import { PlanPanel } from "@/components/plan/plan-panel";
import { FilePreview } from "@/components/preview/file-preview";
import { NotificationBanner } from "@/components/notification/notification-banner";
import { useStore, useCurrentSession } from "@/lib/store";
import { useSession } from "@/hooks/use-session";
import { api, ApiError } from "@/lib/api";
import { Mode } from "@/lib/types";
import { toast } from "sonner";

export default function Page() {
  useSession();

  const currentPaper = useStore((s) => s.currentPaper);
  const session = useCurrentSession();
  const messages = session.messages;
  const sessionId = session.sessionId;
  const sessionStatus = session.sessionStatus;
  const previewOpen = useStore((s) => s.previewOpen);
  const previewPaper = useStore((s) => s.previewPaper);
  const togglePreview = useStore((s) => s.togglePreview);
  const openPreview = useStore((s) => s.openPreview);
  const splitTab = useStore((s) => s.splitTab);
  const setSplitTab = useStore((s) => s.setSplitTab);
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const startSession = useStore((s) => s.startSession);
  const resetSession = useStore((s) => s.resetSession);
  const clearCurrentPaperSession = useStore((s) => s.clearCurrentPaperSession);
  const pushUser = useStore((s) => s.pushUserMessage);
  const [clearConfirmOpen, setClearConfirmOpen] = React.useState(false);

  const [mode, setMode] = React.useState<Mode | null>(null);
  const [input, setInput] = React.useState("");
  const busy = sessionStatus === "streaming" || sessionStatus === "starting";
  const prevPaperRef = React.useRef<string | null>(null);
  const previewPanelRef = React.useRef<PanelImperativeHandle | null>(null);

  // Sync previewOpen → imperatively size the preview panel. Relying on
  // dynamic mount/unmount caused the new panel to get only ~5% width, so
  // we keep the panel always mounted + collapsible and drive its size via
  // the imperative handle.
  // NOTE: resize() takes pixels for numeric arguments. Pass a string like
  // "45" or "45%" for a percentage.
  // Sync previewOpen → imperatively size the preview panel.
  // NOTE (CRITICAL): in react-resizable-panels v4 numeric values are
  // PIXELS; strings like "45%" are percentages. All Panel props and the
  // imperative `resize()` API follow this rule.
  React.useEffect(() => {
    const panel = previewPanelRef.current;
    if (!panel) return;
    if (previewOpen) {
      const size = panel.getSize();
      const pct = typeof size === "number" ? size : size?.asPercentage ?? 0;
      if (pct < 28) panel.resize("45%");
    } else if (!panel.isCollapsed()) {
      panel.collapse();
    }
  }, [previewOpen]);

  // Keep preview in sync with current paper. Session state is now managed
  // by setCurrentPaper in the store (snapshots per paper), so this effect
  // must NOT call resetSession — that would clobber the restored snapshot.
  React.useEffect(() => {
    if (prevPaperRef.current !== currentPaper) {
      setMode(null);
    }
    prevPaperRef.current = currentPaper;

    if (previewOpen && currentPaper && currentPaper !== previewPaper) {
      openPreview(currentPaper);
    }
  }, [currentPaper, previewOpen, previewPaper, openPreview]);

  async function handleStart(chosenMode: Mode | null, userMessage: string) {
    if (!currentPaper) {
      toast.error("请先从左侧选择一篇论文");
      return;
    }
    const paperForTurn = currentPaper;
    try {
      const modeToUse: Mode = chosenMode ?? "chat";
      resetSession(paperForTurn);
      const { session_id } = await api.startSession(paperForTurn, modeToUse, {
        message: userMessage,
      });
      startSession(paperForTurn, session_id);
      const modeLabel =
        modeToUse === "speed-read"
          ? "速览"
          : modeToUse === "deep-learn"
          ? "学习"
          : modeToUse === "present"
          ? "展示"
          : "对话";
      pushUser(paperForTurn, userMessage || `开始 ${paperForTurn} 的${modeLabel}模式`);
      setInput("");
    } catch (e) {
      toast.error("启动会话失败", { description: String(e) });
    }
  }

  async function handleSend() {
    if (!input.trim()) return;
    if (!currentPaper) {
      toast.error("请先从左侧选择一篇论文");
      return;
    }
    const paperForTurn = currentPaper;
    if (!sessionId) {
      await handleStart(mode, input);
      return;
    }
    const text = input;
    setInput("");
    pushUser(paperForTurn, text);
    try {
      await api.sendMessage(sessionId, text);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        // Backend lost the session (TTL expired or backend restarted).
        // Preserve existing messages + tokens — only start a new session
        // for the same paper with the same text.
        toast.info("会话已过期，正在恢复…");
        try {
          const { session_id } = await api.startSession(
            paperForTurn,
            mode ?? "chat",
            { message: text }
          );
          startSession(paperForTurn, session_id);
        } catch (e2) {
          toast.error("恢复失败", { description: String(e2) });
        }
        return;
      }
      toast.error("发送失败", { description: String(e) });
    }
  }

  function handleModeClick(m: Mode) {
    setMode(m);
    if (currentPaper) handleStart(m, input);
  }

  return (
    <div className="flex h-screen w-full overflow-hidden">
      {!sidebarCollapsed && <AppSidebar />}
      {sidebarCollapsed && (
        <div className="flex h-full w-10 shrink-0 flex-col items-center border-r border-border/60 bg-sidebar py-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={toggleSidebar}
            aria-label="展开侧栏"
            title="展开侧栏"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </Button>
        </div>
      )}

      <div className="relative flex flex-1 min-w-0">
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel
            id="chat-panel"
            defaultSize="100%"
            minSize="30%"
          >
            <div className="flex h-full flex-col min-w-0">
              {/* Top bar */}
              <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 bg-card/40 px-2 backdrop-blur">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {!sidebarCollapsed && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={toggleSidebar}
                      aria-label="收起侧栏"
                      title="收起侧栏"
                    >
                      <PanelLeftClose className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {currentPaper ? (
                    <span className="flex items-center gap-2 pl-1">
                      <FileText className="h-3.5 w-3.5" />
                      <span className="font-mono text-[11px]">{currentPaper}</span>
                    </span>
                  ) : (
                    <span className="pl-1">未选择论文</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  {messages.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-destructive"
                      onClick={() => setClearConfirmOpen(true)}
                      title="清空当前论文的对话记录"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      清空对话
                    </Button>
                  )}
                  {previewOpen && (
                    <Button
                      variant={splitTab ? "secondary" : "ghost"}
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      onClick={() => {
                        if (splitTab) {
                          setSplitTab(null);
                        } else {
                          // Split the active tab with the "other" most useful file
                          const tabs = useStore.getState().previewTabs;
                          const activeTab = useStore.getState().activeTab;
                          const other = tabs.find((t) => t !== activeTab && (t.startsWith("notes-") || t.endsWith(".md")));
                          if (other) setSplitTab(other);
                          else toast.info("需要至少两个文件才能分屏");
                        }
                      }}
                      disabled={!currentPaper}
                      title={splitTab ? "取消分屏" : "分屏对比"}
                    >
                      <Columns2 className="h-3.5 w-3.5" />
                      {splitTab ? "取消分屏" : "分屏"}
                    </Button>
                  )}
                  <Button
                    variant={previewOpen ? "secondary" : "ghost"}
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    onClick={() => {
                      if (!previewOpen && currentPaper) {
                        openPreview(currentPaper);
                      } else {
                        // Closing preview also clears split
                        setSplitTab(null);
                        togglePreview();
                      }
                    }}
                    disabled={!currentPaper}
                  >
                    {previewOpen ? (
                      <PanelRightClose className="h-3.5 w-3.5" />
                    ) : (
                      <PanelRightOpen className="h-3.5 w-3.5" />
                    )}
                    {previewOpen ? "收起预览" : "文件预览"}
                  </Button>
                </div>
              </div>

              <PlanPanel />
              <NotificationBanner />

              {messages.length === 0 ? (
                <EmptyState hasPaper={!!currentPaper} />
              ) : (
                <MessageList />
              )}

              <div className="shrink-0 border-t border-border/60 bg-card/30 backdrop-blur">
                <div className="mx-auto w-full max-w-3xl space-y-3 px-6 py-4">
                  <ModeSwitcher
                    value={mode}
                    onChange={handleModeClick}
                    disabled={!currentPaper || busy}
                  />
                  <ChatInput
                    value={input}
                    onChange={setInput}
                    onSubmit={handleSend}
                    busy={busy}
                  />
                </div>
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle className={previewOpen ? "" : "pointer-events-none opacity-0 w-0"} />
          <ResizablePanel
            id="preview-panel"
            panelRef={previewPanelRef}
            defaultSize="0%"
            minSize="28%"
            maxSize="70%"
            collapsible
            collapsedSize="0%"
          >
            <div className="h-full min-w-0">
              <FilePreview />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <Dialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>清空当前论文对话？</DialogTitle>
            <DialogDescription>
              将删除
              <span className="font-mono mx-1 text-primary">{currentPaper}</span>
              的所有消息、任务和 token 计数。其他论文的对话不受影响。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setClearConfirmOpen(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                clearCurrentPaperSession();
                setClearConfirmOpen(false);
              }}
            >
              清空
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
