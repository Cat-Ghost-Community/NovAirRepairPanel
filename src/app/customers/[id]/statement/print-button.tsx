"use client";

import { Icon } from "@/components/icon";

/** دکمهٔ چاپ ساده — فقط در مرورگر کار می‌کند و در چاپ پنهان می‌شود */
export function PrintButton({ label = "چاپ" }: { label?: string }) {
  return (
    <button type="button" className="btn-secondary btn-sm no-print" onClick={() => window.print()}>
      <Icon name="printer" size={14} /> {label}
    </button>
  );
}
