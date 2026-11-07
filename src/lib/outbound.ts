import {DOMESTIC_SERVICE_HOSTS} from './network-policy';
const BUILTIN_HOSTS = DOMESTIC_SERVICE_HOSTS;

/** Custom integration destinations must be approved by deployment configuration, not form input. */
export function assertOutboundUrl(value: string): URL {
  const url = new URL(value);
  const hosts = new Set([...BUILTIN_HOSTS, ...(process.env.REPAID_OUTBOUND_HOSTS ?? "").split(",").map(host => host.trim().toLowerCase()).filter(Boolean)]);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !hosts.has(url.hostname.toLowerCase())) {
    throw new Error("نشانی سرویس خارجی مجاز نیست. دامنه را در تنظیمات امن استقرار ثبت کنید.");
  }
  return url;
}
