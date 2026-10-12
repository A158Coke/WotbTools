/**
 * 地面履带印（TreadSystem 碾压痕）——生成与摆放的纯函数层。
 *
 * 数据面 = 上游 `tools/export_tank_tread.py` 产出的包内 `tread/<tank_id>.json`
 * （客户端 `treadParameters` 块：印记条带宽/间距 + 贴图引用）与 `tread/textures/*.webp`
 * （客户端 DDS 无损转码）。可行性与 fail-closed 边界见上游
 * `docs/feasibility-track-marks.md`；本模块只管"沿路径推进戳 + 戳→贴地四边形"两件事。
 *
 * ## 与客户端的关系（2026-10-12 反汇编定案，全面对齐）
 *
 * `wotblitz.exe`（32 位，base 0x400000）里的 TreadSystem 证据链：
 * - 逐帧 `TreadSystem::Process` @0x83ecc0 → 每车 `0x83f820` → 每侧铺放 `0x83d410`；
 * - **每侧固定环 50 槽**：槽位索引运算 `(i + 0x32) % 0x32`（0x83d460）——活戳上界 = 50/侧×车数
 *   ⇒ 印记长度天然有界（约 ring × space 米），环形覆写而不是无限累积；
 * - **锚点/提交语义**：每个槽位的戳 = 「上次落锚点 → 当前触地点」的扫掠四边形；触地点与锚点
 *   距离满阈值（`0x83d4ca-0x83d507` 的距离平方门控）才**就地重新落锚**（锚点 = 当前点，不做
 *   精确倍数插值）——因此重复碾压同一块地面 = 槽位重新落锚 + 刷新出生时刻，**不叠墨**；
 * - **边界抖动退休**：戳长 ∈ [space, space + 步长]，不存在"整数边界"可被重复跨越；
 * - **时间门控/淡出窗**：`now > slot.t + 7.62`、`+5.45`（常数 0x4010f98 / 0x4010f94）——
 *   与着色器 `1 − smoothstep(fadeOutTimeStartEnd)` 的形态一致，取作本实现的淡出窗；
 * - 几何（扫掠剪切 `y→y·z+w`）、透明度（贴图 alpha × 距离淡出 × 时间淡出，无整体压暗）、
 *   每图设置（`mtsc.color`/`treadBlending`）见 upstream feasibility §四 与 WotbTools
 *   `docs/features/battle-playback.md`。
 *
 * 本模块不依赖 three.js：戳是普通对象、四边形是逐角坐标数组，便于单测；
 * 场景侧只做容器与写入（逐车动态合并几何，槽位 = 绝对序号 % ring）。
 */

/** 无 authored 数据车辆的产品回落（上游 feasibility §四：回落本身无客户端依据）：
 * 贴图用客户端通用张 `Tread`（数据面在场），宽度/间距取 311 辆 authored 值的中位量级。 */
export const TREAD_FALLBACK = { width: 0.6, space: 1.0 };
export const GENERIC_TREAD_TEXTURE = '/tread/textures/Tread.webp';

/** 每侧活戳环槽数：客户端反汇编 `(i + 0x32) % 0x32`（0x83d460，0x32 = 50）。
 *  **这是"印记长度预算"**（环里最老槽被新戳覆写 ⇒ 轨迹在车后滚动收尾），不是我们的旧值
 *  1536（那只是显存上限、不约束可见长度）。 */
export const TREAD_RING = 50;

/** 淡出窗（回放秒）：客户端引擎时间常数 5.45 / 7.62（反汇编 0x4010f94 / 0x4010f98，
 *  参与槽位时间门控；与着色器 `fadeOutTimeStartEnd` 的 `1 − smoothstep(start, end, age)`
 *  同源推断）。旧值 10 + 10 s 是**产品自定**（2026-10-11 用户裁示），本次按客户端口径替换。 */
