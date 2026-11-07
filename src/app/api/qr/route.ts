import { NextRequest } from "next/server";
import QRCode from "qrcode";
import { requireSession, fail } from "@/lib/api";

export const dynamic = "force-dynamic";

/** تولید QR — فقط با نشست معتبر (ابزار داخلی چاپ رسید/سند) */
export async function GET(req: NextRequest) {
  try {
    requireSession(req);
    const text = (req.nextUrl.searchParams.get("text") ?? "").slice(0, 300);
    if (!text) return new Response("متن ورودی لازم است", { status: 400 });
    // مسیرهای نسبی اپ به آدرس مطلق تبدیل می‌شوند
    const base = req.nextUrl.origin;
    const abs = text.startsWith("/") ? base + text : text;
    const png = await QRCode.toBuffer(abs, { margin: 1, width: 240 });
    return new Response(new Uint8Array(png), {
      headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=86400" },
    });
  } catch (e) {
    return fail(e);
  }
}