"use client";

import { useEffect, useState } from "react";
import { Avatar, EmptyState, Modal, Skeleton } from "@/components/ui";
import { Icon } from "@/components/icon";
import { type ChatUserBrief } from "@/lib/chat-shared";
import { chatFetch, colorFor, dayLabel, fmtClock } from "./chat-helpers";

const ROLE_FA: Record<string, string> = {
  owner: "مالک", admin: "مدیر سیستم", manager: "مدیر", reception: "پذیرش",
  technician: "تعمیرکار", inventory: "انباردار", accountant: "حسابدار", sales: "فروشنده",
};

export function NewConversationModal({
  open,
  onClose,
  perms,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  perms: string[];
  onCreated: (conversationId: number) => void;
}) {
  const has = (p: string) => perms.includes("*") || perms.includes(p) || perms.includes(p.split(".")[0] + ".*");
  const canDm = has("chat.dm");
  const canGroup = has("chat.group.create");
  const canChannel = has("chat.channel.create");
  const [type, setType] = useState<"direct" | "group" | "channel">(canDm ? "direct" : canGroup ? "group" : "channel");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle("");
      setDescription("");
      setSelected([]);
      setError(null);
      setType(canDm ? "direct" : canGroup ? "group" : "channel");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const body =
        type === "direct"
          ? { type, user_id: selected[0] }
          : { type, title: title.trim(), description: description.trim(), member_ids: selected };
      const data = await chatFetch<{ id: number }>("/api/chat/conversations", { method: "POST", body: JSON.stringify(body) });
      onCreated(data.id);
      onClose();
    } catch (e: any) {
      setError(e?.message ?? "ساخت مکالمه ناموفق بود");
    } finally {
      setBusy(false);
    }
  };

  const disabled =
    busy || (type === "direct" ? selected.length !== 1 : !title.trim() || (type === "group" && selected.length === 0));
  const noCreatePerm = !canDm && !canGroup && !canChannel;

  return (
    <Modal open={open} onClose={onClose} title="گفت‌وگوی جدید">
      {noCreatePerm ? (
        <p className="py-4 text-center text-sm text-zinc-500">
          برای شروع گفت‌وگو یا ساخت گروه، از مدیر سیستم بخواهید مجوز «شروع گفتگوی خصوصی» یا «ساخت گروه» را به شما بدهد.
        </p>
      ) : (
        <>
      <div className="flex gap-1.5" role="tablist" aria-label="نوع مکالمه">
        {canDm && (
          <button role="tab" aria-selected={type === "direct"} className={`filter-chip ${type === "direct" ? "filter-chip-active" : "filter-chip-idle"}`} onClick={() => { setType("direct"); setSelected([]); }}>
            خصوصی
          </button>
        )}
        {canGroup && (
          <button role="tab" aria-selected={type === "group"} className={`filter-chip ${type === "group" ? "filter-chip-active" : "filter-chip-idle"}`} onClick={() => { setType("group"); setSelected([]); }}>
            گروه کاری
          </button>
        )}
        {canChannel && (
          <button role="tab" aria-selected={type === "channel"} className={`filter-chip ${type === "channel" ? "filter-chip-active" : "filter-chip-idle"}`} onClick={() => { setType("channel"); setSelected([]); }}>
            کانال اطلاع‌رسانی
          </button>
        )}
      </div>

      {type !== "direct" && (
        <div className="mt-3 space-y-2.5">
          <div>
            <label className="label" htmlFor="chat-title">نام {type === "channel" ? "کانال" : "گروه"}</label>
            <input id="chat-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={type === "channel" ? "مثلاً اطلاعیه‌های مدیریت" : "مثلاً هماهنگی تعمیرکاران"} />
          </div>
          <div>
            <label className="label" htmlFor="chat-desc">توضیح (اختیاری)</label>
            <textarea id="chat-desc" className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
      )}

      <div className="mt-3">
        <div className="label">
          {type === "direct" ? "انتخاب همکار" : selected.length > 0 ? `اعضا (${selected.length.toLocaleString("fa-IR")} نفر)` : "انتخاب اعضا"}
        </div>
        <UserPicker
          multi={type !== "direct"}
          selected={selected}
          onChange={(ids) => setSelected(ids)}
        />
      </div>

      {type === "channel" && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-zinc-400">
          <Icon name="info" size={13} />
          ارسال پیام در کانال فقط برای سازنده، مدیران کانال و دارندگان دسترسی «انتشار در کانال» ممکن است.
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-secondary" onClick={onClose}>انصراف</button>
        {!noCreatePerm && (
          <button className="btn-primary" disabled={disabled} onClick={() => void submit()}>
            {busy ? "در حال ساخت…" : type === "direct" ? "شروع گفت‌وگو" : "ساخت"}
          </button>
        )}
      </div>
        </>
      )}
    </Modal>
  );
}

