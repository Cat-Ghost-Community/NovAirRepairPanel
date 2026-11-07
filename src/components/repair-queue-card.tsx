"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/icon";
import { PHASE_META, DEVICE_TYPE_FA_ASSIGN, type AssignTicketCard } from "@/lib/assign-shared";
import { timeAgo } from "@/lib/format";
import { JourneyButton } from "@/components/journey-drawer";
import { Checkbox } from "@/components/checkbox";

/**
 * کارت دستگاه در کارتابل‌ها — رنگ لبه از فاز ذخیره‌شده می‌آید:
 * قرمز = ارجاع‌شده و شروع‌نشده، زرد = در حال تعمیر، سبز = آماده تحویل، خاکستری = در انتظار ارجاع.
 */
export function RepairQueueCard({
  card,
  selectable,
  selected,
  onToggleSelect,
  canAssign,
  onAssign,
  actions,
}: {
  card: AssignTicketCard;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: number, shiftKey?: boolean) => void;
  canAssign?: boolean;
  onAssign?: (card: AssignTicketCard) => void;
  actions?: ReactNode;
}) {
  const meta = PHASE_META[card.phase];
  const deviceLabel = [card.device_brand, card.device_model].filter(Boolean).join(" ") || card.device_type_label || DEVICE_TYPE_FA_ASSIGN[card.device_type ?? ""] || "دستگاه";

  return (
    <div
      className={`card min-w-0 p-4 transition-shadow hover:shadow-md ${meta.border} ${selected ? "ring-2 ring-brand-500/60 bg-brand-50/50 dark:bg-brand-500/10" : ""}`}
    >
      <div className="flex items-start gap-2">
        {selectable && (
          <Checkbox checked={!!selected} onCheckedChange={(_checked,shift)=>onToggleSelect?.(card.id,shift)} label={`انتخاب دستگاه ${card.number}`} className="-mt-2 -mr-2 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Link href={`/repairs/${card.id}`} className="font-mono text-[13px] font-bold text-brand-700 hover:underline dark:text-brand-400">
              {card.number}
            </Link>
            <span className={`${meta.badge} inline-flex items-center gap-1 !text-[10px]`}>
              <Icon name={meta.icon} size={10} />
              {meta.short}
            </span>
            {card.priority === "urgent" && <span className="badge-red !text-[10px]">فوری</span>}
            {card.priority === "high" && <span className="badge-amber !text-[10px]">مهم</span>}
            {card.delayed && (
              <span className="badge-red !text-[10px]" title="از موعد تخمینی گذشته است">
                <Icon name="clock" size={10} />
                تأخیر
              </span>
            )}
          </div>

          <Link href={`/repairs/${card.id}`} className="mt-2 block break-words text-sm font-semibold hover:underline">
            {deviceLabel}
          </Link>
          <div className="truncate text-xs text-zinc-500">
            {card.customer_name}
            <span className="text-zinc-400"> · {card.device_type_label ?? DEVICE_TYPE_FA_ASSIGN[card.device_type ?? ""] ?? card.device_type ?? ""}</span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
            {card.branch_name && <span className="max-w-full break-words"><Icon name="building" size={12} className="inline align-middle" /> {card.branch_name}</span>}
            <span title={`ثبت: ${card.created_at}`}>
              <Icon name="clock" size={10} className="inline align-middle" /> پذیرش {timeAgo(card.created_at)}
            </span>
            {card.technician_name ? (
              <span>
                <Icon name="user-check" size={10} className="inline align-middle" /> {card.technician_name}
                {card.assigned_at ? ` · ارجاع ${timeAgo(card.assigned_at)}` : ""}
              </span>
            ) : (
              <span className="text-amber-600 dark:text-amber-400">بدون تعمیرکار</span>
            )}
            {card.technician2_name && <span className="max-w-full break-words">همکار دوم: {card.technician2_name}</span>}
            {card.estimated_completion && <span title={`موعد: ${card.estimated_completion}`}>موعد {timeAgo(card.estimated_completion)}</span>}
          </div>

          {(canAssign || actions) && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {canAssign && onAssign && (
                <button className="btn-secondary btn-sm" onClick={() => onAssign(card)}>
                  <Icon name="user-check" size={12} />
                  {card.technician_id != null ? "ارجاع مجدد" : "ارجاع به تعمیرکار"}
                </button>
              )}
              {actions}
              <JourneyButton ticketId={card.id} ticketNumber={card.number} compact />
              <Link href={`/repairs/${card.id}`} className="btn-ghost btn-sm no-underline">
                <Icon name="external" size={12} />
                جزئیات
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
