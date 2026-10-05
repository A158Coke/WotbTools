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

/** 树倒动画时长（秒）：与客户端倒伏节奏同量级；超过后保持终态 */
export const TREE_FALL_DURATION_S = 1.1

/**
 * 倒向 → 绕根部旋转（游戏场景系，z 上）。
 * 轴 = up × tip 在水平面内旋转 90°（tip=(1,0) → 轴=(0,1,0)，右手法则把 +z 转向 tip）。
 * 角度按平滑步进（smoothstep）加速倒下；返回 {axis, angle}，elapsed<0 → null（未发生）。
 */
export function fallRotation(fallDir8, elapsedS, durationS = TREE_FALL_DURATION_S) {
  if (!(elapsedS >= 0)) return null
  const p = Math.min(1, Math.max(0, elapsedS / durationS))
  const [dx, dy] = fallTipVector(fallDir8)
  return { axis: [-dy, dx, 0], angle: (Math.PI / 2) * p * p * (3 - 2 * p) }
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
