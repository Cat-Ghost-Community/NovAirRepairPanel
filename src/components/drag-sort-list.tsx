"use client";

import { useRef, useState } from "react";
import { toFaDigits } from "@/lib/format";

/**
 * لیست مرتب‌سازی کشیدنی (drag & drop).
 * آیتم‌ها را با گرفتن دستگیره ⠿ جابه‌جا کنید؛ بعد از رها کردن، ترتیب جدید ذخیره می‌شود.
 */
export function DragSortList<T extends { id: number }>({
  items,
  onReorder,
  renderItem,
}: {
  items: T[];
  onReorder: (orderedIds: number[]) => void;
  renderItem: (item: T, dragHandle: React.ReactNode) => React.ReactNode;
}) {
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);
  const dragNode = useRef<T | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const onDragStart = (e: React.DragEvent, item: T) => {
    dragNode.current = item;
    setDragId(item.id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(item.id));
  };

  const onDragOver = (e: React.DragEvent, item: T) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragId === null || item.id === dragId) return;
    setOverId(item.id);
  };

  const drop = (e: React.DragEvent, target: T) => {
    e.preventDefault();
    const source = dragNode.current;
    if (!source || source.id === target.id) {
      setDragId(null);
      setOverId(null);
      return;
    }
    const ids = items.map((i) => i.id);
    const from = ids.indexOf(source.id);
    const to = ids.indexOf(target.id);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    onReorder(ids);
    setDragId(null);
    setOverId(null);
    dragNode.current = null;
  };

  return (
    <div ref={listRef} className="space-y-1.5">
      {items.map((item) => (
        <div
          key={item.id}
          draggable
          onDragStart={(e) => onDragStart(e, item)}
          onDragOver={(e) => onDragOver(e, item)
          }
          onDragEnd={() => { setDragId(null); setOverId(null); }}
          onDrop={(e) => drop(e, item)}
          className={`
            ${dragId === item.id ? "opacity-40" : ""}
            ${overId === item.id && dragId !== item.id ? "ring-2 ring-brand-400 rounded-lg" : ""}
          `}
        >
          {renderItem(
            item,
            <span
              className="cursor-grab active:cursor-grabbing select-none px-1 text-zinc-400 hover:text-brand-600"
              title="بکشید و رها کنید"
              aria-label={`جابه‌جایی ردیف ${toFaDigits(items.indexOf(item) + 1)}`}
            >
              ⠿
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
