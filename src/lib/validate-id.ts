import {HttpError} from './http-error';
export function validateId(value: unknown, label = "شناسه"): number {
    if ((typeof value !== "string" && typeof value !== "number") || !/^\d+$/.test(String(value))) throw new HttpError(400, `${label} معتبر نیست.`);
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, `${label} معتبر نیست.`);
    return id;
  }
