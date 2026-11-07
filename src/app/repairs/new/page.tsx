"use client";

import { SearchableSelect } from "@/components/searchable-select";


import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui";
import { CameraCapture } from "@/components/camera-capture";
import { JalaliDatePicker } from "@/components/jalali-date-picker";
import { Check } from "lucide-react";
import { Icon } from "@/components/icon";
import { PatternLock } from "@/components/pattern-lock";
import { toFaDigits } from "@/lib/format";
import { DEVICE_TYPE_FA } from "@/lib/status-fa";
import { customerTypeFa, customerTypeBadge } from "@/lib/customer-type";
import { CustomerForm, EMPTY_CUSTOMER_FORM } from "@/components/customer-form";

/** گزینه‌های سوال چندگزینه‌ای — پشتیبانی از JSON، «،» فارسی، «,» انگلیسی و «؛» */
function parseOptions(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      // اگر هر عضو یک رشته با جداکننده است، بشکن
      return [...new Set(arr.flatMap((s: string) => splitOpts(String(s))))].filter(Boolean);
    }
  } catch {
    return splitOpts(raw);
  }
  return [];
}
function splitOpts(s: string): string[] {
  return s.split(/[،,؛]/).map((x) => x.trim()).filter(Boolean);
}

type Customer = { id: number; first_name: string; last_name: string; company: string; mobile: string; email: string; code: string; is_vip: number; is_blacklisted: number; blacklist_reason: string | null; nickname: string | null; customer_type?: string; organization_name?: string | null };
type Device = { id: number; type: string; brand: string; model: string; serial: string; imei: string };
type Technician = { id: number; name: string; role: string; branch_id: number | null };
type Template = { id: number; name: string; device_type: string | null; brand: string | null; model: string | null; repair_type: string | null; problem: string | null; est_cost: number | null };
type CustomQuestion = { id: number; label: string; type: string; options: string; is_required: number };

const STEPS = ["مشتری", "دستگاه", "ایراد", "چک‌این", "بررسی"];

const DEVICE_TYPES = [
  { id: "mobile", label: "موبایل", icon: "phone" },
  { id: "laptop", label: "لپ‌تاپ", icon: "laptop" },
  { id: "desktop", label: "دسکتاپ", icon: "monitor" },
  { id: "tablet", label: "تبلت", icon: "tablet" },
  { id: "console", label: "کنسول بازی", icon: "gamepad" },
  { id: "smartwatch", label: "ساعت هوشمند", icon: "watch" },
  { id: "printer", label: "پرینتر", icon: "printer" },
  { id: "network", label: "تجهیزات شبکه", icon: "router" },
  { id: "other", label: "سایر", icon: "plug" },
];

const PRIORITY_FA: Record<string, string> = { low: "کم", normal: "معمولی", high: "زیاد", urgent: "فوری" };

const SECURITY_TYPE_FA: Record<string, string> = {
  passcode: "رمز عددی (PIN)", password: "گذرواژه", pattern: "الگوی قفل", pin: "رمز عددی (PIN)", none: "بدون قفل",
};

