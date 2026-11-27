
export const TREAD_FALLBACK = { width: 0.6, space: 1.0 };
export const GENERIC_TREAD_TEXTURE = '/tread/textures/Tread.webp';

export const TREAD_RING = 50;

export const TREAD_ACTIVATE = 0.3;

export const TREAD_FADE = { start: 5.45, end: 7.62 };


export function treadAlphaAt(age: number, fade: { start: number; end: number } = TREAD_FADE): number {
  if (age < -1e-9) return 0;
  if (!(age > fade.start)) return 1;
  if (age >= fade.end) return 0;
  const x = (age - fade.start) / (fade.end - fade.start);
  return 1 - x * x * (3 - 2 * x);
}

export interface TreadParams {
  texture: string
  width: number | null
  space: number
  authored: boolean
}

export function resolveTreadParams(json: { texture?: unknown; manual_width?: unknown; manual_space?: unknown; fallback?: unknown } | null | undefined): TreadParams {
  const texPath = (v: unknown): string =>
    (typeof v === 'string' && v ? '/' + v.replace(/^\/+/, '') : GENERIC_TREAD_TEXTURE);
  const widthOf = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 1e-3 ? v : null);
  if (!json || typeof json !== 'object') {
    return { texture: GENERIC_TREAD_TEXTURE, width: null, space: TREAD_FALLBACK.space, authored: false };
  }
  return {
    texture: texPath(json.texture),
    width: widthOf(json.manual_width),
    space: typeof json.manual_space === 'number' && Number.isFinite(json.manual_space) && json.manual_space > 1e-3
      ? json.manual_space : TREAD_FALLBACK.space,
    authored: json.fallback !== true,
  };
}

export function textureStemOf(path: unknown): string {
  if (typeof path !== 'string') return '';
  const name = path.split('/').pop() || '';
  return name.replace(/\.webp$/i, '');
}

export interface TreadTextureMeta {
  scale?: number
}

export function treadScaleFor(meta: { textures?: Record<string, TreadTextureMeta> | null } | null | undefined, texturePath: string): number {
  const stem = textureStemOf(texturePath);
  const v = meta && meta.textures && stem ? meta.textures[stem] : null;
  const s = v && typeof v.scale === 'number' && Number.isFinite(v.scale) && v.scale > 0 ? v.scale : 1;
  return s;
}

export interface TrailStamp {
  x0: number
  z0: number
  yaw0: number
  x1: number
  z1: number
  yaw1: number
  t: number
}

export interface OpenStampCross {
  x1: number
  z1: number
  yaw1: number
}

export interface TrailState {
  hasLast: boolean
  x: number
  z: number
  yaw: number
  t: number
  anchor: { x: number; z: number; yaw: number; t: number }
  open: OpenStampCross | null
  segs: TrailStamp[]
  total: number
  written: number
  breakPending: boolean
  lastSegT: number
}

export function createTrailState(): TrailState {
  return { hasLast: false, x: 0, z: 0, yaw: 0, t: 0,
           anchor: { x: 0, z: 0, yaw: 0, t: 0 }, open: null,
           segs: [], total: 0, written: 0,
           breakPending: false, lastSegT: -Infinity };
}

export function resetTrailState(st: TrailState): void {
  st.hasLast = false;
  st.breakPending = true;
  st.open = null;
}

function clearTrailHistory(st: TrailState): void {
  st.segs.length = 0;
  st.total = 0;
  st.written = 0;
  st.lastSegT = -Infinity;
  st.breakPending = false;
}

/**
 * 沿采样点序列推进一侧履带（客户端槽位模型）。
 *
 * - 活戳 = 「锚点横截面 → 当前横截面」的扫掠四边形；每来一个移动样本就**把末端拉到该样本**
 *   （前沿跟随车辆当前位置，真机同款），锚点与末端距离满 `space` 时**提交**该戳并就地重新
 *   落锚（锚点 = 当前点；不做精确倍数插值）。
 * - 提交的戳 `t` = **锚点时刻**；锚点时刻**始终贴住当前采样时刻**（含停车/低速）——落锚
 *   即"槽位时间刷新"，槽位存续由淡出窗按该时刻判定（客户端 0x83d410 的槽位时间门控同款）；
 *   相邻戳共享整条接缝边（前戳 (x1,z1,yaw1) ≡ 后戳 (x0,z0,yaw0)）⇒ 单趟内零重叠、转弯无缝。
 * - 零位移样本（停车 / 原地转向）推进采样时刻与朝向但不累加里程；原地转向时活戳末端
 *   横截面**跟随朝向**（打转覆盖的扫掠面）。
 * - `resetTrailState()` 后若下一 anchor 的时刻**晚于**最后历史戳：视作 AoI/传送断链，只重锚
 *   （历史保留）；否则视作 seek/重开/参数变化的全量重建，先清历史再重放。
 * - 返回本次**提交**的戳数；环形覆写只替换 `segs[k % cap]` 槽位内容（cap = 客户端 50 槽）。
 *
 * @param {ReturnType<createTrailState>} st 路径累积态（就地变更）
 * @param {Array<{x:number, z:number, t?:number, yaw?:number}>} pts 采样点
 * @param {number} space 落锚间距（m，authored `manual_space`）
 * @param {number} cap 戳环槽数（TREAD_RING）
 * @returns {number} 本次提交的戳数
 */
export interface TrailSample {
  x: number
  z: number
  t?: number
  yaw?: number
}

