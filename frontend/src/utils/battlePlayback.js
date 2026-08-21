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
 * 车辆 t 时刻剩余血量（PR #107：只返回**真实可信采样**，绝不用理论 maxHp 伪造数字）：
 * - 有可信采样（≤t）→ 最近一次值（含阵亡 0 采样）；
 * - 无可信采样 → null（无论本方/敌方/存活/阵亡——「相对满血/未知」由 hpDisplay 状态机表达，
 *   本函数不把 vehicle.maxHp（含 tankopedia base 下界）赋给 current）；
 * - 高位/负 sentinel（<0 或 ≥0xFF00，如 0xFFFD/-3、0xFFFF/-1）一律忽略，防 65533/65535 污染。
 * hpSamples 契约：{ timeSec, hp }（battle-relative 秒升序，type-7 propId=3 signed i16 含装备加成）。
 *
 * @param assumeFullWhenUnobserved 兼容参数（保留签名；一律忽略——旧「满血回退 maxHp」已移除，
 *                                  防止把 tankopedia base 冒充本局当前 HP）。
 */
export function vehicleHpAt(vehicle, t, assumeFullWhenUnobserved = false) {
  if (!vehicle || !Number.isFinite(t)) return null
  const samples = vehicle.hpSamples || []
  let hp = null
  for (const s of samples) {
    if (!Number.isFinite(s.timeSec) || !Number.isFinite(s.hp)) continue
    if (s.hp < 0 || s.hp >= 0xFF00) continue // sentinel 兜底
    if (s.timeSec <= t + 1e-6) hp = s.hp
    else break
  }
  return hp
}


/**
 * 队伍总血量（t 时刻）——PR #107 HP provenance 语义：
 * totalMax = Σ已证明的实际最大 HP（entryHpSource=OBSERVED_EXACT 的 entryHp；无则 0，
 * 绝不含 tankopedia base 冒充实际本局总血量）、knownRemaining = Σ已知当前剩余 HP、
 * unknownMax = Σ血量 UNKNOWN 的理论容量（灰段，Tankopedia baseline 仅作 reference）、
 * spawnFullCount = 处于「开局相对满血」状态的存活己方车辆数（无具体数字，
 * 用于 UI 表达「开局全员满血状态」，不换算成具体总 HP）。
 *
 * <p>敌方/未知路径无采样恒 UNKNOWN；本方路径仅在存活且无战前掉血证据时进入
 * RULE_DERIVED_FULL_AT_SPAWN（fullState），knownRemaining 不增加（不伪造数字）。</p>
 */
