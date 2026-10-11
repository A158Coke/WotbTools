/**
 * 地面履带印（TreadSystem 碾压痕）——生成与摆放的纯函数层。
 *
 * 数据面 = 上游 `tools/export_tank_tread.py` 产出的包内 `tread/<tank_id>.json`
 * （客户端 `treadParameters` 块：印记条带宽/间距 + 贴图引用）与 `tread/textures/*.webp`
 * （客户端 DDS 无损转码）。可行性与 fail-closed 边界见上游
 * `docs/feasibility-track-marks.md`；本模块只管"沿路径铺段 + 段→贴地四边形"两件事。
 *
 * 与客户端的关系（诚实记录）：客户端 TreadSystem 的逐帧铺放算法未逆向，本实现按
 * authored `manualSpace` 沿回放位姿路径铺贴图段——贴图/宽度/间距是客户端作者数据，
 * 铺放节奏与段几何是依据作者参数的近似（上游 feasibility 文档 §四）。
 *
 * 本模块不依赖 three.js：段是普通对象、矩阵是 16 元素列主序数组，便于单测；
 * 场景侧只做容器与写入（InstancedMesh instanceMatrix）。
 */

/** 无 authored 数据车辆的产品回落（上游 feasibility §四：回落本身无客户端依据）：
 * 贴图用客户端通用张 `Tread`（数据面在场），宽度/间距取 311 辆 authored 值的中位量级。 */
export const TREAD_FALLBACK = { width: 0.6, space: 1.0 };
export const GENERIC_TREAD_TEXTURE = 'tread/textures/Tread.webp';

/**
 * `tread/<tank_id>.json`（或缺省 null）→ 消费参数。
 * 坏数值逐字段回落（不整条拒绝——authored 的一半坏不该抹掉另一半）。
 */
export function resolveTreadParams(json) {
  const num = (v, fb) => (Number.isFinite(v) && v > 1e-3 ? v : fb);
  if (!json || typeof json !== 'object') {
    return { texture: GENERIC_TREAD_TEXTURE, width: TREAD_FALLBACK.width, space: TREAD_FALLBACK.space, authored: false };
  }
  return {
    texture: typeof json.texture === 'string' && json.texture ? json.texture : GENERIC_TREAD_TEXTURE,
    width: num(json.manual_width, TREAD_FALLBACK.width),
    space: num(json.manual_space, TREAD_FALLBACK.space),
    authored: true,
  };
}

/** 单侧履带的路径累积态。
 *
 * `segs` 是**固定槽位环形**缓冲：槽位 = 绝对序号 % cap（`total` = 累计出段数），
 * 即 `segs[k % cap]` 永远是绝对序号 k 的段——调用方（InstancedMesh 实例）按同一
 * 槽位公式写入，环形覆写只动被覆盖的那一个槽，**不搬动任何已写实例的索引**。
 * `written` 是消费侧书签（已写进 GPU 的绝对段数），本模块不解释它、只随复位归零。
 */
export function createTrailState() {
  return { hasLast: false, x: 0, z: 0, acc: 0, segs: [], head: 0, total: 0, written: 0 };
}

/** 复位（seek 后退 / 会话复用）：路径累积与段缓存全部作废。 */
export function resetTrailState(st) {
  st.hasLast = false;
  st.acc = 0;
  st.segs.length = 0;
  st.head = 0;
  st.total = 0;
  st.written = 0;
}

/**
 * 沿采样点序列推进一侧履带的路径累积，按 `space`（米）铺段。
 *
 * - 段 = `{x, z, dx, dz, len}`：段**中心**、单位方向（水平面内）、段长。方向取本采样步的
 *   位移方向——印记跟随实际运动方向，不经 yaw 符号约定（镜像系换算由调用方完成）。
 * - 采样步长建议 = 位姿网格步（0.1 s）：8 m/s 下 0.8 m/步，对 1 m 段 granularity 足够。
 * - 大步进（seek 跨越数百米）按同方向连续铺满——确定性输出，seek 重算与连续播放同形。
 * - 返回本次新增段数（`total` 差值）；环形覆写只替换 `segs[k % cap]` 槽位内容。
 *
 * @param {ReturnType<createTrailState>} st 路径累积态（就地变更）
 * @param {Array<{x:number, z:number}>} pts 采样点（世界系；可见性断链由调用方传空/复位处理）
 * @param {number} space 铺段间距（m，authored `manual_space`）
 * @param {number} cap 段缓存上限
 * @returns {number} 新增段数
 */
