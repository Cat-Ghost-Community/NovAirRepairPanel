import { getDb } from "@/lib/db/schema";
import { setCurrencyUnit, getCurrencyUnit, type CurrencyUnit } from "@/lib/format";

/** فقط سمت سرور: واحد پول را از تنظیمات می‌خواند و در format.ts ست می‌کند */
export function initCurrencyUnit(): CurrencyUnit {
  try {
    const row = getDb().prepare("SELECT value FROM settings WHERE key = 'currency_unit'").get() as { value: string } | undefined;
    if (row?.value === "rial" || row?.value === "toman") setCurrencyUnit(row.value);
  } catch {}
  return getCurrencyUnit();
}
