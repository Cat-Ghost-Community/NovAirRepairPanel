"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/ui";
import { hasPerm } from "@/lib/perms-shared";
import { toast } from "sonner";
import type {
  ChatConversationDetails,
  ChatConversationListItem,
  ChatFilter,
  ChatMessage,
  ChatMemberInfo,
} from "@/lib/chat-shared";
import { chatFetch } from "./chat-helpers";
import { ChatSidebar } from "./chat-sidebar";
import { ChatWindow } from "./chat-window";
import { ChatInfo } from "./chat-info";
import { AddMembersModal, ChatSearchModal, ConfirmModal, ImageLightbox, NewConversationModal } from "./chat-modals";
import type { SendInput } from "./chat-composer";

type EventPayload = { id: number; conversation_id: number; type: string; payload: any; actor_id: number | null };

export function ChatClient({
  me,
  perms,
  initialConversationId,
  initialMessageId,
}: {
  me: { id: number; name: string; avatar_color: string };
  perms: string[];
  initialConversationId: number | null;
  initialMessageId: number | null;
}) {
  const [conversations, setConversations] = useState<ChatConversationListItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ChatFilter>("all");
  const [q, setQ] = useState("");

  const [activeId, setActiveId] = useState<number | null>(initialConversationId);
  const activeRef = useRef<number | null>(initialConversationId);
  const [details, setDetails] = useState<ChatConversationDetails | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [members, setMembers] = useState<ChatMemberInfo[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [msgsLoading, setMsgsLoading] = useState(false);
  const [msgsError, setMsgsError] = useState<string | null>(null);
  const [dividerId, setDividerId] = useState<number | null>(null);
  const [highlightedId, setHighlightedId] = useState<number | null>(null);
  const [typing, setTyping] = useState<Array<{ conversation_id: number; user_id: number; name: string }>>([]);
  const [connOk, setConnOk] = useState(true);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [pane, setPane] = useState<"list" | "chat">(initialConversationId != null ? "chat" : "list");
  const [infoOpen, setInfoOpen] = useState(false);

  useEffect(() => {
    const desktop=window.matchMedia('(min-width: 1280px)');
    const update=()=>setInfoOpen(desktop.matches);
    update();
    desktop.addEventListener('change',update);
    return ()=>desktop.removeEventListener('change',update);
  }, []);

  const [newOpen, setNewOpen] = useState(false);
  const [addMembersOpen, setAddMembersOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchScoped, setSearchScoped] = useState(false);
  const [lightbox, setLightbox] = useState<{ images: number[]; activeId: number } | null>(null);
  const [confirmState, setConfirmState] = useState<{ title: string; body: string; label: string; danger?: boolean; action: () => void } | null>(null);
  const [enterToSend, setEnterToSend] = useState(true);
  const [browserNotify, setBrowserNotify] = useState(false);

  const cursorRef = useRef(0);
  const mutedRef = useRef<Map<number, boolean>>(new Map());
  const listRefreshRef = useRef<number | null>(null);
  const notifiedRef = useRef<Set<number>>(new Set());
  const lastReadSentRef = useRef<Map<number, number>>(new Map());
  const messagesRef = useRef<ChatMessage[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const canPinConv = hasPerm(perms, "chat.pin");
  const canModerate = hasPerm(perms, "chat.moderate");

  // ---- تنظیمات شخصی (محلی) ----
  useEffect(() => {
    try {
      const e = localStorage.getItem("chat_enter_send");
      if (e != null) setEnterToSend(e === "1");
      setBrowserNotify(localStorage.getItem("chat_browser_notify") === "1");
    } catch {}
  }, []);

  const toggleEnter = () => {
    setEnterToSend((v) => {
      try {
        localStorage.setItem("chat_enter_send", v ? "0" : "1");
      } catch {}
      return !v;
    });
  };
  const toggleBrowserNotify = async () => {
    if (browserNotify) {
      setBrowserNotify(false);
      try {
        localStorage.setItem("chat_browser_notify", "0");
      } catch {}
      return;
    }
    if (!("Notification" in window)) {
      toast.error("مرورگر شما از اعلان پشتیبانی نمی‌کند");
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm === "granted") {
      setBrowserNotify(true);
      try {
        localStorage.setItem("chat_browser_notify", "1");
      } catch {}
      toast.success("اعلان مرورگر روشن شد");
    } else {
      toast.error("دسترسی اعلان داده نشد — چت همچنان کار می‌کند");
    }
  };

  // ---- فهرست مکالمه‌ها ----
  const loadConversations = useCallback(async () => {
    try {
      const params = new URLSearchParams({ filter });
      if (q.trim()) params.set("q", q.trim());
      const data = await chatFetch<{ conversations: ChatConversationListItem[] }>(`/api/chat/conversations?${params.toString()}`);
      setConversations(data.conversations);
      const m = new Map<number, boolean>();
      for (const c of data.conversations) m.set(c.id, c.muted);
      mutedRef.current = m;
      setListError(null);
    } catch (e: any) {
      setListError(e?.message ?? "بارگذاری مکالمه‌ها ناموفق بود");
    } finally {
      setListLoading(false);
    }
  }, [filter, q]);

  useEffect(() => {
    setListLoading(true);
    const t = setTimeout(() => void loadConversations(), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [loadConversations, q]);

  const scheduleListRefresh = useCallback(() => {
    if (listRefreshRef.current != null) return;
    listRefreshRef.current = window.setTimeout(() => {
      listRefreshRef.current = null;
      void loadConversations();
    }, 900);
  }, [loadConversations]);

  // ---- خواندن: ثبت آخرین پیام خوانده‌شده ----
  const markRead = useCallback(
    async (conversationId: number, messageId: number) => {
      const last = lastReadSentRef.current.get(conversationId) ?? 0;
      if (messageId <= last) return;
      lastReadSentRef.current.set(conversationId, messageId);
      try {
        await chatFetch(`/api/chat/conversations/${conversationId}`, {
          method: "POST",
          body: JSON.stringify({ action: "read", last_message_id: messageId }),
        });
        setMembers((prev) => prev.map((m) => (m.user_id === me.id ? { ...m, last_read_message_id: messageId } : m)));
      } catch {}
    },
    [me.id]
  );

  // ---- باز کردن مکالمه ----
  const openConversation = useCallback(
    async (id: number, opts?: { jumpMessageId?: number | null; keepUrl?: boolean }) => {
      setActiveId(id);
      activeRef.current = id;
      setPane("chat");
      setMsgsLoading(true);
      setMsgsError(null);
      setHighlightedId(opts?.jumpMessageId ?? null);
      try {
        const [det, msgs] = await Promise.all([
          chatFetch<ChatConversationDetails>(`/api/chat/conversations/${id}`),
          opts?.jumpMessageId
            ? chatFetch<{ messages: ChatMessage[]; has_more: boolean; members: ChatMemberInfo[] }>(
                `/api/chat/conversations/${id}/messages?around_id=${opts.jumpMessageId}&limit=60`
              )
            : chatFetch<{ messages: ChatMessage[]; has_more: boolean; members: ChatMemberInfo[] }>(`/api/chat/conversations/${id}/messages?limit=50`),
        ]);
        setDetails(det);
        setMessages(msgs.messages);
        setMembers(msgs.members);
        setHasMore(msgs.has_more);
        if (!opts?.jumpMessageId) {
          const lastRead = det.conversation.last_read_message_id;
          const firstUnread = msgs.messages.find((m) => m.id > lastRead && m.sender_id !== me.id);
          setDividerId(firstUnread ? firstUnread.id : null);
        } else {
          setDividerId(null);
        }
        if (!opts?.keepUrl) {
          try {
            window.history.replaceState(null, "", `/chat?c=${id}`);
          } catch {}
        }
        // خواندن: پیام آخر همین حالا خوانده شد
        const maxId = msgs.messages.length ? msgs.messages[msgs.messages.length - 1].id : 0;
        if (maxId > det.conversation.last_read_message_id) void markRead(id, maxId);
        setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, unread_count: 0, mention_count: 0 } : c)));
      } catch (e: any) {
        setMsgsError(e?.message ?? "بارگذاری پیام‌ها ناموفق بود");
      } finally {
        setMsgsLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [me.id]
  );

  // ورود با پارامتر پیام (از جستجو/لینک)
  useEffect(() => {
    if (initialConversationId == null) return;
    void openConversation(initialConversationId, { jumpMessageId: initialMessageId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadOlder = useCallback(async () => {
    if (activeRef.current == null || messagesRef.current.length === 0) return;
    const firstId = messagesRef.current[0].id;
    try {
      const data = await chatFetch<{ messages: ChatMessage[]; has_more: boolean; members: ChatMemberInfo[] }>(
        `/api/chat/conversations/${activeRef.current}/messages?before_id=${firstId}&limit=40`
      );
      setMessages((prev) => [...data.messages, ...prev]);
      setMembers(data.members);
      setHasMore(data.has_more);
    } catch {}
  }, []);

  const applyMessagePatch = useCallback((msg: ChatMessage) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === msg.id);
      if (idx === -1) return prev;
      const next = [...prev];
      next[idx] = msg;
      return next;
    });
  }, []);

  const loadNewer = useCallback(async () => {
    if (activeRef.current == null) return;
    const list = messagesRef.current;
    const lastId = list.length ? list[list.length - 1].id : 0;
    try {
      const data = await chatFetch<{ messages: ChatMessage[]; has_more: boolean; members: ChatMemberInfo[] }>(
        `/api/chat/conversations/${activeRef.current}/messages?after_id=${lastId}&limit=60`
      );
      if (data.messages.length) {
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          return [...prev, ...data.messages.filter((m) => !seen.has(m.id))];
        });
        setMembers(data.members);
        if (document.hasFocus()) {
          const maxId = data.messages[data.messages.length - 1].id;
          void markRead(activeRef.current, maxId);
          setDividerId(null);
        }
      }
    } catch {}
  }, [markRead]);

  // ---- اعلان پیام‌های مکالمه‌های دیگر ----
  const maybeNotify = useCallback(
    (ev: EventPayload) => {
      if (notifiedRef.current.has(ev.id)) return;
      notifiedRef.current.add(ev.id);
      if (mutedRef.current.get(ev.conversation_id)) return;
      const hidden = typeof document !== "undefined" && document.hidden;
      if (!hidden && ev.conversation_id === activeRef.current) return;
      chatFetch<{ message: ChatMessage }>(`/api/chat/messages/${ev.payload?.message_id}`)
        .then(({ message }) => {
          const sender = message.sender_name ?? "همکار";
          const text = message.body?.slice(0, 80) || "پیوست فرستاد";
          if (hidden && browserNotify && typeof Notification !== "undefined" && Notification.permission === "granted") {
            const n = new Notification(`پیام از ${sender}`, { body: text, tag: `chat-${message.conversation_id}` });
            n.onclick = () => {
              window.focus();
              void openConversation(message.conversation_id);
            };
          } else if (!hidden) {
            toast.info(`${sender}: ${text}`);
          }
        })
        .catch(() => {});
    },
    [browserNotify, openConversation]
  );

  // ---- جریان رویدادها ----
  const handleEvents = useCallback(
    async (events: EventPayload[]) => {
      if (events.length === 0) return;
      const active = activeRef.current;
      const patchIds: number[] = [];
      const touched = new Set<number>();
      let needNewer = false;

      for (const ev of events) {
        switch (ev.type) {
          case "message_new": {
            touched.add(ev.conversation_id);
            if (ev.conversation_id === active) needNewer = true;
            else if (ev.actor_id !== me.id) maybeNotify(ev);
            break;
          }
          case "message_edit":
          case "message_delete":
          case "reaction":
          case "message_pin": {
            if (ev.payload?.message_id != null && ev.conversation_id === active) patchIds.push(Number(ev.payload.message_id));
            break;
          }
          case "read": {
            if (ev.conversation_id === active) {
              setMembers((prev) =>
                prev.map((m) => (m.user_id === Number(ev.payload?.user_id) ? { ...m, last_read_message_id: Number(ev.payload?.last_read_message_id ?? 0) } : m))
              );
            }
            break;
          }
          case "member_update":
          case "conversation_update":
          case "conversation_created": {
            touched.add(ev.conversation_id);
            if (ev.conversation_id === active) {
              chatFetch<ChatConversationDetails>(`/api/chat/conversations/${active}`)
                .then((det) => {
                  setDetails(det);
                  setMembers(det.members);
                })
                .catch(() => {});
            }
            break;
          }
        }
      }

      if (needNewer) await loadNewer();
      for (const id of [...new Set(patchIds)].slice(0, 20)) {
        try {
          const data = await chatFetch<{ message: ChatMessage; members: ChatMemberInfo[] }>(`/api/chat/messages/${id}`);
          applyMessagePatch(data.message);
          if (data.members?.length) setMembers(data.members);
        } catch {}
      }
      if (touched.size > 0) scheduleListRefresh();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [me.id, loadNewer, applyMessagePatch, scheduleListRefresh]
  );

  useEffect(() => {
    let alive = true;
    let timer: number;
    const tick = async () => {
      // تب مخفی: polling را متوقف کن (نشان Shell بودجهٔ خودش را دارد) تا سرور/dev
      // با درخواست‌های بی‌مورد اشباع نشود.
      if (typeof document !== "undefined" && document.hidden) {
        if (alive) timer = window.setTimeout(tick, 10000);
        return;
      }
      try {
        const url = `/api/chat/events?cursor=${cursorRef.current}${activeRef.current ? `&active=${activeRef.current}` : ""}`;
        const data = await chatFetch<{
          cursor: number;
          events: EventPayload[];
          typing: Array<{ conversation_id: number; user_id: number; name: string }>;
          presence: Array<{ user_id: number; online: boolean; last_seen_at: string | null }>;
          unread_total: number;
        }>(url);
        cursorRef.current = data.cursor;
        setConnOk(true);
        setTyping(data.typing);
        if (data.presence.length) {
          const map = new Map(data.presence.map((p) => [p.user_id, p]));
          setMembers((prev) =>
            prev.map((m) => {
              const p = map.get(m.user_id);
              return p ? { ...m, online: p.online, last_seen_at: p.last_seen_at } : m;
            })
          );
          setDetails((prev) => {
            if (!prev?.conversation.dm_user) return prev;
            const p = map.get(prev.conversation.dm_user.id);
            return p
              ? { ...prev, conversation: { ...prev.conversation, dm_user: { ...prev.conversation.dm_user, online: p.online, last_seen_at: p.last_seen_at } } }
              : prev;
          });
          setConversations((prev) =>
            prev.map((c) => {
              if (!c.dm_user) return c;
              const p = map.get(c.dm_user.id);
              return p ? { ...c, dm_user: { ...c.dm_user, online: p.online, last_seen_at: p.last_seen_at } } : c;
            })
          );
        }
        await handleEvents(data.events);
      } catch {
        setConnOk(false);
      }
      if (alive) timer = window.setTimeout(tick, 3000);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- اکشن‌ها ----
  const sendMessage = useCallback(
    async (input: SendInput) => {
      if (activeRef.current == null) return;
      const clientKey = `${me.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const data = await chatFetch<{ message: ChatMessage; duplicate: boolean }>(`/api/chat/conversations/${activeRef.current}/messages`, {
        method: "POST",
        body: JSON.stringify({
          body: input.body,
          client_key: clientKey,
          reply_to_id: input.replyTo,
          attachment_ids: input.attachments.map((a) => a.id).filter(Boolean),
          mentions: input.mentions,
        }),
      });
      if (!data.duplicate) {
        setMessages((prev) => (prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message]));
      }
      setDrafts((prev) => ({ ...prev, [activeRef.current!]: "" }));
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeRef.current
            ? {
                ...c,
                last_message: { sender_name: me.name, body: input.body.slice(0, 90), kind: "text", created_at: data.message.created_at, mine: true },
                last_message_at: data.message.created_at,
              }
            : c
        )
      );
      scheduleListRefresh();
    },
    [me.id, me.name, scheduleListRefresh]
  );

  const editMessage = useCallback(async (id: number, body: string) => {
    await chatFetch(`/api/chat/messages/${id}`, { method: "POST", body: JSON.stringify({ action: "edit", body }) });
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, body, edited_at: new Date().toISOString().slice(0, 19).replace("T", " ") } : m)));
    toast.success("پیام ویرایش شد");
  }, []);

  const deleteMessage = useCallback(
    async (id: number) => {
      await chatFetch(`/api/chat/messages/${id}`, { method: "POST", body: JSON.stringify({ action: "delete" }) });
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, body: "", deleted_at: "x", attachments: [], reactions: [], reply_to: m.reply_to } : m)));
      toast.success("پیام حذف شد");
      scheduleListRefresh();
    },
    [scheduleListRefresh]
  );

  const reactMessage = useCallback(
    async (id: number, emoji: string) => {
      const apply = (m: ChatMessage): ChatMessage => {
        const list = [...m.reactions];
        const idx = list.findIndex((r) => r.emoji === emoji);
        if (idx === -1) list.push({ emoji, count: 1, mine: true });
        else {
          const r = list[idx];
          if (r.mine) {
            if (r.count <= 1) list.splice(idx, 1);
            else list[idx] = { ...r, count: r.count - 1, mine: false };
          } else list[idx] = { ...r, count: r.count + 1, mine: true };
        }
        return { ...m, reactions: list };
      };
      setMessages((prev) => prev.map((m) => (m.id === id ? apply(m) : m)));
      try {
        await chatFetch(`/api/chat/messages/${id}`, { method: "POST", body: JSON.stringify({ action: "react", emoji }) });
      } catch (e: any) {
        toast.error(e?.message ?? "ثبت واکنش ناموفق بود");
      }
    },
    []
  );

  const pinMessage = useCallback(async (id: number, pinned: boolean) => {
    try {
      await chatFetch(`/api/chat/messages/${id}`, { method: "POST", body: JSON.stringify({ action: pinned ? "pin" : "unpin" }) });
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, pinned } : m)));
      toast.success(pinned ? "پیام سنجاق شد" : "سنجاق پیام برداشته شد");
    } catch (e: any) {
      toast.error(e?.message ?? "سنجاق ناموفق بود");
    }
  }, []);

  const convAction = useCallback(
    async (convId: number, body: Record<string, unknown>) => {
      await chatFetch(`/api/chat/conversations/${convId}`, { method: "POST", body: JSON.stringify(body) });
    },
    []
  );

  const onTyping = useCallback(() => {
    if (activeRef.current == null) return;
    void fetch(`/api/chat/conversations/${activeRef.current}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "typing", typing: true }),
      keepalive: true,
    }).catch(() => {});
  }, []);

  // ---- جستجو → پرش ----
  const jumpToMessage = useCallback(
    (conversationId: number, messageId: number) => {
      void openConversation(conversationId, { jumpMessageId: messageId });
    },
    [openConversation]
  );

  // ---- مودال‌های تأیید ----
  const askLeave = () => {
    if (activeId == null || !details) return;
    const id = activeId;
    setConfirmState({
      title: "ترک مکالمه؟",
      body: `با ترک «${details.conversation.title}» دیگر پیام‌های جدید آن را نمی‌بینید. تاریخچهٔ پیام‌های شما حفظ می‌شود.`,
      label: "ترک مکالمه",
      danger: true,
      action: async () => {
        await convAction(id, { action: "leave" });
        setConfirmState(null);
        setActiveId(null);
        activeRef.current = null;
        setDetails(null);
        setMessages([]);
        scheduleListRefresh();
        toast.success("از مکالمه خارج شدید");
      },
    });
  };

  const askRemoveMember = (userId: number) => {
    if (activeId == null || !details) return;
    const id = activeId;
    const name = details.members.find((m) => m.user_id === userId)?.name ?? "این کاربر";
    setConfirmState({
      title: "حذف عضو؟",
      body: `${name} از گروه حذف می‌شود. پیام‌های قبلی او در تاریخچه باقی می‌ماند.`,
      label: "حذف عضو",
      danger: true,
      action: async () => {
        await convAction(id, { action: "remove_member", user_id: userId });
        setConfirmState(null);
      },
    });
  };

  const activeConv = useMemo(() => conversations.find((c) => c.id === activeId) ?? details?.conversation ?? null, [conversations, activeId, details]);

  const typingText = useMemo(() => {
    if (activeId == null) return null;
    const list = typing.filter((t) => t.conversation_id === activeId && t.user_id !== me.id);
    if (list.length === 0) return null;
    if (activeConv?.type === "direct") return "در حال نوشتن…";
    const names = list.slice(0, 2).map((t) => t.name.split(" ")[0]);
    return `${names.join("، ")} در حال نوشتن…`;
  }, [typing, activeId, me.id, activeConv?.type]);

  const typingNames = useMemo(() => {
    const map: Record<number, string | null> = {};
    for (const t of typing) if (t.user_id !== me.id) map[t.conversation_id] = t.name.split(" ")[0] ?? null;
    return map;
  }, [typing, me.id]);

  // تصاویر مکالمهٔ فعال برای لایت‌باکس
  const conversationImageIds = useMemo(
    () => messages.flatMap((m) => (m.deleted_at ? [] : m.attachments.filter((a) => a.mime.startsWith("image/")).map((a) => a.id))),
    [messages]
  );

  return (
    <div className="flex h-full min-h-0">
      {/* ناحیهٔ ۱: فهرست */}
      <aside className={`${pane === "chat" && activeId != null ? "hidden lg:flex" : "flex"} w-full min-w-0 flex-col border-l border-zinc-200 lg:w-[320px] lg:shrink-0 dark:border-zinc-800`}>
        <ChatSidebar
          conversations={conversations}
          activeId={activeId}
          filter={filter}
          onFilter={setFilter}
          q={q}
          onQ={setQ}
          loading={listLoading}
          error={listError}
          onRetry={() => void loadConversations()}
          onSelect={(id) => void openConversation(id)}
          onNew={() => setNewOpen(true)}
          onGlobalSearch={() => {
            setSearchScoped(false);
            setSearchOpen(true);
          }}
          typingNames={typingNames}
        />
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-zinc-200 px-3 py-2 text-[11px] text-zinc-400 dark:border-zinc-800">
          <label className="flex cursor-pointer items-center gap-1.5" title="با Enter پیام ارسال شود؛ خط جدید با Shift+Enter">
            <input type="checkbox" checked={enterToSend} onChange={toggleEnter} />
            ارسال با Enter
          </label>
          <label className="flex cursor-pointer items-center gap-1.5" title="اعلان سیستمی وقتی تب فعال نیست">
            <input type="checkbox" checked={browserNotify} onChange={() => void toggleBrowserNotify()} />
            اعلان مرورگر
          </label>
        </div>
      </aside>

      {/* ناحیهٔ ۲: مکالمه */}
      <main className={`${pane === "list" || activeId == null ? "hidden lg:flex" : "flex"} min-w-0 flex-1 flex-col`}>
        {activeId != null && details ? (
          <ChatWindow
            key={activeId}
            me={me}
            details={details}
            messages={messages}
            members={members}
            hasMore={hasMore}
            loading={msgsLoading}
            error={msgsError}
            dividerId={dividerId}
            highlightedId={highlightedId}
            typingText={typingText}
            canPin={canPinConv}
            canModerate={canModerate}
            enterToSend={enterToSend}
            draft={drafts[activeId] ?? ""}
            onDraftChange={(v) => setDrafts((prev) => ({ ...prev, [activeId]: v }))}
            onBack={() => setPane("list")}
            onRetry={() => void openConversation(activeId)}
            onLoadOlder={loadOlder}
            onSend={sendMessage}
            onEdit={editMessage}
            onDelete={deleteMessage}
            onReact={reactMessage}
            onPinMessage={pinMessage}
            onTyping={onTyping}
            onOpenInfo={() => setInfoOpen((v) => !v)}
            onSearchInConversation={() => {
              setSearchScoped(true);
              setSearchOpen(true);
            }}
            onTogglePinConv={() => {
              void convAction(activeId, { action: activeConv?.pinned ? "unpin" : "pin" }).then(() => {
                setDetails((d) => (d ? { ...d, conversation: { ...d.conversation, pinned: !d.conversation.pinned } } : d));
                scheduleListRefresh();
              });
            }}
            onMuteConv={(minutes) => {
              const muted = activeConv?.muted;
              void convAction(activeId, muted ? { action: "unmute" } : { action: "mute", minutes }).then(() => {
                setDetails((d) => (d ? { ...d, conversation: { ...d.conversation, muted: !muted } } : d));
                scheduleListRefresh();
                toast.success(muted ? "بی‌صدا برداشته شد" : "اعلان‌های این مکالمه بی‌صدا شد");
              });
            }}
            onArchiveConv={() => {
              const archived = activeConv?.archived;
              void convAction(activeId, { action: archived ? "unarchive" : "archive" }).then(() => {
                scheduleListRefresh();
                toast.success(archived ? "از آرشیو خارج شد" : "به آرشیو منتقل شد");
                if (!archived) {
                  setActiveId(null);
                  activeRef.current = null;
                  setDetails(null);
                  setMessages([]);
                }
              });
            }}
            onLeaveConv={askLeave}
            onOpenImage={(id) => setLightbox({ images: conversationImageIds.length ? conversationImageIds : [id], activeId: id })}
            onJumpDone={() => setHighlightedId(null)}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon="chat"
              title="گفت‌وگویی انتخاب نشده"
              body="از فهرست کنار یک مکالمه را باز کنید یا گفت‌وگوی جدیدی با همکارانتان شروع کنید. می‌توانید از جستجو هم استفاده کنید."
              action={<button className="btn-primary btn-sm" onClick={() => setNewOpen(true)}>گفت‌وگوی جدید</button>}
            />
          </div>
        )}
        {!connOk && activeId != null && (
          <div className="shrink-0 bg-amber-100 px-3 py-1 text-center text-[11px] text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
            اتصال به سرور برقرار نیست — پیام‌های جدید ممکن است با تأخیر برسند. پیام‌های ارسالی شما پس از اتصال ثبت می‌شوند.
          </div>
        )}
      </main>

      {/* ناحیهٔ ۳: اطلاعات */}
      {activeId != null && details && infoOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40 xl:hidden" onClick={() => setInfoOpen(false)} />
          <aside className="fixed inset-y-0 right-0 z-50 w-[85%] max-w-sm xl:static xl:z-0 xl:w-[300px] xl:max-w-none xl:shrink-0">
            <ChatInfo
              details={details}
              meId={me.id}
              canManage={details.can_manage}
              onClose={() => setInfoOpen(false)}
              onUpdate={async (input) => {
                await convAction(activeId, { action: "update", ...input });
                const det = await chatFetch<ChatConversationDetails>(`/api/chat/conversations/${activeId}`);
                setDetails(det);
                setMembers(det.members);
                scheduleListRefresh();
              }}
              onAddMember={() => setAddMembersOpen(true)}
              onRemoveMember={askRemoveMember}
              onSetRole={(userId, role) => {
                void convAction(activeId, { action: "set_role", user_id: userId, role }).then(() => {
                  toast.success("نقش عضو تغییر کرد");
                });
              }}
              onJumpToMessage={jumpToMessage}
              onSearchFiles={() => {
                setSearchScoped(true);
                setSearchOpen(true);
              }}
            />
          </aside>
        </>
      )}

      {/* مودال‌ها */}
      <NewConversationModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        perms={perms}
        onCreated={(id) => { void openConversation(id); void loadConversations(); }}
      />
      {details && activeId != null && (
        <AddMembersModal
          open={addMembersOpen}
          onClose={() => setAddMembersOpen(false)}
          existingIds={details.members.map((m) => m.user_id)}
          onAdd={async (ids) => {
            for (const uid of ids) await convAction(activeId, { action: "add_member", user_id: uid });
            const det = await chatFetch<ChatConversationDetails>(`/api/chat/conversations/${activeId}`);
            setDetails(det);
            setMembers(det.members);
            toast.success("عضو افزوده شد");
          }}
        />
      )}
      <ChatSearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        conversationId={searchScoped ? activeId : null}
        conversationTitle={activeConv?.title}
        onJump={jumpToMessage}
      />
      {lightbox && (
        <ImageLightbox
          images={lightbox.images}
          activeId={lightbox.activeId}
          onClose={() => setLightbox(null)}
          onNavigate={(id) => setLightbox((lb) => (lb ? { ...lb, activeId: id } : lb))}
        />
      )}
      <ConfirmModal
        open={confirmState != null}
        title={confirmState?.title ?? ""}
        body={confirmState?.body ?? ""}
        confirmLabel={confirmState?.label ?? "تأیید"}
        danger={confirmState?.danger}
        onConfirm={() => void confirmState?.action()}
        onClose={() => setConfirmState(null)}
      />
    </div>
  );
}
