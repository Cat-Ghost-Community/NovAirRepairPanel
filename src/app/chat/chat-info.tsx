"use client";

import { useState } from "react";
import { Avatar, EmptyState } from "@/components/ui";
import { Icon } from "@/components/icon";
import { CHAT_TYPE_FA, fmtSize, isImageMime, type ChatConversationDetails, type ChatMemberInfo } from "@/lib/chat-shared";
import { colorFor, fmtClock, dayLabel, presenceText } from "./chat-helpers";

const ROLE_FA: Record<string, string> = {
  owner: "مالک", admin: "مدیر سیستم", manager: "مدیر", reception: "پذیرش",
  technician: "تعمیرکار", inventory: "انباردار", accountant: "حسابدار", sales: "فروشنده",
};

export function ChatInfo({
  details,
  meId,
  canManage,
  onClose,
  onUpdate,
  onAddMember,
  onRemoveMember,
  onSetRole,
  onJumpToMessage,
  onSearchFiles,
}: {
  details: ChatConversationDetails;
  meId: number;
  canManage: boolean;
  onClose: () => void;
  onUpdate: (input: { title?: string; description?: string; history_for_new_members?: boolean }) => Promise<void> | void;
  onAddMember: () => void;
  onRemoveMember: (userId: number) => void;
  onSetRole: (userId: number, role: "admin" | "member") => void;
  onJumpToMessage: (conversationId: number, messageId: number) => void;
  onSearchFiles: () => void;
}) {
  const conv = details.conversation;
  const [editOpen, setEditOpen] = useState(false);
  const [title, setTitle] = useState(conv.title);
  const [description, setDescription] = useState(conv.description ?? "");
  const [busy, setBusy] = useState(false);

  const saveMeta = async () => {
    setBusy(true);
    try {
      await onUpdate({ title: title.trim(), description });
      setEditOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const otherMember = details.members.find((m) => m.user_id !== meId);
  const entity = details.entity_card;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-zinc-900">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-200 px-3 dark:border-zinc-800">
        <h3 className="text-[13px] font-semibold">اطلاعات {CHAT_TYPE_FA[conv.type]}</h3>
        <button className="btn-ghost btn-sm btn-icon" onClick={onClose} aria-label="بستن پنل اطلاعات"><Icon name="x" size={15} /></button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        {/* کارت پذیرش/موجودیت مرتبط */}
        {entity && (
          <section className="card p-3">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-zinc-400">
              <Icon name="wrench" size={12} />
              پذیرش مرتبط
            </div>
            {entity.missing ? (
              <p className="text-sm text-zinc-500">{entity.subtitle}</p>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-bold">{entity.title}</span>
                  {entity.status && (
                    <span className="badge" style={entity.status_color ? { backgroundColor: entity.status_color + "22", color: entity.status_color } : undefined}>
                      {entity.status}
                    </span>
                  )}
                </div>
                <div className="mt-1 text-xs text-zinc-500">{entity.subtitle}</div>
                <div className="mt-2 space-y-0.5 text-xs text-zinc-500">
                  {entity.tech_name && <div>تعمیرکار: {entity.tech_name}</div>}
                  {entity.branch_name && <div>شعبه: {entity.branch_name}</div>}
                  {entity.updated_at && <div>آخرین تغییر: {dayLabel(entity.updated_at)} {fmtClock(entity.updated_at)}</div>}
                </div>
                {entity.href && (
                  <a href={entity.href} className="btn-secondary btn-sm mt-2 w-full">
                    <Icon name="external" size={13} />
                    باز کردن پذیرش
                  </a>
                )}
              </>
            )}
          </section>
        )}

        {/* مکالمهٔ خصوصی: کارت کاربر */}
        {conv.type === "direct" && otherMember && (
          <section className="card p-3 text-center">
            <div className="mx-auto w-fit">
              <Avatar name={otherMember.name} color={colorFor(otherMember.name, otherMember.avatar_color)} size={56} />
            </div>
            <div className="mt-2 text-sm font-semibold">{otherMember.name}</div>
            <div className="mt-1 flex flex-wrap justify-center gap-1">
              <span className="badge-blue">{ROLE_FA[otherMember.role] ?? otherMember.role}</span>
              <span className={`badge ${otherMember.online ? "badge-green" : "badge-gray"}`}>
                {otherMember.online ? "آنلاین" : "آفلاین"}
              </span>
            </div>
            <div className="mt-1.5 text-xs text-zinc-400">
              {presenceText(otherMember.online, otherMember.last_seen_at)}
            </div>
          </section>
        )}

        {/* گروه/کانال: مشخصات */}
        {conv.type !== "direct" && (
          <section className="card p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold text-zinc-400">دربارهٔ {CHAT_TYPE_FA[conv.type]}</span>
              {canManage && !editOpen && (
                <button className="text-xs text-brand-600 hover:underline" onClick={() => setEditOpen(true)}>ویرایش</button>
              )}
            </div>
            {editOpen ? (
              <div className="space-y-2">
                <input className="input !py-1.5 text-[13px]" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="نام" aria-label="نام مکالمه" />
                <textarea className="input text-[13px]" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="توضیح اختیاری" aria-label="توضیح مکالمه" />
                <div className="flex gap-2">
                  <button className="btn-primary btn-sm" disabled={busy || !title.trim()} onClick={() => void saveMeta()}>ذخیره</button>
                  <button className="btn-secondary btn-sm" onClick={() => { setEditOpen(false); setTitle(conv.title); setDescription(conv.description ?? ""); }}>انصراف</button>
                </div>
              </div>
            ) : (
              <>
                <div className="text-sm font-semibold">{conv.title}</div>
                {conv.description ? <p className="mt-1 text-xs text-zinc-500">{conv.description}</p> : <p className="mt-1 text-xs text-zinc-400">بدون توضیح</p>}
                {canManage && (
                  <label className="mt-2 flex items-center gap-2 text-xs text-zinc-500">
                    <input
                      type="checkbox"
                      checked={conv.history_for_new_members}
                      onChange={(e) => void onUpdate({ history_for_new_members: e.target.checked })}
                    />
                    اعضای جدید پیام‌های قبلی را ببینند
                  </label>
                )}
              </>
            )}
          </section>
        )}

        {/* فایل‌های مشترک */}
        <section className="card p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-zinc-400">فایل‌های مشترک</span>
            <button className="text-xs text-brand-600 hover:underline" onClick={onSearchFiles}>جستجو در فایل‌ها</button>
          </div>
          {details.files.length === 0 ? (
            <p className="text-xs text-zinc-400">هنوز فایلی به اشتراک گذاشته نشده است.</p>
          ) : (
            <div className="space-y-1.5">
              {details.files.slice(0, 12).map((f) => (
                <a key={f.id} href={`/api/chat/attachments/${f.id}`} download={f.filename} className="flex items-center gap-2 rounded-lg border border-zinc-100 px-2 py-1.5 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50">
                  <Icon name={isImageMime(f.mime) ? "image" : f.mime === "application/pdf" ? "file" : "paperclip"} size={14} className="shrink-0 text-zinc-400" />
                  <span className="min-w-0 flex-1 truncate" dir="auto">{f.filename}</span>
                  <span className="shrink-0 text-zinc-400">{fmtSize(f.size)}</span>
                </a>
              ))}
            </div>
          )}
        </section>

        {/* پیام‌های سنجاق‌شده */}
        {details.pinned_messages.length > 0 && (
          <section className="card p-3">
            <div className="mb-2 text-[11px] font-semibold text-zinc-400">پیام‌های سنجاق‌شده</div>
            <div className="space-y-1.5">
              {details.pinned_messages.map((m) => (
                <button
                  key={m.id}
                  className="block w-full rounded-lg border border-zinc-100 px-2 py-1.5 text-right text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50"
                  onClick={() => onJumpToMessage(m.conversation_id, m.id)}
                >
                  <div className="font-medium text-zinc-600 dark:text-zinc-300">{m.sender_name ?? "سیستمی"}</div>
                  <div className="line-clamp-2 text-zinc-400">{m.body || "📎 پیوست"}</div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* اعضا */}
        {conv.type !== "direct" && (
          <section className="card p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold text-zinc-400">اعضا ({details.members.length.toLocaleString("fa-IR")})</span>
              {canManage && (
                <button className="text-xs text-brand-600 hover:underline" onClick={onAddMember}>افزودن عضو</button>
              )}
            </div>
            <div className="space-y-1">
              {details.members.map((m) => (
                <MemberRow
                  key={m.user_id}
                  member={m}
                  meId={meId}
                  canManage={canManage}
                  onRemove={() => onRemoveMember(m.user_id)}
                  onSetRole={(role) => onSetRole(m.user_id, role)}
                />
              ))}
            </div>
          </section>
        )}

        {conv.type === "direct" && details.files.length === 0 && details.pinned_messages.length === 0 && (
          <EmptyState icon="chat" title="اطلاعات بیشتری نیست" body="پیام‌ها، فایل‌ها و لینک‌های این گفت‌وگو این‌جا جمع می‌شوند." />
        )}
      </div>
    </div>
  );
}

function MemberRow({
  member,
  meId,
  canManage,
  onRemove,
  onSetRole,
}: {
  member: ChatMemberInfo;
  meId: number;
  canManage: boolean;
  onRemove: () => void;
  onSetRole: (role: "admin" | "member") => void;
}) {
  const [menu, setMenu] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-lg px-1 py-1.5">
      <span className="relative shrink-0">
        <Avatar name={member.name} color={colorFor(member.name, member.avatar_color)} size={30} />
        {member.online && <span className="absolute -bottom-0 -left-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500 dark:border-zinc-900" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">
          {member.name}
          {member.user_id === meId && <span className="text-zinc-400"> (شما)</span>}
        </span>
        <span className="text-[11px] text-zinc-400">
          {ROLE_FA[member.role] ?? member.role}
          {member.conv_role === "owner" ? " · مالک گروه" : member.conv_role === "admin" ? " · مدیر گروه" : ""}
        </span>
      </span>
      {canManage && member.user_id !== meId && member.conv_role !== "owner" && (
        <div className="relative shrink-0">
          <button className="btn-ghost btn-sm btn-icon" onClick={() => setMenu((v) => !v)} aria-label={`اقدامات ${member.name}`} aria-expanded={menu}>
            <Icon name="more-vertical" size={14} />
          </button>
          {menu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
              <div className="menu-panel left-0 top-8 z-50 w-44">
                {member.conv_role === "admin" ? (
                  <button className="menu-item" onClick={() => { setMenu(false); onSetRole("member"); }}>
                    <Icon name="user" size={14} />
                    تبدیل به عضو عادی
                  </button>
                ) : (
                  <button className="menu-item" onClick={() => { setMenu(false); onSetRole("admin"); }}>
                    <Icon name="user-check" size={14} />
                    ارتقا به مدیر گروه
                  </button>
                )}
                <button className="menu-item text-red-600 dark:text-red-400" onClick={() => { setMenu(false); onRemove(); }}>
                  <Icon name="user-x" size={14} />
                  حذف از گروه
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
