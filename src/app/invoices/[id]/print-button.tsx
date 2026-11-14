"use client";
import {printWhenReady} from '@/lib/print-ready';

export function PrintButton() {
  return (
    <button className="btn-secondary btn-sm" onClick={() => void printWhenReady()}>
      چاپ / PDF
    </button>
  );
}
