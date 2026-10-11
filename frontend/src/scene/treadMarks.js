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
 * 本模块不依赖 three.js：段是普通对象、四边形是逐角坐标数组，便于单测；
 * 场景侧只做容器与写入（逐车动态合并几何，槽位 = 绝对序号）。
 */

/** 无 authored 数据车辆的产品回落（上游 feasibility §四：回落本身无客户端依据）：
 * 贴图用客户端通用张 `Tread`（数据面在场），宽度/间距取 311 辆 authored 值的中位量级。 */
export const TREAD_FALLBACK = { width: 0.6, space: 1.0 };
export const GENERIC_TREAD_TEXTURE = '/tread/textures/Tread.webp';

/** 印记寿命（回放时钟）：`after` 秒内全显，随后 `dur` 秒线性淡出到 0（共 90 s 消失）。
 * 客户端 TreadSystem 有同类的淡出-消失行为（用户对照），但具体时长未逆向——本组常数
 * 是**产品决定**（上游 feasibility §四 的自定参数项），不是客户端数据。 */
export const TREAD_FADE = { after: 60, dur: 30 };

/**
 * 印记年龄（回放秒）→ 不透明度系数 [0,1]：`after` 前恒 1，之后线性降 0。
 * 输入负数（时钟早于出段时刻，seek 边界）按 1 处理（fail-safe：宁可多显不闪烁）。
 */
export function treadAlphaAt(age, fade = TREAD_FADE) {
  if (!(age > fade.after)) return 1;
  const a = 1 - (age - fade.after) / fade.dur;
  return a > 0 ? a : 0;
}

/**
 * `tread/<tank_id>.json`（或缺省 null）→ 消费参数。
 * 坏数值逐字段回落（不整条拒绝——authored 的一半坏不该抹掉另一半）。
 *
 * ⚠️ `texture` 归一化成 **带前导斜杠** 的资产路径：json 里存的是包相对路径
 * （`tread/textures/X.webp`，数据面口径），而 `assetProvider.url()` 是
 * `requireBase() + path` 的**裸拼接**，所有调用方约定传 `/glb/…` 形的路径——
 * 丢斜杠会拼出 `http://host:8123tread/…`，Image 立即失败、`tex.image` 永远为空，
 * 空纹理采样 (0,0,0,0) 在透明混合下**完全隐形**（2026-10-11 测试页实测报障的根因）。
 */
export function resolveTreadParams(json) {
  const num = (v, fb) => (Number.isFinite(v) && v > 1e-3 ? v : fb);
  const texPath = (v) =>
    (typeof v === 'string' && v ? '/' + v.replace(/^\/+/, '') : GENERIC_TREAD_TEXTURE);
  if (!json || typeof json !== 'object') {
    return { texture: GENERIC_TREAD_TEXTURE, width: TREAD_FALLBACK.width, space: TREAD_FALLBACK.space, authored: false };
  }
  return {
    texture: texPath(json.texture),
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
 * @param {Array<{x:number, z:number, t?:number}>} pts 采样点（世界系 + 回放时刻；
 *   可见性断链由调用方传空/复位处理；`t` 随出段写入 `seg.t` 供寿命淡出用）
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
      pushSeg(st, { x: p.x - ux * back, z: p.z - uz * back, dx: ux, dz: uz, len: space, t: p.t || 0 }, cap);
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

/** 贴地抬升（m）：印记四角**逐角独立采样**地形高度后再抬——抬升只需盖住
 * 「真值场双线性面 vs 渲染网格（LOD 分片线性面）」的残差。全景视距下客户端合法的
 * 粗格网格与真值面可差 5~15 cm（铁轨 D4 同族问题），0.06 时实测成片被网格盖住
 * （印记"被地面挡住且断续可见"的根因）⇒ 取 0.12；近距平地上略微悬空，观感可接受。 */
export const TRAIL_LIFT = 0.12;
/** 段长放大系数：相邻段重叠 ~25%，盖住转弯处相邻段方向突变留下的楔形缝
 * （直线段重叠区 alpha 叠加略深，软边贴图下不可见）。 */
export const TRAIL_OVERLAP = 1.25;

/**
 * 段 → 贴地四边形的 **4 个角**（世界系，逐角独立采样地形高度 + 抬升）。
 *
 * 为什么逐角而不是"中心高度 + 法线倾斜的单平面"：印记必须贴合**渲染网格**，而网格是
 * LOD 分片线性面、与真值场的双线性面存在随视距增大的残差——单平面只有 3 个自由度，
 * 在 1 m 弦上仍会一头扎进网格里；四角各自落到 `heightAt`（真值场）+ 抬升上，随坡
 * 双向弯折，残差只剩"角点采样 vs 网格插值"一项，由 TRAIL_LIFT 统一盖住。
 * 横向基矢取水平面内垂直于段方向即可（坡度已由逐角高度消化，无需法线投影）。
 *
 * @param {{x:number, z:number, dx:number, dz:number, len:number}} seg 段
 * @param {number} width 印记条带宽（m，authored `manual_width`）
 * @param {(x:number, z:number)=>number} heightAt 地形高度采样（场景 `sampleHeight`）
 * @param {Float32Array|number[]} out 长度 ≥12 的输出数组（就地写 [x,y,z]×4，
 *   顺序 (-横,-纵) (+横,-纵) (+横,+纵) (-横,+纵)；uv 固定 (0,0)(1,0)(1,1)(0,1)，由调用方预填）
 * @returns {boolean} 是否写入（false = 段方向退化，调用方跳过该段）
 */
export function trailQuadCorners(seg, width, heightAt, out) {
  const dl = Math.hypot(seg.dx, seg.dz);
  if (!(dl > 1e-6)) return false;
  const ux = seg.dx / dl, uz = seg.dz / dl;
  const rx = -uz, rz = ux;                      // 水平面内横向（左右对称，符号无语义）
  const hw = width / 2;
  const hl = (seg.len * TRAIL_OVERLAP) / 2;
  const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let i = 0; i < 4; i++) {
    const [a, b] = cs[i];
    const x = seg.x + rx * hw * a + ux * hl * b;
    const z = seg.z + rz * hw * a + uz * hl * b;
    out[i * 3] = x;
    out[i * 3 + 1] = heightAt(x, z) + TRAIL_LIFT;
    out[i * 3 + 2] = z;
  }
  return true;
}
