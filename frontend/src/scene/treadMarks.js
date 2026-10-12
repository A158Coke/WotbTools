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

/** 印记寿命（回放时钟）：`after` 秒内全显，随后 `dur` 秒线性淡出到 0（共 20 s 消失；
 * 2026-10-11 用户定值 10+10）。客户端 TreadSystem 有同类的淡出-消失行为（用户对照），
 * 但具体时长未逆向——本组常数是**产品决定**（上游 feasibility §四 的自定参数项）。 */
export const TREAD_FADE = { after: 10, dur: 10 };

/** 全局不透明度系数：顶点色 alpha = 淡出系数 × 本值。
 *
 * 客户端着色器口径（deferred-decal-vp.sl 的 FADE_OUT_WITH_TIME 分支，2026-10-11 取证）：
 * `parameters.x` 是**印记出生时间**，透明度 = 距离淡出（`treadsNear/FarFadeDistance`）
 * × 时间淡出（`smoothstep(fadeOutTimeStartEnd)`）——着色器里**没有**额外的整体压暗。
 * 但直接把本系数设 1.0 后实测比游戏**更黑**（用户目视），0.55 时则偏淡 ⇒ 客户端还有
 * 两处未复刻的减淡机制（二者都在同一着色器族里有实证，具体数值在游戏层代码、尚未逆向）：
 *   ① 距离淡出（`[auto] property float treadsNearFadeDistance/treadsFarFadeDistance`，
 *      随相机距离 smoothstep 淡出——旁观/俯瞰视距下客户端会比我们淡）；
 *   ② 贴花调色分支 `#if GLOBAL_TINT: rgb *= globalFlatColor.rgb * 2.0`（同族着色器，
 *      铁轨贴花已证实该分支在贴花实例上启用；若履带印亦然，客户端标记色比纹理原色亮）。
 * 本值 = **用户目视两点校准**（0.55 偏淡 / 1.0 偏黑，目标介于其间），待上述任一机制
 * 逆向定案后以其精确口径替换。 */
export const TREAD_OPACITY = 0.8;

/**
 * 印记年龄（回放秒）→ 不透明度系数 [0,1]：`after` 前恒 1，之后线性降 0。
 * 真正的负年龄表示回放时钟早于该段出生时刻（例如 seek 到首个 coverage 之前）：必须隐藏，
 * 否则延迟 hard-reset 尚未拿到新 anchor 时会短暂显示“未来的履带印”。仅给 1e-9 的浮点
 * 边界容差，避免刚好在出生时刻因数值抖动闪烁。
 */
export function treadAlphaAt(age, fade = TREAD_FADE) {
  if (age < -1e-9) return 0;
  if (!(age > fade.after)) return 1;
  const a = 1 - (age - fade.after) / fade.dur;
  return a > 0 ? a : 0;
}

/**
 * `tread/<tank_id>.json`（或缺省 null）→ 消费参数。
 * 坏数值逐字段回落（不整条拒绝——authored 的一半坏不该抹掉另一半）。
 *
 * ⚠️ `width` 的契约：**只有有效 authored 数值才透出数字**；`manual_width` 缺失/为 null
 * （国别回落车）/非法，或无 json（404）一律透出 `null` = "未 authored"——调用方按
 * 客户端 `forceManualWidth=false` 语义从模型履带盒实测，最后一跳才是 `TREAD_FALLBACK.width`。
 * 常量只存在于消费侧一处（场景 `resolvedTreadWidth`）：早先在这里兜底填常量，会让调用方
 * 无从区分"真 authored"与"正在等模型"，宽度被永久锁死（2026-10-11 review P2）。
 *
 * ⚠️ `texture` 归一化成 **带前导斜杠** 的资产路径：json 里存的是包相对路径
 * （`tread/textures/X.webp`，数据面口径），而 `assetProvider.url()` 是
 * `requireBase() + path` 的**裸拼接**，所有调用方约定传 `/glb/…` 形的路径——
 * 丢斜杠会拼出 `http://host:8123tread/…`，Image 立即失败、`tex.image` 永远为空，
 * 空纹理采样 (0,0,0,0) 在透明混合下**完全隐形**（2026-10-11 测试页实测报障的根因）。
 */
