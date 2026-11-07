"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "@/components/ui";
import { Icon } from "@/components/icon";
import { REACTION_SET, fmtSize, isImageMime, type ChatConversationDetails, type ChatMessage, type ChatMemberInfo } from "@/lib/chat-shared";
import { colorFor, dayKey, dayLabel, fmtClock, presenceText, splitBody, MONTHLY_MUTE_OPTIONS } from "./chat-helpers";
import { ChatComposer, type SendInput } from "./chat-composer";

function faDigit(n: number): string {
  return String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

export function ChatWindow({
  me,
  details,
  messages,
  members,
  hasMore,
  loading,
  error,
  dividerId,
  highlightedId,
  typingText,
  canPin,
  canModerate,
  enterToSend,
  draft,
  onDraftChange,
  onBack,
  onRetry,
  onLoadOlder,
  onSend,
  onEdit,
  onDelete,
  onReact,
  onPinMessage,
  onTyping,
  onOpenInfo,
  onSearchInConversation,
  onTogglePinConv,
  onMuteConv,
  onArchiveConv,
  onLeaveConv,
  onOpenImage,
  onJumpDone,
}: {
  me: { id: number; name: string; avatar_color: string };
  details: ChatConversationDetails;
  messages: ChatMessage[];
  members: ChatMemberInfo[];
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  dividerId: number | null;
  highlightedId: number | null;
  typingText: string | null;
  canPin: boolean;
  canModerate: boolean;
  enterToSend: boolean;
  draft: string;
  onDraftChange: (v: string) => void;
  onBack: () => void;
  onRetry: () => void;
  onLoadOlder: () => Promise<void>;
  onSend: (input: SendInput) => Promise<void>;
  onEdit: (messageId: number, body: string) => Promise<void>;
  onDelete: (messageId: number) => Promise<void>;
  onReact: (messageId: number, emoji: string) => Promise<void>;
  onPinMessage: (messageId: number, pinned: boolean) => Promise<void>;
  onTyping: () => void;
  onOpenInfo: () => void;
  onSearchInConversation: () => void;
  onTogglePinConv: () => void;
  onMuteConv: (minutes: number | null) => void;
  onArchiveConv: () => void;
  onLeaveConv: () => void;
  onOpenImage: (id: number) => void;
  onJumpDone: () => void;
}) {
  const conv = details.conversation;
  const other = conv.dm_user;
  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const loadingOlderRef = useRef(false);
  const [showJump, setShowJump] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [muteOpen, setMuteOpen] = useState(false);
  const [reply, setReply] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);

  const mentionList = useMemo(() => members.filter((m) => m.user_id !== me.id).map((m) => ({ id: m.user_id, name: m.name })), [members, me.id]);

  const scrollToBottom = useCallback((smooth = false) => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior: smooth ? "smooth" : "auto" });
  }, []);

  useEffect(() => {
    scrollToBottom(false);
    atBottomRef.current = true;
  }, [conv.id, scrollToBottom]);

  useLayoutEffect(() => {
    if (atBottomRef.current) scrollToBottom(false);
  }, [messages.length, scrollToBottom]);

  useEffect(() => {
    if (highlightedId == null) return;
    const el = document.getElementById(`chat-msg-${highlightedId}`);
    if (el) {
      el.scrollIntoView({ block: "center" });
      const t = setTimeout(() => onJumpDone(), 2500);
      return () => clearTimeout(t);
    }
    if (!loading) onJumpDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightedId, loading, messages.length]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
    atBottomRef.current = near;
    setShowJump(!near && messages.length > 0);
    if (el.scrollTop < 80 && hasMore && !loadingOlderRef.current) {
      loadingOlderRef.current = true;
      const prevH = el.scrollHeight;
      const prevTop = el.scrollTop;
      onLoadOlder().finally(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const el2 = listRef.current;
            if (el2) el2.scrollTop = el2.scrollHeight - prevH + prevTop;
            loadingOlderRef.current = false;
          });
        });
      });
    }
  };

  const lastMineId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].sender_id === me.id && !messages[i].deleted_at) return messages[i].id;
    return null;
  }, [messages, me.id]);

  const readText = (msgId: number): string | null => {
    if (msgId !== lastMineId) return null;
    const others = members.filter((m) => m.user_id !== me.id);
    if (others.length === 0) return null;
    const readers = others.filter((m) => m.last_read_message_id >= msgId).length;
    if (conv.type === "direct") return readers >= 1 ? "خوانده شد" : "ارسال شد";
    if (readers === 0) return null;
    return `خوانده: ${faDigit(readers)}`;
  };

  const dividerMsgId = useMemo(() => {
    if (dividerId == null) return null;
    const m = messages.find((x) => x.id >= dividerId);
    return m?.id ?? null;
  }, [dividerId, messages]);

  const grouped = useMemo(() => {
    const out: Array<{ key: string; type: "date" | "msg"; msg?: ChatMessage; label?: string }> = [];
    let prev: ChatMessage | null = null;
    for (const m of messages) {
      if (!prev || dayKey(prev.created_at) !== dayKey(m.created_at)) {
        out.push({ key: `d-${dayKey(m.created_at)}-${m.id}`, type: "date", label: dayLabel(m.created_at) });
        prev = null;
      }
      out.push({ key: `m-${m.id}`, type: "msg", msg: m });
      prev = m;
    }
    return out;
  }, [messages]);

  const title = conv.type === "direct" ? other?.name ?? conv.title : conv.title;
  const subtitle = typingText
    ? typingText
    : conv.type === "direct"
      ? presenceText(other?.online, other?.last_seen_at)
      : `${faDigit(members.length)} عضو${conv.entity_type === "repair" && conv.entity_title ? ` · پذیرش ${conv.entity_title}` : ""}`;

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-50 dark:bg-zinc-950">
      {/* هدر مکالمه */}
      <header className="flex h-14 shrink-0 items-center gap-1.5 border-b border-zinc-200 bg-white px-2 sm:px-3 dark:border-zinc-800 dark:bg-zinc-900">
        <button className="btn-ghost btn-sm btn-icon lg:hidden" onClick={onBack} aria-label="بازگشت به فهرست مکالمه‌ها">
          <Icon name="chevron-right" size={18} />
        </button>
        <span className="relative shrink-0">
          {conv.type === "direct" ? (
            <Avatar name={other?.name ?? "?"} color={colorFor(other?.name ?? "", other?.avatar_color)} size={36} />
          ) : (
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full text-white" style={{ backgroundColor: colorFor(conv.title, conv.avatar_color) }} aria-hidden>
              <Icon name={conv.type === "channel" ? "megaphone" : "users"} size={16} />
            </span>
          )}
          {other?.online && <span className="absolute -bottom-0 -left-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-500 dark:border-zinc-900" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h2 className="truncate text-[14px] font-semibold">{title}</h2>
            {conv.type === "channel" && <span className="badge-purple !text-[10px]">کانال</span>}
            {conv.muted && <Icon name="bell-off" size={13} className="text-zinc-400" />}
            {conv.pinned && <Icon name="pushpin" size={13} className="text-brand-500" />}
          </div>
          <p className={`truncate text-[11px] ${typingText ? "text-brand-600 dark:text-brand-400" : "text-zinc-400"}`}>{subtitle}</p>
        </div>

        <button className="btn-ghost btn-sm btn-icon" onClick={onSearchInConversation} aria-label="جستجو در این مکالمه" title="جستجو در این مکالمه">
          <Icon name="search" size={16} />
        </button>
        <button className="btn-ghost btn-sm btn-icon" onClick={onOpenInfo} aria-label="اطلاعات مکالمه" title="اطلاعات مکالمه">
          <Icon name="info" size={16} />
        </button>
        <div className="relative">
          <button className="btn-ghost btn-sm btn-icon" onClick={() => { setMenuOpen((v) => !v); setMuteOpen(false); }} aria-label="اقدامات بیشتر" aria-expanded={menuOpen}>
            <Icon name="more-vertical" size={16} />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="menu-panel left-0 top-9 z-50 w-52">
                <button className="menu-item" onClick={() => { setMenuOpen(false); onTogglePinConv(); }}>
                  <Icon name="pushpin" size={14} />
                  {conv.pinned ? "لغو سنجاق مکالمه" : "سنجاق مکالمه"}
                </button>
                <button className="menu-item" onClick={() => setMuteOpen((v) => !v)}>
                  <Icon name="bell-off" size={14} />
                  {conv.muted ? "لغو بی‌صدا" : "بی‌صدا کردن"}
                </button>
                {muteOpen && (
                  <div className="border-t border-zinc-100 py-1 dark:border-zinc-800">
                    {MONTHLY_MUTE_OPTIONS.map((o) => (
                      <button key={o.label} className="menu-item !pr-7" onClick={() => { setMenuOpen(false); setMuteOpen(false); onMuteConv(o.minutes); }}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                )}
                <button className="menu-item" onClick={() => { setMenuOpen(false); onArchiveConv(); }}>
                  <Icon name={conv.archived ? "archive-restore" : "archive"} size={14} />
                  {conv.archived ? "خروج از آرشیو" : "انتقال به آرشیو"}
                </button>
                {conv.type !== "direct" && (
                  <button className="menu-item text-red-600 dark:text-red-400" onClick={() => { setMenuOpen(false); onLeaveConv(); }}>
                    <Icon name="logout" size={14} />
                    ترک مکالمه
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </header>

      {/* ناحیهٔ پیام‌ها */}
      <div ref={listRef} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-5" aria-label="تاریخچهٔ پیام‌ها">
        {loading && messages.length === 0 && (
          <div className="space-y-3 py-4" role="status" aria-label="در حال بارگذاری پیام‌ها">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={`flex ${i % 2 ? "flex-row" : "flex-row-reverse"}`}>
                <div className="skeleton h-12 w-52 rounded-2xl" />
              </div>
            ))}
          </div>
        )}
        {error && messages.length === 0 && (
          <div className="py-10 text-center">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            <button className="btn-secondary btn-sm mt-2" onClick={onRetry}>تلاش دوباره</button>
          </div>
        )}
        {!loading && !error && messages.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400 dark:bg-zinc-800">
                <Icon name="chat" size={24} strokeWidth={1.6} />
              </div>
              <p className="text-sm font-medium">هنوز پیامی نیست</p>
              <p className="mt-0.5 text-xs text-zinc-400">اولین پیام را بفرستید — همکارانتان اعلان می‌گیرند.</p>
            </div>
          </div>
        )}
        {hasMore && !loading && messages.length > 0 && (
          <div className="pb-2 text-center">
            <button className="btn-ghost btn-sm text-xs" onClick={() => void onLoadOlder()}>بارگذاری پیام‌های قدیمی‌تر</button>
          </div>
        )}
        {grouped.map((item) =>
          item.type === "date" ? (
            <div key={item.key} className="my-3 flex items-center gap-3" role="separator" aria-label={item.label}>
              <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
              <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">{item.label}</span>
              <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
            </div>
          ) : (
            <div key={item.key}>
              {dividerMsgId != null && item.msg!.id === dividerMsgId && (
                <div className="my-3 flex items-center gap-3" role="separator">
                  <span className="h-px flex-1 bg-brand-300 dark:bg-brand-500/40" />
                  <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-[10px] font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">پیام‌های جدید</span>
                  <span className="h-px flex-1 bg-brand-300 dark:bg-brand-500/40" />
                </div>
              )}
              <MessageBubble
                msg={item.msg!}
                meId={me.id}
                members={mentionList}
                canModerate={canModerate}
                canPin={canPin}
                readText={readText(item.msg!.id)}
                highlighted={highlightedId === item.msg!.id}
                onReact={(id, e) => void onReact(id, e)}
                onReply={() => setReply(item.msg!)}
                onEdit={(m) => setEditing(m)}
                onDelete={(id) => void onDelete(id)}
                onPin={(id, p) => void onPinMessage(id, p)}
                onOpenImage={onOpenImage}
              />
            </div>
          )
        )}
        <div ref={bottomRef} className="h-1" />
        {showJump && (
          <button
            className="btn-primary sticky bottom-2 mr-auto flex items-center gap-1.5 rounded-full !px-3 shadow-lg"
            onClick={() => { scrollToBottom(true); atBottomRef.current = true; setShowJump(false); }}
          >
            <Icon name="arrow-down" size={14} />
            آخرین پیام‌ها
          </button>
        )}
      </div>

      <ChatComposer
        details={details}
        members={mentionList}
        reply={reply}
        editing={editing}
        enterToSend={enterToSend}
        draft={draft}
        onDraftChange={onDraftChange}
        onCancelReply={() => setReply(null)}
        onCancelEdit={() => setEditing(null)}
        onTyping={onTyping}
        onSend={async (input) => {
          setReply(null);
          await onSend(input);
          atBottomRef.current = true;
          scrollToBottom(true);
        }}
        onSaveEdit={async (id, body) => {
          setEditing(null);
          await onEdit(id, body);
        }}
      />
    </div>
  );
}

