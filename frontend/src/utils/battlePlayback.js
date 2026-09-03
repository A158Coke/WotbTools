/** Battle Playback presentation math, event aggregation and view utilities. */

import { positionAtV2, positionCoveredAtV2 } from './battlePlaybackV2.js'

/** 相邻可信位置的最大间隔（秒）；超过则断线，禁止穿线插值。 */
const OBSERVED_GAP_SEC = 5

/**
 * 某时刻车辆位置：
 * - t 早于首点 → null（尚未观测，不显示）
 * - 落在相邻可信点之间且 gap ≤ 5s → 线性插值
 * - gap > 5s（跨越断线/失察）→ null，不穿线
 * - 晚于末点 → 返回最后已知位置（供失察淡化/阵亡标记）
 */
export function positionAt(points, t) {
  if (!points || points.length === 0 || !Number.isFinite(t)) return null
  if (t < points[0].timeSec - 1e-6) return null
  // t 恰为采样点（含 gap 后重新上报的首点）：直接返回该点本身；
  // gap > OBSERVED_GAP_SEC 的断线判定只用于「两点之间」的插值，不适用于落在采样点上的时刻。
  if (t <= points[0].timeSec + 1e-6) {
    return { x: points[0].x, y: points[0].y, timeSec: points[0].timeSec }
  }
  let prev = points[0]
  for (let i = 1; i < points.length; i++) {
    const next = points[i]
    if (t <= next.timeSec + 1e-6) {
      if (t >= next.timeSec - 1e-6) {
        return { x: next.x, y: next.y, timeSec: next.timeSec }
      }
      const gap = next.timeSec - prev.timeSec
      if (gap > OBSERVED_GAP_SEC) return null
      const ratio = gap <= 0 ? 0 : Math.min(1, Math.max(0, (t - prev.timeSec) / gap))
      return {
        x: prev.x + (next.x - prev.x) * ratio,
        y: prev.y + (next.y - prev.y) * ratio,
        timeSec: t
      }
    }
    prev = next
  }
  return { x: prev.x, y: prev.y, timeSec: prev.timeSec }
}

/** 争霸赛实时点数：t 时刻该队最近一次 ≤t 的广播值（type-8 subtype48 field13，PROVEN）；
 * 无 → null（非争霸赛/该队暂无广播时不显示，绝不用结算值冒充实时比分）。
 */
export function teamPointsAt(samples, team, t) {
  if (!Array.isArray(samples) || !Number.isFinite(t)) return null
  let points = null
  for (const s of samples) {
    if (!s || s.team !== team || !Number.isFinite(s.timeSec) || !Number.isFinite(s.points)) continue
    if (s.timeSec <= t + 1e-6) points = s.points
    else break
  }
  return points
}

/**
 * 识别 AI 报告中的明确时间文本 → 秒；不支持裸数字（防止 854:275 等误识别）。
 * 支持：03:20 / 3分20秒 / 3m 20s / 3 мин 20 с。
 */
export function parseAiTime(text) {
  if (text == null) return null
  const s = String(text).trim()
  let m
  if ((m = s.match(/^(\d{1,2}):([0-5]\d)$/))) {
    return (+m[1]) * 60 + (+m[2])
  }
  if ((m = s.match(/^(\d{1,2})分(\d{1,2})秒$/))) {
    return (+m[1]) * 60 + (+m[2])
  }
  if ((m = s.match(/^(\d{1,2})m\s*(\d{1,2})s$/i))) {
    return (+m[1]) * 60 + (+m[2])
  }
  if ((m = s.match(/^(\d{1,2})\s*мин\.?\s*(\d{1,2})\s*с\.?$/i))) {
    return (+m[1]) * 60 + (+m[2])
  }
  return null
}

/** 角度归一化到 [-180, 180)。 */
export function normalizeDeg(a) {
  return (((a + 180) % 360) + 360) % 360 - 180
}

/** 最短圆弧差（度，[-180,180]）：359° → 1° 的正确跨 0 处理。 */
export function shortestArcDeg(a, b) {
  return normalizeDeg(a - b)
}