export function UserPicker({
  multi,
  selected,
  onChange,
  exclude = [],
}: {
  multi: boolean;
  selected: number[];
  onChange: (ids: number[]) => void;
  exclude?: number[];
}) {
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<ChatUserBrief[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const data = await chatFetch<{ users: ChatUserBrief[] }>(`/api/chat/users?q=${encodeURIComponent(q)}`);
        if (alive) {
          setUsers(data.users.filter((u) => !exclude.includes(u.id)));
          setError(null);
        }
      } catch (e: any) {
        if (alive) setError(e?.message ?? "بارگذاری کارکنان ناموفق بود");
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const toggle = (id: number) => {
    if (!multi) onChange([id]);
    else if (selected.includes(id)) onChange(selected.filter((x) => x !== id));
    else onChange([...selected, id]);
  };

  return (
    <div>
      <input className="input !py-1.5 text-[13px]" value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجوی نام کارمند…" aria-label="جستجوی کارمند" />
      <div className="mt-1.5 max-h-52 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        {users === null && (
          <div className="space-y-2 p-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-9 w-full" />)}
          </div>
        )}
        {error && <p className="p-3 text-xs text-red-600 dark:text-red-400">{error}</p>}
        {users && users.length === 0 && <p className="p-3 text-center text-xs text-zinc-400">کارمندی یافت نشد.</p>}
        {users?.map((u) => {
          const on = selected.includes(u.id);
          return (
            <button
              key={u.id}
              onClick={() => toggle(u.id)}
              aria-pressed={on}
              className={`flex w-full items-center gap-2.5 px-2.5 py-2 text-right transition-colors ${on ? "bg-brand-50 dark:bg-brand-500/10" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"}`}
            >
              <span className="relative shrink-0">
                <Avatar name={u.name} color={colorFor(u.name, u.avatar_color)} size={32} />
                {u.online && <span className="absolute -bottom-0 -left-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500 dark:border-zinc-900" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{u.name}</span>
                <span className="block truncate text-[11px] text-zinc-400">
                  {ROLE_FA[u.role] ?? u.role}
                  {u.branch_name ? ` · ${u.branch_name}` : ""}
                </span>
              </span>
              {on && <Icon name="check-circle" size={16} className="shrink-0 text-brand-600" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function AddMembersModal({
  open,
  onClose,
  existingIds,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  existingIds: number[];
  onAdd: (userIds: number[]) => Promise<void> | void;
}) {
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelected([]);
      setError(null);
    }
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="افزودن عضو به گروه">
      <UserPicker multi selected={selected} onChange={setSelected} exclude={existingIds} />
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-secondary" onClick={onClose}>انصراف</button>
        <button
          className="btn-primary"
          disabled={busy || selected.length === 0}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onAdd(selected);
              onClose();
            } catch (e: any) {
              setError(e?.message ?? "افزودن عضو ناموفق بود");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "در حال افزودن…" : `افزودن ${selected.length > 0 ? `(${selected.length.toLocaleString("fa-IR")})` : ""}`}
        </button>
      </div>
    </Modal>
  );
}

export type SearchResult = {
  id: number;
  conversation_id: number;
  conversation_title: string;
  conversation_type: string;
  sender_name: string | null;
  snippet: string;
  highlight_start: number;
  highlight_len: number;
  created_at: string;
  has_attachment: boolean;
  mentions_me: boolean;
};

export function ChatSearchModal({
  open,
  onClose,
  conversationId,
  conversationTitle,
  onJump,
}: {
  open: boolean;
  onClose: () => void;
  conversationId: number | null;
  conversationTitle?: string;
  onJump: (conversationId: number, messageId: number) => void;
}) {
  const [q, setQ] = useState("");
  const [scopeConv, setScopeConv] = useState(conversationId != null);
  const [hasFile, setHasFile] = useState(false);
  const [hasMention, setHasMention] = useState(false);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setScopeConv(conversationId != null);
      setResults(null);
      setError(null);
      setHasFile(false);
      setHasMention(false);
    }
  }, [open, conversationId]);

  useEffect(() => {
    if (!open) return;
    if (q.trim().length < 2) {
      setResults(null);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: q.trim() });
        if (scopeConv && conversationId != null) params.set("conversation_id", String(conversationId));
        if (hasFile) params.set("has_file", "1");
        if (hasMention) params.set("has_mention", "1");
        const data = await chatFetch<{ results: SearchResult[] }>(`/api/chat/search?${params.toString()}`);
        setResults(data.results);
        setError(null);
      } catch (e: any) {
        setError(e?.message ?? "جست‌وجو ناموفق بود");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [q, scopeConv, hasFile, hasMention, conversationId, open]);

  const highlight = (r: SearchResult) => {
    const s = Math.max(0, r.highlight_start);
    const before = r.snippet.slice(0, s);
    const word = r.snippet.slice(s, s + r.highlight_len);
    const after = r.snippet.slice(s + r.highlight_len);
    return (
      <>
        {before}
        <mark className="rounded bg-amber-100 px-0.5 dark:bg-amber-500/25">{word}</mark>
        {after}
      </>
    );
  };

  return (
    <Modal open={open} onClose={onClose} title="جستجوی پیام‌ها" wide>
      <div className="flex flex-wrap items-center gap-2">
        <span className="relative min-w-40 flex-1">
          <Icon name="search" size={15} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            autoFocus
            className="input !pr-8"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="حداقل ۲ نویسه — مثال: برد شارژ"
            aria-label="عبارت جستجو"
          />
        </span>
        {conversationId != null && (
          <button className={`filter-chip ${scopeConv ? "filter-chip-active" : "filter-chip-idle"}`} onClick={() => setScopeConv((v) => !v)} role="switch" aria-checked={scopeConv}>
            فقط «{conversationTitle ?? "همین مکالمه"}»
          </button>
        )}
        <button className={`filter-chip ${hasFile ? "filter-chip-active" : "filter-chip-idle"}`} onClick={() => setHasFile((v) => !v)} role="switch" aria-checked={hasFile}>
          دارای فایل
        </button>
        <button className={`filter-chip ${hasMention ? "filter-chip-active" : "filter-chip-idle"}`} onClick={() => setHasMention((v) => !v)} role="switch" aria-checked={hasMention}>
          منشن من
        </button>
      </div>

      <div className="mt-3 max-h-[55vh] overflow-y-auto">
        {q.trim().length < 2 && <p className="py-8 text-center text-sm text-zinc-400">عبارت جست‌وجو را وارد کنید — در همهٔ مکالمه‌هایی که عضو آن‌ها هستید جست‌وجو می‌شود.</p>}
        {loading && q.trim().length >= 2 && (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        )}
        {error && <p className="py-4 text-center text-sm text-red-600 dark:text-red-400">{error}</p>}
        {!loading && results && results.length === 0 && q.trim().length >= 2 && (
          <EmptyState icon="file-search" title="نتیجه‌ای نیست" body="عبارت دیگری امتحان کنید یا فیلترها را بردارید." />
        )}
        {!loading &&
          results?.map((r) => (
            <button
              key={r.id}
              className="block w-full rounded-lg border-b border-zinc-100 px-2 py-2.5 text-right hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/50"
              onClick={() => {
                onJump(r.conversation_id, r.id);
                onClose();
              }}
            >
              <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                <Icon name={r.conversation_type === "channel" ? "megaphone" : r.conversation_type === "direct" ? "user" : "users"} size={12} />
                <span className="font-medium text-zinc-500 dark:text-zinc-300">{r.conversation_title}</span>
                <span>·</span>
                <span>{r.sender_name ?? "سیستمی"}</span>
                <span className="mr-auto flex items-center gap-1.5">
                  {r.has_attachment && <Icon name="paperclip" size={12} />}
                  {r.mentions_me && <span className="badge-blue !py-0 !text-[9px]">منشن شما</span>}
                  {dayLabel(r.created_at)} {fmtClock(r.created_at)}
                </span>
              </div>
              <div className="mt-1 line-clamp-2 text-[13px] text-zinc-700 dark:text-zinc-200" dir="auto">
                {highlight(r)}
              </div>
            </button>
          ))}
      </div>
    </Modal>
  );
}