export function advanceTrail(st, pts, space, cap) {
  if (!(space > 1e-3)) return 0;
  let added = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (!st.hasLast) {
      st.hasLast = true;
      st.x = p.x; st.z = p.z; st.acc = 0;
      continue;
    }
    const dx = p.x - st.x, dz = p.z - st.z;
    const d = Math.hypot(dx, dz);
    if (!(d > 1e-6)) continue;
    const ux = dx / d, uz = dz / d;
    const accEnd = st.acc + d;
    for (let j = Math.floor(st.acc / space) + 1; j * space <= accEnd + 1e-9; j++) {
      const at = j * space - st.acc;          // 本采样步内的里程位置 ∈ (0, d]
      const back = Math.min(space / 2, at);   // 段中心相对步进点的回退（首段钳到步起点）
      pushSeg(st, { x: p.x - ux * back, z: p.z - uz * back, dx: ux, dz: uz, len: space }, cap);
      added++;
    }
    st.acc = accEnd;
    st.x = p.x; st.z = p.z;
  }
  return added;
}

function pushSeg(st, seg, cap) {
  if (st.segs.length < cap) st.segs.push(seg);
  else {
    st.segs[st.head] = seg;
    st.head = (st.head + 1) % cap;
  }
  st.total++;
}

/** 贴地抬升（m）：与基地圆盘同惯例（groundY = sampleHeight + 小间隙防 z-fighting） */
export const TRAIL_LIFT = 0.06;
/** 地形法线有限差分步长（m）：半个印记宽度量级，滤掉 texel 级噪声 */
const NORMAL_EPS = 0.35;

/**
 * 段 → 贴地四边形的实例矩阵（16 元素**列主序**，直接可写 `instanceMatrix.array`）。
 *
 * 基矢 = 贴地坐标系：`n` = 地形法线（有限差分），`f` = 段方向在切平面上的投影（沿路倾向），
 * `r` = n×f（横向）。四边形 = `r·width` × `f·len`，中心抬升 `TRAIL_LIFT`——随坡倾斜
 * （横坡上不插地/不悬浮），纯平地退化为水平四边形。
 *
 * 退化保护：段方向零向量 / 法线过陡（|n.y| < 0.2，陡坎处差分失真）→ 回落水平摆放，
 * 绝不产出 NaN 矩阵（fail-safe）。
 *
 * @param {{x:number, z:number, dx:number, dz:number, len:number}} seg 段
 * @param {number} width 印记条带宽（m，authored `manual_width`）
 * @param {(x:number, z:number)=>number} heightAt 地形高度采样（场景 `sampleHeight`）
 * @param {Float32Array|number[]} out 长度 ≥16 的输出数组（就地写）
 * @returns {boolean} 是否写入（false = 输入退化，调用方跳过该实例）
 */
export function trailQuadMatrix(seg, width, heightAt, out) {
  const dl = Math.hypot(seg.dx, seg.dz);
  if (!(dl > 1e-6)) return false;
  const e = NORMAL_EPS;
  const h = heightAt(seg.x, seg.z);
  let nx = -(heightAt(seg.x + e, seg.z) - heightAt(seg.x - e, seg.z)) / (2 * e);
  let nz = -(heightAt(seg.x, seg.z + e) - heightAt(seg.x, seg.z - e)) / (2 * e);
  const nl = Math.hypot(nx, 1, nz);
  if (!(nl > 1e-9)) { nx = 0; nz = 0; } else { nx /= nl; nz /= nl; }
  let ny = 1 / (nl || 1);
  // 切平面内的前向：f = d − n(d·n)，归一。⚠️ f 带 **y 分量**（斜坡上投影不再水平），
  // 丢掉它 f·n ≠ 0——四边形会斜插进坡里（实测横坡 f·n = 0.25）。
  const dn = (seg.dx * nx + seg.dz * nz) / dl;
  let fx = seg.dx / dl - nx * dn;
  let fy = -ny * dn;
  let fz = seg.dz / dl - nz * dn;
  const fl = Math.hypot(fx, fy, fz);
  if (!(fl > 1e-6) || !(Math.abs(ny) > 0.2)) {
    // 段方向与法线近平行（陡坎差分失真）：回落水平摆放
    fx = seg.dx / dl; fy = 0; fz = seg.dz / dl;
    nx = 0; ny = 1; nz = 0;
  } else {
    fx /= fl; fy /= fl; fz /= fl;
  }
  // 右向 = n × f（正交基 ⇒ 单位）
  const rx = ny * fz - nz * fy;
  const ry = nz * fx - nx * fz;
  const rz = nx * fy - ny * fx;
  const hw = width / 2, hl = seg.len / 2;
  // 列主序：col0 = r·hw，col1 = n，col2 = f·hl，col3 = (x, h+lift, z)
  out[0] = rx * hw; out[1] = ry * hw; out[2] = rz * hw; out[3] = 0;
  out[4] = nx;      out[5] = ny;      out[6] = nz;      out[7] = 0;
  out[8] = fx * hl; out[9] = fy * hl; out[10] = fz * hl; out[11] = 0;
  out[12] = seg.x;  out[13] = h + TRAIL_LIFT; out[14] = seg.z; out[15] = 1;
  return true;
}
