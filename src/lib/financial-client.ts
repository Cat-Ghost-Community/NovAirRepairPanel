"use client";

const fallbackKeys = new Map<string, string>();

/** Retain an uncertain operation identity across retries/reloads in this tab.
 * Store only a digest and random key, never financial form data. */
export async function postFinancial<T>(url: string, body: unknown): Promise<T> {
  const payload = JSON.stringify(body);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${url}\n${payload}`));
  const storageKey = `repaid-operation:${Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("")}`;
  let key = fallbackKeys.get(storageKey);
  try { key = sessionStorage.getItem(storageKey) ?? key; } catch { /* Private browser storage can be unavailable. */ }
  key ??= crypto.randomUUID();
  fallbackKeys.set(storageKey, key);
  try { sessionStorage.setItem(storageKey, key); } catch { /* In-memory identity still protects retries in this page. */ }
  let response: Response;
  let data;
  try {
    response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: payload });
    data = await response.json();
  } catch {
    throw new Error("نتیجهٔ عملیات دریافت نشد. با همین اطلاعات دوباره تلاش کنید؛ شناسهٔ ضدتکرار حفظ شده است.");
  }
  if (!response.ok) throw new Error(data.error ?? "عملیات مالی انجام نشد؛ دوباره تلاش کنید.");
  fallbackKeys.delete(storageKey);
  try { sessionStorage.removeItem(storageKey); } catch { /* No form data is persisted. */ }
  return data as T;
}
