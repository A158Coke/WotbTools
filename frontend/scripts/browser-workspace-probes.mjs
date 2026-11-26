function workspace2dProbe(touch = false) {
  const box = (el) => {
    if (!el || !el.getClientRects().length) return null
    const r = el.getBoundingClientRect()
    return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }
  }
  const root = document.querySelector('[data-test="battle-playback"]')
  const main = document.querySelector('[data-test="pb-main"]')
  const lane = (side) => {
    const el = document.querySelector(`[data-test="pb-team-lane-${side}"]`)
    if (!el) return null
    const rows = [...el.querySelectorAll('[data-test="pb-roster-row"]')]
    return {
      box: box(el),
      ids: rows.map((row) => Number(row.dataset.accountId)),
      scrolls: el.scrollHeight > el.clientHeight + 1,
      dbg: { sh: el.scrollHeight, ch: el.clientHeight, before: getComputedStyle(el, "::before").content, rows: [...el.querySelectorAll("[data-test=pb-roster-row]")].map(r => Math.round(r.getBoundingClientRect().height)).join(",") },
      scrollsX: el.scrollWidth > el.clientWidth + 1,
      rowsFit: rows.every((row) => {
        const rowBox = row.getBoundingClientRect()
        const laneBox = el.getBoundingClientRect()
        const hpBox = row.querySelector('[data-test="roster-hp"]')?.getBoundingClientRect()
        return rowBox.left >= laneBox.left - 1 && rowBox.right <= laneBox.right + 1
          && hpBox && hpBox.left >= rowBox.left && hpBox.right <= rowBox.right + 1
          && ['pb-roster-player', 'pb-roster-tank'].every(test =>
            row.querySelector(`[data-test="${test}"]`)?.getBoundingClientRect().width > 1)
      }),
      rowsComplete: rows.every((row) => {
        const bar = row.querySelector('[data-test="roster-hp"]')
        return ['pb-roster-player', 'pb-roster-tank']
          .every((test) => (row.querySelector(`[data-test="${test}"]`)?.textContent || '').trim().length > 0)
          && !!bar && (bar.getAttribute('aria-label') || '').trim().length > 0
      }),
      hpBar: !!el.querySelector('[data-test="roster-hp"]'),
    }
  }
  const buttons = [...document.querySelectorAll('.pb-controls > .pb-btn, .pb-controls > * > .pb-btn, .pb-controls .pb-btn')]
    .filter((b) => b.getClientRects().length && !b.closest('.pb-speed-menu'))
  const phoneLandscape = !!root?.classList.contains('pb-phone-landscape')
  const primaryIds = touch && !phoneLandscape
    ? ['pb-back5', 'pb-play', 'pb-fwd5', 'pb-speed-current', 'pb-secondary-entry']
    : ['pb-back5', 'pb-play', 'pb-fwd5', 'pb-speed-current', 'pb-fullscreen', 'pb-secondary-entry']
  const primary = primaryIds
    .map((test) => box(document.querySelector(`.pb-controls [data-test="${test}"]`)))
  const primaryHitAreas = primaryIds.map((test, index) => {
    const el = document.querySelector(`.pb-controls [data-test="${test}"]`)
    const b = primary[index]
    if (!el || !b) return { test, missing: true }
    const hit = (x, y) => { const target = document.elementFromPoint(x, y); return target === el || el.contains(target) }
    const cx = b.l + b.w / 2, cy = b.t + b.h / 2
    return {
      test, center: hit(cx, cy), top: hit(cx, b.t - 1.5), bottom: hit(cx, b.b + 1.5),
      left: hit(b.l - 1.5, cy), right: hit(b.r + 1.5, cy), visualHeight: b.h, visualWidth: b.w,
    }
  })
  const scene = document.querySelector('[data-scene-surface]')
  const sceneStyle = getComputedStyle(scene || document.documentElement)
  const token = (name) => parseFloat(sceneStyle.getPropertyValue(name)) || null
  const details = document.querySelector('[data-test="pb-info"]')
  const transport = document.querySelector('[data-test="pb-transport-slot"]')
  const inline = document.querySelector('[data-test="pb-inline-area"]')
  return {
    width: innerWidth,
    height: innerHeight,
    fullscreen: !!document.fullscreenElement,
    rootClass: root?.className || '',
    phoneLandscape,
    primaryIds,
    hud: box(document.querySelector('.pb-hud')),
    pageOverflowX: document.documentElement.scrollWidth > innerWidth + 1,
    main: box(main),
    mainPadding: main ? {
      left: parseFloat(getComputedStyle(main).paddingLeft) || 0,
      right: parseFloat(getComputedStyle(main).paddingRight) || 0,
      top: parseFloat(getComputedStyle(main).paddingTop) || 0,
    } : null,
    map: box(document.querySelector('[data-test="pb-map"]')),
    transport: box(transport),
    left: lane('left'),
    right: lane('right'),
    inline: box(inline),
    inlineRosterIds: inline ? [...inline.querySelectorAll('[data-test="pb-roster-row"]')].map((r) => Number(r.dataset.accountId)) : [],
    inlineHasDetails: !!inline?.querySelector('[data-test="pb-info"]'),
    details: box(details),
    detailsCount: document.querySelectorAll('[data-test="pb-info"]').length,
    detailsParentIsMain: !!details && details.parentElement === main,
    detailsPresentation: details?.dataset.presentation || null,
    detailsPlayer: document.querySelector('[data-test="pb-sb-player"]')?.textContent?.trim() || null,
    selectedIds: [...document.querySelectorAll('[data-test="pb-roster-row"][aria-pressed="true"]')].map((r) => Number(r.dataset.accountId)),
    time: document.querySelector('[data-test="pb-time"]')?.textContent?.trim() || null,
    friendlyHp: document.querySelector('[data-test="pb-hp-value-friendly"]')?.textContent?.trim() || null,
    primaryTops: primary.map((b) => (b ? Math.round(b.t) : null)),
    primaryBoxes: primary,
    primaryOrder: [...document.querySelectorAll('.pb-controls button[data-test]')].map((b) => b.dataset.test)
      .filter((id) => primaryIds.includes(id)),
    fullscreenInline: (() => {
      const inlineFs = document.querySelector('.pb-controls [data-test="pb-fullscreen"]')
      return !!inlineFs && inlineFs.getClientRects().length > 0
    })(),
    fullscreenCount: document.querySelectorAll('[data-test="pb-fullscreen"]').length,
    primaryMinSide: Math.min(...primary.filter(Boolean).map((b) => Math.min(b.w, b.h))),
    primaryHitAreas,
    tokens: {
      coarse: matchMedia('(pointer: coarse)').matches,
      compact: matchMedia('(pointer: coarse) and (orientation: landscape) and (height <= 520px)').matches,
      controlMd: token('--control-h-md'), hitComfortable: token('--hit-min-comfortable'), space2: token('--space-2'),
    },
    buttonCount: buttons.length,
    layout: ['.battle-playback', '.pb-hud', '.pb-main', '.pb-map-stage', '.pb-map', '.pb-transport-slot', '.pb-mobile-overlay', '.pb-mobile-overlay-content', '.pb-team-lane-left', '[data-test="pb-roster-row"]'].map((selector) => {
      const element = document.querySelector(selector)
      if (!element) return { selector }
      const style = getComputedStyle(element)
      return { selector, box: box(element), rows: style.gridTemplateRows, columns: style.gridTemplateColumns,
        gridRow: style.gridRow, position: style.position, display: style.display, flex: style.flex,
        padding: style.padding, margin: style.margin, border: style.borderWidth, gap: style.gap, minHeight: style.minHeight, maxHeight: style.maxHeight,
        scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, classes: element.className,
        squareAvailable: style.getPropertyValue('--pb-square-avail-h'), workspaceHeight: style.getPropertyValue('--pb-workspace-h') }
    }),
  }
}