export const TREAD_FADE = { start: 5.45, end: 7.62 };

/** 全局不透明度系数：顶点色 alpha = 淡出系数 × 本值。
 *
 * 客户端着色器口径（deferred-decal-vp.sl 的 FADE_OUT_WITH_TIME 分支）：透明度 = 距离淡出
 * （`treadsNear/FarFadeDistance`）× 时间淡出（`smoothstep(fadeOutTimeStartEnd)`），
 * **没有**额外的整体压暗。但直接把本系数设 1.0 后实测比游戏更黑（用户目视两点校准：
 * 0.55 偏淡 / 1.0 偏黑）⇒ 客户端还有两处未复刻的减淡机制（具体数值在游戏层、未逆向）：
 *   ① 距离淡出（`treadsNear/FarFadeDistance`，随相机距离 smoothstep 淡出）；
 *   ② 贴花调色分支 `#if GLOBAL_TINT: rgb *= globalFlatColor.rgb * 2.0`（同族着色器）。
 * **保留 0.8 是刻意的产品决定**（用户校准值；槽位模型落地后它对"重压变深"的补偿作用已
 * 消失，可随时按客户端口径（1.0）做一次目视 A/B）。 */
export const TREAD_OPACITY = 0.8;

/**
 * 印记年龄（回放秒）→ 不透明度系数 [0,1]：客户端同款 `1 − smoothstep(start, end, age)`
 * ——`start` 前恒 1，`start→end` 平滑降 0，之后 0。
 * 负年龄 = 回放时钟早于该戳出生时刻（seek 到其出生前）：隐藏（0），只容忍 1e-9 浮点抖动。
 */
