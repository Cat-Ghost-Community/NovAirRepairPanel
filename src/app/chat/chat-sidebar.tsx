"use client";

import { useMemo } from "react";
import { Avatar, EmptyState, Skeleton } from "@/components/ui";
import { Icon } from "@/components/icon";
import { CHAT_FILTERS, CHAT_TYPE_FA, type ChatConversationListItem, type ChatFilter } from "@/lib/chat-shared";
import { colorFor, dayKey, dayLabel, fmtClock } from "./chat-helpers";

export function ChatSidebar({
  conversations,
  activeId,
  filter,
  onFilter,
  q,
  onQ,
  loading,
  error,
  onRetry,
  onSelect,
  onNew,
  onGlobalSearch,
  typingNames,
}: {
  conversations: ChatConversationListItem[];
  activeId: number | null;
  filter: ChatFilter;
  onFilter: (f: ChatFilter) => void;
  q: string;
  onQ: (v: string) => void;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSelect: (id: number) => void;
  onNew: () => void;
  onGlobalSearch: () => void;
  typingNames: Record<number, string | null>;
}) {
  const rows = useMemo(() => conversations, [conversations]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-zinc-900">
      <div className="shrink-0 space-y-2 border-b border-zinc-200 p-3 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <span className="relative min-w-0 flex-1">
            <Icon name="search" size={15} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              value={q}
              onChange={(e) => onQ(e.target.value)}
              placeholder="جستجوی مکالمه…"
              aria-label="جستجوی مکالمه"
              className="input !py-1.5 !pr-8 !text-[13px]"
            />
            {q && (
              <button
                type="button"
                aria-label="پاک‌کردن جستجو"
                onClick={() => onQ("")}
                className="absolute left-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              >
                <Icon name="x" size={13} />
              </button>
            )}
          </span>
          <button className="btn-primary btn-sm shrink-0" onClick={onNew} title="گفت‌وگوی جدید" aria-label="گفت‌وگوی جدید">
            <Icon name="plus" size={15} />
          </button>
          <button className="btn-secondary btn-sm shrink-0" onClick={onGlobalSearch} title="جستجوی متن پیام‌ها" aria-label="جستجوی متن پیام‌ها">
            <Icon name="file-search" size={15} />
          </button>
        </div>
        <div className="flex gap-1 overflow-x-auto pb-0.5" role="tablist" aria-label="فیلتر مکالمه‌ها">
          {CHAT_FILTERS.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => onFilter(f.key)}
              className={`filter-chip ${filter === f.key ? "filter-chip-active" : "filter-chip-idle"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && rows.length === 0 && (
          <div className="space-y-2 p-3" role="status" aria-label="در حال بارگذاری مکالمه‌ها">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-1/3" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        )}
        {error && (
          <div className="p-4 text-center">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            <button className="btn-secondary btn-sm mt-2" onClick={onRetry}>تلاش دوباره</button>
          </div>
        )}
        {!loading && !error && rows.length === 0 && (
          <EmptyState
            icon="chat"
            title="مکالمه‌ای نیست"
            body={q ? "عبارت دیگری را جستجو کنید یا فیلتر را عوض کنید." : "اولین گفت‌وگو را با همکارانتان شروع کنید."}
            action={<button className="btn-primary btn-sm" onClick={onNew}>گفت‌وگوی جدید</button>}
          />
        )}
        {rows.map((c) => {
          const active = c.id === activeId;
          const typing = typingNames[c.id];
          const other = c.dm_user;
          const title = c.type === "direct" ? other?.name ?? c.title : c.title;
          return (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              aria-current={active ? "true" : undefined}
              className={`flex w-full items-center gap-2.5 border-b border-zinc-100 px-3 py-2.5 text-right transition-colors dark:border-zinc-800/60 ${
                active ? "bg-brand-50 dark:bg-brand-500/10" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
              }`}
            >
              <span className="relative shrink-0">
                {c.type === "direct" ? (
                  <Avatar name={other?.name ?? "?"} color={colorFor(other?.name ?? "", other?.avatar_color)} size={40} />
                ) : (
                  <span
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full text-white"
                    style={{ backgroundColor: colorFor(c.title, c.avatar_color) }}
                    aria-hidden
                  >
                    <Icon name={c.type === "channel" ? "megaphone" : "users"} size={18} />
                  </span>
                )}
                {other?.online && <span className="absolute -bottom-0 -left-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-500 dark:border-zinc-900" />}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className={`min-w-0 flex-1 truncate text-[13px] font-semibold ${active ? "text-brand-800 dark:text-brand-300" : "text-zinc-800 dark:text-zinc-100"}`}>
                    {title}
                  </span>
                  <span className="shrink-0 text-[10px] text-zinc-400">
                    {c.last_message ? clockShort(c.last_message.created_at) : ""}
                  </span>
                </span>
                <span className="mt-0.5 flex items-center gap-1.5">
                  <span className={`min-w-0 flex-1 truncate text-xs ${c.unread_count > 0 ? "font-medium text-zinc-700 dark:text-zinc-200" : "text-zinc-500 dark:text-zinc-400"}`}>
                    {typing ? (
                      <span className="text-brand-600 dark:text-brand-400">
                        {typing} در حال نوشتن…
                      </span>
                    ) : c.last_message ? (
                      <>
                        {c.type !== "direct" && c.last_message.sender_name && <span className="text-zinc-400">{c.last_message.mine ? "شما" : c.last_message.sender_name.split(" ")[0]}: </span>}
                        {c.last_message.kind === "system" ? <span className="italic text-zinc-400">{c.last_message.body}</span> : c.last_message.body}
                      </>
                    ) : (
                      <span className="italic text-zinc-400">بدون پیام</span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {c.muted && <Icon name="bell-off" size={12} className="text-zinc-400" />}
                    {c.pinned && <Icon name="pin" size={12} className="text-brand-500" />}
                    {c.mention_count > 0 ? (
                      <span className="badge-blue !px-1.5 !text-[10px]">@{c.mention_count}</span>
                    ) : c.unread_count > 0 ? (
                      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white">
                        {c.unread_count > 99 ? "۹۹+" : c.unread_count}
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="mt-0.5 flex items-center gap-1">
                  {c.type !== "direct" && (
                    <span className="text-[10px] text-zinc-400">
                      {CHAT_TYPE_FA[c.type]}
                      {c.type !== "channel" ? ` · ${c.member_count} عضو` : ""}
                    </span>
                  )}
                  {c.entity_type === "repair" && c.entity_title && (
                    <span className="badge-gray !py-0 !text-[10px]">
                      <Icon name="wrench" size={10} />
                      {c.entity_title}
                    </span>
                  )}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="shrink-0 border-t border-zinc-200 px-3 py-1.5 text-[10px] text-zinc-400 dark:border-zinc-800">
        {cText(rows.length)} مکالمه
      </div>
    </div>
  );
}

function clockShort(dt: string): string {
  if (!dt) return "";
  const t = new Date();
  return dayKey(dt) === `${t.getFullYear()}-${t.getMonth() + 1}-${t.getDate()}` ? fmtClock(dt) : dayLabel(dt);
}

function cText(n: number): string {
  return String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}
