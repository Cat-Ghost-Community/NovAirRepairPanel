"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { fmtSize, type ChatConversationDetails, type ChatMessage } from "@/lib/chat-shared";
import { colorFor,chatMutationIdentity } from "./chat-helpers";

export type PendingAttachment = {
  key: string;
  name: string;
  size: number;
  mime: string;
  progress: number;
  state: "uploading" | "done" | "error";
  id?: number;
  error?: string;
};

export type SendInput = { body: string; replyTo: number | null; attachments: PendingAttachment[]; mentions: number[] };

function faDigit(n: number): string {
  return String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

export function ChatComposer({
  details,
  members,
  reply,
  editing,
  enterToSend,
  draft,
  onDraftChange,
  onCancelReply,
  onCancelEdit,
  onTyping,
  onSend,
  onSaveEdit,
}: {
  details: ChatConversationDetails;
  members: Array<{ id: number; name: string }>;
  reply: ChatMessage | null;
  editing: ChatMessage | null;
  enterToSend: boolean;
  draft: string;
  onDraftChange: (v: string) => void;
  onCancelReply: () => void;
  onCancelEdit: () => void;
  onTyping: () => void;
  onSend: (input: SendInput) => Promise<void>;
  onSaveEdit: (id: number, body: string) => Promise<void>;
}) {
  const convId = details.conversation.id;
  const [body, setBody] = useState(draft);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [mentionIds, setMentionIds] = useState<number[]>([]);
  const [picker, setPicker] = useState<{ start: number; q: string; index: number } | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastTypingRef = useRef(0);
  const uploadsRef = useRef(0);
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  const skipRestoreRef = useRef(false);

  // تغییر مکالمه: پیش‌نویس همان مکالمه و پیوست‌های ارسال‌نشده پاک می‌شوند
  useEffect(() => {
    setBody(draftRef.current);
    setAttachments([]);
    setAttachmentError(null);
    setSendError(null);
    setPicker(null);
    setMentionIds([]);
  }, [convId]);

  useEffect(() => {
    if (!editing) onDraftChange(body);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, editing]);

  useEffect(() => {
    if (editing) {
      setBody(editing.body);
      setSendError(null);
      requestAnimationFrame(() => {
        const ta = taRef.current;
        if (ta) {
          ta.focus();
          ta.setSelectionRange(ta.value.length, ta.value.length);
        }
      });
    } else if (skipRestoreRef.current) {
      skipRestoreRef.current = false;
    } else {
      setBody(draftRef.current);
    }
  }, [editing]);

  // رشد خودکار کادر متن
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }, [body]);

  const filteredMentions = useMemo(() => {
    if (!picker) return [];
    const q = picker.q.trim().toLowerCase();
    return members.filter((m) => !q || m.name.toLowerCase().includes(q)).slice(0, 8);
  }, [picker, members]);

  const uploadOne = async (file: File) => {
    const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const item: PendingAttachment = { key, name: file.name, size: file.size, mime: file.type, progress: 0, state: "uploading" };
    setAttachments((a) => [...a, item]);
    uploadsRef.current += 1;
    let identity:Awaited<ReturnType<typeof chatMutationIdentity>>;
    try{identity=await chatMutationIdentity('/api/chat/upload:'+JSON.stringify({name:file.name,mime:file.type,size:file.size}),await file.arrayBuffer());}
    catch{uploadsRef.current-=1;setAttachments(a=>a.map(x=>x.key===key?{...x,state:'error',error:'آماده‌سازی امن فایل ناموفق بود؛ دوباره تلاش کنید.'}:x));return;}
    const fd = new FormData();
    fd.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/chat/upload");
    xhr.setRequestHeader('idempotency-key',identity.key);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const p = Math.round((e.loaded / e.total) * 100);
        setAttachments((a) => a.map((x) => (x.key === key ? { ...x, progress: p } : x)));
      }
    };
    xhr.onload = () => {
      uploadsRef.current -= 1;
      try {
        const data = JSON.parse(xhr.responseText || "{}");
        if(xhr.status>=200&&xhr.status<300&&Number.isSafeInteger(data.id)&&data.id>0||xhr.status>=400&&xhr.status<500&&![401,403,408,425,429].includes(xhr.status))identity.confirm();
        if (xhr.status >= 200 && xhr.status < 300&&Number.isSafeInteger(data.id)&&data.id>0) {
          setAttachments((a) => a.map((x) => (x.key === key ? { ...x, state: "done", progress: 100, id: Number(data.id), mime: data.mime ?? x.mime } : x)));
        } else {
          setAttachments((a) => a.map((x) => (x.key === key ? { ...x, state: "error", error: data.error ?? "آپلود ناموفق بود" } : x)));
        }
      } catch {
        setAttachments((a) => a.map((x) => (x.key === key ? { ...x, state: "error", error: "پاسخ سرور نامعتبر بود" } : x)));
      }
    };
    xhr.onerror = () => {
      uploadsRef.current -= 1;
      setAttachments((a) => a.map((x) => (x.key === key ? { ...x, state: "error", error: "ارتباط قطع شد — دوباره تلاش کنید" } : x)));
    };
    xhr.send(fd);
  };

  const onPickFiles = (files: FileList | null) => {
    setAttachmentError(null);
    if (!files) return;
    const list = [...files].slice(0, 6 - attachments.length);
    for (const f of list) uploadOne(f);
    if (fileRef.current) fileRef.current.value = "";
  };

  const uploading = attachments.some((a) => a.state === "uploading");
  const doneAttachments = attachments.filter((a) => a.state === "done");
  const canSend = !sending && !uploading && (body.trim().length > 0 || (doneAttachments.length > 0 && !editing));

  const submit = async () => {
    setSendError(null);
    if (editing) {
      const text = body.trim();
      if (!text) return;
      setSending(true);
      try {
        await onSaveEdit(editing.id, text);
        skipRestoreRef.current = true;
        setBody("");
        onDraftChange("");
      } catch (e: any) {
        setSendError(e?.message ?? "ذخیرهٔ ویرایش ناموفق بود");
      } finally {
        setSending(false);
      }
      return;
    }
    const text = body.trim();
    if (!canSend) return;
    setSending(true);
    try {
      const validMentions = mentionIds.filter((id) => {
        const m = members.find((x) => x.id === id);
        return m ? text.includes("@" + m.name) : false;
      });
      await onSend({
        body: text,
        replyTo: reply?.id ?? null,
        attachments: doneAttachments,
        mentions: validMentions,
      });
      setBody("");
      onDraftChange("");
      setAttachments([]);
      setMentionIds([]);
      setPicker(null);
    } catch (e: any) {
      setSendError(e?.message ?? "ارسال ناموفق بود — متن شما حفظ شد");
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (picker && filteredMentions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setPicker({ ...picker, index: (picker.index + 1) % filteredMentions.length });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setPicker({ ...picker, index: (picker.index - 1 + filteredMentions.length) % filteredMentions.length });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(filteredMentions[Math.min(picker.index, filteredMentions.length - 1)]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setPicker(null);
        return;
      }
    }
    if (e.key === "Escape" && editing) {
      onCancelEdit();
      return;
    }
    if (e.key === "Enter" && enterToSend && !e.shiftKey && !(e.nativeEvent as any).isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  const insertMention = (m: { id: number; name: string }) => {
    const ta = taRef.current;
    if (!ta || !picker) return;
    const caret = ta.selectionStart ?? body.length;
    const before = body.slice(0, picker.start);
    const after = body.slice(caret);
    const next = `${before}@${m.name} ${after}`;
    setBody(next);
    setMentionIds((ids) => (ids.includes(m.id) ? ids : [...ids, m.id]));
    setPicker(null);
    requestAnimationFrame(() => {
      const pos = before.length + m.name.length + 2;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  };

  const onChange = (v: string) => {
    setBody(v);
    const ta = taRef.current;
    const caret = ta?.selectionStart ?? v.length;
    const upTo = v.slice(0, caret);
    const m = /(^|\s)@([^\s@]{0,40})$/.exec(upTo);
    if (m && members.length > 0) setPicker({ start: caret - m[2].length - 1, q: m[2], index: 0 });
    else setPicker(null);
    const now = Date.now();
    if (now - lastTypingRef.current > 2500 && v.trim()) {
      lastTypingRef.current = now;
      onTyping();
    }
  };

  if (!details.can_post) {
    return (
      <div className="shrink-0 border-t border-zinc-200 bg-white px-4 py-3 text-center text-xs text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900">
        {details.conversation.type==='direct'?"شعبهٔ همکار تغییر کرده است؛ برای ادامه گفت‌وگوی جدیدی با او آغاز کنید.":"فقط مدیران کانال می‌توانند پیام بفرستند."}
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      {reply && !editing && (
        <div className="flex items-center gap-2 border-b border-zinc-100 px-3 py-1.5 dark:border-zinc-800">
          <Icon name="reply" size={14} className="shrink-0 text-brand-600" />
          <div className="min-w-0 flex-1 text-xs">
            <div className="font-medium text-brand-700 dark:text-brand-300">پاسخ به {reply.sender_name ?? "پیام"}</div>
            <div className="truncate text-zinc-400">{reply.body || (reply.attachments.length ? "📎 پیوست" : "")}</div>
          </div>
          <button className="btn-ghost btn-sm btn-icon" onClick={onCancelReply} aria-label="لغو پاسخ"><Icon name="x" size={14} /></button>
        </div>
      )}
      {editing && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5 dark:border-amber-500/30 dark:bg-amber-500/10">
          <Icon name="pencil" size={14} className="shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1 text-xs font-medium text-amber-700 dark:text-amber-400">ویرایش پیام — Escape برای لغو</div>
          <button className="btn-ghost btn-sm btn-icon" onClick={onCancelEdit} aria-label="لغو ویرایش"><Icon name="x" size={14} /></button>
        </div>
      )}

      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
          {attachments.map((a) => (
            <span key={a.key} className="relative flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] dark:border-zinc-700 dark:bg-zinc-800/60">
              <Icon name={a.mime.startsWith("image/") ? "image" : "paperclip"} size={13} className="shrink-0 text-zinc-400" />
              <span className="max-w-32 truncate" dir="auto">{a.name}</span>
              <span className="shrink-0 text-zinc-400">{fmtSize(a.size)}</span>
              {a.state === "uploading" && (
                <span className="inline-flex shrink-0 items-center gap-1 text-brand-600">
                  <span className="h-1 w-10 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                    <span className="block h-full bg-brand-500 transition-all" style={{ width: `${a.progress}%` }} />
                  </span>
                  {faDigit(a.progress)}٪
                </span>
              )}
              {a.state === "error" && <span className="shrink-0 text-red-500" title={a.error}>ناموفق</span>}
              <button
                className="shrink-0 rounded-full p-0.5 text-zinc-400 hover:text-red-500"
                onClick={() => setAttachments((list) => list.filter((x) => x.key !== a.key))}
                aria-label={`حذف ${a.name}`}
              >
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      {attachmentError && <p className="px-3 pt-1 text-xs text-red-600 dark:text-red-400">{attachmentError}</p>}

      <div className="relative">
        {picker && filteredMentions.length > 0 && (
          <div className="menu-panel bottom-12 right-3 z-40 w-60" role="listbox" aria-label="پیشنهاد منشن">
            <div className="menu-section">منشن کردن</div>
            {filteredMentions.map((m, i) => (
              <button
                key={m.id}
                role="option"
                aria-selected={i === picker.index}
                className={`menu-item ${i === picker.index ? "bg-zinc-100 dark:bg-zinc-800" : ""}`}
                onMouseDown={(e) => { e.preventDefault(); insertMention(m); }}
              >
                <span className="h-5 w-5 shrink-0 rounded-full text-center text-[9px] font-bold leading-5 text-white" style={{ backgroundColor: colorFor(m.name) }}>
                  {m.name.trim().charAt(0)}
                </span>
                <span className="truncate">{m.name}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-1.5 p-2 sm:p-3">
          <input ref={fileRef} type="file" multiple hidden accept=".jpg,.jpeg,.png,.webp,.gif,.mp4,.webm,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip,.rar,.7z" onChange={(e) => onPickFiles(e.target.files)} />
          <button className="btn-ghost btn-sm btn-icon shrink-0" onClick={() => fileRef.current?.click()} aria-label="پیوست فایل" title="پیوست فایل (حداکثر ۶ فایل)">
            <Icon name="paperclip" size={17} />
          </button>
          <textarea
            ref={taRef}
            value={body}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={editing ? "ویرایش پیام…" : "پیام… (Enter ارسال، Shift+Enter خط جدید)"}
            aria-label="متن پیام"
            className="input max-h-40 min-h-9 flex-1 resize-none !py-1.5 text-[13px]"
          />
          <button
            className="btn-primary btn-sm btn-icon shrink-0"
            onClick={() => void submit()}
            disabled={!canSend}
            aria-label={sending ? "در حال ارسال" : "ارسال پیام"}
            title={uploading ? "در حال آپلود پیوست…" : "ارسال"}
          >
            <Icon name={sending ? "refresh" : "send"} size={16} className={sending ? "animate-spin" : ""} />
          </button>
        </div>
        {sendError && (
          <div className="flex items-center gap-2 px-3 pb-2 text-xs text-red-600 dark:text-red-400">
            <Icon name="alert" size={13} />
            {sendError}
          </div>
        )}
      </div>
    </div>
  );
}
