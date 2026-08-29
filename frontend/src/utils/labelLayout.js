/**
 * PR4（标签布局）+ 本任务（docs/features/battle-playback.md 标签布局与碰撞）+ PR #107 Blocker 1 —— Battle Playback 标签布局与碰撞纯函数。
 *
 * 坐标系：全部为**屏幕像素**（相对地图容器，y 向下）。调用方把 marker 的地图坐标经
 * viewport 变换（translate + scale(view.scale)）换算成屏幕坐标后传入。
 *
 * 坐标空间约定（PR #107 Blocker 1）：
 * - marker core 本体位于 viewport 内，随地图整体缩放 → 屏幕尺寸 = CSS size × view.scale；
 *   调用方必须把 coreSize 传为**真实屏幕尺寸**（markerCssSize × view.scale），不得传 transform 前值。
 * - inverse-scaled 叠加层（selected 三角 / destroyed ✕ / recorder 菱形 / 名称标签 / HP HUD）
 *   用 scale(1/view.scale) 反缩放 → **屏幕恒定尺寸**，不随 zoom 变化；
 *   本函数用屏幕恒定常量描述它们的盒（SELECTED_MARK_W/H、DESTROYED_X_PX、RECORDER_BADGE_PX 等）。
 *
 * 碰撞几何（§22/§23）基于**真实 screen-space visual footprint**：
 * - Marker core 盒（车辆图标本体，屏幕尺寸 = coreSize，随 zoom）；
 * - Selected 倒三角盒（§25 优先级 2；屏幕恒定 10×9px，位于 label 块上方）；
 * - Destroyed ✕ 盒（阵亡 30px 红叉，屏幕恒定，覆盖车体中心）；
 * - Recorder 菱形盒（7×7px，屏幕恒定，位于 marker 下方）；
 * - HP HUD 盒（数字 + 定宽 bar，屏幕恒定；PR #107 Blocker 4：hpRendered=false（关闭「显示血量」）
 *   时 footprint 缩小 §28；RULE_DERIVED_FULL_AT_SPAWN 的 current=null 与 UNKNOWN 的 — 仍渲染 HUD、
 *   必须有盒——是否存在按 DOM 实际渲染判断，不是按 current 是否为 null）；
 * - TankName 盒（§31 永远完整，不截断；屏幕恒定）；
 * - PlayerName 盒（§30 截断 110px；屏幕恒定）。
 *
 * 优先级（§25）：Marker core(1) > Selected vehicle(2) > HP(3) > Tank name(4) > Player name(5)。
 * 解决重叠不是通过让所有东西一起隐藏：可移位元素优先位移（TankName 上移让位，上限一行），
 * 物理上无法分离的（label 与上方车辆 core 重叠）才隐藏低优先级元素。
 *
 * 契约：
 * - TankName 与 TankName 冲突只做轻量垂直位移（§34，上限约一行）；达到上限接受剩余 overlap；
 * - TankName 与下方车辆 core/HP HUD/selected/destroyed/recorder 冲突 → 上移让位；
 *   与上方不可移位障碍冲突 → 整块隐藏（§31 完整性与 §25 优先级：blockHidden 隐藏整块 tank+player）；
 * - PlayerName 与任何他车元素冲突 → 隐藏候选（§32），resolvePlayerVisibility 施加时间稳定阈值；
 * - HP HUD 与 he 车 core/selected/destroyed 冲突 → 隐藏（§25 core 优先；selected 车辆 HP 不被挤掉，§26）；
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

/** Marker core 盒尺寸（screen px；调用方传 coreSize = 实际屏幕尺寸，此处仅作缺省）。
 * 与 .pb-vehicle CSS 36px 同源；mobile 28 经调用方换算。 */