export function teamHp(vehicles, team, t, assumeFullWhenUnobserved = false) {
  let totalMax = 0
  let knownRemaining = 0
  let unknownMax = 0
  let spawnFullCount = 0
  for (const v of vehicles || []) {
    if (v.team !== team) continue
    const entryProven = v.entryHpSource === 'OBSERVED_EXACT'
      && Number.isFinite(v.entryHp) && v.entryHp > 0
    const maxHp = entryProven ? v.entryHp : (Number.isFinite(v.maxHp) && v.maxHp > 0 ? v.maxHp : 0)
    if (entryProven) totalMax += v.entryHp
    const cur = vehicleHpAt(v, t, false)
    if (cur != null) {
      knownRemaining += cur
      continue
    }
    // 无采样：assumeFullWhenUnobserved 仅本方路径（兼容旧调用），进入相对满血状态
    const death = v.deathSec
    const alive = death == null || t < death - 1e-6
    if (assumeFullWhenUnobserved && alive) {
      spawnFullCount++
    } else {
      unknownMax += maxHp
    }
  }
  return { totalMax, knownRemaining, unknownMax, spawnFullCount }
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

/** 炮线可见窗口基础时长（真实秒）：实际窗口 = TRACER_BASE_SEC × 播放倍速——1×/2×/4× 各约 0.4s 真实时间
 * （游戏时间窗口 = 0.4 × speed）。短 shot effect：命中后 ≈400ms 完全消失，不再挂在地图上整秒。 */
export const TRACER_BASE_SEC = 0.4

/** 炮线全亮保持期（真实秒）：激光「先亮后淡」——保持 0.15s 后快速线性淡出到窗口结束（≈0.4s 完全消失）。 */
export const TRACER_HOLD_REAL_SEC = 0.15

/** 命中闪光生命周期（真实秒）：0.35s 内完成「扩散 + 峰值→淡出」，短于炮线本体（≈0.35s 完全消失）。 */
export const TRACER_FLASH_REAL_SEC = 0.35

/** 命中闪光到达峰值的时间（真实秒）：前 0.1s 由 0 升至峰值（0.9），之后线性淡出到 0——短促冲击闪光，
 * 不再出现长时间实体圆球/孤立 waypoint 感。 */
export const TRACER_FLASH_PEAK_REAL_SEC = 0.1

/** 同一次射击的判同窗口（秒）：同 attacker/target 且时间差 ≤ 该值的 DAMAGE/KILL 只画一条炮线。 */
export const SAME_SHOT_WINDOW_SEC = 0.25

/**
 * 已知射击事件 → 当前可见炮线（纯函数：只依赖 now/speed，seek 与倍速天然正确，无一次性定时器）。
 * 候选 = DAMAGE 与 KILL（攻击者/目标均已解析）；同刻同 attacker/target 去重为一条（优先保留 DAMAGE）；
 * 两端都必须在事件时刻有可信位置（trustedPositionAt）且不是同一辆车/同一坐标才输出。
 * nowSec ∈ [timeSec, timeSec + TRACER_BASE_SEC × speed) 时可见。
 * 激光视觉派生：opacity 为「先亮后淡」（前 TRACER_HOLD_REAL_SEC × speed 秒全亮，
 * 之后线性淡出到窗口结束）；flashProgress 0→1 描述命中端闪光进度（窗口
 * TRACER_FLASH_REAL_SEC × speed 秒），flashOpacity 为峰值曲线（前
 * TRACER_FLASH_PEAK_REAL_SEC × speed 秒由 0 升至 0.9，之后线性淡出到 0；
 * flashProgress=1 时 opacity=0，组件不再渲染圆点，不残留孤立端点）。
 *
 * @param events         过滤后的 playback 事件（DAMAGE/KILL）
 * @param routesByAccount Map<accountId, { points: [{x,y,timeSec}] }>
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
/**
 * HP 显示时刻的 knowledge projection（review Blocker 3 / docs/current-plan.md §7.3/§10.1）：
 * 敌方在位置流未覆盖（last-known）期间，HP 冻结在「进入 last-known 前最后一个允许知道的值」——
 * 即最后一个在 t 之前（含）结束的覆盖区间端点时刻的采样（区间端点 = 失察前最后可信时刻）；
 * 恢复覆盖后直接用 t（届时最新可信 HP，不补播 hidden interval 的历史伤害动画）。
 * 本方恒返回 t（authoritative HP 正常更新，不被敌方冻结规则误伤）；无 positionIntervals 数据的
 * 车辆不建模覆盖（保持旧语义，直接使用 t）。
 */
function hpKnowledgeTime(vehicle, t, friendly) {
  if (friendly) return t
  const intervals = vehicle && vehicle.positionIntervals
  if (!Array.isArray(intervals) || intervals.length === 0) return t
  if (positionCoveredAt(intervals, t)) return t
  let lastEnd = null
  for (const iv of intervals) {
    if (!iv || !Number.isFinite(iv.startSec) || !Number.isFinite(iv.endSec)) continue
    if (iv.endSec <= t + 1e-6 && (lastEnd == null || iv.endSec > lastEnd)) lastEnd = iv.endSec
  }
  return lastEnd // null = 从未覆盖：无 last-known 可冻结 → UNKNOWN
}

/**
 * 单车 HP HUD 显示语义（docs/current-plan.md §4/§5/§6/§7 + PR #107 HP provenance）：
 *
 * <p>状态机（state 字段，替代把多种语义压进一个布尔/黑条）：</p>
 * <ul>
 *   <li>DESTROYED：已阵亡（t ≥ deathSec）→ current=0（权威事实，即使无 0 采样）；</li>
 *   <li>OBSERVED_EXACT：存活 + 最近可信采样 + 进场满血已证明（entryHpSource=OBSERVED_EXACT）
 *       → current=采样值、maxHp=entryHp、pct 准确；</li>
 *   <li>CURRENT_HP_EXACT_MAX_UNKNOWN：存活 + 有可信当前 HP 采样，但实际进场 max HP 未证明
 *       → current=真实采样、maxHp=null、pct=null（不按 tankopedia base 伪造百分比），
 *       前端渲染阵营色 indeterminate/斜纹（最大值未知），不显示黑色空条；</li>
 *   <li>RULE_DERIVED_FULL_AT_SPAWN：**仅本方**存活、当前时间早于首个可信 HP 采样、
 *       无 destroyed 证据、无战前掉血证据 → 表达「开局满血相对状态」：
 *       current=null（不伪造具体数字）、fullState=true（前端渲染完整阵营色条）、
 *       maxHp=null（绝不用 tankopedia base 冒充本局最大 HP）；
 *       数字显示 —，tooltip 明确「开局满血，具体 HP 尚未从回放确认」；</li>
 *   <li>BASELINE_ONLY：tankopedia base 仅作静态参考下界（不进入 current/maxHp 数字）——
 *       本函数不产出此状态，由调用方/DTO 标注 provenance；</li>
 *   <li>UNKNOWN：当前值与相对状态均无可靠依据（敌方从未有允许知道的采样等）
 *       → current=null、fullState=false（保持灰色/未知样式）。</li>
 * </ul>
 *
 * <p>约束：</p>
 * - 敌方禁止 RULE_DERIVED_FULL_AT_SPAWN（不因改善己方 UX 泄漏敌方开局状态）；
 * - 首个可用 sample 若已是受击后 HP，只解释为该时刻 current，绝不反推为 entry/max；
 * - 敌方 last-known 期间 HP 经 hpKnowledgeTime 冻结（hidden interval 采样不得提前泄漏）；
 * - 已阵亡显示 0/阵亡状态；seek 确定性重建，不把未来 sample 泄漏到过去；
 * - 不把 vehicle.maxHp（含 tankopedia fallback）赋给 current 实现满血。
 *
 * @returns {{ current:number|null, maxHp:number|null, pct:number|null, destroyed:boolean,
 *             state:string, fullState:boolean }|null}
 */
export function hpDisplay(vehicle, t, { friendly = false } = {}) {
  if (!vehicle || !Number.isFinite(t)) return null
  const destroyed = vehicle.deathSec != null && t >= vehicle.deathSec - 1e-6
  if (destroyed) {
    return { current: 0, maxHp: null, pct: 0, destroyed: true, state: 'DESTROYED', fullState: false }
  }
  const knownT = hpKnowledgeTime(vehicle, t, friendly)
  const current = vehicleHpAt(vehicle, knownT, false)
  if (current != null) {
    // 有真实采样：
    // - OBSERVED_EXACT（进场满血已证明）→ current + 精确 maxHp/entryHp + pct；
    // - 否则 CURRENT_HP_EXACT_MAX_UNKNOWN → 真实 current；maxHp 用观测最大容量
    //   （observedMaxHp = 回放实测最大，tankopedia base 仅作下界兜底；标注为观测分母、
    //   非进场满血证明——绝不把 base 冒充本局实际 max），pct 是相对该观测容量的值；
    //   前端对该状态渲染阵营色 indeterminate 提示「当前 HP 已观测，进场最大 HP 未知」。
    const entryProven = vehicle.entryHpSource === 'OBSERVED_EXACT'
      && Number.isFinite(vehicle.entryHp) && vehicle.entryHp > 0
    if (entryProven) {
      return {
        current, maxHp: vehicle.entryHp, pct: Math.max(0, Math.min(100, (current / vehicle.entryHp) * 100)),
        destroyed: false, state: 'OBSERVED_EXACT', fullState: false,
      }
    }
    const maxHp = Number.isFinite(vehicle.maxHp) && vehicle.maxHp > 0 ? vehicle.maxHp : null
    const pct = maxHp != null ? Math.max(0, Math.min(100, (current / maxHp) * 100)) : null
    return {
      current, maxHp, pct, destroyed: false,
      state: 'CURRENT_HP_EXACT_MAX_UNKNOWN', fullState: false,
    }
  }
  // 无采样：已证明的进场满血（OBSERVED_EXACT，精确值，含装备加成）→ 直接作为 current
  if (vehicle.entryHpSource === 'OBSERVED_EXACT'
      && Number.isFinite(vehicle.entryHp) && vehicle.entryHp > 0) {
    return {
      current: vehicle.entryHp, maxHp: vehicle.entryHp, pct: 100,
      destroyed: false, state: 'OBSERVED_EXACT', fullState: false,
    }
  }
  // 无采样且未证明：仅本方存活且无战前掉血证据 → 相对满血状态（100% 阵营色条，
  // 不伪造具体数字；tankopedia base 永不冒充本局 max/current）
  if (friendly) {
    const hasPreBattleDamage = Array.isArray(vehicle.hpLosses)
      && vehicle.hpLosses.some(l => Number.isFinite(l.toSec) && l.toSec <= t + 1e-6)
    if (!hasPreBattleDamage) {
      return {
        current: null, maxHp: null, pct: null, destroyed: false,
        state: 'RULE_DERIVED_FULL_AT_SPAWN', fullState: true,
      }
    }
  }
  return { current: null, maxHp: null, pct: null, destroyed: false, state: 'UNKNOWN', fullState: false }
}

/**
 * 某账号 t 时刻的累计战斗统计（确定性重建，docs/current-plan.md §16/§17）：
 * - dealt = Σ 可 attribution 的权威 HP loss（该账号为攻击者，来自车辆 hpLosses）；
 * - received = Σ 该车辆全部权威 HP loss（受害者侧，HP 采样推导，含无法 attribution 的掉血）；
 * - kills = Σ KILL（该账号为攻击者；KILL 只在击杀者身份可解析时产生）。
 * 语义：只反映回放可可靠重建的掉血事实（Type-7 propId=3 推导），
 * 与整场结算（finalStats）允许存在差异——本函数只用于「当前时间点」重建，不冒充最终战绩。
 * raw Type-8 协议值（rawProtocolValue）语义未证明，不得参与统计。
 * @param vehicles 全部 playback 车辆（dealt 需要其它车辆的 hpLosses attribution，
 *                 received 用本车 hpLosses；两者都只消费 toSec ≤ t 的记录）
 */
export function cumulativeStatsAt(events, accountId, t, vehicles = []) {
  let dealt = 0
  let received = 0
  let kills = 0
  for (const ev of events || []) {
    if (!ev || !Number.isFinite(ev.timeSec) || ev.timeSec > t + 1e-6) continue
    if (ev.type === 'KILL' && ev.accountId === accountId) kills += 1
  }
  for (const v of vehicles || []) {
    for (const l of v.hpLosses || []) {
      if (!l || !Number.isFinite(l.toSec) || l.toSec > t + 1e-6) continue
      if (v.accountId === accountId) received += l.hpLoss
      if (l.attackerReliable && l.attackerAccountId === accountId) dealt += l.hpLoss
    }
  }
  return { dealt, received, kills }
}

/**
 * 最近伤害记录（docs/current-plan.md §19「最近伤害记录」）：全部车辆的权威 HP loss，
 * 只消费 toSec ≤ t 的记录（backward seek 后未来伤害记录不泄漏）。
 * - in：该车为受害者（attacker 不可证明时 label 走「来源未知」）；
 * - out：该车为攻击者（仅 attackerReliable 可归属时产生）。
 * 按时间升序返回最近 maxRows 条。
 */
export function damageLogAt(vehicles, selectedAccountId, t, maxRows = 8) {
  const rows = []
  for (const v of vehicles || []) {
    for (const l of v.hpLosses || []) {
      if (!l || !Number.isFinite(l.toSec) || l.toSec > t + 1e-6) continue
      if (v.accountId === selectedAccountId) {
        rows.push({
          timeSec: l.toSec,
          dir: 'in',
          hpLoss: l.hpLoss,
          attackerAccountId: l.attackerAccountId,
          attackerReliable: l.attackerReliable,
        })
      } else if (l.attackerReliable && l.attackerAccountId === selectedAccountId) {
        rows.push({ timeSec: l.toSec, dir: 'out', hpLoss: l.hpLoss, victimAccountId: v.accountId })
      }
    }
  }
  rows.sort((a, b) => a.timeSec - b.timeSec)
  const limit = Number.isFinite(maxRows) && maxRows > 0 ? Math.floor(maxRows) : 8
  return rows.slice(-limit)
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

/** 伤害反馈是否允许（§7.2/§10.1）：受害者在事件时刻位置流覆盖（当前可见/可展示）；
 * 失察期间受击 → 不跳伤害、不更新 HP、不显示 attacker（HP 冻结为最后可信值）。 */
export function victimFeedbackAllowed(vehicle, eventTimeSec) {
  if (!vehicle || !Number.isFinite(eventTimeSec)) return false
  return positionCoveredAt(vehicle.positionIntervals, eventTimeSec)
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
/** kill feed 生命周期（真实 ms；计划 §16.2：约 4–6s）。 */
export const KILL_FEED_MS = 5000
/** kill feed 同时最多条数（§16.2：最多 3 条，队列，新进挤最旧）。 */
export const KILL_FEED_MAX = 3

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

/** kill feed 入队：尾部追加，超限从最旧挤出（不合并多条 KILL，§16.2）。 */
export function pushFeed(items, entry, max = KILL_FEED_MAX) {
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : 0
  if (limit <= 0) return []
  return [...items, entry].slice(-limit)
}

/** 事件时刻受害者的 ghost 参数：{ prevPct, nextPct }（均 null 时无 ghost，§11）。 */
export function ghostAround(vehicle, t, { friendly = false } = {}) {
  const prev = hpDisplay(vehicle, t - 0.001, { friendly })
  const next = hpDisplay(vehicle, t, { friendly })
  const has = (p) => p != null && p.pct != null
  if (!has(prev) || !has(next) || !(prev.pct > next.pct + 1e-9)) return null
  return { prevPct: prev.pct, nextPct: next.pct }
}