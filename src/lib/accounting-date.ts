import {HttpError} from './http-error';
export function accountingDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString().slice(0, 10) !== value) throw new HttpError(400, "تاریخ میلادی سند معتبر نیست.");
  return value;
}
