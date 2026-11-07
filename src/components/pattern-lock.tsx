"use client";

import { useEffect, useRef, useState } from "react";
import { toFaDigits } from "@/lib/format";

/**
 * قفل الگویی ۳×۳ (مشابه الگوی موبایل) برای ثبت رمز/الگوی امنیتی دستگاه هنگام پذیرش.
 * خروجی: رشته‌ای مثل "1,5,9" (شماره نقاط ۱..۹ به‌ترتیب کشیده‌شده).
 * با ماوس و لمس کار می‌کند؛ خطوط با SVG و انیمیشن نرم رندر می‌شوند.
 *
 * خوانایی الگو (در هر دو کامپوننت):
 *  - شمارهٔ هر نقطه (۱..۹، فارسی) همیشه کنار نقطه نمایش داده می‌شود (حتی نقاط غیرفعال).
 *  - عدد داخل دایرهٔ نقاط فعال = ترتیب کشیدن آن نقطه در الگو.
 */

const SIZE = 252; // ابعاد بوم
const PAD = 30; // فاصله لبه
const STEP = (SIZE - PAD * 2) / 2; // فاصله بین نقاط
const R = 15; // شعاع دکمه

// مرکز هر نقطه (اینکس 0..8 — ردیف از بالا)
function centerOf(idx: number): { x: number; y: number } {
  const row = Math.floor(idx / 3);
  const col = idx % 3;
  return { x: PAD + col * STEP, y: PAD + row * STEP };
}

