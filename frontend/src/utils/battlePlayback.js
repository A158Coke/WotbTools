/**
 * 战局回放（Battle Playback）确定性工具：位置插值、可见性、时间解析与事件聚合。
 * 全部为纯函数，供 BattlePlayback.vue 与单测使用。
 */

/** 相邻可信位置的最大间隔（秒）；超过则断线，禁止穿线插值。 */
export const OBSERVED_GAP_SEC = 5

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

/**
 * t 是否落在任一位置上报区间内。
 * 语义 = 服务器位置流覆盖（type-10 gap 聚类），不代表录像者客户端点亮。
 */
export function positionCoveredAt(intervals, t) {
  if (!intervals) return false
  return intervals.some(iv => t >= iv.startSec - 1e-6 && t <= iv.endSec + 1e-6)
}

/**
 * 车辆 t 时刻剩余血量：
 * - 有可信采样（≤t）→ 最近一次值（含阵亡 0 采样）；
 * - 无可信采样但车辆存活（未阵亡或 t 早于 deathSec）→ 满血回退 maxHp——回放整场覆盖（0s 起）、
 *   propId=3 仅在受击/血量变化时上报（首采样=首次变化），故开局/未受击车辆血量 = maxHp 是确定性事实，
 *   不得把整队显示为 UNKNOWN 灰段；
 * - 无可信采样且已阵亡（t ≥ deathSec）→ null（UNKNOWN：死亡但无采样，不冒充 0/满血）；
 * - 高位/负 sentinel（<0 或 ≥0xFF00，如 0xFFFD/-3、0xFFFF/-1）一律忽略，防 65533/65535 污染。
 * hpSamples 契约：{ timeSec, hp }（battle-relative 秒升序，type-7 propId=3 signed i16 含装备加成）。
 */
export function vehicleHpAt(vehicle, t) {
  if (!vehicle || !Number.isFinite(t)) return null
  const samples = vehicle.hpSamples || []
  let hp = null
  for (const s of samples) {
    if (!Number.isFinite(s.timeSec) || !Number.isFinite(s.hp)) continue
    if (s.hp < 0 || s.hp >= 0xFF00) continue // sentinel 兜底
    if (s.timeSec <= t + 1e-6) hp = s.hp
    else break
  }
  // 满血回退：存活车辆无采样 = 未受击（首采样=首次血量变化）→ maxHp；阵亡无采样保持 UNKNOWN
  if (hp == null) {
    const death = vehicle.deathSec
    if (death == null || t < death - 1e-6) hp = vehicle.maxHp || 0
  }
  return hp
}


/**
 * 队伍总血量（t 时刻）：
 * totalMax = ΣmaxHp（理论容量）、knownRemaining = Σ已知当前剩余 HP、
 * unknownMax = Σ血量 UNKNOWN 的理论容量（灰段）——仅剩「阵亡且无采样」等数据缺失场景，
 * 存活车辆按满血回退（vehicleHpAt：未受击=满血），开局显示满血而非整条灰。
 */
export function teamHp(vehicles, team, t) {
  let totalMax = 0
  let knownRemaining = 0
  let unknownMax = 0
  for (const v of vehicles || []) {
    if (v.team !== team) continue
    const maxHp = v.maxHp || 0
    totalMax += maxHp
    const cur = vehicleHpAt(v, t)
    if (cur == null) unknownMax += maxHp
    else knownRemaining += cur
  }
  return { totalMax, knownRemaining, unknownMax }
}