export default function NewRepairPage() {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState(0);

  // customer
  const [custQuery, setCustQuery] = useState("");
  const [custResults, setCustResults] = useState<Customer[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [newCust, setNewCust] = useState<any>({ ...EMPTY_CUSTOMER_FORM });
  const [custDupes, setCustDupes] = useState<any[] | null>(null);

  // device
  const [devices, setDevices] = useState<Device[]>([]);
  const [device, setDevice] = useState<Device | null>(null);
  const [newDev, setNewDev] = useState<Record<string, any>>({ type: "mobile", brand: "", model: "", condition: "خوب" });
  const [devDupes, setDevDupes] = useState<any[] | null>(null);
  const [devBlacklisted, setDevBlacklisted] = useState<{ serial: string; imei: string; reason: string } | null>(null);
  const [serialWarn, setSerialWarn] = useState<string | null>(null);

  // problem
  const [problem, setProblem] = useState("");
  const [repairType, setRepairType] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);

  // check-in
  const [source, setSource] = useState("حضوری");
  const [conditionNotes, setConditionNotes] = useState("");
  const [accessories, setAccessories] = useState("");
  const [securityType, setSecurityType] = useState("");
  const [securityValue, setSecurityValue] = useState("");
  const [securityHint, setSecurityHint] = useState("");
  const [inspection, setInspection] = useState<Record<string, boolean>>({});
  const [customAnswers, setCustomAnswers] = useState<Record<number, string>>({});
  const [customQuestions, setCustomQuestions] = useState<CustomQuestion[]>([]);

  // review
  const [priority, setPriority] = useState("normal");
  const [canAssign,setCanAssign]=useState(false);
  const [assignmentError,setAssignmentError]=useState('');
  const [technicianId, setTechnicianId] = useState("");
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [deposit, setDeposit] = useState("");
  const [diagnosticFee, setDiagnosticFee] = useState("");
  const [estCompletion, setEstCompletion] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [photos, setPhotos] = useState<Blob[]>([]);

  useEffect(() => {
    if (!custQuery.trim()) { setCustResults([]); return; }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/customers?q=${encodeURIComponent(custQuery)}`);
      const data = await res.json();
      setCustResults(data.customers ?? []);
    }, 200);
    return () => clearTimeout(t);
  }, [custQuery]);

  useEffect(() => {
    if (!customer) { setDevices([]); return; }
    fetch(`/api/devices?customer_id=${customer.id}`).then((r) => r.json()).then((d) => setDevices(d.devices ?? []));
  }, [customer]);

  useEffect(() => {
    const controller=new AbortController();
    fetch('/api/repairs/workflow',{signal:controller.signal}).then(r=>{if(!r.ok)throw Error('Workflow unavailable');return r.json();}).then(caps=>{setCanAssign(caps.can_assign);if(caps.can_assign)return fetch('/api/users?role=technician',{signal:controller.signal}).then(r=>r.json()).then(d=>setTechnicians((d.users??[]).filter((u:{branch_id:number})=>u.branch_id===caps.branch_id)));}).catch(error=>{if(error.name!=='AbortError'){setCanAssign(false);setAssignmentError('بررسی اختیار ارجاع ممکن نشد. پذیرش بدون تعمیرکار قابل ثبت است؛ برای ارجاع صفحه را تازه کنید.');}});
    fetch("/api/repair-templates").then((r) => r.json()).then((d) => setTemplates(d.templates ?? [])).catch(() => {});
    fetch("/api/intake-questions").then((r) => r.json()).then((d) => setCustomQuestions(d.questions ?? [])).catch(() => {});
    return ()=>controller.abort();
  }, []);

  /** هشدار سریال/IMEI تکراری در حین تایپ */
  useEffect(() => {
    const s = (newDev.serial ?? "").trim();
    const im = (newDev.imei ?? "").trim();
    if (s.length < 4 && im.length < 8) { setSerialWarn(null); setDevBlacklisted(null); return; }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/devices/check?serial=${encodeURIComponent(s)}&imei=${encodeURIComponent(im)}`);
        const d = await res.json();
        setSerialWarn(d.exists ? "دستگاهی با این سریال/IMEI قبلاً پذیرش شده است" : null);
        setDevBlacklisted(d.blacklisted ? d.blacklisted : null);
      } catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [newDev.serial, newDev.imei]);

  const deviceFields = useMemo(() => {
    const t = newDev.type;
    if (t === "mobile") return [["imei", "IMEI/سریال"], ["storage", "حافظه"], ["carrier", "اپراتور"], ["battery_health", "سلامت باتری (٪)"]];
    if (t === "laptop") return [["serial", "شماره سریال"], ["cpu", "پردازنده (CPU)"], ["ram", "حافظه رم (RAM)"], ["storage", "حافظه"], ["gpu", "گرافیک (GPU)"], ["os", "سیستم‌عامل"]];
    if (t === "desktop") return [["serial", "شماره سریال"], ["cpu", "پردازنده (CPU)"], ["ram", "حافظه رم (RAM)"], ["gpu", "گرافیک (GPU)"], ["storage", "حافظه"]];
    if (t === "console") return [["serial", "شماره سریال"], ["storage", "حافظه"]];
    if (t === "tablet") return [["imei", "IMEI"], ["serial", "شماره سریال"], ["storage", "حافظه"]];
    return [["serial", "شماره سریال"]];
  }, [newDev.type]);

  const INSPECTION_AREAS = ["صفحه‌نمایش", "درب پشت", "فریم", "دوربین", "سوکت شارژ", "دکمه‌ها", "اسپیکر", "کیبورد", "تاچ‌پد", "لولاها", "پورت‌ها", "بدنه"];
  const toggleArea = (a: string) => setInspection((s) => ({ ...s, [a]: !s[a] }));

  const applyTemplate = (tpl: Template) => {
    if (tpl.device_type) setNewDev((d) => ({ ...d, type: tpl.device_type! }));
    if (tpl.brand) setNewDev((d) => ({ ...d, brand: tpl.brand! }));
    if (tpl.model) setNewDev((d) => ({ ...d, model: tpl.model! }));
    if (tpl.repair_type) setRepairType(tpl.repair_type);
    if (tpl.problem) setProblem(tpl.problem);
    toast(`الگوی «${tpl.name}» اعمال شد`);
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      let customerId = customer?.id;
      if (!customerId) {
        const res = await fetch("/api/customers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...newCust, force: custDupes ? true : false }),
        });
        const data = await res.json();
        if (res.status === 409 && data.duplicate) {
          setCustDupes(data.duplicates);
          setSubmitting(false);
          return;
        }
        if (!res.ok) throw new Error(data.error);
        customerId = data.id;
      }

      let deviceId = device?.id;
      if (!deviceId) {
        const res = await fetch("/api/devices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...newDev, customer_id: customerId, force: devDupes ? true : false }),
        });
        const data = await res.json();
        if (res.status === 409 && data.duplicate) {
          setDevDupes(data.duplicates);
          setSubmitting(false);
          return;
        }
        if (!res.ok) throw new Error(data.error);
        deviceId = data.id;
      }

      const res = await fetch("/api/repairs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_id: customerId,
          device_id: deviceId,
          repair_type: repairType,
          problem,
          source,
          condition_notes: conditionNotes,
          accessories,
          security_type: securityType,
          security_value: securityValue || undefined,
          security_hint: securityHint,
          inspection,
          priority,
          technician_id: canAssign?(technicianId || null):null,
          deposit: deposit ? Number(deposit.replace(/[^\d]/g, "")) : 0,
          diagnostic_fee: diagnosticFee ? Number(diagnosticFee.replace(/[^\d]/g, "")) : undefined,
          estimated_completion: estCompletion || undefined,
          custom_answers: customAnswers,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      // آپلود عکس‌های وبکم به عنوان پیوست "قبل از تعمیر"
      for (const photo of photos) {
        const fd = new FormData();
        fd.append("file", photo, `webcam-${Date.now()}.jpg`);
        fd.append("phase", "before");
        try { await fetch(`/api/repairs/${data.id}/attachments`, { method: "POST", body: fd }); } catch {}
      }

      toast(`پذیرش ${data.number} ثبت شد`);
      router.push(`/repairs/${data.id}`);
    } catch (e: any) {
      toast(e.message ?? "ثبت پذیرش ناموفق بود. دوباره تلاش کنید.", "error");
      setSubmitting(false);
    }
  };

  const canNext = () => {
    if (step === 0) return !!customer || (newCust.first_name && newCust.mobile);
    if (step === 1) return !!device || (newDev.brand && newDev.model);
    if (step === 2) return problem.trim().length > 3;
    if (step === 3) return customQuestions.filter((q) => q.is_required).every((q) => (customAnswers[q.id] ?? "").trim() !== "");
    return true;
  };

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <h1 className="text-xl font-bold tracking-tight">پذیرش جدید</h1>
      <p className="text-sm text-zinc-500 mt-0.5">پذیرش دستگاه در کمتر از یک دقیقه — فقط موارد ضروری الزامی است.</p>

      {/* هشدار لیست سیاه دستگاه */}
      {devBlacklisted && (
        <div className="card card-pad border-red-400 bg-red-50 dark:bg-red-500/15 dark:border-red-500/40 mt-3">
          <div className="font-bold text-red-700 dark:text-red-300">این دستگاه در لیست سیاه است</div>
          <p className="text-sm text-red-600 dark:text-red-400 mt-1">دلیل: {devBlacklisted.reason}</p>
          <p className="text-xs text-red-500 mt-1">سریال: {devBlacklisted.serial || "—"} · IMEI: {devBlacklisted.imei || "—"}</p>
        </div>
      )}

      {/* هشدار مشتری لیست سیاه */}
      {customer?.is_blacklisted ? (
        <div className="card card-pad border-amber-400 bg-amber-50 dark:bg-amber-500/15 dark:border-amber-500/40 mt-3">
          <div className="font-bold text-amber-800 dark:text-amber-300">مشتری لیست سیاه</div>
          <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">دلیل: {customer.blacklist_reason ?? "—"}</p>
        </div>
      ) : null}

      {/* Stepper */}
      <ol className="flex items-center gap-1.5 my-5" aria-label="پیشرفت">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-1.5 flex-1 last:flex-none">
            <button
              onClick={() => i <= step && setStep(i)}
              className={`flex min-w-8 items-center justify-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors sm:min-w-[auto] sm:justify-start ${
                i === step ? "bg-brand-600 text-white" : i < step ? "bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300" : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800"
              }`}
              aria-current={i === step ? "step" : undefined}
            >
              <span>{i < step ? <Check size={13} strokeWidth={2.5} /> : toFaDigits(i + 1)}</span> <span className="hidden sm:inline">{s}</span>
            </button>
            {i < STEPS.length - 1 && <div className={`h-0.5 flex-1 ${i < step ? "bg-brand-500" : "bg-zinc-200 dark:bg-zinc-800"}`} />}
          </li>
        ))}
      </ol>

      {/* الگوهای پذیرش */}
      {templates.length > 0 && step <= 2 && (
        <div className="card card-pad mb-3">
          <div className="text-[13px] font-medium mb-2">پذیرش سریع با الگو</div>
          <div className="flex flex-wrap gap-1.5">
            {templates.map((tpl) => (
              <button key={tpl.id} onClick={() => applyTemplate(tpl)} className="btn-secondary btn-sm">
                {tpl.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card card-pad min-h-[380px]">
        {step === 0 && (
          <div className="space-y-4">
            <fieldset>
              <legend className="label">مشتری حضوری آمده یا دستگاه را ارسال کرده؟</legend>
              <div className="flex flex-wrap gap-2">
                {([["حضوری", "حضوری آمده"], ["ارسال شده", "ارسال کرده"]] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setSource(value)}
                    aria-pressed={source === value}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-4 py-1.5 text-sm transition ${source === value ? "border-brand-500 bg-brand-50 text-brand-700 font-medium dark:bg-brand-500/15 dark:text-brand-300" : "border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"}`}
                  >
                    <Icon name={value === "حضوری" ? "store" : "truck"} size={14} className="opacity-70" />
                    {label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-zinc-400">
                {source === "حضوری" ? "مشتری خودش دستگاه را به تعمیرگاه آورده است." : "مشتری دستگاه را با پست یا پیک ارسال کرده است."}
              </p>
            </fieldset>
            <div>
              <label className="label" htmlFor="cust-search">جستجوی مشتری موجود</label>
              <input
                id="cust-search"
                className="input"
                placeholder="نام، تلفن، ایمیل، کد ملی…"
                value={customer ? `${customer.first_name} ${customer.last_name}${customer.company ? ` (${customer.company})` : ""}` : custQuery}
                onFocus={() => { if (customer) { setCustomer(null); setCustQuery(""); } }}
                onChange={(e) => { setCustQuery(e.target.value); setCustomer(null); }}
              />
              {custResults.length > 0 && !customer && (
                <div className="mt-1 border border-zinc-200 dark:border-zinc-800 rounded-lg divide-y divide-zinc-100 dark:divide-zinc-800 max-h-48 overflow-y-auto">
                  {custResults.map((c) => (
                    <button key={c.id} onClick={() => { setCustomer(c); setCustResults([]); }} className="w-full text-right px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center justify-between">
                      <span>
                        <span className="text-sm font-medium">{c.first_name} {c.last_name}</span>
                        {c.nickname && <span className="text-xs text-brand-600"> «{c.nickname}»</span>}
                        {c.company && <span className="text-xs text-zinc-400"> · {c.company}</span>}
                        <span className="block text-xs text-zinc-400">{c.mobile} · {c.code}</span>
                      </span>
                      <span className="flex gap-1">
                        <span className={customerTypeBadge(c.customer_type)}>{customerTypeFa(c.customer_type)}</span>
                        {c.is_vip ? <span className="badge-amber">VIP</span> : null}
                        {c.is_blacklisted ? <span className="badge-red">لیست سیاه</span> : null}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="relative">
              <div className="absolute inset-0 flex items-center" aria-hidden><div className="w-full border-t border-zinc-200 dark:border-zinc-800" /></div>
              <div className="relative flex justify-center"><span className="bg-white dark:bg-zinc-900 px-2 text-xs text-zinc-400">یا مشتری جدید</span></div>
            </div>
            <div onClick={() => setCustomer(null)}>
              <CustomerForm form={newCust} onChange={setNewCust} mode="inline" />
            </div>
            {custDupes && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10 p-3 text-sm">
                <p className="font-medium text-amber-800 dark:text-amber-300">مشتری مشابه پیدا شد:</p>
                <ul className="mt-1 text-amber-700 dark:text-amber-400 list-disc pr-5">
                  {custDupes.map((d) => <li key={d.id}>{d.first_name} {d.last_name} · {d.mobile ?? d.email}</li>)}
                </ul>
                <button className="btn-secondary btn-sm mt-2" onClick={() => setCustDupes(null)}>ثبت به عنوان مشتری جدید</button>
              </div>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            {devices.length > 0 && (
              <div>
                <div className="label">دستگاه‌های {customer?.first_name}</div>
                <div className="grid sm:grid-cols-2 gap-2">
                  {devices.map((d) => (
                    <button key={d.id} onClick={() => { setDevice(d); setNewDev({ ...newDev, type: d.type }); }}
                      className={`card p-3 text-right hover:border-brand-400 ${device?.id === d.id ? "ring-2 ring-brand-500" : ""}`}>
                      <div className="text-sm font-medium">{d.brand} {d.model}</div>
                      <div className="text-xs text-zinc-400">{DEVICE_TYPE_FA[d.type] ?? d.type}{d.imei ? ` · IMEI ${d.imei}` : d.serial ? ` · سریال ${d.serial}` : ""}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="relative">
              <div className="absolute inset-0 flex items-center" aria-hidden><div className="w-full border-t border-zinc-200 dark:border-zinc-800" /></div>
              <div className="relative flex justify-center"><span className="bg-white dark:bg-zinc-900 px-2 text-xs text-zinc-400">یا دستگاه جدید</span></div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {DEVICE_TYPES.map((t) => (
                <button key={t.id} onClick={() => { setNewDev({ ...newDev, type: t.id }); setDevice(null); }}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-medium transition ${newDev.type === t.id && !device ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300" : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800"}`}>
                  <Icon name={t.icon ?? "device"} size={14} className="opacity-70" />
                  {t.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label" htmlFor="brand">برند *</label><input id="brand" className="input" value={newDev.brand} onChange={(e) => { setNewDev({ ...newDev, brand: e.target.value }); setDevice(null); }} /></div>
              <div><label className="label" htmlFor="model">مدل *</label><input id="model" className="input" value={newDev.model} onChange={(e) => { setNewDev({ ...newDev, model: e.target.value }); setDevice(null); }} /></div>
              {deviceFields.map(([key, label]) => (
                <div key={key}>
                  <label className="label" htmlFor={`dv-${key}`}>{label}</label>
                  <input id={`dv-${key}`} type={key === "battery_health" ? "number" : "text"} dir={key === "imei" || key === "serial" ? "ltr" : undefined} className="input"
                    value={newDev[key] ?? ""} onChange={(e) => setNewDev({ ...newDev, [key]: e.target.value })} />
                </div>
              ))}
            </div>
            {serialWarn && !devBlacklisted && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
                {serialWarn}
              </div>
            )}
            {devDupes && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10 p-3 text-sm">
                <p className="font-medium text-amber-800 dark:text-amber-300">دستگاهی با این IMEI/سریال قبلاً ثبت شده:</p>
                <ul className="mt-1 text-amber-700 dark:text-amber-400 list-disc pr-5">
                  {devDupes.map((d) => <li key={d.id}>{d.brand} {d.model}</li>)}
                </ul>
                <button className="btn-secondary btn-sm mt-2" onClick={() => setDevDupes(null)}>ثبت به هر حال</button>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div>
              <label className="label" htmlFor="problem">ایراد اعلام‌شده *</label>
              <textarea id="problem" className="input min-h-24" value={problem} onChange={(e) => setProblem(e.target.value)}
                placeholder="مثلاً صفحه شکسته از سقوط، لمس کار می‌کند" />
            </div>
            <div>
              <label className="label" htmlFor="rtype">نوع تعمیر (حدس اولیه)</label>
              <input id="rtype" className="input" list="rtype-list" value={repairType} onChange={(e) => setRepairType(e.target.value)} placeholder="مثلاً تعویض صفحه‌نمایش" />
              <datalist id="rtype-list">
                {["تعویض صفحه‌نمایش", "تعویض باتری", "تعمیر سوکت شارژ", "آسیب آب‌خوردگی", "عیب‌یابی", "ریکاوری اطلاعات", "نصب سیستم‌عامل", "تعویض کیبورد", "پاکسازی ویروس", "داغ‌کردن", "سایر"].map((x) => <option key={x} value={x} />)}
              </datalist>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="label" htmlFor="cond">وضعیت ظاهری</label>
                <input id="cond" className="input" value={conditionNotes} onChange={(e) => setConditionNotes(e.target.value)} placeholder="مثلاً خط و خش پشت، فرورفتگی کوچک گوشه" />
              </div>
              <div className="sm:col-span-2">
                <label className="label" htmlFor="acc">لوازم همراه دستگاه</label>
                <input id="acc" className="input" value={accessories} onChange={(e) => setAccessories(e.target.value)} placeholder="مثلاً شارژر، قاب، سوزن سیم‌کارت" />
              </div>
            </div>
            {/* عکس دستگاه با وبکم */}
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
              <div className="text-[13px] font-medium mb-2">عکس وضعیت دستگاه</div>
              <div className="flex flex-wrap items-center gap-2">
                <CameraCapture onCapture={(blob) => setPhotos((p) => [...p, blob])} label="عکس گرفتن با دوربین" />
                <label className="btn-secondary btn-sm cursor-pointer">
                  از فایل
                  <input type="file" accept="image/*" multiple className="hidden"
                    onChange={(e) => setPhotos((p) => [...p, ...Array.from(e.target.files ?? [])])} />
                </label>
                {photos.length > 0 && (
                  <button type="button" className="text-xs text-red-500 hover:underline" onClick={() => setPhotos([])}>
                    حذف {toFaDigits(photos.length)} عکس
                  </button>
                )}
              </div>
              {photos.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {photos.map((b, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={URL.createObjectURL(b)} alt={`عکس ${i + 1}`} className="h-16 w-16 object-cover rounded-lg border border-zinc-200 dark:border-zinc-700" />
                  ))}
                </div>
              )}
            </div>

            <fieldset>
              <legend className="label">علامت‌گذاری آسیب‌های ظاهری / ایرادات قبلی</legend>
              <div className="flex flex-wrap gap-1.5">
                {INSPECTION_AREAS.map((a) => (
                  <button key={a} type="button" onClick={() => toggleArea(a)}
                    className={`rounded-full border px-2.5 py-1 text-xs transition ${inspection[a] ? "border-red-400 bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300" : "border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"}`}
                    aria-pressed={!!inspection[a]}>
                    {a}
                  </button>
                ))}
              </div>
            </fieldset>

            {/* سوالات سفارشی پذیرش */}
            {customQuestions.length > 0 && (
              <fieldset className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 space-y-3">
                <legend className="label px-1">سوالات تکمیلی</legend>
                {customQuestions.map((q) => (
                  <div key={q.id}>
                    <label className="label" htmlFor={`cq-${q.id}`}>{q.label}{q.is_required ? " *" : ""}</label>
                    {q.type === "select" ? (
                      <SearchableSelect id={`cq-${q.id}`} className="input" value={customAnswers[q.id] ?? ""} onChange={(e) => setCustomAnswers({ ...customAnswers, [q.id]: e.target.value })}>
                        <option value="">انتخاب کنید…</option>
                        {parseOptions(q.options).map((o) => <option key={o} value={o}>{o}</option>)}
                      </SearchableSelect>
                    ) : q.type === "boolean" ? (
                      <div className="flex gap-2">
                        {["بله", "خیر"].map((v) => (
                          <button key={v} type="button" onClick={() => setCustomAnswers({ ...customAnswers, [q.id]: customAnswers[q.id] === v ? "" : v })}
                            className={`rounded-lg border px-4 py-1.5 text-sm transition ${customAnswers[q.id] === v ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300 font-medium" : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400"}`}
                            aria-pressed={customAnswers[q.id] === v}>
                            {v}
                          </button>
                        ))}
                      </div>
                    ) : q.type === "date" ? (
                      <JalaliDatePicker value={customAnswers[q.id] ?? ""} onChange={(iso) => setCustomAnswers({ ...customAnswers, [q.id]: iso })} id={`cq-${q.id}`} />
                    ) : q.type === "textarea" ? (
                      <textarea id={`cq-${q.id}`} className="input min-h-16" value={customAnswers[q.id] ?? ""} onChange={(e) => setCustomAnswers({ ...customAnswers, [q.id]: e.target.value })} />
                    ) : (
                      <input id={`cq-${q.id}`} type={q.type === "number" ? "number" : "text"} className="input" value={customAnswers[q.id] ?? ""} onChange={(e) => setCustomAnswers({ ...customAnswers, [q.id]: e.target.value })} />
                    )}
                  </div>
                ))}
              </fieldset>
            )}

            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 space-y-3">
              <div className="text-[13px] font-medium">اطلاعات امنیتی دستگاه (رمزگذاری‌شده و کنترل‌شده)</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="sec-type">نوع</label>
                  <SearchableSelect id="sec-type" className="input" value={securityType} onChange={(e) => setSecurityType(e.target.value)}>
                    <option value="">ندارد</option>
                    <option value="passcode">رمز عددی (PIN)</option>
                    <option value="password">گذرواژه</option>
                    <option value="pattern">الگو</option>
                  </SearchableSelect>
                </div>
                {securityType && (
                  <>
                    {securityType === "pattern" ? (
                      <div className="col-span-2">
                        <label className="label">الگوی قفل دستگاه (۳×۳) — با کشیدن روی نقاط رسم کنید</label>
                        <PatternLock value={securityValue} onChange={setSecurityValue} />
                      </div>
                    ) : (
                      <div>
                        <label className="label" htmlFor="sec-val">مقدار</label>
                        <input id="sec-val" type="password" className="input" value={securityValue} onChange={(e) => setSecurityValue(e.target.value)} autoComplete="off" />
                      </div>
                    )}
                    <div className="col-span-2">
                      <label className="label" htmlFor="sec-hint">راهنما (قابل مشاهده برای تعمیرکار)</label>
                      <input id="sec-hint" className="input" value={securityHint} onChange={(e) => setSecurityHint(e.target.value)} />
                    </div>
                  </>
                )}
              </div>
              <p className="text-xs text-zinc-400">رمزگذاری‌شده ذخیره می‌شود. فقط با اقدام صریح نمایش داده می‌شود و هر نمایش در گزارش رخدادها ثبت می‌گردد.</p>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="prio">اولویت</label>
                <SearchableSelect id="prio" className="input" value={priority} onChange={(e) => setPriority(e.target.value)}>
                  <option value="low">کم</option>
                  <option value="normal">معمولی</option>
                  <option value="high">زیاد</option>
                  <option value="urgent">فوری</option>
                </SearchableSelect>
              </div>
              <div>
                <label className="label" htmlFor="tech">ارجاع به تعمیرکار</label>
                <SearchableSelect id="tech" className="input" disabled={!canAssign} value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}>
                  <option value="">ارجاع‌نشده (نوبت میز کار)</option>
                  {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </SearchableSelect>
                {!canAssign&&<p className="mt-1 text-xs leading-6 text-zinc-500">{assignmentError||'تعیین تعمیرکار با مدیر یا سرپرست است؛ پذیرش را بدون ارجاع ثبت کنید.'}</p>}
              </div>
              <div>
                <label className="label" htmlFor="est">تاریخ تخمینی تحویل</label>
                <JalaliDatePicker
                  value={estCompletion}
                  onChange={(iso) => setEstCompletion(iso)}
                  placeholder="انتخاب تاریخ تحویل (شمسی)"
                  clearable
                />
              </div>
              <div>
                <label className="label" htmlFor="dfee">هزینه عیب‌یابی (تومان)</label>
                <input id="dfee" className="input num" dir="ltr" placeholder="پیش‌فرض از تنظیمات" value={diagnosticFee} onChange={(e) => setDiagnosticFee(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="dep">بیعانه (تومان)</label>
                <input id="dep" className="input num" dir="ltr" placeholder="۰" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
              </div>
            </div>
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800 text-sm">
              <ReviewRow label="مشتری" value={customer ? `${customer.first_name} ${customer.last_name}` : `${newCust.first_name} ${newCust.last_name} (جدید)`} />
              <ReviewRow label="دستگاه" value={device ? `${device.brand} ${device.model}` : `${newDev.brand} ${newDev.model} (جدید)`} />
              <ReviewRow label="روش دریافت" value={source === "حضوری" ? "حضوری آمده" : "ارسال کرده"} />
              <ReviewRow label="ایراد" value={problem} />
              {repairType && <ReviewRow label="نوع تعمیر" value={repairType} />}
              {conditionNotes && <ReviewRow label="وضعیت" value={conditionNotes} />}
              {accessories && <ReviewRow label="لوازم همراه" value={accessories} />}
              {Object.values(inspection).some(Boolean) && <ReviewRow label="آسیب علامت‌گذاری شد" value={Object.entries(inspection).filter(([, v]) => v).map(([k]) => k).join("، ")} />}
              {photos.length > 0 && <ReviewRow label="عکس دستگاه" value={`${toFaDigits(photos.length)} عکس ثبت شد`} />}
              {securityType && <ReviewRow label="اطلاعات امنیتی" value={`${SECURITY_TYPE_FA[securityType] ?? securityType} (رمزگذاری‌شده)`} />}
              {customQuestions.filter((q) => customAnswers[q.id]).map((q) => <ReviewRow key={q.id} label={q.label} value={customAnswers[q.id]} />)}
            </div>
          </div>
        )}
      </div>

      <div className="sticky bottom-4 mt-4 flex items-center justify-between card card-pad shadow-lg">
        <button className="btn-secondary" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>→ قبلی</button>
        <div className="flex gap-2">
          {step < STEPS.length - 1 ? (
            <button className="btn-primary" onClick={() => setStep((s) => s + 1)} disabled={!canNext()}>بعدی ←</button>
          ) : (
            <button type="button" className="btn-primary btn-lg min-w-36" onClick={submit} disabled={submitting} aria-busy={submitting}>
              {submitting ? "در حال ثبت…" : "ثبت پذیرش"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 px-3 py-2">
      <span className="w-28 shrink-0 text-zinc-400 text-xs pt-0.5">{label}</span>
      <span className="text-[13px]">{value}</span>
    </div>
  );
}
