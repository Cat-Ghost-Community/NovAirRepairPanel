"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import { Icon } from "@/components/icon";
import { Modal } from "@/components/ui";
import { faNum,fmtDate } from "@/lib/format";
import { paintSignature, signatureHasInk, signaturePoint, signatureTransform, type SignatureFrame, type SignatureStroke } from "@/lib/signature-strokes";

/** Local handwritten capture only. The parent confirms persistence after its server operation. */
export function SignaturePad({ onChange, onDrawingChange, width = 720, height = 220, disabled = false, label = "امضای دست‌نویس" }: {
  onChange: (dataUrl: string | null) => void; onDrawingChange?:(drawing:boolean)=>void; width?: number; height?: number; disabled?: boolean; label?: string;
}) {
  const id = useId();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [paperNode,setPaperNode]=useState<HTMLDivElement|null>(null);
  const [aspect,setAspect]=useState<number|null>(null);
  const strokes = useRef<SignatureStroke[]>([]);
  const future = useRef<SignatureStroke[]>([]);
  const frame = useRef<SignatureFrame | null>(null);
  const pointer = useRef<number | null>(null);
  const animation = useRef<number | null>(null);
  const callback = useRef(onChange);
  const [counts, setCounts] = useState({ undo: 0, redo: 0 });
  const [drawing, setDrawing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paperSize,setPaperSize]=useState<SignatureFrame|null>(null);
  useEffect(() => { callback.current = onChange; }, [onChange]);

  const redraw = useCallback(() => {
    const element = canvas.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(devicePixelRatio || 1, 3);
    const w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
    if (element.width !== w || element.height !== h) { element.width = w; element.height = h; }
    const ctx = element.getContext("2d");
    if (!ctx) { setError("مرورگر امکان رسم امضا ندارد؛ مرورگر را به‌روز کنید."); return; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, rect.width, rect.height);
    if (frame.current) paintSignature(ctx, strokes.current, frame.current, {width:rect.width,height:rect.height});
  }, []);
  const schedule = useCallback(() => {
    if (animation.current !== null) return;
    animation.current = requestAnimationFrame(() => { animation.current = null; redraw(); });
  }, [redraw]);
  useEffect(() => {
    const element = paperNode;
    if (!element) return;
    const observer = new ResizeObserver(entries=>{const rect=entries[0].contentRect;if(!rect.width||!rect.height)return;const source=frame.current;const scale=source?signatureTransform(source,{width:rect.width,height:rect.height}).scale:1;setPaperSize({width:source?source.width*scale:rect.width,height:source?source.height*scale:rect.height});});
    observer.observe(element); window.addEventListener("resize", schedule); schedule();
    return () => { observer.disconnect(); window.removeEventListener("resize", schedule); if (animation.current !== null) cancelAnimationFrame(animation.current); animation.current = null; };
  }, [paperNode, schedule]);
  useEffect(()=>{schedule();},[paperSize,schedule]);

  const publish = () => {
    const ink = signatureHasInk(strokes.current);
    setCounts({undo:strokes.current.length,redo:future.current.length});
    schedule();
    if (!ink || !frame.current) { callback.current(null); return; }
    // Export actual ink on white; decorative guides never enter the saved evidence.
    const output = document.createElement("canvas");
    const ratio = Math.min(2, 1600 / frame.current.width, 900 / frame.current.height);
    output.width = Math.round(frame.current.width * ratio); output.height = Math.round(frame.current.height * ratio);
    const ctx = output.getContext("2d");
    if (!ctx) { setError("ساخت تصویر امضا ناموفق بود؛ دوباره تلاش کنید."); callback.current(null); return; }
    ctx.fillStyle = "#fff"; ctx.fillRect(0,0,output.width,output.height);
    paintSignature(ctx,strokes.current,frame.current,{width:output.width,height:output.height});
    callback.current(output.toDataURL("image/png"));
  };
  const end = (cancel = false) => {
    if (pointer.current === null) return;
    pointer.current = null; setDrawing(false);onDrawingChange?.(false);
    const last = strokes.current.at(-1);
    if (cancel || !last || !signatureHasInk([last])) strokes.current.pop();
    else future.current=[];
    publish();
  };
  const undo = () => { if (disabled || drawing) return; const line = strokes.current.pop(); if (!line) return; future.current.push(line); publish(); };
  const redo = () => { if (disabled || drawing) return; const line = future.current.pop(); if (!line) return; strokes.current.push(line); publish(); };
  const pointFromEvent = (event: {clientX:number;clientY:number}) => {
    const rect = canvas.current!.getBoundingClientRect();
    return signaturePoint(event.clientX - rect.left,event.clientY - rect.top,frame.current!,{width:rect.width,height:rect.height});
  };
  const surface = <div className="signature-editor min-w-0 space-y-3" style={{containerType:'inline-size'}} dir="rtl" onKeyDown={event => {
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
    if (event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
  }}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/10"><Icon name="pen" size={18} /></span><div><p className="text-sm font-semibold">{label}</p><p id={`${id}-help`} className="text-xs leading-5 text-zinc-500">با قلم، انگشت یا ماوس در کادر سفید امضا کنید.</p></div></div>
      {!expanded && <button type="button" className="btn-ghost btn-sm" disabled={disabled || drawing} onClick={() => setExpanded(true)}><Icon name="maximize" size={15} /> بزرگ‌نمایی</button>}
    </div>
    <div ref={setPaperNode} style={{height:expanded ? `clamp(180px, calc(100cqw / ${aspect??2.5}), 60dvh)` : Math.max(180,Math.min(280,height))}} className={`relative flex min-w-0 items-center justify-center overflow-hidden rounded-2xl border bg-zinc-100 shadow-inner transition dark:bg-zinc-800 ${drawing ? "border-brand-500 ring-2 ring-brand-500/15" : "border-zinc-300 dark:border-zinc-600"}`}>
      <div className="relative max-h-full max-w-full shrink-0 overflow-hidden bg-white" style={{width:paperSize?.width??'100%',height:paperSize?.height??'100%'}}>
      <canvas ref={canvas} tabIndex={disabled ? -1 : 0} role="img" aria-label="کادر امضا — با ماوس یا انگشت امضا کنید" aria-describedby={`${id}-help ${id}-status`} data-disabled={disabled}
        className="block w-full touch-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
        style={{height:'100%',cursor:disabled?"default":"crosshair",pointerEvents:disabled?"none":undefined}}
        onPointerDown={event => {
          if (disabled || !event.isPrimary || event.button !== 0 || pointer.current !== null) return;
          if (strokes.current.length >= 128) { setError("تعداد خط‌ها زیاد است؛ امضا را بازبینی یا پاک کنید."); return; }
          event.preventDefault(); event.currentTarget.focus({preventScroll:true});
          const rect=event.currentTarget.getBoundingClientRect();
          if (!frame.current || !strokes.current.length){frame.current={width:rect.width,height:rect.height};setAspect(rect.width/rect.height);}
          const point=pointFromEvent(event); if (!point) return;
          pointer.current=event.pointerId; event.currentTarget.setPointerCapture(event.pointerId);
          strokes.current.push([point]); setDrawing(true);onDrawingChange?.(true); setError(null); callback.current(null); schedule();
        }}
        onPointerMove={event => {
          if (pointer.current !== event.pointerId) return;
          const line=strokes.current.at(-1)!;
          const samples=typeof event.nativeEvent.getCoalescedEvents==='function'?event.nativeEvent.getCoalescedEvents():[event.nativeEvent];
          for (const sample of samples.length?samples:[event.nativeEvent]) {
            const point=pointFromEvent(sample),previous=line.at(-1)!;
            if (point && line.length<12000 && Math.hypot(point.x-previous.x,point.y-previous.y)>=.5) line.push(point);
          }
          schedule();
        }}
        onPointerUp={event => { if(pointer.current===event.pointerId) end(); }}
        onPointerCancel={event => { if(pointer.current===event.pointerId) end(true); }}
        onLostPointerCapture={event => { if(pointer.current===event.pointerId) end(true); }} />
      {!counts.undo && !drawing && <div className="pointer-events-none absolute inset-0 grid place-items-center"><span className="rounded-lg bg-white/90 px-3 py-2 text-sm text-zinc-400">امضای خود را اینجا بکشید</span></div>}
      <div aria-hidden className="pointer-events-none absolute bottom-7 inset-x-5 border-b border-dashed border-zinc-200" />
      <span aria-hidden className="pointer-events-none absolute bottom-2 right-5 text-[10px] text-zinc-400">محل امضا</span>
      </div>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap gap-1.5"><button type="button" className="btn-secondary btn-sm" disabled={disabled || drawing || !counts.undo} onClick={undo}><Icon name="undo" size={14} /> بازگردانی خط آخر</button><button type="button" className="btn-secondary btn-sm" disabled={disabled || drawing || !counts.redo} onClick={redo}><Icon name="redo" size={14} /> انجام دوباره</button><button type="button" className="btn-ghost btn-sm text-red-600" disabled={disabled || drawing || !counts.undo} onClick={()=>setConfirmClear(true)}><Icon name="trash" size={14} /> پاک‌کردن</button></div>
      <p id={`${id}-status`} role="status" className={`text-xs ${counts.undo ? "text-emerald-700 dark:text-emerald-400":"text-zinc-500"}`}>{drawing?"در حال رسم…":counts.undo?`${faNum(counts.undo)} خط · آماده پیوست به فرم`:"هنوز امضایی رسم نشده است"}</p>
    </div>
    <p className="text-[11px] leading-5 text-zinc-500">امضا پس از تأیید نهایی همین فرم ذخیره می‌شود. تغییر اندازه کادر، امضا را پاک نمی‌کند.</p>
    {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
  </div>;
  return <div className="min-w-0" style={{width:"100%",maxWidth:Math.max(width,720)}}>
    {expanded ? <div className="rounded-xl border border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-800">ویرایشگر امضا در نمای بزرگ باز است.</div> : surface}
    <Modal open={expanded} onClose={()=>setExpanded(false)} dismissible={!drawing} title="رسم امضا در نمای بزرگ" fullWidth>{expanded && <>{surface}<button type="button" className="btn-primary mt-4 w-full sm:w-auto" disabled={drawing} onClick={()=>setExpanded(false)}>بازگشت به فرم</button></>}</Modal>
    <Modal open={confirmClear} onClose={()=>setConfirmClear(false)} title="امضای رسم‌شده پاک شود؟"><p className="text-sm leading-7 text-zinc-500">تمام خط‌های این امضای ذخیره‌نشده پاک می‌شوند. اسناد و امضاهای ثبت‌شده تغییر نمی‌کنند.</p><div className="mt-4 flex flex-wrap justify-end gap-2"><button type="button" className="btn-secondary" onClick={()=>setConfirmClear(false)}>نگه‌داشتن امضا</button><button type="button" className="btn-primary" onClick={()=>{future.current=[...strokes.current].reverse();strokes.current=[];publish();setConfirmClear(false);}}>پاک‌کردن امضا</button></div></Modal>
  </div>;
}

/** Shared evidence frame; original raster is displayed and downloaded without rewriting it. */
export function SignatureView({ dataUrl, className = "", alt = "امضای ثبت‌شده", signedBy, signedAt, compact = false }: {
  dataUrl: string; className?: string; alt?: string; signedBy?: string | null; signedAt?: string | null; compact?: boolean;
}) {
  const [open,setOpen]=useState(false);
  const [failedSource,setFailedSource]=useState<string|null>(null);
  const valid=/^data:image\/png;base64,[A-Za-z0-9+/=\r\n]+$/.test(dataUrl);
  if(!valid||failedSource===dataUrl)return <p role="status" className="rounded-xl border border-amber-200 p-3 text-sm text-amber-700 dark:border-amber-500/30 dark:text-amber-400">تصویر امضا قابل نمایش نیست؛ اصل سند را بررسی کنید.</p>;
  const image=(large=false)=><div className={`relative w-full ${large?'h-[60dvh]':'h-28 sm:h-32'}`}><Image fill unoptimized sizes="(max-width: 768px) 100vw, 768px" src={dataUrl} alt={alt} draggable={false} onError={()=>setFailedSource(dataUrl)} className="object-contain p-3" /></div>;
  return <figure className={`signature-evidence min-w-0 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700 ${className}`}>
    <div className="bg-white">{image()}</div>
    {!compact && <figcaption className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 bg-zinc-50 px-3 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-800/40"><span className="min-w-0 break-words text-zinc-500">{signedBy || alt}{signedAt && <> · {fmtDate(signedAt)}</>}</span><button type="button" className="btn-ghost btn-sm no-print" onClick={()=>setOpen(true)}><Icon name="maximize" size={14} /> مشاهده امضا</button></figcaption>}
    <Modal open={open} onClose={()=>setOpen(false)} title={alt} wide><div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">{image(true)}</div><div className="mt-4 flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-zinc-500">{signedBy}{signedAt&&<> · {fmtDate(signedAt)}</>}</p><a href={dataUrl} download="signature.png" className="btn-secondary"><Icon name="download" size={15} /> دریافت تصویر امضا</a></div></Modal>
  </figure>;
}