/**
 * 争霸赛实时点数：t 时刻该队最近一次 ≤t 的广播值（type-8 subtype48 field13，PROVEN）；
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

/** 事件按秒聚合（进度条标记）：[{ sec, count, types }]。 */
export function aggregateEventsBySecond(events) {
  const map = new Map()
  for (const ev of events || []) {
    if (!Number.isFinite(ev.timeSec)) continue
    const sec = Math.round(ev.timeSec)
    const bucket = map.get(sec) || { sec, count: 0, types: new Set() }
    bucket.count++
    bucket.types.add(ev.type)
    map.set(sec, bucket)
  }
  return [...map.values()]
    .sort((a, b) => a.sec - b.sec)
    .map(b => ({ sec: b.sec, count: b.count, types: [...b.types] }))
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

/**
 * 方向插值：在时间升序的 directionSamples 上按最短圆弧分别插值 hull/turret 角。
 * - t 早于首个样本 → null（未采样，不伪造朝向）
 * - 样本间 gap > OBSERVED_GAP_SEC → 不插值，返回最后可信样本（lost 冻结语义）
 * - t 晚于末样本 → 返回末样本（阵亡/战斗末冻结）
 */
export function interpolateDirection(samples, t) {
  if (!samples || samples.length === 0 || !Number.isFinite(t)) return null
  if (t < samples[0].timeSec - 1e-6) return null
  let prev = samples[0]
  for (let i = 1; i < samples.length; i++) {
    const next = samples[i]
    if (t <= next.timeSec + 1e-6) {
      const gap = next.timeSec - prev.timeSec
      if (gap > OBSERVED_GAP_SEC) {
        return { hullYawDeg: prev.hullYawDeg, turretRelativeYawDeg: prev.turretRelativeYawDeg, timeSec: prev.timeSec }
      }
      const ratio = gap <= 0 ? 0 : Math.min(1, Math.max(0, (t - prev.timeSec) / gap))
      return {
        hullYawDeg: normalizeDeg(prev.hullYawDeg + shortestArcDeg(next.hullYawDeg, prev.hullYawDeg) * ratio),
        turretRelativeYawDeg: normalizeDeg(prev.turretRelativeYawDeg + shortestArcDeg(next.turretRelativeYawDeg, prev.turretRelativeYawDeg) * ratio),
        timeSec: t
      }
    }
    prev = next
  }
  return { hullYawDeg: prev.hullYawDeg, turretRelativeYawDeg: prev.turretRelativeYawDeg, timeSec: prev.timeSec }
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

/** 事件是否与录像者相关（随机战默认过滤；位置覆盖事件恒显示）。 */
export function recorderRelated(event, recorderAccountId) {
  if (event.type === 'POSITION_REPORTED' || event.type === 'POSITION_STALE') return true
  if (recorderAccountId == null) return true
  return event.accountId === recorderAccountId || event.targetAccountId === recorderAccountId
}

/** 事件是否涉及某阵营（团队视角默认过滤）。 */
export function teamRelated(event, team, vehiclesByAccount) {
  if (event.type === 'POSITION_REPORTED' || event.type === 'POSITION_STALE') return true
  const a = vehiclesByAccount.get(event.accountId)
  const b = vehiclesByAccount.get(event.targetAccountId)
  return (a && a.team === team) || (b && b.team === team)
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

/** 炮线可见窗口基础时长（游戏时间秒）；实际窗口 = TRACER_BASE_SEC × 播放倍速（1×/2×/4× 各约 1s 真实时间）。 */
export const TRACER_BASE_SEC = 1.0

/** 炮线全亮保持期（真实秒）：激光「先亮后淡」——保持期后平滑淡出到窗口结束（各倍速约 0.4s 真实时间）。 */
export const TRACER_HOLD_REAL_SEC = 0.4

/** 命中闪光窗口（真实秒）：命中端圆点扩散 + 淡出（各倍速约 0.35s 真实时间）。 */
export const TRACER_FLASH_REAL_SEC = 0.35

/** 同一次射击的判同窗口（秒）：同 attacker/target 且时间差 ≤ 该值的 DAMAGE/KILL 只画一条炮线。 */
export const SAME_SHOT_WINDOW_SEC = 0.25

/**
 * 已知射击事件 → 当前可见炮线（纯函数：只依赖 now/speed，seek 与倍速天然正确，无一次性定时器）。
 * 候选 = DAMAGE 与 KILL（攻击者/目标均已解析）；同刻同 attacker/target 去重为一条（优先保留 DAMAGE）；
 * 两端都必须在事件时刻有可信位置（trustedPositionAt）且不是同一辆车/同一坐标才输出。
 * nowSec ∈ [timeSec, timeSec + TRACER_BASE_SEC × speed) 时可见。
 * 激光视觉派生：opacity 为「先亮后淡」（前 TRACER_HOLD_REAL_SEC × speed 秒全亮，
 * 之后线性淡出到窗口结束）；flashProgress 0→1 描述命中端闪光进度（窗口
 * TRACER_FLASH_REAL_SEC × speed 秒，扩散 + 淡出，由组件派生半径/透明度）。
 *
 * @param events         过滤后的 playback 事件（DAMAGE/KILL）
 * @param routesByAccount Map<accountId, { points: [{x,y,timeSec}] }>
 * @param nowSec         当前播放时间（battle-relative 秒）
 * @param speed          播放倍速（1/2/4）
 * @returns [{ x1, y1, x2, y2, opacity, flashProgress, timeSec, attackerAccountId, targetAccountId }]
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
    const a = from ? trustedPositionAt(from.points, t) : null
    const b = to ? trustedPositionAt(to.points, t) : null
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
    lines.push({
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      opacity,
      flashProgress,
      timeSec: t,
      attackerAccountId: ev.accountId,
      targetAccountId: ev.targetAccountId
    })
  }
  return lines
}

/** 地图视图缩放范围。 */
export const VIEW_MIN_SCALE = 1
export const VIEW_MAX_SCALE = 4

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
