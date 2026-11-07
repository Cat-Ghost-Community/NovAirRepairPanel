/** Signature checks supplement MIME validation; downloads also use nosniff. */
export function matchesContentType(data: Uint8Array, mime: string): boolean {
  const buffer = Buffer.from(data);
  const starts = (...bytes: number[]) => bytes.every((byte,index) => buffer[index] === byte);
  switch (mime) {
    case "image/png": return starts(137,80,78,71,13,10,26,10);
    case "image/jpeg": return starts(255,216,255);
    case "image/gif": return ["GIF87a","GIF89a"].includes(buffer.subarray(0,6).toString("ascii"));
    case "image/webp": return buffer.subarray(0,4).toString("ascii") === "RIFF" && buffer.subarray(8,12).toString("ascii") === "WEBP";
    case "video/mp4": return buffer.subarray(4,8).toString("ascii") === "ftyp";
    case "video/webm": return starts(0x1a,0x45,0xdf,0xa3);
    case "application/pdf": return buffer.subarray(0,5).toString("ascii") === "%PDF-";
    default: return false;
  }
}
