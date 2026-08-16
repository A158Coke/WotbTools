/**
 * PR4（§26–§35）——Battle Playback 标签布局与碰撞纯函数。
 *
 * 坐标系：全部为**屏幕像素**（相对地图容器，y 向下）。调用方把 marker 的地图坐标
 * 换算成屏幕坐标后传入；标签盒尺寸为屏幕恒定（不随地图 zoom 缩放）。
 *
 * 契约：
 * - TankName 永远完整（§31），与 TankName 冲突只做轻量垂直位移（§34，上限约一行）；
 * - PlayerName 与任何 TankName 冲突 → 隐藏候选（§32），由 resolvePlayerVisibility
 *   施加时间稳定阈值（§33，hide/show 都有阈值，用时间不用帧数）；
 * - 只检测 viewport 内 marker（§35），越界裁剪。
 */

/** 单行盒高（screen px，与 VehicleMarker .pb-labels CSS 保持同一事实源）。 */
export const LABEL_LINE_H = Object.freeze({ tank: 12, player: 11 })
/** label 块上下 padding 合计（.pb-labels padding 1px×2）。 */
export const LABEL_PAD_Y = 2
/** 标签底边 ↔ 车顶 screen gap。 */
export const LABEL_GAP_PX = 2
/** §34 TankName 最大垂直位移（约一行文本高度）。 */
export const TANK_SHIFT_MAX_PX = 14
/* 宽度钳制常量（内部实现；视觉截断由 CSS max-width 承担）：
   - PlayerName 截断 110px（§30，> TankName 常规目标宽度；CSS .pb-label-player max-width 同值）
   - TankName 碰撞估算上限 150px（§31：不作用于视觉，背景仍自然变宽） */
const PLAYER_MAX_WIDTH_PX = 110
const TANK_MAX_WIDTH_PX = 150
/** 平均字符宽度系数（fontSize 倍数，估算用——DOM 端由 CSS ellipsis 做真实像素截断）。 */
export const CHAR_WIDTH_FACTOR = 0.56
/** 宽字符范围（CJK / 日文假名 / 全角）：按整字宽估算——中文/日文玩家名常见，
 * 若按拉丁系数低估 → 碰撞盒偏窄 → 实际视觉重叠而系统不隐藏（§32 失效）。
 * 内部实现细节，不导出。 */