export const MARKER_CORE_PX = 36
/** HP bar 定宽（.pb-hp-bar width 46px + border 2px）。 */
export const HP_BAR_W_PX = 48
/** HP HUD 盒高（数字 11px + gap 1px + bar 6px）。 */
export const HP_HUD_H_PX = 18
/** HP HUD ↔ label 块 screen gap（与 VehicleMarker HP_HUD_GAP_PX 同值）。 */
export const HP_HUD_GAP_PX = 4
/** Recorder 空心菱形（7×7px，inverse-scaled 屏幕恒定）位于 marker 下方 5px
 * （VehicleMarker .pb-recorder-badge：top calc(100% + 5×inv px)）。 */
export const RECORDER_BADGE_PX = 7
/** Recorder 菱形 ↔ marker 底部 screen gap（5px）。 */
export const RECORDER_GAP_PX = 5
/** Selected 红色倒三角 bounding box（VehicleMarker .pb-selected-mark：border-top 9px，
 * 屏幕恒定 inverse-scaled；宽 ≈ 2×9×tan(30°) ≈ 10.4 → 10）。 */
export const SELECTED_MARK_W_PX = 10
export const SELECTED_MARK_H_PX = 9
/** Selected 三角底边 ↔ label 块顶边 screen gap（VehicleMarker NAME_GAP_SCREEN_PX）。 */
export const SELECTED_NAME_GAP_PX = 3
/** Destroyed ✕ 覆盖盒（30px 红叉，屏幕恒定 inverse-scaled，覆盖车体中心）。 */
export const DESTROYED_X_PX = 30

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
 * 计算全部 marker 的标签碰撞几何（纯函数，无时间状态）。
 *
 * @param items [{ accountId, x, y, tankName, playerName, hpRendered, hpDisplayText,
 *                selected, destroyed, recorder, hpBoxW, hpBoxH }]
 *   x/y = marker 中心（屏幕 px，viewport 变换后）；selected/destroyed/recorder 为状态标志；
 *   hpRendered = HP HUD 是否实际渲染（DOM 是否画 HUD——RULE_DERIVED_FULL_AT_SPAWN 的 current=null
 *               与 UNKNOWN 的 — 都渲染 HUD，必须有 footprint，不能只看 current 是否为 null）；
 *   hpDisplayText = HUD 数字区实际渲染文本（数字或 —，用于按状态估算盒宽）；
 *   hpBoxW/hpBoxH = HP HUD 真实渲染宽高（screen px，调用方测量；缺省按 CSS 常量，
 *               与 hpDisplayText 估算取 max 保守覆盖全部状态）。
 * @param opts { showTank, showPlayer, viewportW, viewportH, coreSize }
 *   coreSize = marker core **真实屏幕尺寸**（= CSS size × view.scale，调用方换算）。
 * @returns Map<accountId, {
 *   coreBox: {x,y,w,h} | null,         // marker core 盒（§22 参与碰撞；恒可见；随 zoom）
 *   selectedBox: {x,y,w,h} | null,     // selected 三角盒（§25 优先级 2；屏幕恒定）
 *   destroyedBox: {x,y,w,h} | null,    // destroyed ✕ 盒（阵亡覆盖；屏幕恒定）
 *   recorderBox: {x,y,w,h} | null,     // recorder 菱形盒（marker 下方；屏幕恒定）
 *   tankBox: { x, y, w, h } | null,     // 位移后的 TankName 盒（含 dy）
 *   tankDy: number,                     // §34 垂直位移（≤0 = 上移，screen px）
 *   blockHidden: boolean,               // §25/§31：TankName 与不可移位障碍重叠 → 整块隐藏
 *   playerBox: { x, y, w, h } | null,
 *   playerConflict: boolean,            // §32 与任一他车元素冲突（未施加 hysteresis）
 *   hpBox: { x, y, w, h } | null,       // HP HUD 盒（hpRendered 才存在——DOM 实际渲染即有盒）
 *   hpHidden: boolean,                  // §25：与 he 车 core 冲突且非 selected → 隐藏
 * }>
 */
