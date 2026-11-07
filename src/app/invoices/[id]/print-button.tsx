"use client";

export function PrintButton() {
  return (
    <button className="btn-secondary btn-sm" onClick={() => window.print()}>
      چاپ / PDF
    </button>
  );
}
