"use client";

import * as React from "react";
import { Bell, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";

const DISMISS_KEY = "paper-lens-notif-banner-dismissed";

export function NotificationBanner() {
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "granted" || Notification.permission === "denied") return;
    if (localStorage.getItem(DISMISS_KEY)) return;
    setVisible(true);
  }, []);

  async function enable() {
    try {
      const perm = await Notification.requestPermission();
      if (perm === "granted") {
        new Notification("通知已开启", { body: "离开标签页时也会收到提醒" });
      }
    } catch {}
    setVisible(false);
  }

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    setVisible(false);
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: -30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -30, opacity: 0 }}
          className="mx-auto mt-3 flex w-full max-w-3xl items-center gap-3 rounded-full border border-border/60 bg-card/90 px-4 py-2 shadow-sm backdrop-blur"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Bell className="h-3.5 w-3.5" />
          </div>
          <div className="flex-1 text-xs">
            <div className="font-medium">开启桌面通知</div>
            <div className="text-muted-foreground text-[11px]">离开标签页时也能第一时间收到提醒</div>
          </div>
          <Button size="sm" className="h-7 text-xs" onClick={enable}>
            开启
          </Button>
          <button onClick={dismiss} className="text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