export function resolveTreadParams(json) {
  const texPath = (v) =>
    (typeof v === 'string' && v ? '/' + v.replace(/^\/+/, '') : GENERIC_TREAD_TEXTURE);
  const widthOf = (v) => (Number.isFinite(v) && v > 1e-3 ? v : null);
  if (!json || typeof json !== 'object') {
    return { texture: GENERIC_TREAD_TEXTURE, width: null, space: TREAD_FALLBACK.space, authored: false };
  }
  return {
    texture: texPath(json.texture),
    // 数字 → authored 宽度；null/缺失/非法 → null（未 authored，调用方模型实测）
    width: widthOf(json.manual_width),
    space: Number.isFinite(json.manual_space) && json.manual_space > 1e-3
      ? json.manual_space : TREAD_FALLBACK.space,
    authored: json.fallback !== true,
  };
}

/** 贴图路径 → stem（`/tread/textures/GB_01_tread.webp` → `GB_01_tread`）。 */
export function textureStemOf(path) {
  if (typeof path !== 'string') return '';
  const name = path.split('/').pop() || '';
  return name.replace(/\.webp$/i, '');
}

/**
 * alpha 归一化系数：`/tread/textures.json` 的 per-stem `scale`（导出器按全库中位数
 * 归一，消除跨贴图 1.7~4× 的密度差——2026-10-11 用户裁示"统一颜色深浅"）。
 * 缺失/异常一律 1（fail-open 到原始贴图观感）。
 */
export function treadScaleFor(meta, texturePath) {
  const stem = textureStemOf(texturePath);
  const v = meta && meta.textures && stem ? meta.textures[stem] : null;
  const s = v && Number.isFinite(v.scale) && v.scale > 0 ? v.scale : 1;
  return s;
}

/** 单侧履带的路径累积态。
 *
 * `segs` 是**固定槽位环形**缓冲：槽位 = 绝对序号 % cap（`total` = 累计出段数），
 * 即 `segs[k % cap]` 永远是绝对序号 k 的段——调用方（InstancedMesh 实例）按同一
 * 槽位公式写入，环形覆写只动被覆盖的那一个槽，**不搬动任何已写实例的索引**。
 * `written` 是消费侧书签（已写进 GPU 的绝对段数）。
 */
export function createTrailState() {
  // lastMark = 上一横截面 {x, z, yaw, t}——印记戳 = 相邻两横截面之间的**扫掠四边形**
  // （客户端同构：每戳由"上一戳时刻的履带横截面 → 当前时刻的横截面"围成，相邻戳共享
  // 整条接缝边 ⇒ 转弯处天生无缝；deferred-decal-vp.sl 的剪切参数 y→y·z+w 即这一几何）。
  return { hasLast: false, x: 0, z: 0, yaw: 0, t: 0, acc: 0, segs: [], head: 0, total: 0, written: 0,
           breakPending: false, lastSegT: -Infinity,
           lastMark: { x: 0, z: 0, yaw: 0, t: 0 } };
}

/**
 * 断开路径连续性，但**保留已经生成的历史履带印**。
 *
 * 调用方在两类场景都复用这个入口：
 * - AoI/coverage 空洞、pose 大跳：下一可见点应成为新 anchor，历史 decal 继续按寿命淡出；
 * - seek 后退、关断重开、宽度变化：调用方随后会从 START 重喂。`advanceTrail()` 看到
 *   新 anchor 时刻不晚于最后历史段，会把它识别为真正的全量重建并清历史。
 *
 * 这样避免把“断链”错误实现成“删除历史印记”（#587 review blocker）。
 */
export function resetTrailState(st) {
  st.hasLast = false;
  st.acc = 0;
  st.breakPending = true;
}