export function ImageLightbox({
  images,
  activeId,
  onClose,
  onNavigate,
}: {
  images: number[];
  activeId: number;
  onClose: () => void;
  onNavigate: (id: number) => void;
}) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      const idx = images.indexOf(activeId);
      if (e.key === "ArrowLeft" && idx < images.length - 1) onNavigate(images[idx + 1]);
      if (e.key === "ArrowRight" && idx > 0) onNavigate(images[idx - 1]);
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [images, activeId, onClose, onNavigate]);

  const idx = images.indexOf(activeId);
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/85 p-4" role="dialog" aria-modal="true" aria-label="نمایش تصویر">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative z-10 flex max-h-full max-w-full flex-col items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/chat/attachments/${activeId}`} alt="تصویر پیوست" className="max-h-[80vh] max-w-full rounded-lg object-contain" />
        <div className="mt-2 flex items-center gap-2">
          <button className="btn-secondary btn-sm" onClick={onClose}>بستن</button>
          <a className="btn-secondary btn-sm" href={`/api/chat/attachments/${activeId}`} download>دانلود</a>
          {images.length > 1 && (
            <span className="text-xs text-white/70">
              {(idx + 1).toLocaleString("fa-IR")} از {images.length.toLocaleString("fa-IR")}
            </span>
          )}
        </div>
      </div>
      {images.length > 1 && idx > 0 && (
        <button className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20" onClick={() => onNavigate(images[idx - 1])} aria-label="تصویر قبلی">
          <Icon name="chevron-right" size={22} />
        </button>
      )}
      {images.length > 1 && idx < images.length - 1 && (
        <button className="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20" onClick={() => onNavigate(images[idx + 1])} aria-label="تصویر بعدی">
          <Icon name="chevron-left" size={22} />
        </button>
      )}
    </div>
  );
}

export function ConfirmModal({
  open,
  title,
  body,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="text-sm text-zinc-600 dark:text-zinc-300">{body}</p>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-secondary" onClick={onClose}>انصراف</button>
        <button className={danger ? "btn-danger" : "btn-primary"} disabled={busy} onClick={onConfirm}>
          {busy ? "در حال انجام…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
