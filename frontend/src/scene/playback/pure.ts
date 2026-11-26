
export function tracerSpanSecs(flightSecs: number): number {
  const oneFrame = 1 / 60
  return Number.isFinite(flightSecs) && flightSecs > oneFrame ? flightSecs : oneFrame
}

export function occlusionCells(ax: number, ay: number, bx: number, by: number, cell = 16): Set<string> {
  const out = new Set<string>();
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / (cell / 2)));
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    out.add(`${Math.floor((ax + dx * k) / cell)},${Math.floor((ay + dy * k) / cell)}`);
  }
  return out;
}

export function occlusionFootprintCells(minX: number, minY: number, maxX: number, maxY: number, cell = 16): string[] {
  let gx0 = Math.floor(minX / cell), gx1 = Math.floor(maxX / cell);
  let gy0 = Math.floor(minY / cell), gy1 = Math.floor(maxY / cell);
  const MAX_SPAN = 64;
  if (gx1 - gx0 >= MAX_SPAN) { const c = Math.floor((gx0 + gx1) / 2); gx0 = c - (MAX_SPAN >> 1); gx1 = gx0 + MAX_SPAN - 1; }
  if (gy1 - gy0 >= MAX_SPAN) { const c = Math.floor((gy0 + gy1) / 2); gy0 = c - (MAX_SPAN >> 1); gy1 = gy0 + MAX_SPAN - 1; }
  const out = [];
  for (let gx = gx0; gx <= gx1; gx++) {
    for (let gy = gy0; gy <= gy1; gy++) out.push(`${gx},${gy}`);
  }
  return out;
}