export function PatternLock({
  value,
  onChange,
  disabled,
}: {
  /** الگوی فعلی: "1,5,9" یا رشته خالی */
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<number[]>(() => (value ? value.split(",").map(Number) : []));
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const drawingRef = useRef(false);
  const selectedRef = useRef<number[]>(active);

  // همگام‌سازی وقتی مقدار بیرونی صفر شد (مثلاً دکمه پاک‌کردن یا تغییر نوع)
  useEffect(() => {
    if (!value && selectedRef.current.length > 0) {
      selectedRef.current = [];
      setActive([]);
    }
  }, [value]);

  const pointFromEvent = (e: React.PointerEvent): { x: number; y: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * SIZE;
    const y = ((e.clientY - rect.top) / rect.height) * SIZE;
    return { x, y };
  };

  const hitTest = (p: { x: number; y: number }): number | null => {
    for (let i = 0; i < 9; i++) {
      const c = centerOf(i);
      if (Math.hypot(p.x - c.x, p.y - c.y) <= R + 6) return i;
    }
    return null;
  };

  const start = (e: React.PointerEvent) => {
    if (disabled) return;
    const p = pointFromEvent(e);
    if (!p) return;
    const idx = hitTest(p);
    drawingRef.current = true;
    svgRef.current?.setPointerCapture(e.pointerId);
    const sel = idx !== null ? [idx] : [];
    selectedRef.current = sel;
    setActive(sel);
    setCursor(p);
  };

  const move = (e: React.PointerEvent) => {
    if (disabled || !drawingRef.current) return;
    const p = pointFromEvent(e);
    if (!p) return;
    setCursor(p);
    const idx = hitTest(p);
    if (idx !== null && !selectedRef.current.includes(idx)) {
      // اگر پرش بین دو نقطه، نقطه وسط مسیر را هم اضافه کن (مثل الگوی اندروید)
      const prev = selectedRef.current[selectedRef.current.length - 1];
      const additions: number[] = [];
      if (prev !== undefined) {
        const pr = Math.floor(prev / 3), pc = prev % 3;
        const nr = Math.floor(idx / 3), nc = idx % 3;
        if (pr === nr || pc === nc || Math.abs(pr - nr) === Math.abs(pc - nc)) {
          const dr = Math.sign(nr - pr), dc = Math.sign(nc - pc);
          let r = pr + dr, c = pc + dc;
          while (r !== nr || c !== nc) {
            const mid = r * 3 + c;
            if (!selectedRef.current.includes(mid)) additions.push(mid);
            r += dr; c += dc;
          }
        }
      }
      additions.push(idx);
      const sel = [...selectedRef.current, ...additions];
      selectedRef.current = sel;
      setActive(sel);
    }
  };

  const end = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    setCursor(null);
    onChange(selectedRef.current.map((i) => i + 1).join(","));
  };

  const clear = () => {
    selectedRef.current = [];
    setActive([]);
    onChange("");
  };

  const linePts = active.map((i) => centerOf(i));

  return (
    <div className="inline-block select-none" dir="ltr">
      <svg
        ref={svgRef}
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className={`rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 touch-none ${disabled ? "opacity-50" : "cursor-pointer"}`}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        role="application"
        aria-label="الگوی قفل دستگاه را با کشیدن روی نقاط رسم کنید؛ شماره هر نقطه کنار آن و عدد داخل دایره، ترتیب کشیدن است"
      >
        {/* پس‌زمینه شبکه: دایره + شمارهٔ نقطه (همیشه برای هر ۹ نقطه) */}
        {Array.from({ length: 9 }, (_, i) => {
          const c = centerOf(i);
          const on = active.includes(i);
          return (
            <g key={i}>
              <circle
                cx={c.x}
                cy={c.y}
                r={on ? R + 4 : R}
                fill={on ? "rgba(53,99,246,0.12)" : "transparent"}
                stroke={on ? "#3563f6" : "#a1a1aa"}
                strokeWidth={on ? 2.5 : 1.5}
                style={{ transition: "r 120ms ease, stroke 120ms ease" }}
              />
              <text
                x={c.x + R - 1}
                y={c.y - R - 3}
                fontSize="11"
                fill={on ? "#3563f6" : "#a1a1aa"}
                fontWeight="700"
                textAnchor="start"
              >
                {toFaDigits(i + 1)}
              </text>
            </g>
          );
        })}
        {/* خطوط الگو */}
        {linePts.length > 1 && (
          <polyline
            points={linePts.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke="#3563f6"
            strokeWidth={4}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.85}
          />
        )}
        {/* خط دنباله تا نشانگر */}
        {cursor && linePts.length > 0 && (
          <line
            x1={linePts[linePts.length - 1].x}
            y1={linePts[linePts.length - 1].y}
            x2={cursor.x}
            y2={cursor.y}
            stroke="#3563f6"
            strokeWidth={3}
            opacity={0.4}
            strokeLinecap="round"
          />
        )}
        {/* نشان ترتیب: عدد داخل دایرهٔ هر نقطهٔ فعال (روی خط، با زمینهٔ سفید) */}
        {active.map((i) => {
          const c = centerOf(i);
          const order = active.indexOf(i) + 1;
          return (
            <g key={`ord-${i}`}>
              <circle cx={c.x} cy={c.y} r={11} fill="#ffffff" stroke="#3563f6" strokeWidth={1} />
              <text
                x={c.x}
                y={c.y}
                fontSize="12"
                fill="#3563f6"
                fontWeight="800"
                textAnchor="middle"
                dominantBaseline="central"
              >
                {toFaDigits(order)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="flex items-center justify-between mt-1.5" dir="rtl">
        <span className="text-[13px] text-zinc-500">
          {active.length > 0
            ? `${toFaDigits(active.length)} نقطه انتخاب شده — عدد داخل دایره‌ها ترتیب کشیدن است`
            : "الگو را با کشیدن رسم کنید"}
        </span>
        <button
          type="button"
          onClick={clear}
          disabled={disabled || active.length === 0}
          className="text-[13px] text-red-600 hover:underline disabled:opacity-40 disabled:no-underline"
        >
          پاک کردن
        </button>
      </div>
    </div>
  );
}

/**
 * نمایش فقط‌خواندنی الگوی ذخیره‌شده — برای Workspace، تحویل و رسید چاپی.
 * value = "1,5,9"؛ هیچ تعاملی ندارد و در چاپ هم تمیز رندر می‌شود.
 *
 * mono: حالت سیاه‌وسفیدِ مناسب چاپ (رسید) — بدون رنگ، خطوط ضخیم‌تر و کنتراست بالا.
 * همیشه: شمارهٔ ۱..۹ کنار همه نقاط + عدد ترتیب داخل دایرهٔ نقاط فعال روی مسیر.
 */
export function PatternLockView({
  value,
  size = 190,
  mono = false,
}: {
  value: string;
  size?: number;
  /** سیاه‌وسفید برای رسید چاپی */
  mono?: boolean;
}) {
  const seq = (value || "")
    .split(",")
    .map((n) => parseInt(n, 10) - 1)
    .filter((n) => n >= 0 && n < 9 && Number.isFinite(n));
  const s = size;
  const pad = Math.round(s * 0.12);
  const step = (s - pad * 2) / 2;
  const r = Math.round(s * 0.062);
  const c = (i: number) => ({ x: pad + (i % 3) * step, y: pad + Math.floor(i / 3) * step });
  const pts = seq.map(c);

  // رنگ‌ها: mono یعنی مناسب چاپ سیاه‌وسفید
  const line = mono ? "#000000" : "#3563f6";
  const onStroke = mono ? "#000000" : "#3563f6";
  const onFill = mono ? "rgba(0,0,0,0.06)" : "rgba(53,99,246,0.12)";
  const offStroke = mono ? "#6b7280" : "#9ca3af";
  const badgeR = Math.max(5.5, Math.round(s * 0.048));
  const badgeFont = Math.max(8, Math.round(badgeR * 1.2));
  const dotNumFont = Math.max(9, Math.round(s * 0.055));

  return (
    <svg
      width={s}
      height={s}
      viewBox={`0 0 ${s} ${s}`}
      className={mono
        ? "rounded-lg border border-black bg-white print:break-inside-avoid"
        : "rounded-lg border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900 print:break-inside-avoid"}
      role="img"
      aria-label={`الگوی قفل ذخیره‌شده با ${seq.length} نقطه؛ شماره هر نقطه کنار آن و عدد داخل دایره، ترتیب کشیدن است`}
    >
      {/* مسیر رسم‌شده */}
      {pts.length > 1 && (
        <polyline
          points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke={line}
          strokeWidth={mono ? Math.max(3, s * 0.022) : Math.max(2.5, s * 0.016)}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={mono ? 1 : 0.85}
        />
      )}
      {/* شبکه نقاط: دایره + شمارهٔ نقطه (همیشه برای هر ۹ نقطه) */}
      {Array.from({ length: 9 }, (_, i) => {
        const p = c(i);
        const on = seq.includes(i);
        return (
          <g key={i}>
            <circle
              cx={p.x}
              cy={p.y}
              r={on ? r + 2 : r}
              fill={on ? onFill : "transparent"}
              stroke={on ? onStroke : offStroke}
              strokeWidth={on ? 2 : 1.2}
            />
            <text
              x={p.x + r - 1}
              y={p.y - r - 2}
              fontSize={dotNumFont}
              fill={on ? line : offStroke}
              fontWeight="700"
              textAnchor="start"
            >
              {toFaDigits(i + 1)}
            </text>
          </g>
        );
      })}
      {/* نشان ترتیب: عدد داخل دایرهٔ هر نقطهٔ فعال (روی خط، با زمینهٔ سفید) */}
      {seq.map((i, k) => {
        const p = c(i);
        return (
          <g key={`ord-${i}`}>
            <circle cx={p.x} cy={p.y} r={badgeR} fill="#ffffff" stroke={line} strokeWidth={mono ? 1 : 0.8} />
            <text
              x={p.x}
              y={p.y}
              fontSize={badgeFont}
              fill={line}
              fontWeight="800"
              textAnchor="middle"
              dominantBaseline="central"
            >
              {toFaDigits(k + 1)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
