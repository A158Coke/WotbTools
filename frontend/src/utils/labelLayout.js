/**
 * Battle Playback 标签布局纯函数。
 *
 * UX contract：用户选择显示的 TankName / PlayerName / HP HUD 永不因碰撞而隐藏。
 * 碰撞只作用于 model box；标签、名称与 HP 不参与 model collision。
 * marker / selected / destroyed / recorder 仅作为 lane 评分障碍，不再驱动 visibility。
 */

/**
 * Vehicle label 的垂直层级（自上而下，screen 坐标 y 向下增长）：
 *
 *     PlayerName
 *     TankName      ← 身份块 `--type-caption` 两行，行高 16、无行间距
 *     ─ 8px ─       ← `.vehicle-label` 的 gap（`calc(var(--space-1) * 2)`）
 *     HP HUD        ← 数值行 16 + 血条 4，块内 gap 0（`HP_HUD_H_PX` / 实测 hpBoxH）
 *     ─ 4px ─       ← `.pb-combat-state` 的 gap（`HP_HUD_GAP_PX`）
 *     Reload        ← 不参与 collision scoring（有意的：它是最次级的信息）
 *     ↓ marker
 *
 * **本文件的 box 顺序必须与 `PlaybackVehicleLabel.vue` 的真实 DOM 顺序一致**：
 * player 在 tank 之上、tank 在 HP 之上、HP 在 marker 之上。这里曾经是
 * 「HP → 玩家 → 车辆」，与真实呈现相反，导致 2D lane/collision 评分按错的几何计算。
 *
 * 行高来自 `--type-caption`（`--line-height-caption: 16px`）；两行标签是
 * `.pb-labels` 的直接子元素、该 flex 列没有 gap，所以身份块高度就是两行行高之和。
 */
export const LABEL_LINE_H = Object.freeze({ tank: 16, player: 16 })
/** 已并入行高：保留导出是为了不破坏既有消费者，语义上等价于 0。 */
export const LABEL_PAD_Y = 0
/** marker 顶部 → 身份块底部（`tankBox` 与其下方元素之间就是它）。 */
export const LABEL_GAP_PX = 2
/**
 * 身份块 → combat block 的间距，owner 是 `PlaybackVehicleLabel.vue` 的
 * `.vehicle-label { gap: calc(var(--space-1) * 2) }`（--space-1 = 4px）。
 * 改那个 gap 时必须同步这里，否则 collision 盒会与真实渲染错位。
 */
