"use client";

import { useEffect, useState, useRef, createContext, useContext, useCallback } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast as sonnerToast } from "sonner";
import { Sun, Moon, X } from "lucide-react";
import { Icon } from "@/components/icon";

type Toast = { id: number; msg: string; kind: "success" | "error" | "info" };
const ToastCtx = createContext<(msg: string, kind?: Toast["kind"]) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const push = useCallback((msg: string, kind: Toast["kind"] = "success") => {
    if (kind === "error") sonnerToast.error(msg);
    else if (kind === "info") sonnerToast.info(msg);
    else sonnerToast.success(msg);
  }, []);
  return <ToastCtx.Provider value={push}>{children}</ToastCtx.Provider>;
}



export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);
  if (dark === null) return null;
  return (
    <button
      aria-label="حالت تاریک"
      className="btn-ghost btn-sm btn-icon"
      onClick={() => {
        const el = document.documentElement;
        const next = !el.classList.contains("dark");
        el.classList.toggle("dark", next);
        localStorage.setItem("repaid_theme", next ? "dark" : "light");
        setDark(next);
      }}
    >
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

export function ThemeInitScript() {
  // Applied after hydration via useEffect to avoid SSR/client class mismatch
  return null;
}

export function ThemeInitEffect({ children }: { children?: React.ReactNode }) {
  useEffect(() => {
    try {
      const saved = localStorage.getItem("repaid_theme");
      const dark = saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
      document.documentElement.classList.toggle("dark", dark);
    } catch {}
  }, []);
  return <>{children}</>;
}

export function EmptyState({
  icon = "package",
  title,
  body,
  action,
}: {
  icon?: string;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-14 px-6 text-center">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400 dark:bg-zinc-800/80 dark:text-zinc-500" aria-hidden>
        <Icon name={icon} size={28} strokeWidth={1.6} />
      </div>
      <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2 p-4" role="status" aria-label="در حال بارگذاری…">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={`h-5 ${c === 0 ? "w-1/4" : "flex-1"}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="block text-[13px] font-medium mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-zinc-400 mt-1">{hint}</span>}
    </label>
  );
}export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
  dismissible = true,
  fullWidth = false,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
  dismissible?: boolean;
  fullWidth?: boolean;
  footer?: React.ReactNode;
}) {
  const returnFocus=useRef<HTMLElement|null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && dismissible && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          onEscapeKeyDown={event=>{const dropdown=document.querySelector<HTMLElement>('.search-select-panel:popover-open');if(dropdown){event.preventDefault();dropdown.hidePopover();}else if(!dismissible)event.preventDefault();}}
          onPointerDownOutside={event=>{if(!dismissible)event.preventDefault();}}
          onOpenAutoFocus={()=>{returnFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;}}
          onCloseAutoFocus={event=>{event.preventDefault();if(returnFocus.current?.isConnected)returnFocus.current.focus({preventScroll:true});}}
          className={`fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-2rem)] ${fullWidth ? "max-w-none" : wide ? "max-w-3xl" : "max-w-lg"} max-h-[92vh] overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl focus:outline-none`}
        >
          <div className="sticky top-0 z-10 bg-white/95 dark:bg-zinc-900/95 backdrop-blur border-b border-zinc-200 dark:border-zinc-800 px-5 py-3.5 flex items-center justify-between rounded-t-xl">
            <Dialog.Title className="text-[15px] font-semibold">{title}</Dialog.Title>
            <Dialog.Close className="btn-ghost btn-sm" disabled={!dismissible} aria-label="بستن"><X size={15} /></Dialog.Close>
          </div>
          <div className="p-5">{children}</div>
          {footer&&<div className="sticky bottom-0 z-10 flex flex-wrap justify-end gap-2 border-t border-zinc-200 bg-white/95 px-5 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ترجمه وضعیت به فارسی — نسخه کلاینت (بدون import سروری)
const STATUS_FA_CLIENT: Record<string, string> = {
  "New": "جدید",
  "Received": "پذیرش‌شده",
  "Waiting for Diagnosis": "در انتظار عیب‌یابی",
  "Diagnosing": "در حال عیب‌یابی",
  "Estimate Prepared": "برآورد آماده شد",
  "Waiting for Customer Approval": "در انتظار تأیید مشتری",
  "Approved": "تأییدشده",
  "Waiting for Parts": "در انتظار قطعه",
  "Parts Available": "قطعه موجود شد",
  "In Repair": "در حال تعمیر",
  "Quality Control": "کنترل کیفیت",
  "Ready for Pickup": "آماده تحویل",
  "Delivered": "تحویل‌شده",
  "Warranty": "گارانتی",
  "Returned for Rework": "مرجوع برای بازتعمیر",
  "Cancelled": "لغوشده",
  "Unrepairable": "غیرقابل تعمیر",
  "No Fault Found": "بدون ایراد (NFF)",
};

export function StatusBadge({ name, color }: { name: string; color?: string }) {
  return (
    <span className="badge" style={color ? { backgroundColor: color + "22", color } : undefined}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color ?? "#71717a" }} />
      {STATUS_FA_CLIENT[name] ?? name}
    </span>
  );
}

export function PriorityBadge({ p }: { p: string }) {
  const map: Record<string, string> = { low: "badge-gray", normal: "badge-blue", high: "badge-amber", urgent: "badge-red" };
  const fa: Record<string, string> = { low: "کم", normal: "معمولی", high: "زیاد", urgent: "فوری" };
  return <span className={map[p] ?? "badge-gray"}>{fa[p] ?? p}</span>;
}

export function Avatar({ name, color, size = 28 }: { name: string; color?: string | null; size?: number }) {
  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span
      className="inline-flex items-center justify-center rounded-full font-semibold text-white shrink-0"
      style={{ width: size, height: size, backgroundColor: color ?? "#0ea5e9", fontSize: size * 0.38 }}
      aria-hidden
    >
      {initials}
    </span>
  );
}
