"use client";

import { Icon } from "@/components/icon";
import {printWhenReady} from '@/lib/print-ready';

/** دکمهٔ چاپ ساده — فقط در مرورگر کار می‌کند و در چاپ پنهان می‌شود */
export function PrintButton({ label = "چاپ" }: { label?: string }) {
  return (
    <button type="button" className="btn-secondary btn-sm no-print" onClick={() => void printWhenReady()}>
      <Icon name="printer" size={14} /> {label}
    </button>
  );
}