export const IDENTITY_TO_COMBAT_GAP_PX = 8
export const TANK_SHIFT_MAX_PX = 24
const PLAYER_MAX_WIDTH_PX = 110
const TANK_MAX_WIDTH_PX = 150
export const CHAR_WIDTH_FACTOR = 0.56
const WIDE_CHAR_RE = /[\u2E80-\u2EFF\u3000-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/
export const LABEL_PAD_X = 8

/** Desktop marker visual target; mobile CSS remains smaller. */
export const MARKER_CORE_PX = 30
export const HP_BAR_W_PX = 48
/**
 * `.pb-hp-hud` 的高度**回退**（无布局环境，例如 jsdom）。
 *
 * 真实高度由 `BattlePlayback.vue` 实测 `offsetHeight` 后作为 `hpBoxH` 传入；这个常量是
 * 测不到布局时的等价盒。当前口径 = `--line-height-caption` 16（数值行）+ 4（血条），
 * 与真实渲染一致（`.pb-hp-hud` 块内 gap 为 0）。
 */
export const HP_HUD_H_PX = 20
/** `.pb-combat-state` 的 gap：HP HUD → reload（--space-1 = 4px）。 */
export const HP_HUD_GAP_PX = 4
export const RECORDER_BADGE_PX = 7
export const RECORDER_GAP_PX = 5
export const SELECTED_MARK_W_PX = 10
export const SELECTED_MARK_H_PX = 9
export const SELECTED_NAME_GAP_PX = 3
export const DESTROYED_X_PX = 30

/** Stable lane offsets in screen px. Never hide when all lanes overlap. */
export const LABEL_LANES_PX = Object.freeze([0, -10, 10, -20])

/**
 * 名牌被地形 / 静态场景挡住时的弱化下限（软遮挡）。
 *
 * **永不隐藏**（严格大于 0、小于 1）：被挡只是变淡，不是消失。2D 与 3D 共用同一语义——
 * 3D 的 HTML 覆盖层把本值写进 `--pb-label-occluded-opacity`，因此这条下限只有一份事实源
 * （此前它同时存在于 scene 的常量、覆盖层 CSS 与注释三处，重构后已收敛到这里）。
 */
export const LABEL_OCCLUDED_OPACITY = 0.35

export function estimateLabelWidth(text, fontSizePx, maxWidthPx = Infinity) {
  if (text == null || text === '') return 0
  let w = LABEL_PAD_X
  for (const ch of String(text)) {
    w += WIDE_CHAR_RE.test(ch) ? fontSizePx : fontSizePx * CHAR_WIDTH_FACTOR
  }
  return Math.min(w, maxWidthPx)
}

function overlaps(a, b) {
  return !!a && !!b
    && a.x < b.x + b.w && a.x + a.w > b.x
    && a.y < b.y + b.h && a.y + a.h > b.y
}

function overlapArea(a, b) {
  if (!overlaps(a, b)) return 0
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return Math.max(0, w) * Math.max(0, h)
}

function moved(box, dy) {
  return box ? { ...box, y: box.y + dy } : null
}

/**
 * Layout-only collision handling. Returned legacy visibility fields are retained as compatibility
 * outputs for current BattlePlayback/VehicleMarker callers, but they are always false.
 */
export function computeLabelLayout(items, opts = {}) {
  const showTank = opts.showTank !== false
  const showPlayer = opts.showPlayer === true
  const vw = opts.viewportW || Infinity
  const vh = opts.viewportH || Infinity
  const coreSize = Number.isFinite(opts.coreSize) && opts.coreSize > 0 ? opts.coreSize : MARKER_CORE_PX
  const margin = 60
  const result = new Map()
  if (!Array.isArray(items)) return result

  const tankH = LABEL_LINE_H.tank + LABEL_PAD_Y
  const playerH = LABEL_LINE_H.player + LABEL_PAD_Y
  /** 身份块 = 名称两行（顺序同 DOM：player 在上、tank 在下）。 */
  const identityBlockH = (showTank ? tankH : 0) + (showPlayer ? playerH : 0)

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

    const itemCoreSize = Number.isFinite(it.coreSize) && it.coreSize > 0 ? it.coreSize : coreSize
    const coreHalf = itemCoreSize / 2
    const markerTop = it.y - coreHalf
    const markerBottom = it.y + coreHalf
    const coreBox = { x: it.x - coreHalf, y: markerTop, w: itemCoreSize, h: itemCoreSize }
    const destroyedBox = it.destroyed === true
      ? { x: it.x - DESTROYED_X_PX / 2, y: it.y - DESTROYED_X_PX / 2, w: DESTROYED_X_PX, h: DESTROYED_X_PX }
      : null
    const recorderBox = it.recorder === true
      ? { x: it.x - RECORDER_BADGE_PX / 2, y: markerBottom + RECORDER_GAP_PX, w: RECORDER_BADGE_PX, h: RECORDER_BADGE_PX }
      : null

    // 自下而上构造：先定 combat block（它直接坐在 marker 之上），身份块再叠在它上面。
    // 真实层级：PlayerName → TankName →（IDENTITY_TO_COMBAT_GAP_PX）→ HP →（LABEL_GAP_PX）→ marker
    const hpRendered = it.hpRendered === true
    const hpText = it.hpDisplayText || ''
    const hpW = hpRendered ? Math.max(it.hpBoxW ?? HP_BAR_W_PX,
      estimateLabelWidth(hpText || '—', 10, 80)) : 0
    const hpH = hpRendered ? (it.hpBoxH ?? HP_HUD_H_PX) : 0
    // 没有 HP 时 marker 上方留白的仍是同一个 LABEL_GAP_PX。
    const combatTop = hpRendered && hpW > 0
      ? markerTop - LABEL_GAP_PX - hpH
      : markerTop - LABEL_GAP_PX
    const hpBox = hpRendered && hpW > 0
      ? { x: it.x - hpW / 2, y: combatTop, w: hpW, h: hpH }
      : null

    // 身份块底边 = combat block 顶边 − identity gap（tank 在下、player 在上）。
    const identityBottom = combatTop - (it.hpRing === true ? 0 : IDENTITY_TO_COMBAT_GAP_PX)
    const identityTop = identityBottom - identityBlockH
    const tankExtra = Number.isFinite(it.tankNameExtraWidth) ? Math.max(0, it.tankNameExtraWidth) : 0
    const tankW = showTank ? estimateLabelWidth(it.tankName, 10, TANK_MAX_WIDTH_PX) + tankExtra : 0
    const tankBox = showTank && tankW > 0
      ? { x: it.x - tankW / 2, y: identityBottom - tankH, w: tankW, h: tankH }
      : null
    const playerW = showPlayer && it.playerName
      ? estimateLabelWidth(it.playerName, 9, PLAYER_MAX_WIDTH_PX) : 0
    const playerBox = showPlayer && playerW > 0
      ? { x: it.x - playerW / 2, y: identityTop, w: playerW, h: playerH }
      : null

    // 选中倒三角贴在身份块（整个标签栈的最上沿）之上。
    const selectedBox = it.selected === true
      ? { x: it.x - SELECTED_MARK_W_PX / 2, y: identityTop - SELECTED_NAME_GAP_PX - SELECTED_MARK_H_PX, w: SELECTED_MARK_W_PX, h: SELECTED_MARK_H_PX }
      : null

    result.set(it.accountId, {
      accountId: it.accountId, x: it.x, y: it.y, selected: it.selected === true,
      coreBox, selectedBox, destroyedBox, recorderBox,
      tankBox, tankDy: 0, blockHidden: false,
      playerBox, playerConflict: false, hpBox, hpHidden: false,
    })
  }

  // Stable deterministic order makes lane selection reproducible across frames/seeks.
  const ordered = [...result.values()]
    .filter(entry => entry.tankBox || entry.playerBox || entry.hpBox)
    .sort((a, b) => a.y - b.y || String(a.accountId).localeCompare(String(b.accountId)))
  const placed = []

  for (const entry of ordered) {
    let bestDy = 0
    let bestScore = Number.POSITIVE_INFINITY

    for (const laneDy of LABEL_LANES_PX) {
      const candidateBoxes = [moved(entry.tankBox, laneDy), moved(entry.playerBox, laneDy), moved(entry.hpBox, laneDy)]
        .filter(Boolean)
      let score = 0
      for (const candidate of candidateBoxes) {
        for (const other of placed) {
          // 只允许 label/tag ↔ label/tag 参与 lane 评分；核心/销毁/选中/记录器盒不影响 lane。
          for (const obstacle of [other.tankBox, other.playerBox, other.hpBox]) {
            score += overlapArea(candidate, obstacle)
          }
        }
      }
      if (score < bestScore) {
        bestScore = score
        bestDy = laneDy
        if (score === 0) break
      }
    }

    entry.tankDy = bestDy
    entry.tankBox = moved(entry.tankBox, bestDy)
    entry.playerBox = moved(entry.playerBox, bestDy)
    entry.hpBox = moved(entry.hpBox, bestDy)
    entry.selectedBox = moved(entry.selectedBox, bestDy)
    // UX invariant: collisions never alter visibility.
    entry.blockHidden = false
    entry.playerConflict = false
    entry.hpHidden = false
    placed.push(entry)
  }

  return result
}
