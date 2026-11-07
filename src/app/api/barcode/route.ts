import { NextRequest } from "next/server";
import { toBuffer } from "bwip-js/node";
import { requireSession, fail } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * تولید بارکد (CODE128 استاندارد و سازگار با همه بارکدخوان‌ها)
 * ?text=...&height=40 — فقط با نشست معتبر (ابزار داخلی چاپ برچسب/رسید)
 */
export async function GET(req: NextRequest) {
  try {
    requireSession(req);
    const text = (req.nextUrl.searchParams.get("text") ?? "").slice(0, 300);
    const height = Math.min(Math.max(Number(req.nextUrl.searchParams.get("height") ?? 40), 20), 120);
    if (!text) return new Response("متن ورودی لازم است", { status: 400 });
    try {
      const png = await toBuffer({
        bcid: "code128",
        text,
        scale: 2,
        height,
        includetext: true,
        textxalign: "center",
      });
      return new Response(new Uint8Array(png), {
        headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=86400" },
      });
    } catch {
      return new Response("خطا در تولید بارکد", { status: 500 });
    }
  } catch (e) {
    return fail(e);
  }
}
