/**
 * Battle Playback 标签布局纯函数。
 *
 * UX contract：用户选择显示的 TankName / PlayerName / HP HUD 永不因碰撞而隐藏。
 * 碰撞只允许有限的垂直 lane 位移；如果所有 lane 仍冲突，则接受 overlap。
 * marker / selected / destroyed / recorder 仅作为 lane 评分障碍，不再驱动 visibility。
 */

export const LABEL_LINE_H = Object.freeze({ tank: 12, player: 11 })
export const LABEL_PAD_Y = 2
export const LABEL_GAP_PX = 2
export const TANK_SHIFT_MAX_PX = 24
const PLAYER_MAX_WIDTH_PX = 110
const TANK_MAX_WIDTH_PX = 150
export const CHAR_WIDTH_FACTOR = 0.56
const WIDE_CHAR_RE = /[\u2E80-\u2EFF\u3000-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/
export const LABEL_PAD_X = 8

/** Desktop marker visual target; mobile CSS remains smaller. */
export const MARKER_CORE_PX = 30
export const HP_BAR_W_PX = 48
export const HP_HUD_H_PX = 18
export const HP_HUD_GAP_PX = 4
export const RECORDER_BADGE_PX = 7
export const RECORDER_GAP_PX = 5
export const SELECTED_MARK_W_PX = 10
export const SELECTED_MARK_H_PX = 9
export const SELECTED_NAME_GAP_PX = 3
export const DESTROYED_X_PX = 30

/** Stable lane offsets in screen px. Never hide when all lanes overlap. */
export const LABEL_LANES_PX = Object.freeze([0, -12, 12, -24])

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

  const coreHalf = coreSize / 2
  const tankH = LABEL_LINE_H.tank + LABEL_PAD_Y
  const playerH = LABEL_LINE_H.player + LABEL_PAD_Y
  const labelBlockH = (showTank ? tankH : 0) + (showPlayer ? playerH : 0)

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

    const markerTop = it.y - coreHalf
    const markerBottom = it.y + coreHalf
    const coreBox = { x: it.x - coreHalf, y: markerTop, w: coreSize, h: coreSize }
    const destroyedBox = it.destroyed === true
      ? { x: it.x - DESTROYED_X_PX / 2, y: it.y - DESTROYED_X_PX / 2, w: DESTROYED_X_PX, h: DESTROYED_X_PX }
      : null
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

    const hpRendered = it.hpRendered === true
    const hpText = it.hpDisplayText || ''
    const hpW = hpRendered ? Math.max(it.hpBoxW ?? HP_BAR_W_PX,
      estimateLabelWidth(hpText || '—', 10, 80)) : 0
    const hpH = hpRendered ? (it.hpBoxH ?? HP_HUD_H_PX) : 0
    const hpBox = hpRendered && hpW > 0
      ? { x: it.x - hpW / 2, y: markerTop - LABEL_GAP_PX - labelBlockH - HP_HUD_GAP_PX - hpH, w: hpW, h: hpH }
      : null
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
          for (const obstacle of [other.coreBox, other.destroyedBox, other.selectedBox, other.recorderBox,
            other.tankBox, other.playerBox, other.hpBox]) {
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