function clearTrailHistory(st) {
  st.segs.length = 0;
  st.head = 0;
  st.total = 0;
  st.written = 0;
  st.lastSegT = -Infinity;
  st.breakPending = false;
}

/** 角度插值（最短弧，rad）——横截面在步内取交会点时用。 */
function lerpAngle(a, b, f) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * f;
}

/**
 * 沿采样点序列推进一侧履带的路径累积，按 `space`（米）打**横截面戳**。
 *
 * - 戳 = 相邻两横截面的扫掠四边形（`{x0,z0,yaw0,x1,z1,yaw1,t}`；t = 后一横截面时刻）。
 *   横截面 = 该时刻履带中心线处、垂直于车体朝向的宽度线——**相邻戳共享整条接缝边**
 *   （前一戳的 (x1,z1,yaw1) 即后一戳的 (x0,z0,yaw0)），转弯处无楔形缝（客户端同构）。
 * - 采样点 = `{x, z, t, yaw}`（世界系 + 回放时刻 + 车体朝向）；步内交会点按距离分数插值
 *   （朝向走最短弧）。
 * - 零位移样本（停车 / 原地转向）**推进采样时刻与朝向但不累加里程**（2026-10-11 review：
 *   不推进的话，重新起步的新戳出生时刻在「停车前」与「起步后」之间插值——实测 40.1 s
 *   而实际 100 s，新印记一出即过期）。
 * - `resetTrailState()` 后若下一 anchor 的时间**晚于**最后历史段：视作 AoI/传送断链，只重锚；
 *   若不晚于最后历史段：视作 seek/重开/参数变化的全量重建，先清历史再重放。
 * - 返回本次新增戳数（`total` 差值）；环形覆写只替换 `segs[k % cap]` 槽位内容。
 *
 * @param {ReturnType<createTrailState>} st 路径累积态（就地变更）
 * @param {Array<{x:number, z:number, t?:number, yaw?:number}>} pts 采样点
 * @param {number} space 打戳间距（m，authored `manual_space`）
 * @param {number} cap 戳缓存上限
 * @returns {number} 新增戳数
 */
export function advanceTrail(st, pts, space, cap) {
  if (!(space > 1e-3)) return 0;
  let added = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (!st.hasLast) {
      const pt = Number.isFinite(p.t) ? p.t : 0;
      // resetTrailState 同时承担“断链”和“即将全量重建”的入口。真正区别在下一 anchor：
      // AoI/传送恢复一定向前走（pt > lastSegT）⇒ 保留历史；seek/重开从 START 重喂
      // （pt <= lastSegT）⇒ 清历史。容差只吸收网格边界浮点噪声。
      if (st.breakPending && st.total > 0 && pt <= st.lastSegT + 1e-9) clearTrailHistory(st);
      st.breakPending = false;
      st.hasLast = true;
      st.x = p.x; st.z = p.z; st.yaw = p.yaw || 0; st.t = pt; st.acc = 0;
      st.lastMark.x = p.x; st.lastMark.z = p.z; st.lastMark.yaw = st.yaw; st.lastMark.t = st.t;
      continue;
    }
    const dx = p.x - st.x, dz = p.z - st.z;
    const d = Math.hypot(dx, dz);
    const pyaw = p.yaw || 0;
    const pt = p.t || 0;
    if (!(d > 1e-6)) {
      // 静止样本：不累加里程、不打戳（st.x/z 本就不变），但**采样时刻与朝向必须推进**——
      // 停车期间（速度 0 但有采样点、可能原地转向）若把 t 冻在停车前，重新起步跨过下一个
      // 打戳边界时出生时刻会在「停车前」与「起步后」之间插值（review 复现：实际 100.1 s
      // 的戳被算成 40.1 s ⇒ 当前 alpha=0，新印记一出生就不可见）。
      st.t = pt;
      st.yaw = pyaw;
      continue;
    }
    const accEnd = st.acc + d;
    // ⚠️ floor 前必须加静差（2026-10-11 定案）：点位来自插值，步长带 ~1e-10 抖动；当 accEnd
    // 落在整数界下 1e-9 内时，`floor(acc/space)+1` 对**下一个**半步仍算出同一个 j，配合
    // 条件里的 +1e-9 容差 ⇒ **同一戳被相邻两步重复发出**（实测 20 m 窗口发 29/27 戳、L/R
    // 因抖动不对称、轨迹上出现不规则双戳）。floor 内加静差后同一边界只能跨过一次。
    for (let j = Math.floor((st.acc + 1e-9) / space) + 1; j * space <= accEnd + 1e-9; j++) {
      const f = (j * space - st.acc) / d;      // 步内交会分数 ∈ (0, 1]
      const m = st.lastMark;
      const mk = {
        x: st.x + dx * f, z: st.z + dz * f,
        yaw: lerpAngle(st.yaw, pyaw, f),
        t: st.t + (pt - st.t) * f,
      };
      pushSeg(st, { x0: m.x, z0: m.z, yaw0: m.yaw, x1: mk.x, z1: mk.z, yaw1: mk.yaw, t: mk.t }, cap);
      m.x = mk.x; m.z = mk.z; m.yaw = mk.yaw; m.t = mk.t;
      added++;
    }
    st.acc = accEnd;
    st.x = p.x; st.z = p.z; st.yaw = pyaw; st.t = pt;
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
  st.lastSegT = seg.t;
}

