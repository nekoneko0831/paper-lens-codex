"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BookOpen, FileText, Link2, Upload, Search, Plus, Loader2, Bell, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ThemeSwitcher } from "@/components/theme/theme-switcher";
import { toast } from "sonner";

export function AppSidebar() {
  const papers = useStore((s) => s.papers);
  const currentPaper = useStore((s) => s.currentPaper);
  const setPapers = useStore((s) => s.setPapers);
  const setCurrentPaper = useStore((s) => s.setCurrentPaper);
  const sessions = useStore((s) => s.sessions);
  const openPreview = useStore((s) => s.openPreview);
  const [query, setQuery] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  function trySwitchPaper(name: string) {
    if (name === currentPaper) {
      // Still open preview even when re-clicking active paper
      openPreview(name);
      return;
    }
    // Switch is safe — the store saves the old paper's conversation to
    // paperSnapshots[] and loads the new paper's cached conversation.
    setCurrentPaper(name);
    // Auto-open the file preview for the newly selected paper
    openPreview(name);
  }

  const loadPapers = React.useCallback(async () => {
    try {
      const { papers } = await api.listPapers();
      setPapers(papers);
    } catch (e) {
      console.error(e);
      toast.error("无法加载论文列表", { description: String(e) });
    }
  }, [setPapers]);

  React.useEffect(() => {
    const id = window.setTimeout(() => {
      setLoading(true);
      loadPapers().finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(id);
  }, [loadPapers]);

  const filtered = React.useMemo(() => {
    if (!query) return papers;
    const q = query.toLowerCase();
    return papers.filter((p) => p.name.toLowerCase().includes(q));
  }, [papers, query]);

  return (
    <aside className="group/sidebar flex h-full w-[260px] shrink-0 flex-col border-r border-border/60 bg-sidebar text-sidebar-foreground">
      <header className="flex items-center gap-2 px-4 py-4 border-b border-sidebar-border/60">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
          <BookOpen className="h-4 w-4" />
        </div>
        <div className="flex-1 overflow-hidden">
          <div className="font-heading text-base font-semibold leading-tight tracking-tight">
            Paper Lens
          </div>
          <div className="text-[11px] text-muted-foreground leading-tight">
            论文阅读助手
          </div>
        </div>
        <NotificationButton />
        <ThemeSwitcher />
      </header>


      <div className="p-3 space-y-2">
        <AddPaperDialog onAdded={loadPapers} />
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索论文"
            className="pl-8 h-8 text-xs bg-background/60"
          />
        </div>
      </div>

      <Separator className="bg-sidebar-border/60" />

      <ScrollArea className="min-h-0 flex-1 px-2 py-2">
        {loading && (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">
            {query ? "未找到匹配的论文" : "还没有论文——点上方「添加论文」"}
          </div>
        )}
        <AnimatePresence initial={false}>
          {filtered.map((p) => {
            const cached = sessions[p.name];
            const cachedCount = cached?.messages?.length ?? 0;
            const isActive =
              cached?.sessionStatus === "streaming" ||
              cached?.sessionStatus === "starting";
            const isWaiting = cached?.sessionStatus === "waiting";
            return (
            <motion.button
              key={p.name}
              layout
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              onClick={() => trySwitchPaper(p.name)}
              className={cn(
                "group relative block w-full rounded-lg px-3 py-2.5 text-left text-sm transition-all",
                "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                currentPaper === p.name &&
                  "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm ring-1 ring-primary/20"
              )}
            >
              <div className="flex items-center gap-2">
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
                <span className="truncate font-medium flex-1">{p.name}</span>
                {isActive && (
                  <span
                    title="正在运行"
                    className="shrink-0 h-1.5 w-1.5 rounded-full bg-primary animate-pulse"
                  />
                )}
                {isWaiting && (
                  <span
                    title="等待你的下一条消息"
                    className="shrink-0 h-1.5 w-1.5 rounded-full bg-amber-500"
                  />
                )}
                {cachedCount > 0 && (
                  <span
                    title={`${cachedCount} 条对话已缓存`}
                    className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-medium text-primary"
                  >
                    {cachedCount}
                  </span>
                )}
              </div>
              <div className="mt-1 flex gap-1 pl-5.5">
                {p.has_speed_read && <ModeBadge label="速览" tone="emerald" />}
                {p.has_paper_reading && <ModeBadge label="精读" tone="purple" />}
                {p.has_deep_learn && <ModeBadge label="学习" tone="blue" />}
                {p.has_slides && <ModeBadge label="展示" tone="amber" />}
              </div>
            </motion.button>
            );
          })}
        </AnimatePresence>
      </ScrollArea>

      <footer className="flex items-center justify-between gap-2 border-t border-sidebar-border/60 px-4 py-2 text-[10px] text-muted-foreground">
        <span>© Paper Lens · v3</span>
        <ClearAllButton />
      </footer>
    </aside>
  );
}

function ModeBadge({ label, tone }: { label: string; tone: "emerald" | "purple" | "blue" | "amber" }) {
  const toneClass = {
    emerald: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    purple: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
    blue: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    amber: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  }[tone];
  return (
    <Badge variant="outline" className={cn("h-4 rounded-sm border-transparent px-1 text-[9px] font-normal leading-none", toneClass)}>
      {label}
    </Badge>
  );
}

function AddPaperDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<"file" | "url">("file");
  const [url, setUrl] = React.useState("");
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const setCurrentPaper = useStore((s) => s.setCurrentPaper);
  const fileRef = React.useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setBusy(true);
    try {
      const { paper_name } = await api.uploadPdf(file, name);
      toast.success(`已上传 ${paper_name}`);
      setCurrentPaper(paper_name);
      onAdded();
      setOpen(false);
    } catch (e) {
      toast.error("上传失败", { description: String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function handleUrl() {
    if (!url.trim()) return;
    const derived = name.trim() || deriveName(url);
    setBusy(true);
    try {
      await api.downloadPdf(derived, url);
      toast.success(`已下载 ${derived}`);
      setCurrentPaper(derived);
      onAdded();
      setOpen(false);
    } catch (e) {
      toast.error("下载失败", { description: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            size="sm"
            className="h-8 w-full justify-start gap-2 text-xs font-medium"
            variant="default"
          />
        }
      >
        <Plus className="h-3.5 w-3.5" />
        添加论文
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="font-heading">添加论文</DialogTitle>
          <DialogDescription>上传本地 PDF 或粘贴 arXiv 链接</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Button
            variant={mode === "file" ? "default" : "outline"}
            size="sm"
            className="flex-1"
            onClick={() => setMode("file")}
          >
            <Upload className="h-3.5 w-3.5 mr-1.5" /> 本地文件
          </Button>
          <Button
            variant={mode === "url" ? "default" : "outline"}
            size="sm"
            className="flex-1"
            onClick={() => setMode("url")}
          >
            <Link2 className="h-3.5 w-3.5 mr-1.5" /> arXiv 链接
          </Button>
        </div>

        <div className="space-y-3">
          {mode === "file" ? (
            <div
              onClick={() => fileRef.current?.click()}
              className="rounded-lg border-2 border-dashed border-border bg-muted/30 px-6 py-8 text-center cursor-pointer hover:bg-muted/60 transition-colors"
            >
              <Upload className="mx-auto h-6 w-6 text-muted-foreground" />
              <div className="mt-2 text-sm">点击选择 PDF 文件</div>
              <div className="mt-1 text-xs text-muted-foreground">或拖放到此处</div>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Input
                placeholder="https://arxiv.org/abs/2506.07982"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <Button className="w-full" onClick={handleUrl} disabled={busy || !url}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "下载"}
              </Button>
            </div>
          )}
          <Input
            placeholder="论文简称（可选）"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function deriveName(url: string): string {
  const m = url.match(/arxiv\.org\/(?:abs|pdf)\/([\d.]+)/);
  if (m) return `arxiv-${m[1]}`;
  return `paper-${Date.now()}`;
}

function ClearAllButton() {
  const [open, setOpen] = React.useState(false);
  const clearAll = useStore((s) => s.clearAllHistory);
  const sessions = useStore((s) => s.sessions);
  const count = Object.keys(sessions).filter(
    (k) => (sessions[k]?.messages?.length ?? 0) > 0
  ).length;
  if (count === 0) return null;
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-[10px] text-muted-foreground hover:text-destructive underline-offset-2 hover:underline"
      >
        清空全部
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>清空所有论文对话？</DialogTitle>
            <DialogDescription>
              将删除 {count} 篇论文的本地对话记录与 session，
              并清空 localStorage。论文文件本身不会删除。
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                clearAll();
                setOpen(false);
                toast.success("已清空所有本地对话");
              }}
            >
              清空全部
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function NotificationButton() {
  const [perm, setPerm] = React.useState<NotificationPermission | "unsupported">("default");

  React.useEffect(() => {
    const id = window.setTimeout(() => {
      if (typeof window === "undefined" || !("Notification" in window)) {
        setPerm("unsupported");
        return;
      }
      setPerm(Notification.permission);
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  async function handleClick() {
    if (perm === "unsupported") {
      toast.error("此浏览器不支持桌面通知");
      return;
    }
    if (perm === "granted") {
      // Clear dismissed flag + show banner again for user to verify
      localStorage.removeItem("paper-lens-notif-banner-dismissed");
      toast.success("桌面通知已开启", {
        description: "离开标签页时会收到提醒",
      });
      try {
        const n = new Notification("Paper Lens", { body: "桌面通知已开启 ✓" });
        setTimeout(() => n.close(), 2500);
      } catch {}
      return;
    }
    if (perm === "denied") {
      toast.error("通知已被浏览器拒绝", {
        description: "请到浏览器设置中重新允许",
      });
      return;
    }
    try {
      const next = await Notification.requestPermission();
      setPerm(next);
      if (next === "granted") {
        toast.success("通知已开启");
        new Notification("Paper Lens", { body: "桌面通知已开启 ✓" });
      }
    } catch {}
  }

  const Icon = perm === "granted" ? Bell : BellOff;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="桌面通知"
            onClick={handleClick}
            className="relative"
          />
        }
      >
        <Icon className="h-[1.1rem] w-[1.1rem]" />
        {perm === "granted" && (
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500" />
        )}
      </TooltipTrigger>
      <TooltipContent>
        {perm === "granted"
          ? "桌面通知：已开启"
          : perm === "denied"
          ? "被浏览器拒绝"
          : perm === "unsupported"
          ? "此浏览器不支持"
          : "开启桌面通知"}
      </TooltipContent>
    </Tooltip>
  );
}