/**
 * 地图 yaw → 屏幕旋转角（CSS/SVG rotate，正值=屏幕顺时针）。
 * 地图约定：yaw 从北(+Z)起顺时针为正；屏幕：+Y 向下。两次翻转（Z→−Y 镜像与 y-down 顺时针）抵消，
 * 故 screenRotate = yawDeg（0=朝上、90=朝右/东、180=朝下、270=朝左），四个基准方向已用公式验证。
 */
export function screenRotation(yawDeg) {
  return normalizeDeg(yawDeg)
}

/** 炮塔世界方向 = normalize(hullYaw + turretRelativeYaw)（单位：度）。 */
export function turretWorldYawDeg(hullYawDeg, turretRelativeYawDeg) {
  return normalizeDeg(hullYawDeg + turretRelativeYawDeg)
}

/** 秒 → MM:SS（播放器/进度条显示）。先对总秒数统一取整再分解，避免 59.6s 显示成 00:60。 */
export function formatClock(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '00:00'
  const total = Math.round(sec)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * 最后可信位置：t 之前（含）最近一个有限坐标的点；
 * t 早于首点返回 null（从未可信，不显示）。
 * 用于 gap/失察/阵亡时淡化停驻，不参与插值。
 */
export function lastKnownPosition(points, t) {
  if (!points || points.length === 0 || !Number.isFinite(t)) return null
  let best = null
  for (const p of points) {
    if (!Number.isFinite(p.timeSec) || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
    if (p.timeSec > t + 1e-6) break
    best = { x: p.x, y: p.y, timeSec: p.timeSec }
  }
  return best
}

/**
 * 事件时刻严格可信位置：仅当 t 落在该车路线首末点之间、所在相邻点 gap ≤ OBSERVED_GAP_SEC
 * （即 positionAt 返回插值/采样点本身，timeSec === t）且坐标为有限值时返回。
 * 末点之后的最后已知位置、gap 内、首点之前与非有限坐标一律 null——
 * 炮线端点禁止用最后已知位置伪造射击位置。
 */
export function trustedPositionAt(points, t) {
  const p = positionAt(points, t)
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null
  if (Math.abs(p.timeSec - t) > 1e-6) return null
  return p
}

/** Canonical V2 route position at a shot time; point routes remain legacy-test compatible. */
function trustedRoutePosition(route, t) {
  if (Array.isArray(route?.positionSegments)) {
    if (!positionCoveredAtV2(route.positionSegments, t)) return null
    const p = positionAtV2(route.positionSegments, t)
    return p && Number.isFinite(p.x) && Number.isFinite(p.y)
      && Math.abs(p.timeSec - t) <= 1e-6 ? p : null
  }
  return trustedPositionAt(route?.points, t)
}

/**
 * Build the last battle-relative two seconds of observed positions for each vehicle.
 * Segments are never joined, future samples are ignored, and LAST_KNOWN/unknown
 * intervals do not extend the visible trail.
 */
export function recentPositionTrails(vehicles, nowSec, windowSec = 2) {
  if (!Array.isArray(vehicles) || !Number.isFinite(nowSec)) return []
  const span = Number.isFinite(windowSec) && windowSec > 0 ? windowSec : 2
  const start = nowSec - span
  const trails = []
  for (const vehicle of vehicles) {
    for (const segment of vehicle?.positionSegments || []) {
      if (segment?.knowledge !== 'OBSERVED' || !Array.isArray(segment.samples)) continue
      const samples = segment.samples
        .filter(sample => sample && Number.isFinite(sample.timeSec)
          && Number.isFinite(sample.x) && Number.isFinite(sample.y)
          && sample.timeSec >= start - 1e-6 && sample.timeSec <= nowSec + 1e-6)
        .sort((a, b) => a.timeSec - b.timeSec)
      for (let index = 1; index < samples.length; index += 1) {
        const from = samples[index - 1]
        const to = samples[index]
        if (to.timeSec - from.timeSec > OBSERVED_GAP_SEC) continue
        const age = Math.max(0, nowSec - to.timeSec)
        trails.push({
          accountId: vehicle.accountId,
          friendly: vehicle.friendly,
          from,
          to,
          opacity: 0.12 + 0.58 * Math.max(0, 1 - age / span),
        })
      }
      if (samples.length === 1) {
        const point = samples[0]
        trails.push({
          accountId: vehicle.accountId,
          friendly: vehicle.friendly,
          point,
          opacity: 0.2 + 0.5 * Math.max(0, 1 - Math.max(0, nowSec - point.timeSec) / span),
        })
      }
    }
  }
  return trails
}

/** 炮线可见窗口基础时长（真实秒）：实际窗口 = TRACER_BASE_SEC × 播放倍速——1×/2×/4× 各约 0.4s 真实时间
 * （游戏时间窗口 = 0.4 × speed）。短 shot effect：命中后 ≈400ms 完全消失，不再挂在地图上整秒。 */
const TRACER_BASE_SEC = 0.4

/** 炮线全亮保持期（真实秒）：激光「先亮后淡」——保持 0.15s 后快速线性淡出到窗口结束（≈0.4s 完全消失）。 */
const TRACER_HOLD_REAL_SEC = 0.15

/** 命中闪光生命周期（真实秒）：0.35s 内完成「扩散 + 峰值→淡出」，短于炮线本体（≈0.35s 完全消失）。 */
const TRACER_FLASH_REAL_SEC = 0.35

/** 命中闪光到达峰值的时间（真实秒）：前 0.1s 由 0 升至峰值（0.9），之后线性淡出到 0——短促冲击闪光，
 * 不再出现长时间实体圆球/孤立 waypoint 感。 */
const TRACER_FLASH_PEAK_REAL_SEC = 0.1

/** 同一次射击的判同窗口（秒）：同 attacker/target 且时间差 ≤ 该值的 DAMAGE/KILL 只画一条炮线。 */
const SAME_SHOT_WINDOW_SEC = 0.25

/**
 * 已知射击事件 → 当前可见炮线（纯函数：只依赖 now/speed，seek 与倍速天然正确，无一次性定时器）。
 * 候选 = DAMAGE 与 KILL（攻击者/目标均已解析）；同刻同 attacker/target 去重为一条（优先保留 DAMAGE）；
 * 两端都必须在事件时刻有可信位置（V2 使用 canonical positionSegments）且不是同一辆车/同一坐标才输出。
 * nowSec ∈ [timeSec, timeSec + TRACER_BASE_SEC × speed) 时可见。
 * 激光视觉派生：opacity 为「先亮后淡」（前 TRACER_HOLD_REAL_SEC × speed 秒全亮，
 * 之后线性淡出到窗口结束）；flashProgress 0→1 描述命中端闪光进度（窗口
 * TRACER_FLASH_REAL_SEC × speed 秒），flashOpacity 为峰值曲线（前
 * TRACER_FLASH_PEAK_REAL_SEC × speed 秒由 0 升至 0.9，之后线性淡出到 0；
 * flashProgress=1 时 opacity=0，组件不再渲染圆点，不残留孤立端点）。
 *
 * @param events         过滤后的 playback 事件（DAMAGE/KILL）
 * @param routesByAccount Map<accountId, VehiclePlaybackTrack | { points: [{x,y,timeSec}] }>
 * @param nowSec         当前播放时间（battle-relative 秒）
 * @param speed          播放倍速（1/2/4）
 * @returns [{ x1, y1, x2, y2, opacity, flashProgress, flashOpacity, timeSec, attackerAccountId, targetAccountId }]
 */
export function tracerLines(events, routesByAccount, nowSec, speed) {
  if (!Array.isArray(events) || !routesByAccount || !Number.isFinite(nowSec)) return []
  const rate = Number.isFinite(speed) && speed > 0 ? speed : 1
  const windowSec = TRACER_BASE_SEC * rate
  // 按 (attacker,target) 分组，组内按实际时间差去重（时间差 ≤ SAME_SHOT_WINDOW_SEC 视为同一炮，
  // 优先保留 DAMAGE）——不用固定时间桶，避免桶边界把相差 2ms 的两次事件拆成两条线
  const byPair = new Map()
  for (const ev of events) {
    if (!ev || (ev.type !== 'DAMAGE' && ev.type !== 'KILL')) continue
    if (ev.accountId == null || ev.targetAccountId == null || ev.accountId === ev.targetAccountId) continue
    if (!Number.isFinite(ev.timeSec)) continue
    const key = `${ev.accountId}|${ev.targetAccountId}`
    const list = byPair.get(key)
    if (list) list.push(ev)
    else byPair.set(key, [ev])
  }
  const shots = []
  for (const pair of byPair.values()) {
    pair.sort((a, b) => a.timeSec - b.timeSec)
    let kept = null
    for (const ev of pair) {
      if (!kept) {
        kept = ev
        continue
      }
      if (ev.timeSec - kept.timeSec <= SAME_SHOT_WINDOW_SEC + 1e-9) {
        if (kept.type === 'KILL' && ev.type === 'DAMAGE') kept = ev
        continue
      }
      shots.push(kept)
      kept = ev
    }
    if (kept) shots.push(kept)
  }
  const lines = []
  for (const ev of shots) {
    const t = ev.timeSec
    if (nowSec < t - 1e-6 || nowSec >= t + windowSec - 1e-9) continue
    const from = routesByAccount.get(ev.accountId)
    const to = routesByAccount.get(ev.targetAccountId)
    const a = from ? trustedRoutePosition(from, t) : null
    const b = to ? trustedRoutePosition(to, t) : null
    if (!a || !b) continue
    if (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9) continue
    const elapsed = nowSec - t
    const holdSec = TRACER_HOLD_REAL_SEC * rate
    const fadeSpan = windowSec - holdSec
    // 先亮后淡：保持期内全亮，之后线性淡出到窗口结束；窗口 ≤ 保持期时回退线性淡出
    const opacity = fadeSpan > 1e-9
      ? Math.max(0, Math.min(1, 1 - (elapsed - holdSec) / fadeSpan))
      : Math.max(0, Math.min(1, 1 - elapsed / windowSec))
    const flashSec = TRACER_FLASH_REAL_SEC * rate
    const flashProgress = flashSec > 1e-9
      ? Math.max(0, Math.min(1, elapsed / flashSec))
      : 1
    // 命中闪光亮度峰值曲线：前 TRACER_FLASH_PEAK_REAL_SEC 真实秒由 0 升至 0.9，之后线性淡出到 0——
    // 短促冲击闪光（0ms 不可见 → ~100ms 峰值 → ~350ms 归零），不残留实体圆点
    const flashPeak = TRACER_FLASH_PEAK_REAL_SEC / TRACER_FLASH_REAL_SEC
    const flashOpacity = flashPeak > 1e-9 && flashPeak < 1 - 1e-9
      ? (flashProgress < flashPeak
          ? (flashProgress / flashPeak) * 0.9
          : ((1 - flashProgress) / (1 - flashPeak)) * 0.9)
      : (1 - flashProgress) * 0.9
    lines.push({
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      opacity,
      flashProgress,
      flashOpacity,
      timeSec: t,
      attackerAccountId: ev.accountId,
      targetAccountId: ev.targetAccountId
    })
  }
  return lines
}

/** 地图视图缩放范围。 */
const VIEW_MIN_SCALE = 1
const VIEW_MAX_SCALE = 4

/**
 * 以屏幕锚点 (px, py)（相对地图容器左上的**屏幕坐标**，即 clientX/Y − getBoundingClientRect().left/top，
 * 未经任何变换）缩放视图：
 * s' = clamp(s × factor, min, max)；t' = p − (p − t)·(s'/s)。
 * 契约：该公式保证锚点屏幕位置下的地图内容点在缩放前后不变
 * （(px − tx)/scale 与 (py − ty)/scale 保持不变），translate 单位为屏幕像素。
 * 调用方（wheel/pinch）必须传入屏幕坐标，不得混入内容坐标。
 */
export function zoomViewAt(view, px, py, factor, minScale = VIEW_MIN_SCALE, maxScale = VIEW_MAX_SCALE) {
  if (!view || !Number.isFinite(view.scale) || !Number.isFinite(factor) || factor <= 0) return view
  const next = Math.min(maxScale, Math.max(minScale, view.scale * factor))
  const ratio = next / view.scale
  return {
    scale: next,
    tx: px - (px - view.tx) * ratio,
    ty: py - (py - view.ty) * ratio
  }
}

/**
 * 平移钳制：保证地图内容不会完全滑出视口（viewW/viewH 为视口 CSS 尺寸）。
 * scale≤1 时复位；尺寸未知（≤0，如无布局的测试环境）时不做钳制。
 */
export function clampViewPan(view, viewW, viewH) {
  if (!view || !Number.isFinite(view.scale)) return view
  if (view.scale <= 1) return { scale: view.scale, tx: 0, ty: 0 }
  const s = view.scale
  const noW = !Number.isFinite(viewW) || viewW <= 0
  const noH = !Number.isFinite(viewH) || viewH <= 0
  if (noW && noH) return { scale: s, tx: view.tx, ty: view.ty }
  const txMin = noW ? -Infinity : viewW * (1 - s)
  const tyMin = noH ? -Infinity : viewH * (1 - s)
  return {
    scale: s,
    tx: noW ? view.tx : Math.min(0, Math.max(txMin, view.tx)),
    ty: noH ? view.ty : Math.min(0, Math.max(tyMin, view.ty))
  }
}
/**
 * 播放时钟从 fromSec 前进到 toSec 时跨过的（新消费）事件：严格 > from（事件恰在
 * cursor 上不重复触发——pause/resume 与 seek 到事件时刻都不补播），≤ to。
 * 返回事件引用数组（保持原顺序）。
 */
export function eventsCrossed(events, fromSec, toSec) {
  if (!Array.isArray(events) || !Number.isFinite(fromSec) || !Number.isFinite(toSec)) return []
  return events.filter(ev =>
    Number.isFinite(ev && ev.timeSec) && ev.timeSec > fromSec + 1e-9 && ev.timeSec <= toSec + 1e-9)
}

// ---- transient feedback（wall-clock 生命周期，任意倍速保持相近可读时长）----
/** 浮伤害数字寿命（真实 ms）。 */
export const FLOAT_DMG_MS = 1000
/** lost-HP ghost bar 消退（真实 ms）。 */
export const GHOST_MS = 600
/** HP bar 受击 flash（真实 ms）。 */
export const FLASH_MS = 280
/** 击毁 burst（真实 ms）。 */
export const BURST_MS = 700
/** kill feed 生命周期（真实 ms约 4–6s）。 */
export const KILL_FEED_MS = 5000
/** kill feed 最多保留 3 条；新条目加入时淘汰最旧条目。 */
const KILL_FEED_MAX = 3

/**
 * 过滤仍未过期的 transient 项：item 需携带 bornRealMs（performance.now 基准）与 durationMs。
 * 纯函数：由外层 wall-clock 驱动（播放帧 / 暂停时轻量时钟），seek 清空由调用方负责。
 */
export function transientsActive(items, nowRealMs) {
  if (!Array.isArray(items) || !Number.isFinite(nowRealMs)) return []
  return items.filter(i =>
    i && Number.isFinite(i.bornRealMs) && Number.isFinite(i.durationMs)
      && nowRealMs - i.bornRealMs < i.durationMs)
}

/** kill feed 入队：尾部追加，超限从最旧挤出（不合并多条 KILL）。 */
export function pushFeed(items, entry, max = KILL_FEED_MAX) {
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : 0
  if (limit <= 0) return []
  return [...items, entry].slice(-limit)
}