function hudStressProbe(longTitle = false) {
  const box = (el) => {
    if (!el || !el.getClientRects().length) return null
    const r = el.getBoundingClientRect()
    return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }
  }
  const hud = document.querySelector('[data-test="pb-hud"]')
  if (!hud) return { missing: true }
  const map = hud.querySelector('[data-test="pb-hud-map"]')
  if (longTitle && map) {
    map.textContent = '异常长的地图名称用于验证截断优先级与完整战斗数据'
    void hud.offsetWidth
  }
  const center = hud.querySelector('[data-test="pb-hud-center"]')
  const teams = [...hud.querySelectorAll('[data-test="pb-hud-friendly"], [data-test="pb-hud-enemy"]')]
  const tracks = teams.map((el) => el.querySelector('.pb-hp-track'))
  const values = teams.map((el) => el.querySelector('.pb-hp-value'))
  const valueTextWidth = (el) => {
    if (!el) return 0
    const range = document.createRange()
    range.selectNodeContents(el)
    return range.getBoundingClientRect().width
  }
  const rects = { hud: box(hud), map: box(map), center: box(center), friendly: box(teams[0]), enemy: box(teams[1]) }
  const overlaps = (a, b) => !!a && !!b && a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5
  return {
    missing: false,
    width: hud.getBoundingClientRect().width,
    height: hud.getBoundingClientRect().height,
    tracks: tracks.map((el) => (el ? el.getBoundingClientRect().width : 0)),
    values: values.map((el) => (el ? el.textContent.trim() : '')),
    valueWidths: values.map((el) => (el ? el.getBoundingClientRect().width : 0)),
    valueTextWidths: values.map(valueTextWidth),
    baseCount: hud.querySelectorAll('[data-testid^="base-badge-"]').length,
    clock: hud.querySelector('[data-test="pb-hud-time"]')?.textContent?.trim() || '',
    score: hud.querySelector('[data-test="pb-hud-score"]')?.textContent?.trim() || '',
    title: map ? {
      text: map.textContent.trim(),
      width: map.getBoundingClientRect().width,
      scrollWidth: map.scrollWidth,
      overflow: getComputedStyle(map).overflow,
      textOverflow: getComputedStyle(map).textOverflow,
    } : null,
    rects,
    centerOverlapsTeam: overlaps(rects.center, rects.friendly) || overlaps(rects.center, rects.enemy),
    valueOverlapsCenter: overlaps(box(values[0]), rects.center) || overlaps(box(values[1]), rects.center),
    hudOverflowX: hud.scrollWidth > hud.clientWidth + 1,
    hudScrollWidth: hud.scrollWidth,
    hudClientWidth: hud.clientWidth,
    centerOverflowX: center ? center.scrollWidth > center.clientWidth + 1 : false,
  }
}


export { workspace2dProbe, hudStressProbe }
