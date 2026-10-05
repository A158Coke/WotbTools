// 可破坏地形交互（契约 v2 additive：playback.destructible_areas / destructible_events）。
//
// 上游机制（WoT-Blitz-Agent 逆向总集 §5.4，2026-10-05 闭合）：
// - 事件 envelope = 区域实体（100m 格子锚点），body 末字节 = lka 槽位；
//   **物体 = destructibles.json 的 serverId.(cell, slot) 联表**（cell 由区域锚点
//   floor(x/100), floor(z/100) 得出，贴边事件用 ±1 邻域兜底）。
// - prop：1=fragiles（碎裂换模）、2=柱状物（碎裂换模）、3=树倒（倒伏动画）。
// - fall_dir（body 倒数第二字节）= 8 位角（LSB=1.40625°），**树倒的服务器权威
//   倒向**：实测指向冲量来源（碾压车速方向 + 180°），树向其反向倒下——未点亮
//   碾压者亦携带，客户端复原不依赖车辆姿态流。
//
// 本文件只放纯函数（联表 / 寻址 / 倒向运动学），场景接线在 playbackScene.js。
// 坐标约定：destructibles.json 的 pos 与 scenery.glb 节点位置同为**游戏场景系**
// （x/y 水平、z 上、直接对应回放 x/z——无镜像）。

/** 事件→实例解析结果（寻址失败 = null，调用方静默跳过） */
export function resolveDestructibleEvent(ev, areasByEid, index) {
  const area = areasByEid.get(ev.area_eid)
  if (!area) return null
  const cx = Math.floor(area.x / 100)
  const cy = Math.floor(area.z / 100)
  // 锚点贴格边界兜底：本体格 → ±1 邻域（GB48 实测 1/70 需要邻域）
  for (const dx of [0, -1, 1]) {
    for (const dz of [0, -1, 1]) {
      const hit = index.get(`${cx + dx},${cy + dz},${ev.slot}`)
      if (hit) return hit
    }
  }
  return null
}

/** destructibles.json → (cell,slot) → 实例 索引（重复键保首个，与导出器去重一致） */
export function buildDestructibleIndex(doc) {
  const index = new Map()
  if (!doc || !Array.isArray(doc.instances)) return index
  for (const inst of doc.instances) {
    const srv = inst.serverId
    if (!srv) continue
    const key = `${srv.cell[0]},${srv.cell[1]},${srv.slot}`
    if (!index.has(key)) index.set(key, inst)
  }
  return index
}

/**
 * 倒向 → 树顶运动方向（游戏场景系水平单位向量 [dx, dy]）。
 * fall_dir 指向冲量来源（实测 = 碾压车速方向 + 180°），树向**反向**倒下。
 */
export function fallTipVector(fallDir8) {
  const a = (fallDir8 / 256) * Math.PI * 2
  return [-Math.sin(a), -Math.cos(a)]
}

/**
 * 树倒运动学（客户端模型 = **逐类型物理 / 关节链**；本实现是形状保真的近似）。
 *
 * 客户端证据（`docs/回放与射击逆向总集.md` §5.4 + 二进制/数据复核 2026-10-05）：
 * - 树 = `SpeedTreeObject` 实体，倒伏由 `TreeCutterComponent` / `TreeCutterSystem`
 *   （client `Classes/Battle/Visuals/...`）驱动；树**没有**损毁态替换网格
 *   （GLB 里 D_ 节点与树实例无一同位），砸倒是作用在原节点上的旋转；
 * - `.sc2` 的 `SpeedTreeComponent` 给出每棵树的物理形态：`bushPhysicsMaxJointsCount`
 *   （≤16 个关节）+ 每条 bone 的 `bushJointInfoN{staticPoint,dynamicPoint,flexibility,invLength}`
 *   + `trunkOscillationSpring/Damping` —— 即**弹簧-阻尼关节链**，倒伏是弯曲过程；
 * - `destructibles.xml` `<trees>` 每类型带 `physicParams`（7 数）与 `touchdownEffect`
 *   （**触地**特效，183 类中 9 类有）；冲量按载具质量缩放（`unitVehicleMass = 30000`）。
 * ⇒ 客户端不是"刚性转到固定角度"，而是"被撞 → 关节链弯曲倒下 → **停在地形/障碍上**"，
 *   因此最终角度**取决于树所在位置与倒向**（实测确认：随地形坡度/障碍变化）。
 *
 * 本实现用刚性旋转逼近，并复现其中两个可验证特征：
 * 1) **停止角 = 树干触及地形（或平坦地面）的角度**：沿倒向采样树干轴，取最小的触地角
 *    （上坡/前方有坎 → 停得更早；下坡/平地 → 到 90° 贴地为止）；
 * 2) 角度按**恒定角速度**增长（客户端 `angle += dt` 累积至上限即停），到停止角即硬停。
 * 未建模：树倒在其他树上（邻树接触）、bone 链的弯曲形变（需要资产侧按高度切分网格）。
 */