function MessageBubble({
  msg,
  meId,
  members,
  canModerate,
  canPin,
  readText,
  highlighted,
  onReact,
  onReply,
  onEdit,
  onDelete,
  onPin,
  onOpenImage,
}: {
  msg: ChatMessage;
  meId: number;
  members: Array<{ id: number; name: string }>;
  canModerate: boolean;
  canPin: boolean;
  readText: string | null;
  highlighted: boolean;
  onReact: (id: number, emoji: string) => void;
  onReply: () => void;
  onEdit: (m: ChatMessage) => void;
  onDelete: (id: number) => void;
  onPin: (id: number, pinned: boolean) => void;
  onOpenImage: (id: number) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const mine = msg.sender_id === meId;
  const deleted = !!msg.deleted_at;

  if (msg.kind === "system") {
    return (
      <div className="my-2 flex justify-center">
        <span className="max-w-[85%] rounded-full bg-zinc-100 px-3 py-1 text-center text-[11px] text-zinc-500 dark:bg-zinc-800/80 dark:text-zinc-400">
          {msg.body} · {fmtClock(msg.created_at)}
        </span>
      </div>
    );
  }

  const canEdit = mine && msg.kind === "text" && !deleted;
  const canDelete = !deleted && (mine || canModerate);

  return (
    <div id={`chat-msg-${msg.id}`} className={`group mb-1 flex items-end gap-2 ${mine ? "flex-row-reverse" : "flex-row"}`}>
      {!mine && <Avatar name={msg.sender_name ?? "?"} color={colorFor(msg.sender_name ?? "", msg.sender_color)} size={28} />}
      <div className="relative max-w-[min(78%,42rem)] min-w-0">
        <div
          className={`relative rounded-2xl px-3 py-2 text-[13px] leading-6 shadow-sm ${
            mine
              ? "rounded-bl-md bg-brand-600 text-white"
              : "rounded-br-md border border-zinc-200 bg-white text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
          } ${highlighted ? "ring-2 ring-amber-400 ring-offset-2 dark:ring-offset-zinc-950" : ""} ${deleted ? "opacity-70" : ""}`}
        >
          {!mine && (
            <div className="mb-0.5 text-[11px] font-semibold" style={{ color: colorFor(msg.sender_name ?? "", msg.sender_color) }}>
              {msg.sender_name}
            </div>
          )}

          {msg.reply_to && (
            <div className={`mb-1.5 rounded-lg border-r-2 px-2 py-1 text-[11px] ${mine ? "border-white/60 bg-white/10 text-white/85" : "border-brand-400 bg-zinc-50 text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400"}`}>
              <div className="font-medium">{msg.reply_to.sender_name ?? "پیام"}</div>
              <div className="truncate">{msg.reply_to.deleted ? "پیام حذف شده" : msg.reply_to.body || (msg.reply_to.has_attachment ? "📎 پیوست" : "")}</div>
            </div>
          )}

          {deleted ? (
            <div className={`flex items-center gap-1.5 italic ${mine ? "text-white/80" : "text-zinc-400"}`}>
              <Icon name="ban" size={13} />
              این پیام حذف شد
            </div>
          ) : (
            <>
              {msg.body && (
                <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]" dir="auto">
                  {splitBody(msg.body, members).map((p, i) =>
                    p.type === "link" ? (
                      <a key={i} href={p.text} target="_blank" rel="noopener noreferrer" className={`underline ${mine ? "text-white" : "text-brand-600 dark:text-brand-400"}`} dir="ltr">
                        {p.text}
                      </a>
                    ) : p.type === "mention" ? (
                      <span key={i} className={`rounded px-0.5 font-medium ${mine ? "bg-white/20" : "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"}`}>
                        {p.text}
                      </span>
                    ) : (
                      <span key={i}>{p.text}</span>
                    )
                  )}
                </div>
              )}
              {msg.attachments.length > 0 && <AttachmentList attachments={msg.attachments} mine={mine} onOpenImage={onOpenImage} />}
            </>
          )}

          <div className={`mt-1 flex items-center gap-1.5 text-[10px] ${mine ? "text-white/75" : "text-zinc-400"}`}>
            <span>{fmtClock(msg.created_at)}</span>
            {msg.edited_at && <span>(ویرایش‌شده)</span>}
            {msg.pinned && <Icon name="pushpin" size={10} />}
            {mine && readText && (
              <span className="inline-flex items-center gap-0.5">
                <Icon name={readText === "ارسال شد" ? "check" : "check-check"} size={12} />
                {readText}
              </span>
            )}
          </div>
        </div>

        {!deleted && (
          <div className={`absolute -top-3 z-10 flex items-center gap-0.5 rounded-full border border-zinc-200 bg-white px-1 py-0.5 opacity-60 shadow-sm transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 dark:border-zinc-700 dark:bg-zinc-800 ${mine ? "left-1" : "right-1"}`}>
            <ActionBtn label="پاسخ" icon="reply" onClick={onReply} />
            <ActionBtn label="واکنش" icon="smile" onClick={() => setPickerOpen((v) => !v)} />
            {msg.body && (
              <ActionBtn
                label="کپی متن"
                icon="copy"
                onClick={() => {
                  navigator.clipboard?.writeText(msg.body).catch(() => {});
                }}
              />
            )}
            {canPin && <ActionBtn label={msg.pinned ? "لغو سنجاق" : "سنجاق"} icon="pushpin" onClick={() => onPin(msg.id, !msg.pinned)} />}
            {canEdit && <ActionBtn label="ویرایش" icon="pencil" onClick={() => onEdit(msg)} />}
            {canDelete && <ActionBtn label="حذف" icon="trash" danger onClick={() => setConfirmDelete(true)} />}
          </div>
        )}
        {pickerOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setPickerOpen(false)} />
            <div className={`absolute z-50 -top-10 flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2 py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-800 ${mine ? "right-0" : "left-0"}`} role="menu" aria-label="انتخاب واکنش">
              {REACTION_SET.map((e) => (
                <button key={e} className="rounded-full p-1 text-base leading-none hover:bg-zinc-100 dark:hover:bg-zinc-700" onClick={() => { setPickerOpen(false); onReact(msg.id, e); }} aria-label={`واکنش ${e}`}>
                  {e}
                </button>
              ))}
            </div>
          </>
        )}
        {confirmDelete && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="تأیید حذف پیام">
            <div className="card w-full max-w-sm p-4">
              <h4 className="font-semibold">حذف پیام؟</h4>
              <p className="mt-1 text-sm text-zinc-500">این پیام برای همهٔ اعضا «حذف‌شده» نمایش داده می‌شود و بازگردانی ندارد.</p>
              <div className="mt-4 flex justify-end gap-2">
                <button className="btn-secondary btn-sm" onClick={() => setConfirmDelete(false)}>انصراف</button>
                <button className="btn-danger btn-sm" onClick={() => { setConfirmDelete(false); onDelete(msg.id); }}>حذف پیام</button>
              </div>
            </div>
          </div>
        )}

        {msg.reactions.length > 0 && (
          <div className={`mt-1 flex flex-wrap gap-1 ${mine ? "justify-start" : "justify-end"}`}>
            {msg.reactions.map((r) => (
              <button
                key={r.emoji}
                onClick={() => onReact(msg.id, r.emoji)}
                aria-pressed={r.mine}
                className={`inline-flex h-7 items-center gap-1 rounded-full border px-2 text-xs transition-colors ${
                  r.mine ? "border-brand-400 bg-brand-50 dark:bg-brand-500/15" : "border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700"
                }`}
              >
                <span className="text-sm leading-none">{r.emoji}</span>
                <span className="tabular-nums text-zinc-500 dark:text-zinc-400">{faDigit(r.count)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ActionBtn({ label, icon, onClick, danger }: { label: string; icon: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      className={`rounded-full p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-700 ${danger ? "text-red-500" : "text-zinc-500 dark:text-zinc-300"}`}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      <Icon name={icon} size={13} />
    </button>
  );
}

export function AttachmentList({
  attachments,
  mine,
  onOpenImage,
}: {
  attachments: Array<{ id: number; filename: string; mime: string; size: number }>;
  mine: boolean;
  onOpenImage: (id: number) => void;
}) {
  const images = attachments.filter((a) => isImageMime(a.mime));
  const files = attachments.filter((a) => !isImageMime(a.mime));
  return (
    <div className="mt-1.5 space-y-1.5">
      {images.length > 0 && (
        <div className={`grid max-w-sm gap-1.5 ${images.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
          {images.map((a) => (
            <button key={a.id} onClick={() => onOpenImage(a.id)} className="overflow-hidden rounded-lg border border-black/10 dark:border-white/10" aria-label={`نمایش تصویر ${a.filename}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/chat/attachments/${a.id}`} alt={a.filename} className="max-h-56 w-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {files.map((a) => (
        <a
          key={a.id}
          href={`/api/chat/attachments/${a.id}`}
          className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${mine ? "border-white/30 bg-white/10 text-white" : "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-200"}`}
          download={a.filename}
        >
          <Icon name={a.mime === "application/pdf" ? "file" : "paperclip"} size={15} className="shrink-0 opacity-80" />
          <span className="min-w-0 flex-1 truncate" dir="auto">{a.filename}</span>
          <span className="shrink-0 opacity-70">{fmtSize(a.size)}</span>
          <Icon name="download" size={13} className="shrink-0 opacity-70" />
        </a>
      ))}
    </div>
  );
}
