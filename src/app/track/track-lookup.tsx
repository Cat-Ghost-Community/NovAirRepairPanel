"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function TrackLookup({example,initialTicket=''}:{example:string;initialTicket?:string}) {
  const router = useRouter();
  const [ticket, setTicket] = useState(initialTicket);
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/track/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket: ticket.trim(), phone: phone.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "پذیرش پیدا نشد. شماره و تلفن را بررسی کنید.");
        return;
      }
      router.push(`/track/${data.token}`);
    } catch {
      setError("مشکل شبکه — دوباره تلاش کنید.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label className="label" htmlFor="t">شماره پذیرش</label>
        <input id="t" className="input" placeholder={example} value={ticket} onChange={(e) => setTicket(e.target.value)} required />
      </div>
      <div>
        <label className="label" htmlFor="p">شماره موبایل شما</label>
        <input id="p" className="input" placeholder="مثلاً ۰۹۱۲۳۴۵۶۷۸۹" value={phone} onChange={(e) => setPhone(e.target.value)} required />
      </div>
      {error && <p className="rounded-lg bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 text-sm px-3 py-2" role="alert">{error}</p>}
      <button className="btn-primary btn-lg w-full" disabled={busy}>{busy ? "در حال بررسی…" : "پیدا کردن پذیرش من"}</button>
    </form>
  );
}