/** 贴地抬升（m）：印记四角**逐角独立采样**地形高度后再抬——抬升只需盖住
 * 「真值场双线性面 vs 渲染网格（LOD 分片线性面）」的残差。全景视距下客户端合法的
 * 粗格网格与真值面可差 5~15 cm（铁轨 D4 同族问题），0.06 时实测成片被网格盖住
 * （印记"被地面挡住且断续可见"的根因）⇒ 取 0.12；近距平地上略微悬空，观感可接受。 */
export const TRAIL_LIFT = 0.12;
/**
 * 戳（扫掠四边形）→ 贴地**4 个角**（世界系，逐角独立采样地形高度 + 抬升）。
 *
 * 几何 = 客户端同构：两个横截面（各为过中心线、垂直于当时车体朝向的宽度线）之间的
 * 扫掠四边形——角序 `[L0, R0, R1, L1]`（L/R = 横截面两端，0/1 = 先后两个横截面），
 * uv 固定 `(0,0)(1,0)(1,1)(0,1)`（u = 横向、v = 沿戳方向一次完整条带，调用方预填）。
 * **相邻戳共享整条接缝边**（前戳的 L1/R1 ≡ 后戳的 L0/R0，两侧横截面由同一次采样插值
 * 产生）⇒ 转弯处无楔形缝（2026-10-11 用户报"仍不连续"的根因，客户端 deferred-decal
 * 的剪切几何同款）。
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
export function trailStampCorners(seg, width, heightAt, out) {
  const hw = width / 2;
  // 横截面两端：中心 ± 横向量·半宽。横向量取车队 heading 的水平右向（与旧实现同一
  // 约定：fwd=(−sin yaw, cos yaw) → right=(−cos yaw, −sin yaw)，左右对称无语义）。
  const fx0 = -Math.sin(seg.yaw0), fz0 = Math.cos(seg.yaw0);
  const rx0 = -fz0, rz0 = fx0;
  const fx1 = -Math.sin(seg.yaw1), fz1 = Math.cos(seg.yaw1);
  const rx1 = -fz1, rz1 = fx1;
  const p0 = [seg.x0 - rx0 * hw, seg.z0 - rz0 * hw, seg.x0 + rx0 * hw, seg.z0 + rz0 * hw];
  const p1 = [seg.x1 - rx1 * hw, seg.z1 - rz1 * hw, seg.x1 + rx1 * hw, seg.z1 + rz1 * hw];
  // 角序 [L0, R0, R1, L1]
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