const WIDE_CHAR_RE = /[\u2E80-\u2EFF\u3000-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/
/** 文本左右 padding 合计（.pb-labels padding 4px×2）。 */
export const LABEL_PAD_X = 8

/**
 * 文本宽度估算（screen px）：逐字符（宽字符整字宽，其余 fontSize × 系数）+ 水平 padding。
 * 只用于碰撞盒估算；真实截断由 CSS max-width + ellipsis 完成（§30 按实际像素宽度）。
 */
export function estimateLabelWidth(text, fontSizePx, maxWidthPx = Infinity) {
  if (text == null || text === '') return 0
  let w = LABEL_PAD_X
  for (const ch of String(text)) {
    w += WIDE_CHAR_RE.test(ch) ? fontSizePx : fontSizePx * CHAR_WIDTH_FACTOR
  }
  return Math.min(w, maxWidthPx)
}

/**
 * 计算全部 marker 的标签碰撞几何（纯函数，无时间状态）：
 *
 * @param items [{ accountId, x, y, tankName, playerName }]  屏幕 px 中心（调用方已换算）
 * @param opts { showTank, showPlayer, viewportW, viewportH }
 * @returns Map<accountId, {
 *   tankBox: { x, y, w, h } | null,      // 位移后的 TankName 盒（含 dy）
 *   tankDy: number,                       // §34 垂直位移（≤0 = 上移，screen px）
 *   playerBox: { x, y, w, h } | null,
 *   playerConflict: boolean               // §32 与任一 TankName 冲突（未施加 hysteresis）
 * }>
 */
export function computeLabelLayout(items, opts = {}) {
  const showTank = opts.showTank !== false
  const showPlayer = opts.showPlayer === true
  const vw = opts.viewportW || Infinity
  const vh = opts.viewportH || Infinity
  const margin = 60 // 标签/位移可能超出 marker 一定范围
  const result = new Map()
  if (!Array.isArray(items)) return result

  const tankH = LABEL_LINE_H.tank + LABEL_PAD_Y
  const playerH = LABEL_LINE_H.player + LABEL_PAD_Y
  const tanks = []

  // 1) 基础盒 + viewport 裁剪（§35）
  for (const it of items) {
    if (!it || it.accountId == null || !Number.isFinite(it.x) || !Number.isFinite(it.y)) continue
    if (it.x < -margin || it.x > vw + margin || it.y < -margin || it.y > vh + margin) {
      result.set(it.accountId, { tankBox: null, tankDy: 0, playerBox: null, playerConflict: false })
      continue
    }
    const tankW = showTank ? estimateLabelWidth(it.tankName, 10, TANK_MAX_WIDTH_PX) : 0
    const tankBox = showTank && tankW > 0
      ? { x: it.x - tankW / 2, y: it.y - LABEL_GAP_PX - tankH, w: tankW, h: tankH }
      : null
    const playerW = showPlayer ? estimateLabelWidth(it.playerName, 9, PLAYER_MAX_WIDTH_PX) : 0
    const playerBox = showPlayer && playerW > 0
      ? { x: it.x - playerW / 2, y: (tankBox ? tankBox.y : it.y - LABEL_GAP_PX) - playerH, w: playerW, h: playerH }
      : null
    const entry = { accountId: it.accountId, x: it.x, y: it.y, tankBox, tankDy: 0, playerBox, playerConflict: false }
    result.set(it.accountId, entry)
    if (tankBox) tanks.push(entry)
  }

  // 2) §34 TankName vs TankName：**从下往上** greedy placement——
  //    下方标签先 finalized（tankBox.y 已含其位移），当前（上方）标签只与已 finalized 的
  //    下方 boxes 比较，计算消除全部重叠所需的最小上移；上方标签后续不会再被下方标签的
  //    新位移撞回（下方已定型）→ 3+ 连锁碰撞不重新产生 overlap。
  //    上限一行（TANK_SHIFT_MAX_PX），达到上限后接受剩余 overlap（产品契约 §34）。
  //    排序按 y，同 y 用 accountId 决胜 → 输入顺序变化结果 deterministic。
  const ordered = [...tanks].sort(
    (a, b) => a.y - b.y || String(a.accountId).localeCompare(String(b.accountId)),
  )
  for (let i = ordered.length - 1; i >= 0; i--) {
    const a = ordered[i] // 当前标签（上方）；j > i 均已被 finalized
    let dy = 0
    for (let j = i + 1; j < ordered.length; j++) {
      const b = ordered[j]
      // 水平重叠检查（x 不受垂直位移影响）
      if (a.tankBox.x + a.tankBox.w <= b.tankBox.x || a.tankBox.x >= b.tankBox.x + b.tankBox.w) continue
      const aBottom = a.tankBox.y + a.tankBox.h + dy // 位移后 a 的底边
      const bTop = b.tankBox.y // b 已是 final（含其自身位移）
      const overlap = aBottom - bTop
      if (overlap > 0) dy = Math.max(-TANK_SHIFT_MAX_PX, dy - overlap)
    }
    a.tankDy = dy
    a.tankBox.y += dy
  }

  // 3) §27/§28 PlayerName 与 TankName 共享同一 label 块（DOM：.pb-labels 整块一起位移，
  //    tankDy 作用于整个块）。playerBox 必须从 **final** tankBox（含 tankDy）推导，
  //    否则碰撞模型与真实渲染不一致（false/missed conflict，甚至旧 playerBox 与自家
  //    final tankBox 产生假 overlap）。单一事实源：player 行底边 = tank 行顶边。
  for (const entry of result.values()) {
    if (!entry.playerBox) continue
    entry.playerBox.y = entry.tankBox
      ? entry.tankBox.y - playerH
      : entry.y - LABEL_GAP_PX - playerH
  }

  // 4) §32 PlayerName 冲突：final playerBox vs 所有 final TankName 盒
  const tankBoxes = tanks.map(t => t.tankBox)
  for (const entry of result.values()) {
    if (!entry.playerBox) continue
    entry.playerConflict = tankBoxes.some(tb =>
      tb
      && entry.playerBox.x < tb.x + tb.w
      && entry.playerBox.x + entry.playerBox.w > tb.x
      && entry.playerBox.y < tb.y + tb.h
      && entry.playerBox.y + entry.playerBox.h > tb.y
    )
  }
  return result
}

/** §33 时间稳定阈值（hide/show，ms）。 */
export const PLAYER_HIDE_MS = 250
export const PLAYER_SHOW_MS = 300
/** §33 恢复 fade-in 时长（ms）：与 VehicleMarker .pb-label-fading animation 0.12s 同步；
 *  BattlePlayback 用其保证 fade 类完整生命周期（fadeUntil 计时，不被下一次 resolve 取消）。 */
export const PLAYER_FADE_MS = 120

/**
 * PlayerName 显示状态的 hysteresis 解析（§33，时间阈值）。
 *
 * @param conflicts Set<accountId>          当前帧冲突集合
 * @param prev Map<accountId, { hidden, conflict, since }>  上一帧状态（调用方维护）
 * @param nowMs number                      当前时间（UI wall clock：performance.now，
 *                                          暂停时由 BattlePlayback 轻量 RAF 继续推进）
 * @returns { state: Map<accountId, { hidden, conflict, since }>, hidden: Set<accountId>, fading: Set<accountId> }
 */
export function resolvePlayerVisibility(conflicts, prev, nowMs, hideMs = PLAYER_HIDE_MS, showMs = PLAYER_SHOW_MS) {
  const state = new Map()
  const hidden = new Set()
  const fading = new Set()
  if (!Number.isFinite(nowMs)) {
    // 无时间基准（暂停/未推进）：沿用 prev 快照，不产生状态迁移
    for (const [id, s] of prev || []) {
      state.set(id, s)
      if (s.hidden) hidden.add(id)
    }
    return { state, hidden, fading }
  }
  const ids = new Set([...(prev?.keys() || []), ...conflicts])
  for (const id of ids) {
    const was = prev?.get(id)
    const conflict = conflicts.has(id)
    let hiddenNow = was ? was.hidden : false
    let since = was ? was.since : nowMs
    if (!was || was.conflict !== conflict) {
      // 冲突状态翻转（含首次出现）：重置计时
      since = nowMs
    }
    if (conflict && !hiddenNow && nowMs - since >= hideMs) hiddenNow = true
    if (!conflict && hiddenNow && nowMs - since >= showMs) {
      hiddenNow = false
      fading.add(id)
    }
    state.set(id, { hidden: hiddenNow, conflict, since })
    if (hiddenNow) hidden.add(id)
  }
  return { state, hidden, fading }
}