export function advanceTrail(st: TrailState, pts: readonly TrailSample[], space: number, cap: number): number {
  if (!(space > 1e-3)) return 0;
  let added = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const pyaw = p.yaw || 0;
    const pt = Number.isFinite(p.t) ? (p.t as number) : 0;
    if (!st.hasLast) {
      if (st.breakPending && st.total > 0 && pt <= st.lastSegT + 1e-9) clearTrailHistory(st);
      st.breakPending = false;
      st.hasLast = true;
      st.x = p.x; st.z = p.z; st.yaw = pyaw; st.t = pt;
      st.anchor.x = p.x; st.anchor.z = p.z; st.anchor.yaw = pyaw; st.anchor.t = pt;
      st.open = null;
      continue;
    }
    const d = Math.hypot(p.x - st.x, p.z - st.z);
    st.anchor.t = pt;
    if (!(d > 1e-6)) {
      st.t = pt;
      st.yaw = pyaw;
      if (st.open && st.open.yaw1 !== pyaw) st.open.yaw1 = pyaw;
      continue;
    }
    st.x = p.x; st.z = p.z; st.yaw = pyaw; st.t = pt;
    const anchorDist = Math.hypot(p.x - st.anchor.x, p.z - st.anchor.z);
    if (!st.open && anchorDist >= TREAD_ACTIVATE - 1e-9) {
      st.open = { x1: p.x, z1: p.z, yaw1: pyaw };
    }
    if (st.open) { st.open.x1 = p.x; st.open.z1 = p.z; st.open.yaw1 = pyaw; }
    if (anchorDist >= space - 1e-9) {
      pushSeg(st, { x0: st.anchor.x, z0: st.anchor.z, yaw0: st.anchor.yaw,
                    x1: p.x, z1: p.z, yaw1: pyaw, t: st.anchor.t }, cap);
      st.anchor.x = p.x; st.anchor.z = p.z; st.anchor.yaw = pyaw;
      st.open = null;
      added++;
    }
  }
  return added;
}
function pushSeg(st: TrailState, seg: TrailStamp, cap: number): void {
  if (st.segs.length < cap) st.segs.push(seg);
  else st.segs[st.total % cap] = seg;
  st.total++;
  st.lastSegT = seg.t;
}

export function openStampOf(st: TrailState): TrailStamp | null {
  if (!st.open) return null;
  if (!(Math.hypot(st.open.x1 - st.anchor.x, st.open.z1 - st.anchor.z) > 1e-6)) return null;
  return { x0: st.anchor.x, z0: st.anchor.z, yaw0: st.anchor.yaw,
           x1: st.open.x1, z1: st.open.z1, yaw1: st.open.yaw1, t: st.anchor.t };
}

export const TRAIL_LIFT = 0.12;
/**
 * 戳（扫掠四边形）→ 贴地**4 个角**（世界系，逐角独立采样地形高度 + 抬升）。
 *
 * 几何 = 客户端同构：两个横截面（各为过中心线、垂直于当时车体朝向的宽度线）之间的
 * 扫掠四边形——角序 `[L0, R0, R1, L1]`（L/R = 横截面两端，0/1 = 先后两个横截面），
 * uv 固定 `(0,0)(1,0)(1,1)(0,1)`（u = 横向、v = 沿戳方向一次完整条带，调用方预填）。
 * **相邻戳共享整条接缝边**（前戳的 L1/R1 ≡ 后戳的 L0/R0）⇒ 转弯处无楔形缝。
 *
 * 逐角高度：印记必须贴合**渲染网格**（LOD 分片线性面，与真值场双线性面残差随视距
 * 增大）——四角各自落到 `heightAt` + `TRAIL_LIFT` 上，随坡双向弯折；单平面只 3 个
 * 自由度，会在 1 m 弦上一头扎进网格（2026-10-11 前车之鉴）。
 *
 * @param {{x0:number,z0:number,yaw0:number,x1:number,z1:number,yaw1:number}} seg 戳
 * @param {number} width 印记条带宽（m，authored `manual_width`）
 * @param {(x:number, z:number)=>number} heightAt 地形高度采样（场景 `sampleHeight`）
 * @param {Float32Array|number[]} out 长度 ≥12 的输出数组（就地写 [x,y,z]×4）
 * @returns {boolean} 是否写入（false = 戳退化，调用方跳过）
 */
export function trailStampCorners(seg: TrailStamp, width: number, heightAt: (x: number, z: number) => number, out: Float32Array | number[]): boolean {
  const hw = width / 2;
  const fx0 = -Math.sin(seg.yaw0), fz0 = Math.cos(seg.yaw0);
  const rx0 = -fz0, rz0 = fx0;
  const fx1 = -Math.sin(seg.yaw1), fz1 = Math.cos(seg.yaw1);
  const rx1 = -fz1, rz1 = fx1;
  const p0 = [seg.x0 - rx0 * hw, seg.z0 - rz0 * hw, seg.x0 + rx0 * hw, seg.z0 + rz0 * hw];
  const p1 = [seg.x1 - rx1 * hw, seg.z1 - rz1 * hw, seg.x1 + rx1 * hw, seg.z1 + rz1 * hw];
  const cs = [p0[0], p0[1], p0[2], p0[3], p1[2], p1[3], p1[0], p1[1]];
  for (let i = 0; i < 4; i++) {
    const x = cs[i * 2], z = cs[i * 2 + 1];
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    out[i * 3] = x;
    out[i * 3 + 1] = heightAt(x, z) + TRAIL_LIFT;
    out[i * 3 + 2] = z;
  }
  return true;
}