export function computeLabelLayout(items, opts = {}) {
  const showTank = opts.showTank !== false
  const showPlayer = opts.showPlayer === true
  const vw = opts.viewportW || Infinity
  const vh = opts.viewportH || Infinity
  const coreSize = Number.isFinite(opts.coreSize) && opts.coreSize > 0 ? opts.coreSize : MARKER_CORE_PX
  const margin = 60 // 标签/位移可能超出 marker 一定范围
  const result = new Map()
  if (!Array.isArray(items)) return result

  const coreHalf = coreSize / 2
  const tankH = LABEL_LINE_H.tank + LABEL_PAD_Y
  const playerH = LABEL_LINE_H.player + LABEL_PAD_Y
  // label 块总高（按显示偏好；与 VehicleMarker labelScreenHeight 同源——HP HUD 偏移基于偏好而非实际隐藏）
  const labelBlockH = (showTank ? tankH : 0) + (showPlayer ? playerH : 0)

  // 1) 基础盒（screen px，含 marker core / selected / destroyed / recorder / HP HUD / label 块）
  for (const it of items) {
    if (!it || it.accountId == null || !Number.isFinite(it.x) || !Number.isFinite(it.y)) continue
    if (it.x < -margin || it.x > vw + margin || it.y < -margin || it.y > vh + margin) {
      result.set(it.accountId, {
        coreBox: null, selectedBox: null, destroyedBox: null, recorderBox: null,
        tankBox: null, tankDy: 0, blockHidden: false,
        playerBox: null, playerConflict: false, hpBox: null, hpHidden: false,
      })
      continue
    }
    const coreBox = { x: it.x - coreHalf, y: it.y - coreHalf, w: coreSize, h: coreSize }
    const markerTop = it.y - coreHalf
    const markerBottom = it.y + coreHalf
    // §22 destroyed ✕：屏幕恒定 30px，覆盖 marker 中心（inverse-scaled）
    const destroyedBox = it.destroyed === true
      ? { x: it.x - DESTROYED_X_PX / 2, y: it.y - DESTROYED_X_PX / 2, w: DESTROYED_X_PX, h: DESTROYED_X_PX }
      : null
    // §22 recorder 菱形：屏幕恒定 7×7px，位于 marker 底部下方 5px（inverse-scaled）
    const recorderBox = it.recorder === true
      ? { x: it.x - RECORDER_BADGE_PX / 2, y: markerBottom + RECORDER_GAP_PX, w: RECORDER_BADGE_PX, h: RECORDER_BADGE_PX }
      : null
    const tankW = showTank ? estimateLabelWidth(it.tankName, 10, TANK_MAX_WIDTH_PX) : 0
    const tankBox = showTank && tankW > 0
      ? { x: it.x - tankW / 2, y: markerTop - LABEL_GAP_PX - tankH, w: tankW, h: tankH }
      : null
    const playerW = showPlayer && it.playerName
      ? estimateLabelWidth(it.playerName, 9, PLAYER_MAX_WIDTH_PX) : 0
    const playerBox = showPlayer && playerW > 0
      ? { x: it.x - playerW / 2, y: (tankBox ? tankBox.y : markerTop - LABEL_GAP_PX) - playerH, w: playerW, h: playerH }
      : null
    // HP HUD 位于 label 块之上（§22 + PR #107 Blocker 4：HP 参与碰撞；hpRendered=false 时无盒 →
    // footprint 缩小，§28）。HP footprint 是否存在 = DOM 是否实际渲染 HUD（调用方传 hpRendered +
    // hpDisplayText），不是 current 是否为 null——RULE_DERIVED_FULL_AT_SPAWN（current=null，仍渲染
    // 100% 血条）与 UNKNOWN（数字 —）都渲染 HUD，必须有盒。
    const hpRendered = it.hpRendered === true
    // 盒宽 = max(调用方实测宽（第一辆车基准）, 按实际渲染文本估算)——不同显示文本（数字 vs —）
    // 可能影响宽度，按每车 hpDisplayText 估算取 max 保守覆盖全部状态（§22 屏幕恒定 inverse-scaled）。
    const hpText = it.hpDisplayText || ''
    const hpW = hpRendered ? Math.max(it.hpBoxW ?? HP_BAR_W_PX,
      estimateLabelWidth(hpText || '—', 10, 80)) : 0
    const hpH = hpRendered ? (it.hpBoxH ?? HP_HUD_H_PX) : 0
    const hpBox = hpRendered && hpW > 0
      ? { x: it.x - hpW / 2, y: markerTop - LABEL_GAP_PX - labelBlockH - HP_HUD_GAP_PX - hpH, w: hpW, h: hpH }
      : null
    // §25 selected 三角：位于 label 块上方（屏幕恒定；随 label 块整体位移 tankDy 同步上移）
    const selectedBox = it.selected === true
      ? { x: it.x - SELECTED_MARK_W_PX / 2, y: markerTop - LABEL_GAP_PX - labelBlockH - SELECTED_NAME_GAP_PX - SELECTED_MARK_H_PX, w: SELECTED_MARK_W_PX, h: SELECTED_MARK_H_PX }
      : null
    result.set(it.accountId, {
      accountId: it.accountId, x: it.x, y: it.y, selected: it.selected === true,
      coreBox, selectedBox, destroyedBox, recorderBox,
      tankBox, tankDy: 0, blockHidden: false,
      playerBox, playerConflict: false, hpBox, hpHidden: false,
    })
  }

  // 2) §34 TankName 位移（**从下往上** greedy）+ §22 下方障碍：
  //    - TankName vs TankName（同级）：保留既有语义——只对「下方已 finalized」标签位移
  //      （上限一行，3+ 连锁不重新产生 overlap；达到上限接受剩余 overlap）；
  //    - TankName vs he 车 core/HP/selected/destroyed（更高优先级，§25）：只对「障碍起点位于
  //      标签起点及以下」（上移能离开）的障碍位移；上方不可移位障碍留给 blockHidden 处理。
  const entries = [...result.values()].filter((e) => e.tankBox != null)
  const ordered = [...entries].sort(
    (a, b) => a.y - b.y || String(a.accountId).localeCompare(String(b.accountId)),
  )
  for (let i = ordered.length - 1; i >= 0; i--) {
    const a = ordered[i]
    let dy = 0
    // (a) 同级 TankName：下方已 finalized 标签（j > i）
    for (let j = i + 1; j < ordered.length; j++) {
      const b = ordered[j]
      const o = b.tankBox
      if (a.tankBox.x + a.tankBox.w <= o.x || a.tankBox.x >= o.x + o.w) continue
      const aBottom = a.tankBox.y + a.tankBox.h + dy
      const overlap = aBottom - o.y
      if (overlap > 0) dy = Math.max(-TANK_SHIFT_MAX_PX, dy - overlap)
    }
    // (b) 更高优先级障碍：he 车 core / HP HUD / selected 三角 / destroyed ✕ / recorder 菱形（§22/§25）
    for (let j = 0; j < ordered.length; j++) {
      if (j === i) continue
      const b = ordered[j]
      const obstacles = [b.coreBox, b.destroyedBox, b.selectedBox, b.recorderBox]
      if (b.hpBox && !b.hpHidden) obstacles.push(b.hpBox)
      for (const o of obstacles) {
        if (!o) continue
        if (a.tankBox.x + a.tankBox.w <= o.x || a.tankBox.x >= o.x + o.w) continue
        const aBottom = a.tankBox.y + a.tankBox.h + dy
        const overlap = aBottom - o.y
        // 障碍起点位于标签起点及以下（上移能离开）才位移；上方不可移位 → blockHidden 处理
        if (overlap > 0 && o.y >= a.tankBox.y + dy) {
          dy = Math.max(-TANK_SHIFT_MAX_PX, dy - overlap)
        }
      }
    }
    a.tankDy = dy
    a.tankBox.y += dy
    // selected 三角与 HP HUD 与 label 块同源位移（§22/§25：同一视觉堆叠，位移后保持贴合；
    // 与 VehicleMarker selectedMarkStyle/hpHudStyle bottom += tankDy 同源）
    if (a.selectedBox) a.selectedBox.y += dy
    if (a.hpBox) a.hpBox.y += dy
  }

  // 3) playerBox 从 **final** tankBox 推导（§27/§28：player 行底边 = tank 行顶边，共享块整体位移）
  for (const entry of result.values()) {
    if (!entry.playerBox) continue
    entry.playerBox.y = entry.tankBox
      ? entry.tankBox.y - playerH
      : entry.y - coreHalf - LABEL_GAP_PX - playerH
  }

  // 4) §25/§31 blockHidden：位移后 TankName 仍与不可移位障碍（他车 core / hp / selected / destroyed /
  //    recorder 元素）重叠 → 整块（tank+player）隐藏。TankName 间残留 overlap（位移上限）按 §34 契约接受。
  for (const entry of result.values()) {
    if (!entry.tankBox) {
      entry.blockHidden = false
      continue
    }
    entry.blockHidden = [...result.values()].some((o) => {
      if (o === entry || o.coreBox == null) return false
      // §25：不可分离冲突只来自更高优先级元素（he 车 core / HP HUD / selected / destroyed / recorder）——
      // 同级 TankName 残留 overlap 按 §34 契约接受，不触发隐藏
      const obstacles = [o.coreBox, o.destroyedBox, o.selectedBox, o.recorderBox]
      if (o.hpBox && !o.hpHidden) obstacles.push(o.hpBox)
      return obstacles.some((b) =>
        b
        && entry.tankBox.x < b.x + b.w && entry.tankBox.x + entry.tankBox.w > b.x
        && entry.tankBox.y < b.y + b.h && entry.tankBox.y + entry.tankBox.h > b.y)
    })
  }

  // 5) §32 PlayerName 冲突：final playerBox vs 他车全部元素（含 core / hp / tank / player /
  //    selected / destroyed / recorder）
  for (const entry of result.values()) {
    if (!entry.playerBox) continue
    entry.playerConflict = [...result.values()].some((o) => {
      if (o === entry) return false
      const obstacles = [o.coreBox, o.destroyedBox, o.selectedBox, o.recorderBox]
      if (o.hpBox && !o.hpHidden) obstacles.push(o.hpBox)
      if (o.tankBox) obstacles.push(o.tankBox)
      if (o.playerBox) obstacles.push(o.playerBox)
      return obstacles.some((b) =>
        b
        && entry.playerBox.x < b.x + b.w && entry.playerBox.x + entry.playerBox.w > b.x
        && entry.playerBox.y < b.y + b.h && entry.playerBox.y + entry.playerBox.h > b.y)
    })
  }

  // 6) §25/§26 HP HUD：与 he 车 core（或 selected/destroyed/recorder 元素）重叠 → 隐藏；
  //    HP 间重叠 → 非 selected 且 accountId 大者隐藏（deterministic，输入顺序无关）。
  for (const entry of result.values()) {
    if (!entry.hpBox) {
      entry.hpHidden = false
      continue
    }
    const blockedByCore = [...result.values()].some((o) =>
      o !== entry && [o.coreBox, o.destroyedBox, o.selectedBox, o.recorderBox].some((b) =>
        b
        && entry.hpBox.x < b.x + b.w && entry.hpBox.x + entry.hpBox.w > b.x
        && entry.hpBox.y < b.y + b.h && entry.hpBox.y + entry.hpBox.h > b.y))
    const blockedByHp = [...result.values()].some((o) =>
      o !== entry && o.hpBox && !o.hpHidden
      && !o.selected && String(o.accountId).localeCompare(String(entry.accountId)) > 0
      && entry.hpBox.x < o.hpBox.x + o.hpBox.w && entry.hpBox.x + entry.hpBox.w > o.hpBox.x
      && entry.hpBox.y < o.hpBox.y + o.hpBox.h && entry.hpBox.y + entry.hpBox.h > o.hpBox.y)
    entry.hpHidden = !entry.selected && (blockedByCore || blockedByHp)
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
