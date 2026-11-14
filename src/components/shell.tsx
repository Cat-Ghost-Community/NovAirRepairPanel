"use client";

import {NotificationAnnouncements} from './notification-announcements';
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback,useEffect, useMemo, useRef, useState,useTransition } from "react";
import { Avatar, ThemeToggle, ThemeInitEffect, useToast } from "@/components/ui";
import { Icon } from "@/components/icon";
import { BranchSelect } from "@/components/select";
import { hasPerm } from "@/lib/perms-shared";
import { ChangePasswordModal } from "@/app/team/change-password";
import * as Dialog from "@radix-ui/react-dialog";

export type SessionUser = { id: number; name: string; email: string; role: string; branch_id: number | null; avatar_color: string };

const ROLE_FA: Record<string, string> = {
  owner: "مالک", admin: "مدیر سیستم", manager: "مدیر", reception: "پذیرش",
  technician: "تعمیرکار", inventory: "انباردار", accountant: "حسابدار", sales: "فروشنده",
};

type NavItem = { href: string; label: string; icon: string; perm?: string; roles?: string[] };
type NavGroup = { section: string; items: NavItem[] };

/** ارقام فارسی برای نشان‌های شمارشی */
function faCount(n: number): string {
  return String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

/** منو با مجوز هر آیتم — آیتم بدون دسترسی هرگز رندر نمی‌شود */
const NAV: NavGroup[] = [
  {
    section: "مرور کلی",
    items: [{ href: "/", label: "داشبورد", icon: "dashboard" }],
  },
  {
    section: "عملیات",
    items: [
      { href: "/repairs", label: "پذیرش‌ها", icon: "wrench", perm: "repairs.view" },
      { href: "/repairs/bulk", label: "پذیرش گروهی", icon: "boxes", perm: "repairs.create" },
      { href: "/repairs/board", label: "تابلوی وضعیت", icon: "board", perm: "repairs.view" },
      { href: "/repairs/assignment", label: "کارتابل ارجاع", icon: "clipboard", perm: "repairs.assign" },
      { href: "/repairs/queue", label: "کارتابل من", icon: "timer", roles: ["technician"] },
      { href: "/chat", label: "گفتگوی داخلی", icon: "chat", perm: "chat.view" },
      { href: "/estimates", label: "برآوردها", icon: "clipboard", perm: "estimates.view" },
      { href: "/tariffs", label: "تعرفه تعمیرات", icon: "calculator", perm: "repairs.view" },
    ],
  },
  {
    section: "اشخاص",
    items: [
      { href: "/customers", label: "مشتریان", icon: "user", perm: "customers.view" },
      { href: "/devices", label: "دستگاه‌ها", icon: "phone", perm: "devices.view" },
    ],
  },
  {
    section: "انبار و فروش",
    items: [
      { href: "/parts", label: "قطعات و موجودی", icon: "package", perm: "inventory.view" },
      { href: "/labels", label: "چاپ برچسب و بارکد", icon: "tags", perm: "inventory.view" },
      { href: "/inventory-tools", label: "ابزارهای انبار", icon: "sliders", perm: "inventory.edit" },
      { href: "/suppliers", label: "تأمین‌کنندگان", icon: "factory", perm: "suppliers.view" },
      { href: "/purchase-orders", label: "سفارش‌های خرید", icon: "truck", perm: "purchasing.view" },
    ],
  },
  {
    section: "امور مالی",
    items: [
      { href: "/invoices", label: "فاکتورها", icon: "receipt", perm: "invoices.view" },
      { href: '/returns',label:'مرجوعی و اعتبارنامه',icon:'receipt',perm:'invoices.view' },
      { href: "/payments", label: "دریافت و پرداخت", icon: "banknote", perm: "payments.view" },
      { href: "/expenses", label: "هزینه‌ها", icon: "banknote-down", perm: "expenses.view" },
      { href: "/checks", label: "چک‌ها", icon: "bank", perm: "finance.view" },
      { href: "/installments", label: "اقساط", icon: "calendar", perm: "finance.view" },
      { href: "/bank", label: "حساب‌های بانکی", icon: "landmark", perm: "finance.view" },
      { href: "/finance", label: "خلاصه مالی", icon: "trending-up", perm: "finance.view" },
    ],
  },
  {
    section: "سایر",
    items: [
      { href: "/warranty", label: "گارانتی", icon: "shield", perm: "warranty.view" },
      { href: "/communication", label: "ارتباطات", icon: "chat", perm: "communication.send" },
      { href: "/outbox", label: "صف ارسال پیام", icon: "send", perm: "communication.send" },
      { href: "/report-builder", label: "گزارش‌ساز", icon: "calculator", perm: "reports.view" },
      { href: "/daily-report", label: "گزارش پایان روز", icon: "notebook-pen" },
      { href: "/calendar", label: "تقویم سررسید", icon: "calendar-days", perm: "finance.view" },
      { href: "/reports", label: "گزارش‌ها", icon: "bar-chart", perm: "reports.view" },
      { href: "/reports/iran", label: "گزارش‌های مالی", icon: "trending-up", perm: "reports.view" },
      { href: "/team", label: "کارکنان", icon: "users", perm: "team.view" },
      { href: "/payroll", label: "حقوق و دستمزد", icon: "hand-coins", perm: "team.view" },
      { href: "/settings", label: "تنظیمات", icon: "settings", perm: "settings.view" },
      { href: "/audit", label: "گزارش رخدادها", icon: "clock", perm: "audit.view" },
    ],
  },
];

const MOBILE_NAV: NavItem[] = [
  { href: "/", label: "خانه", icon: "home" },
  { href: "/repairs", label: "پذیرش", icon: "wrench", perm: "repairs.view" },
  { href: "/chat", label: "گفتگو", icon: "chat", perm: "chat.view" },
  { href: "/customers", label: "مشتریان", icon: "user", perm: "customers.view" },
];

export function Shell({
  user,
  branches,
  perms,
  activeBranchId,
  canSwitchBranch,
  integrationMode = false,
  children,
}: {
  user: SessionUser;
  branches: Array<{ id: number; name: string }>;
  perms: string[];
  activeBranchId: number | null;
  canSwitchBranch: boolean;
  integrationMode?: boolean;
  children: React.ReactNode;
}) {
  const toast=useToast();
  const pathname = usePathname();
  const router = useRouter();
  const isPublicPage = pathname.startsWith("/track") || pathname.includes("/receipt") || pathname.includes("/group-receipt");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => { if (desktop.matches) setSidebarOpen(false); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [storedNotifs, setNotifs] = useState<any[]>([]);
  const [storedUnread, setUnread] = useState(0);
  const [storedNotifError,setNotifError]=useState<string|null>(null);
  const [storedNotifLoading,setNotifLoading]=useState(false);
  const notificationScope=user.id+':'+String(activeBranchId);
  const [notificationSnapshotScope,setNotificationSnapshotScope]=useState('');
  const notificationScopeRef=useRef(notificationScope);
  const notifs=notificationSnapshotScope===notificationScope?storedNotifs:[];
  const unread=notificationSnapshotScope===notificationScope?storedUnread:0;
  const notifError=notificationSnapshotScope===notificationScope?storedNotifError:null;
  const notifLoading=notificationSnapshotScope!==notificationScope||storedNotifLoading;
  const [notifBusy,setNotifBusy]=useState(false);
  const notifController=useRef<AbortController|null>(null);
  const notifOperations=useRef(new Map<string,string>());
  const [userMenu, setUserMenu] = useState(false);
  const [online, setOnline] = useState(true);
  const [navQuery, setNavQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [branchSel, setBranchSel] = useState<string>(activeBranchId == null ? "all" : String(activeBranchId));
  const [branchPending,startBranchTransition]=useTransition();
  const searchRef = useRef<HTMLInputElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setSidebarOpen(false), [pathname]);
  useEffect(() => setBranchSel(activeBranchId == null ? "all" : String(activeBranchId)), [activeBranchId]);

  // منوی دسترسی‌محور: آیتم‌های بدون مجوز حذف می‌شوند و گروه خالی نمایش داده نمی‌شود
  const navGroups = useMemo(() => {
    const q = navQuery.trim();
    const roleOk = (i: NavItem) => !i.roles || i.roles.includes(user.role);
    return NAV.map((g) => ({
      ...g,
      items: g.items.map(i=>integrationMode&&i.href==='/settings'?{...i,href:'/settings/repair-workflow',label:'تنظیمات ارجاع'}:i).filter((i) => (!integrationMode||['/customers','/devices','/chat','/repairs','/repairs/assignment','/repairs/queue','/settings/repair-workflow','/appointments','/complaints'].includes(i.href)) && roleOk(i) && (!i.perm || hasPerm(perms, i.perm)) && (!q || i.label.includes(q))),
    })).filter((g) => g.items.length > 0);
  }, [perms, navQuery, user.role,integrationMode]);

  const mobileNav = MOBILE_NAV.filter((i) => (!integrationMode||['/customers','/devices','/chat','/repairs','/repairs/queue','/appointments','/complaints'].includes(i.href)) && (!i.roles || i.roles.includes(user.role)) && (!i.perm || hasPerm(perms, i.perm)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!integrationMode && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
      if (e.key === "Escape") {
        setNotifOpen(false);
        setUserMenu(false);
      }
      if (!integrationMode&&e.key.toLowerCase() === "n" && !e.metaKey && !e.ctrlKey && !e.altKey && hasPerm(perms, "repairs.create")) {
        const el = document.activeElement;
        if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
        e.preventDefault();
        router.push("/repairs/new");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, perms,integrationMode]);

  // بستن منوهای شناور با کلیک بیرون (قبلاً منوی کاربر فقط با خروج ماوس بسته می‌شد)
  useEffect(() => {
    if (!notifOpen && !userMenu) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (notifOpen && !notifRef.current?.contains(t)) setNotifOpen(false);
      if (userMenu && !userMenuRef.current?.contains(t)) setUserMenu(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [notifOpen, userMenu]);

  useEffect(() => {
    const upd = () => setOnline(navigator.onLine);
    upd();
    window.addEventListener("online", upd);
    window.addEventListener("offline", upd);
    return () => {
      window.removeEventListener("online", upd);
      window.removeEventListener("offline", upd);
    };
  }, []);

  const loadNotifs = useCallback(async () => {
    // تب مخفی است → درخواست بی‌مورد به سرور (و در dev، رقابت با کامپایل) نزنیم
    if (typeof document !== "undefined" && document.hidden) return;
    notifController.current?.abort();const controller=new AbortController();notifController.current=controller;
    try {
      const res = await fetch("/api/notifications",{signal:controller.signal});
      const data = await res.json();
      if(!res.ok)throw new Error(data.error??'دریافت اعلان‌ها ناموفق بود.');
      if(controller.signal.aborted)return;
      setNotificationSnapshotScope(notificationScope);
      setNotifs(data.notifications ?? []);
      setUnread(data.unread ?? 0);
      setNotifError(null);
    } catch(error) {if(!controller.signal.aborted){setNotificationSnapshotScope(notificationScope);setNotifs([]);setUnread(0);setNotifError(error instanceof Error?error.message:'دریافت اعلان‌ها ناموفق بود.');}}
    finally{if(!controller.signal.aborted)setNotifLoading(false);}
  },[notificationScope]);
  useEffect(() => {
    notificationScopeRef.current=notificationScope;
    loadNotifs();
    const iv = setInterval(loadNotifs, 30000);
    window.addEventListener('repaid:notifications',loadNotifs);
    return () => {clearInterval(iv);notifController.current?.abort();window.removeEventListener('repaid:notifications',loadNotifs);};
  }, [loadNotifs,notificationScope]);
  const markNotification=async(body:{action:'mark_read'|'mark_all_read';id?:number})=>{
    if(notifBusy)return false;setNotifBusy(true);
    const json=JSON.stringify(body),identity=notificationScope+':'+json;
    let key=notifOperations.current.get(identity);if(!key){key=crypto.randomUUID();notifOperations.current.set(identity,key);}
    try{
      const response=await fetch('/api/notifications',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:json});
      const result=await response.json();if(!response.ok)throw new Error(result.error??'ثبت وضعیت اعلان انجام نشد.');
      notifOperations.current.delete(identity);if(notificationScopeRef.current===notificationScope)await loadNotifs();return true;
    }catch(error){if(notificationScopeRef.current===notificationScope)setNotifError(error instanceof Error?error.message:'ثبت وضعیت اعلان انجام نشد.');return false;}
    finally{setNotifBusy(false);}
  };

  // نشان ناخواندهٔ چت روی منو — فقط برای دارندگان دسترسی
  const [chatUnread, setChatUnread] = useState(0);
  useEffect(() => {
    if (!hasPerm(perms, "chat.view")) return;
    let alive = true;
    const load = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const res = await fetch("/api/chat/summary");
        if (!res.ok) return;
        const data = await res.json();
        if (alive) setChatUnread(Number(data.unread_total ?? 0));
      } catch {}
    };
    load();
    const iv = setInterval(load, 30000);
    window.addEventListener('repaid:notifications',load);
    return () => {
      alive = false;
      clearInterval(iv);window.removeEventListener('repaid:notifications',load);
    };
  }, [perms,integrationMode]);

  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const sidebar = (
    <nav aria-label="ناوبری اصلی" className="flex h-full min-h-0 flex-col gap-3 px-3 py-4">
      <Link href="/" className="flex items-center gap-2 px-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white font-bold">ت</span>
        <span className="text-[15px] font-bold tracking-tight">تعمیرکار</span>
        <span className="badge-blue badge hidden lg:inline">نسخه ۱</span>
      </Link>

      <span className="select-wrap px-1">
        <input
          value={navQuery}
          onChange={(e) => setNavQuery(e.target.value)}
          placeholder="جستجو در منو…"
          aria-label="جستجو در منو"
          className="input !py-1.5 !text-[13px]"
        />
      </span>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pl-0.5">
        {navGroups.map((group) => {
          const isCollapsed = !!collapsed[group.section] && !navQuery;
          return (
            <div key={group.section}>
              <button
                type="button"
                onClick={() => setCollapsed((c) => ({ ...c, [group.section]: !c[group.section] }))}
                aria-expanded={!isCollapsed}
                className="flex h-8 w-full items-center justify-between rounded-md px-2 text-xs font-semibold text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
              >
                {group.section}
                <Icon name={isCollapsed ? "chevron-down" : "chevron-up"} size={13} className="opacity-70" />
              </button>
              {!isCollapsed && (
                <div className="space-y-0.5">
                  {group.items.map((item) => (
                    <Link key={item.href} href={item.href} className={`nav-item ${active(item.href) ? "nav-item-active" : ""}`}>
                      <Icon name={item.icon} size={17} className="shrink-0 opacity-80" />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.href === "/chat" && chatUnread > 0 && (
                        <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                          {chatUnread > 99 ? "۹۹+" : faCount(chatUnread)}
                        </span>
                      )}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {navGroups.length === 0 && <p className="px-2 text-xs text-zinc-400">موردی یافت نشد.</p>}
      </div>

      <div className="border-t border-zinc-200 px-2 pt-3 text-xs text-zinc-400 dark:border-zinc-800">
        کلید <kbd className="rounded border px-1 border-zinc-300 dark:border-zinc-700">N</kbd> پذیرش جدید ·{" "}
        <kbd className="rounded border px-1 border-zinc-300 dark:border-zinc-700">Ctrl+K</kbd> جستجو
      </div>
    </nav>
  );

  if (isPublicPage) {
    return <ThemeInitEffect>{children}</ThemeInitEffect>;
  }

  const myBranchName = branches.find((b) => b.id === user.branch_id)?.name;

  return (
    <div className="app-shell flex h-dvh overflow-hidden">
      <ThemeInitEffect />
      {/* منوی کنار دسکتاپ */}
      <aside className="hidden lg:flex w-56 shrink-0 border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        {sidebar}
      </aside>

      {/* منوی کشویی موبایل */}
      <Dialog.Root open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 lg:hidden" />
          <Dialog.Content asChild aria-describedby={undefined} onCloseAutoFocus={(event) => { event.preventDefault(); (menuButtonRef.current?.getClientRects().length ? menuButtonRef.current : searchButtonRef.current)?.focus(); }}>
            <aside id="mobile-navigation" className="fixed right-0 top-0 z-50 h-dvh w-72 max-w-[85vw] bg-white shadow-xl dark:bg-zinc-900 lg:hidden">
              <Dialog.Title className="sr-only">منوی اصلی</Dialog.Title>
              {sidebar}
            </aside>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* نوار بالا */}
        <header className="flex h-14 shrink-0 items-center gap-1.5 border-b border-zinc-200 bg-white px-2 sm:gap-2 sm:px-4 dark:border-zinc-800 dark:bg-zinc-900">
          <button ref={menuButtonRef} className="btn-ghost btn-sm btn-icon lg:hidden" onClick={() => setSidebarOpen(true)} aria-label="باز کردن منو" aria-controls="mobile-navigation" aria-expanded={sidebarOpen}><Icon name="menu" size={18} /></button>
          <button
            ref={searchButtonRef}
            disabled={integrationMode}
            onClick={() => setSearchOpen(true)}
            aria-label="جستجو"
            className="flex h-9 min-w-9 max-w-[9rem] flex-1 items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-400 hover:border-zinc-300 md:max-w-[13rem] xl:max-w-md dark:border-zinc-800 dark:bg-zinc-800/50 dark:hover:border-zinc-700"
          >
            <Icon name="search" size={16} className="shrink-0 opacity-60" />
            <span className="hidden min-w-0 flex-1 truncate text-right sm:block">جستجوی مشتری، پذیرش، قطعه…</span>
            <kbd className="hidden shrink-0 rounded border border-zinc-200 px-1.5 text-xs dark:border-zinc-700 sm:inline">Ctrl+K</kbd>
          </button>

          {!online && <span className="badge-red">آفلاین — تغییرات ممکن است ذخیره نشوند</span>}

          <div className="mr-auto flex items-center gap-1.5">
            {!integrationMode&&hasPerm(perms, "repairs.create") && (
              <Link href="/repairs/new" className="btn-primary btn-sm hidden sm:inline-flex">+ پذیرش جدید</Link>
            )}

            {canSwitchBranch ? (
              <BranchSelect
                branches={branches}
                value={branchSel}
                pending={branchPending}
                onChange={(v) => {
                  setBranchSel(v);
                  document.cookie = `repaid_branch=${v}; path=/; max-age=31536000; samesite=lax`;
                  startBranchTransition(()=>router.refresh());
                }}
              />
            ) : (
              myBranchName && (
                <span className="hidden items-center gap-1.5 rounded-lg border border-zinc-200 px-2 py-1.5 text-xs text-zinc-500 md:inline-flex dark:border-zinc-800 dark:text-zinc-400">
                  <Icon name="branch" size={13} className="opacity-70" />
                  {myBranchName}
                </span>
              )
            )}

            <div className="relative" ref={notifRef}>
              <button className="btn-ghost btn-sm btn-icon relative" aria-label="اعلان‌ها" aria-expanded={notifOpen} onClick={() => { setNotifOpen((v) => !v); if (!notifOpen) loadNotifs(); }}>
                <Icon name="bell" size={17} />
                {unread > 0 && (
                  <span className="absolute -top-0.5 -left-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                    {unread > 9 ? "۹+" : unread}
                  </span>
                )}
              </button>
              {notifOpen && (
                <div className="menu-panel left-0 top-11 w-[min(20rem,calc(100vw-1.5rem))] p-0">
                  <div className="menu-head">
                    <span>اعلان‌ها</span>
                    <button
                      className="btn-ghost btn-sm text-brand-600"
                      disabled={notifBusy||notifLoading||unread===0}
                      onClick={() => void markNotification({action:'mark_all_read'})}
                    >
                      خواندن همه
                    </button>
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {notifError&&<div className="p-3 text-sm" role="alert"><p>{notifError}</p><button className="btn-secondary btn-sm mt-2" disabled={notifLoading||notifBusy} onClick={()=>{setNotifLoading(true);void loadNotifs();}}>تلاش دوباره</button></div>}
                    {notifLoading&&notifs.length===0&&<p className="p-3 text-sm text-zinc-500" role="status">در حال دریافت اعلان‌ها…</p>}
                    {!notifLoading&&!notifError&&notifs.length === 0 && <div className="px-3 py-6 text-center text-sm text-zinc-400">اعلانی وجود ندارد</div>}
                    {notifs.map((n: any) => (
                      <button
                        key={n.id}
                        disabled={notifBusy}
                        onClick={async () => {
                          if(!n.read&&!await markNotification({action:'mark_read',id:n.id}))return;
                          setNotifOpen(false);
                          if(n.link){if(!integrationMode||/^\/(customers|devices|chat|repairs|appointments|complaints)(\/|\?|$)/.test(n.link)||n.link==='/')router.push(n.link);else toast('صفحهٔ مرتبط هنوز به PostgreSQL منتقل نشده است.','error');}
                        }}
                        className={`block w-full border-b border-zinc-100 px-3 py-2.5 text-right hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/50 ${n.read ? "opacity-60" : ""}`}
                      >
                        <div className="flex items-center gap-2">
                          {n.priority === "high" && <span className="badge-red">!</span>}
                          <span className="text-[13px] font-medium">{n.title}</span>
                        </div>
                        <div className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{n.body}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <ThemeToggle />

            <div className="relative" ref={userMenuRef}>
              <button onClick={() => setUserMenu((v) => !v)} className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="منوی کاربر" aria-expanded={userMenu}>
                <Avatar name={user.name} color={user.avatar_color} />
                <span className="hidden md:block text-[13px] font-medium">{user.name.split(" ")[0]}</span>
              </button>
              {userMenu && (
                <div className="menu-panel left-0 top-11 w-56">
                  <div className="px-2.5 py-2">
                    <div className="text-[13px] font-semibold">{user.name}</div>
                    <div className="text-xs text-zinc-500">{user.email}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <span className="badge-blue">{ROLE_FA[user.role] ?? user.role}</span>
                      {myBranchName && <span className="badge-gray">{myBranchName}</span>}
                    </div>
                  </div>
                  {hasPerm(perms, "settings.view") && (
                    <Link href={integrationMode?'/settings/repair-workflow':'/settings'} className="menu-item"><Icon name="settings" size={15} /> {integrationMode?'تنظیمات ارجاع':'تنظیمات'}</Link>
                  )}
                  {!integrationMode&&hasPerm(perms, "team.view") && (
                    <Link href="/team" className="menu-item"><Icon name="users" size={15} /> کارکنان و دسترسی‌ها</Link>
                  )}
                  <ChangePasswordModal onDone={() => setUserMenu(false)} />
                  <form action="/api/auth/logout" method="post"><button type="submit" className="menu-item w-full text-red-600 dark:text-red-400"><Icon name="logout" size={15} /> خروج از حساب</button></form>
                </div>
              )}
            </div>
          </div>
        </header>

        {!online && (
          <div className="bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 text-xs px-4 py-1.5 text-center">
            شما آفلاین هستید — داده‌های نمایش‌داده‌شده ممکن است قدیمی باشند. عملیات به‌جای ذخیره ناموفق، با خطا متوقف می‌شوند.
          </div>
        )}

        {/* تنها ناحیهٔ اسکرول عمودی برنامه — صفحه‌ها نباید اسکرول تودرتو بسازند */}
        <NotificationAnnouncements userId={user.id} branch={activeBranchId}/><main id="main-content" className="min-h-0 flex-1 overflow-y-auto">{children}</main>

        {/* ناوبری پایین موبایل */}
        <nav className="lg:hidden flex h-14 shrink-0 items-stretch border-t border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900" aria-label="ناوبری موبایل">
          {mobileNav.map((item) => (
            <Link key={item.href} href={item.href} className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 text-xs ${active(item.href) ? "text-brand-600 dark:text-brand-400" : "text-zinc-500"}`}>
              <Icon name={item.icon} size={20} className="shrink-0" />
              {item.href === "/chat" && chatUnread > 0 && (
                <span className="absolute top-1 right-[calc(50%+10px)] inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                  {chatUnread > 9 ? "۹+" : faCount(chatUnread)}
                </span>
              )}
              {item.label}
            </Link>
          ))}
          <button
            onClick={() => setSidebarOpen(true)}
            className="flex flex-1 flex-col items-center justify-center gap-0.5 text-xs text-zinc-500"
            aria-label="همهٔ بخش‌ها"
          >
            <Icon name="menu" size={20} className="shrink-0" />
            بیشتر
          </button>
        </nav>
      </div>

      {searchOpen && <GlobalSearch onClose={() => setSearchOpen(false)} />}
    </div>
  );
}

function GlobalSearch({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    if (!q.trim()) { setResults(null); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        setResults(await res.json());
      } catch {}
      setLoading(false);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onClose]);

  const go = (href: string) => { onClose(); router.push(href); };

  const groups = results
    ? Object.entries(results as Record<string, any[]>).filter(([, items]) => items.length > 0)
    : [];

  const ICONS: Record<string, string> = {
    tickets: "wrench", customers: "user", devices: "phone", parts: "package", invoices: "receipt", suppliers: "factory", pos: "cart",
  };
  const LABELS: Record<string, string> = {
    tickets: "پذیرش‌ها", customers: "مشتریان", devices: "دستگاه‌ها", parts: "قطعات", invoices: "فاکتورها", suppliers: "تأمین‌کنندگان",
  };

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="جستجوی سراسری">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative mx-auto mt-[8vh] w-[92%] max-w-xl card shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-800 px-4">
          <Icon name="search" size={16} className="shrink-0 opacity-60" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="جستجو با نام، تلفن، IMEI، سریال، شماره پذیرش، کد کالا…"
            className="w-full bg-transparent py-3.5 text-sm outline-none placeholder:text-zinc-400"
          />
          {loading && <span className="skeleton h-4 w-4 rounded-full" />}
          <kbd className="rounded border border-zinc-200 px-1.5 text-xs text-zinc-400 dark:border-zinc-700">Esc</kbd>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {!q.trim() && (
            <div className="px-3 py-8 text-center text-sm text-zinc-400">
              شماره تلفن، IMEI، سریال، شماره پذیرش، نام مشتری یا کد کالا را وارد کنید
            </div>
          )}
          {q.trim() && groups.length === 0 && !loading && (
            <div className="px-3 py-8 text-center text-sm text-zinc-400">نتیجه‌ای برای «{q}» یافت نشد</div>
          )}
          {groups.map(([group, items]) => (
            <div key={group} className="mb-2">
              <div className="menu-section">{LABELS[group] ?? group}</div>
              {(items as any[]).slice(0, 6).map((item) => (
                <button key={item.id} onClick={() => go(item.href)} className="menu-item">
                  <Icon name={ICONS[group] ?? "dot"} size={15} className="shrink-0 opacity-70" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{item.title}</span>
                    <span className="block truncate text-xs text-zinc-500">{item.subtitle}</span>
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