export function treadAlphaAt(age, fade = TREAD_FADE) {
  if (age < -1e-9) return 0;
  if (!(age > fade.start)) return 1;
  if (age >= fade.end) return 0;
  const x = (age - fade.start) / (fade.end - fade.start);
  return 1 - x * x * (3 - 2 * x);          // 1 − smoothstep(start, end, age)
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

/** 单侧履带的路径累积态（客户端槽位模型）。
 *
 * - `anchor` = 当前活戳的起点横截面（落锚点：位置 + 朝向 + 出生时刻）；
 * - `open` = 当前活戳的**末端横截面**（逐帧拉伸到车辆当前位置；`null` = 尚无活戳）；
 * - `segs` = **固定槽位环形**缓冲（`segs[k % cap]` = 绝对序号 k 的已提交戳，`total` 累计）；
 *   调用方按同一槽位公式写入：已提交戳占 `k % cap`，活戳占独立槽位 `cap`；
 * - `written` = 消费侧书签（已写进 GPU 的绝对戳数）。
 */
export function createTrailState() {
  return { hasLast: false, x: 0, z: 0, yaw: 0, t: 0,
           anchor: { x: 0, z: 0, yaw: 0, t: 0 }, open: null,
           segs: [], head: 0, total: 0, written: 0,
           breakPending: false, lastSegT: -Infinity };
}

/**
 * 断开路径连续性，但**保留已经生成的历史履带印**。
 *
 * 调用方在两类场景都复用这个入口：
 * - AoI/coverage 空洞、pose 大跳：下一可见点应成为新 anchor，历史 decal 继续按寿命淡出；
 * - seek 后退、关断重开、宽度变化：调用方随后会从 START 重喂。`advanceTrail()` 看到
 *   新 anchor 时刻不晚于最后历史戳，会把它识别为真正的全量重建并清历史。
 *
 * 这样避免把“断链”错误实现成“删除历史印记”（#587 review blocker）。
 */
export function resetTrailState(st) {
  st.hasLast = false;
  st.breakPending = true;
  st.open = null;
}

function clearTrailHistory(st) {
  st.segs.length = 0;
  st.head = 0;
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
 * - 提交的戳 `t` = **锚点时刻**（出生 = 落锚，与客户端"槽位时间随重新落锚刷新"一致）；
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
export function advanceTrail(st, pts, space, cap) {
  if (!(space > 1e-3)) return 0;
  let added = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const pyaw = p.yaw || 0;
    const pt = Number.isFinite(p.t) ? p.t : 0;
    if (!st.hasLast) {
      // resetTrailState 同时承担“断链”和“即将全量重建”的入口。真正区别在下一 anchor：
      // AoI/传送恢复一定向前走（pt > lastSegT）⇒ 保留历史；seek/重开从 START 重喂
      // （pt <= lastSegT）⇒ 清历史。容差只吸收网格边界浮点噪声。
      if (st.breakPending && st.total > 0 && pt <= st.lastSegT + 1e-9) clearTrailHistory(st);
      st.breakPending = false;
      st.hasLast = true;
      st.x = p.x; st.z = p.z; st.yaw = pyaw; st.t = pt;
      st.anchor.x = p.x; st.anchor.z = p.z; st.anchor.yaw = pyaw; st.anchor.t = pt;
      st.open = { x1: p.x, z1: p.z, yaw1: pyaw };
      continue;
    }
    const d = Math.hypot(p.x - st.x, p.z - st.z);
    if (!(d > 1e-6)) {
      // 静止样本：里程不推进；但采样时刻与朝向必须推进（停车期间重新起步时，新戳的锚点
      // 时刻才不会是停车前），原地转向时活戳末端横截面跟随朝向。
      st.t = pt;
      st.yaw = pyaw;
      if (st.open && st.open.yaw1 !== pyaw) st.open.yaw1 = pyaw;
      continue;
    }
    st.x = p.x; st.z = p.z; st.yaw = pyaw; st.t = pt;
    if (st.open) { st.open.x1 = p.x; st.open.z1 = p.z; st.open.yaw1 = pyaw; }
    // 落锚门控：当前位置与锚点距离满 space ⇒ 提交活戳、就地重新落锚（客户端 0x83d4ca 同款：
    // 距离平方门控 + 锚点直接设为当前点）。戳长 ∈ [space, space + 步长]，无整数边界可重复跨越
    // ⇒ 旧的 floor+静差防抖机制不再需要。
    // ⚠️ 阈值带 1e-9 容差：采样点是网格线性插值的产物，恰好落在 space 倍数上的点会以
    // 0.9999999999999998 的形态出现（浮点欠冲）——不容差会让落锚被推迟一个采样，戳长在
    // 1.0/1.5 m 间交替、平均间距 1.25 m（实测 12 s 只落 48 戳而非 60）。
    if (Math.hypot(p.x - st.anchor.x, p.z - st.anchor.z) >= space - 1e-9) {
      pushSeg(st, { x0: st.anchor.x, z0: st.anchor.z, yaw0: st.anchor.yaw,
                    x1: p.x, z1: p.z, yaw1: pyaw, t: st.anchor.t }, cap);
      st.anchor.x = p.x; st.anchor.z = p.z; st.anchor.yaw = pyaw; st.anchor.t = pt;
      st.open = { x1: p.x, z1: p.z, yaw1: pyaw };
      added++;
    }
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

/** 活戳是否可画（长度非退化）——场景侧写活戳槽位前判退化用。 */
export function openStampOf(st) {
  if (!st.open) return null;
  if (!(Math.hypot(st.open.x1 - st.anchor.x, st.open.z1 - st.anchor.z) > 1e-6)) return null;
  return { x0: st.anchor.x, z0: st.anchor.z, yaw0: st.anchor.yaw,
           x1: st.open.x1, z1: st.open.z1, yaw1: st.open.yaw1, t: st.anchor.t };
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
export function trailStampCorners(seg, width, heightAt, out) {
  const hw = width / 2;
  // 横截面两端：中心 ± 横向量·半宽。横向量取车队 heading 的水平右向（左右对称无语义）。
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
