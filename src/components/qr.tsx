import QRCode from "qrcode";

export function QR({
  text,
  size = 96,
  label,
}: {
  text: string;
  size?: number;
  label?: boolean;
}) {
  // server component: generate data URL synchronously via toDataURL (async) — use sync string
  // We generate on the server with qrcode.toString? Simplest: render an img pointing to the API.
  const href = `/api/qr?text=${encodeURIComponent(text)}`;
  return (
    <span className="inline-flex items-center gap-1.5 align-middle" title={text}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={href} width={size} height={size} alt="کد QR" style={{ width: size, height: size }} />
      {label && <span className="text-xs text-zinc-400">QR</span>}
    </span>
  );
}

export async function generateQrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, { margin: 1, width: 240 });
}