export const TREE_FALL_MIN_S = 0.45
export const TREE_FALL_MAX_S = 3.0
/** 树高缺省（拿不到几何包围盒时的中型树） */
export const TREE_FALL_DEFAULT_HEIGHT_M = 6
/** 停止角下限（前方地形陡升/紧贴坎时不允许"原地不倒"） */
export const TREE_FALL_MIN_STOP_RAD = (20 * Math.PI) / 180
/** 树干轴向采样点数（触地判定用） */
const GROUND_PROBES = 10

/** 倒伏时长（秒）：T = 1.51·√(L/g)，按 [TREE_FALL_MIN_S, TREE_FALL_MAX_S] 钳位。 */
export function fallDurationS(heightM) {
  const L = Number.isFinite(heightM) && heightM > 0 ? heightM : TREE_FALL_DEFAULT_HEIGHT_M
  const t = 1.51 * Math.sqrt(L / 9.81)
  return Math.min(TREE_FALL_MAX_S, Math.max(TREE_FALL_MIN_S, t))
}

/**
 * 停止角（弧度）：树干绕根部转到**触及地形**为止的角度。
 *
 * @param {number} fallDir8 倒向字节（倒向 = tip 方向的反向，见 fallTipVector）
 * @param {{x:number,y:number,z:number}} base 树根位置（**gltf.scene 局部系**：x/y 水平、z 上）
 * @param {number} heightM 树高（米）
 * @param {((lx:number,ly:number)=>number)|null} sampleGround 局部系 (x,y) → 地面高度（米，
 *        与 base.z 同基准）；缺失（无高度场）→ 平坦地面假设，返回 90°。
 * @param {number} [minStopRad] 停止角下限（默认 TREE_FALL_MIN_STOP_RAD）
 * @returns {number} 停止角 ∈ [minStop, π/2]
 *
 * 判据：θ 从下限起每 1° 扫描，树干轴上的采样点世界高度 = base.z + h·cosθ，
 * 水平位置 = base + tip·h·sinθ；任一采样点落到地面（≤ 地面高度）即认为已停靠。
 */
export function fallStopAngle(fallDir8, base, heightM, sampleGround, minStopRad = TREE_FALL_MIN_STOP_RAD) {
  const flat = Math.PI / 2
  if (typeof sampleGround !== 'function') return flat
  const L = Number.isFinite(heightM) && heightM > 0.5 ? heightM : TREE_FALL_DEFAULT_HEIGHT_M
  const minStop = Math.min(Math.max(minStopRad, 0), flat)
  const [dx, dy] = fallTipVector(fallDir8)
  const step = Math.PI / 180
  for (let th = minStop; th <= flat + 1e-9; th += step) {
    const s = Math.sin(th)
    const c = Math.cos(th)
    for (let i = 1; i <= GROUND_PROBES; i++) {
      const h = (L * i) / GROUND_PROBES
      const gz = sampleGround(base.x + dx * h * s, base.y + dy * h * s)
      if (!Number.isFinite(gz)) continue
      if (base.z + c * h <= gz) return Math.min(th, flat)
    }
  }
  return flat
}

/**
 * 倒向 + 时刻 → 绕根部旋转（游戏场景系，z 上）。
 * 轴 = up × tip 在水平面内旋转 90°（tip=(1,0) → 轴=(0,1,0)，右手法则把 +z 转向 tip）。
 * 角度 = stopRad·u（u = elapsed/时长，**恒定角速度**，到停止角硬停）；
 * 返回 {axis, angle, durationS, stopRad}，elapsed<0 → null（未发生）。
 */
export function fallRotation(fallDir8, elapsedS, heightM, stopRad = Math.PI / 2) {
  if (!(elapsedS >= 0)) return null
  const durationS = fallDurationS(heightM)
  const u = Math.min(1, elapsedS / durationS)
  const stop = Math.min(Math.max(Number.isFinite(stopRad) ? stopRad : Math.PI / 2, 0), Math.PI / 2)
  const [dx, dy] = fallTipVector(fallDir8)
  return { axis: [-dy, dx, 0], angle: stop * u, durationS, stopRad: stop }
}

/**
 * 把事件流折叠成「每物体一个状态项」（同物体多事件取最早——摧毁是单次语义）。
 * 返回按 clock 升序的 [{ key, clock, prop, fallDir, inst }]，供场景逐帧应用。
 */
export function foldDestructibleStates(events, areasByEid, index) {
  const byKey = new Map()
  for (const ev of events || []) {
    const inst = resolveDestructibleEvent(ev, areasByEid, index)
    if (!inst) continue
    const prev = byKey.get(inst.id)
    if (!prev || ev.clock < prev.clock) {
      byKey.set(inst.id, { key: inst.id, clock: ev.clock, prop: ev.prop, fallDir: ev.fall_dir, inst })
    }
  }
  return [...byKey.values()].sort((a, b) => a.clock - b.clock)
}
