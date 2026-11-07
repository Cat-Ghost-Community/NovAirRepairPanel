/** Browser-independent signature geometry. Coordinates stay in one immutable drawing frame. */
export type SignaturePoint = { x: number; y: number };
export type SignatureStroke = SignaturePoint[];
export type SignatureFrame = { width: number; height: number };

export function signatureTransform(frame: SignatureFrame, viewport: SignatureFrame) {
  const scale = Math.min(viewport.width / frame.width, viewport.height / frame.height);
  return { scale, x: (viewport.width - frame.width * scale) / 2, y: (viewport.height - frame.height * scale) / 2 };
}

export function signaturePoint(x: number, y: number, frame: SignatureFrame, viewport: SignatureFrame): SignaturePoint | null {
  const fit = signatureTransform(frame, viewport);
  const point = { x: (x - fit.x) / fit.scale, y: (y - fit.y) / fit.scale };
  return point.x >= 0 && point.y >= 0 && point.x <= frame.width && point.y <= frame.height ? point : null;
}

export function signatureHasInk(strokes: readonly SignatureStroke[]) {
  return strokes.some(points => {
    let distance = 0;
    for (let i = 1; i < points.length; i++) distance += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    return distance >= 3;
  });
}

export function paintSignature(ctx: CanvasRenderingContext2D, strokes: readonly SignatureStroke[], frame: SignatureFrame, viewport: SignatureFrame) {
  const fit = signatureTransform(frame, viewport);
  ctx.save();
  ctx.translate(fit.x, fit.y);
  ctx.scale(fit.scale, fit.scale);
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#172033";
  for (const points of strokes) {
    if (points.length < 2) continue;
    ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length - 1; i++) {
      const next = points[i + 1];
      ctx.quadraticCurveTo(points[i].x, points[i].y, (points[i].x + next.x) / 2, (points[i].y + next.y) / 2);
    }
    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y); ctx.stroke();
  }
  ctx.restore();
}
