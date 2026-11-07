"use client";

import { SearchableSelect } from "@/components/searchable-select";


import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast, Modal, Field } from "@/components/ui";

type Template = { id: number; event: string; event_fa: string; channel: string; subject: string | null; body: string; is_active: number };
type Customer = { id: number; first_name: string; last_name: string; mobile: string };

const CHANNEL_FA: Record<string, string> = { sms: "پیامک", email: "ایمیل", whatsapp: "واتس‌اپ", in_app: "درون‌برنامه" };

export function TemplateEditor({ templates,canManage }: { templates: Template[];canManage:boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState<Template | null>(null);
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [channel, setChannel] = useState("sms");
  const [busy, setBusy] = useState(false);

  const openEdit = (t: Template) => {
    setEditing(t);
    setBody(t.body);
    setSubject(t.subject ?? "");
    setChannel(t.channel);
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/message-templates/${editing.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body, subject, channel }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast("قالب پیام ذخیره شد");
      setEditing(null);
      router.refresh();
    } catch (e: any) {
      toast(e.message ?? "ذخیره ناموفق بود", "error");
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (t: Template) => {
    try {
      const res = await fetch(`/api/message-templates/${t.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ is_active: t.is_active ? 0 : 1 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast(t.is_active ? "قالب غیرفعال شد" : "قالب فعال شد");
      router.refresh();
    } catch (e: any) {
      toast(e.message ?? "عملیات ناموفق بود", "error");
    }
  };

  return (
    <>
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
        {templates.map((t) => (
          <div key={t.id} className="px-5 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[13px] font-medium">{t.event_fa}</span>
                <span className="badge-gray">{CHANNEL_FA[t.channel] ?? t.channel}</span>
                {!t.is_active && <span className="badge-red">غیرفعال</span>}
              </div>
              {canManage && <div className="flex items-center gap-1.5 shrink-0">
                <button className="btn-secondary btn-sm" onClick={() => toggleActive(t)}>{t.is_active ? "غیرفعال‌سازی" : "فعال‌سازی"}</button>
                <button className="btn-secondary btn-sm" onClick={() => openEdit(t)}>ویرایش</button>
              </div>}
            </div>
            <p className="mt-1 text-[13px] text-zinc-500 whitespace-pre-wrap">{t.body}</p>
          </div>
        ))}
      </div>
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={`ویرایش قالب: ${editing?.event_fa ?? ""}`}>
        <div className="space-y-3">
          <Field label="کانال ارسال">
            <SearchableSelect className="input w-full" value={channel} onChange={(e) => setChannel(e.target.value)}>
              <option value="sms">پیامک</option>
            </SearchableSelect>
          </Field>
          <Field label="موضوع (برای ایمیل)">
            <input className="input w-full" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <Field
            label="متن پیام"
            hint="متغیرها: {{customer_name}} {{ticket}} {{device}} {{status}} {{amount}} {{link}} {{shop}}"
          >
            <textarea className="input w-full min-h-32 font-mono text-[13px]" value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <div className="flex gap-2 justify-end pt-2">
            <button className="btn-secondary btn-sm" onClick={() => setEditing(null)}>انصراف</button>
            <button className="btn-primary btn-sm" disabled={busy} onClick={save}>{busy ? "در حال ذخیره…" : "ذخیره قالب"}</button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export function SendMessageButton({ customers }: { customers: Customer[] }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [channel, setChannel] = useState("sms");
  const [text, setText] = useState("");

  const submit = async () => {
    if (!customerId || !text.trim()) { toast("مشتری و متن پیام الزامی است.", "error"); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/messages/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ customer_id: Number(customerId), body: text.trim(), channel }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast("پیام در صف ارسال قرار گرفت");
      setOpen(false);
      setCustomerId(""); setText("");
      router.refresh();
    } catch (e: any) {
      toast(e.message ?? "ارسال ناموفق بود", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="btn-primary btn-sm" onClick={() => setOpen(true)}>+ ارسال پیام دستی</button>
      <Modal open={open} onClose={() => setOpen(false)} title="ارسال پیام به مشتری">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="مشتری *">
              <SearchableSelect className="input w-full" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">— انتخاب مشتری —</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.first_name} {c.last_name} {c.mobile ? `· ${c.mobile}` : ""}</option>)}
              </SearchableSelect>
            </Field>
            <Field label="کانال">
              <SearchableSelect className="input w-full" value={channel} onChange={(e) => setChannel(e.target.value)}>
                <option value="sms">پیامک</option>
              </SearchableSelect>
            </Field>
          </div>
          <Field label="متن پیام *">
            <textarea className="input w-full min-h-24" value={text} onChange={(e) => setText(e.target.value)} placeholder="پیام خود را بنویسید…" />
          </Field>
          <div className="flex gap-2 justify-end pt-2">
            <button className="btn-secondary btn-sm" onClick={() => setOpen(false)}>انصراف</button>
            <button className="btn-primary btn-sm" disabled={busy} onClick={submit}>{busy ? "در حال ارسال…" : "ارسال"}</button>
          </div>
        </div>
      </Modal>
    </>
  );
}
