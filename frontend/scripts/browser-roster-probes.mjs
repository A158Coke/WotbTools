function rosterGeometryProbe() {
  const rect = (el) => (el ? el.getBoundingClientRect() : null)
  const root = document.querySelector('.pb-root')
  const out = { root: !!root, errors: [], boxes: {} }
  if (!root) return out
  const scene = root.closest('[data-scene-surface]')
  const hitComfortable = parseFloat(getComputedStyle(scene || root).getPropertyValue('--hit-min-comfortable')) || 44
  out.hitComfortable = hitComfortable
  const rr = root.getBoundingClientRect()
  const transient = false
  const mobileRosterScroll = matchMedia('(width < 1200px) and (pointer: coarse)').matches
  out.portrait = root.classList.contains('portrait-flow')
  out.side = root.classList.contains('roster-side')
  out.phone = root.classList.contains('phone-form')
  out.viewport = { width: innerWidth, height: innerHeight }
  const rootStyle = getComputedStyle(root)
  const portraitScrolls = /auto|scroll/.test(rootStyle.overflowY)
    && root.scrollHeight > root.clientHeight + 1
  out.portraitScroll = {
    scrollH: root.scrollHeight, clientH: root.clientHeight, overflowY: rootStyle.overflowY, scrolls: portraitScrolls,
  }
  if (out.portrait && document.fullscreenElement && root.scrollHeight > root.clientHeight + 1 && !portraitScrolls) {
    out.errors.push(`portrait fullscreen content exceeds the viewport but cannot scroll: ${JSON.stringify(out.portraitScroll)}`)
  }
  const square = root.querySelector('.stage-square')?.getBoundingClientRect()
  out.square = square ? { w: square.width, h: square.height, l: square.left, r: square.right, t: square.top, b: square.bottom } : null
  if (!square || (out.portrait && Math.abs(square.width - square.height) > 1)) out.errors.push(`3D Stage is not square: ${JSON.stringify(out.square)}`)
  const stage = root.querySelector('.pb-stage')?.getBoundingClientRect()
  if (out.portrait && stage && square && stage.height < square.height - 1) {
    out.errors.push(`portrait Stage collapses around its square: stage=${stage.height}, square=${square.height}`)
  }
  const hud = root.querySelector('.hud')?.getBoundingClientRect()
  const transport = root.querySelector('.controls')?.getBoundingClientRect()
  const hudPanel = root.querySelector('.hud .pb-hud')
  const FLOATING_LAYOUT = root.classList.contains('roster-side') || root.classList.contains('portrait-flow')
  if (!FLOATING_LAYOUT && hudPanel && hud && Math.abs(hudPanel.getBoundingClientRect().width - hud.width) > 1) out.errors.push('HUD panel must span its center column')
  if (innerWidth >= 1200 && hudPanel && parseFloat(getComputedStyle(hudPanel.querySelector('.pb-hud-value')).fontSize) < 16) out.errors.push('desktop HUD values must use the enlarged type scale')
  const friendlyTeam = window.__pbPane?.store.friendlyTeam
  if ([1, 2].includes(friendlyTeam)) {
    for (const team of [1, 2]) {
      const expected = root.querySelector(`[data-test="pb-hp-fill-${team === friendlyTeam ? 'friendly' : 'enemy'}"]`)
      for (const fill of root.querySelectorAll(`.team${team} .pb-roster-hpfill`)) {
        if (expected && getComputedStyle(fill).backgroundColor !== getComputedStyle(expected).backgroundColor) out.errors.push(`Team ${team} HP must use Recorder relation color`)
      }
    }
  }
  if (stage && square) {
    const LEGACY_STACKED_GRID = false
    const style = getComputedStyle(root)
    const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0)
    const border = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0)
    const availableHeight = rr.height - padding - border - (hud?.height || 0) - (transport?.height || 0)
      - (parseFloat(getComputedStyle(root.querySelector('.pb-stage')).marginTop) || 0)
      - (parseFloat(getComputedStyle(root.querySelector('.pb-stage')).marginBottom) || 0)
    const expectedHeight = out.portrait ? stage.width : availableHeight
    if (LEGACY_STACKED_GRID && (Math.abs(square.width - stage.width) > 2 || Math.abs(square.height - expectedHeight) > 2)) {
      out.errors.push(`Stage must fill available center: ${JSON.stringify(out.square)}, available=${stage.width}x${expectedHeight}`)
    }
    if (LEGACY_STACKED_GRID && hud && transport) {
      const gaps = { hud: square.top - hud.bottom, transport: transport.top - square.bottom }
      out.stackGaps = gaps
      for (const [name, gap] of Object.entries(gaps)) {
        if (gap < -1 || gap > 16) out.errors.push(`central ${name} gap must remain compact (0–16px): ${gap.toFixed(1)}`)
      }
    }

    const FLOATING = out.side || out.portrait
    if (FLOATING) {
      const stageBox = root.querySelector('.pb-stage')?.getBoundingClientRect()
      const rr = root.getBoundingClientRect()
      if (stageBox) {
        const inside = stageBox.left >= rr.left - 0.5 && stageBox.right <= rr.right + 0.5
          && stageBox.top >= rr.top - 0.5 && stageBox.bottom <= rr.bottom + 0.5
        const fillsW = stageBox.width >= rr.width * 0.95
        if (!inside) out.errors.push(`floating: stage must sit inside the workspace: ${JSON.stringify({ stage: [Math.round(stageBox.left), Math.round(stageBox.top), Math.round(stageBox.width), Math.round(stageBox.height)], root: [Math.round(rr.left), Math.round(rr.top), Math.round(rr.width), Math.round(rr.height)] })}`)
        if (!out.portrait && !fillsW) out.errors.push(`floating: stage must fill the workspace width: ${stageBox.width.toFixed(1)} < ${(rr.width * 0.95).toFixed(1)}`)
      } else {
        out.errors.push('floating: .pb-stage missing')
      }
      const fpsBox = root.querySelector('[data-testid="replay3d-fps"]')?.getBoundingClientRect()
      const distBox = root.querySelector('[data-testid="scene-distance-slider"]')?.getBoundingClientRect()
      if (fpsBox && distBox && fpsBox.left < distBox.right && distBox.left < fpsBox.right && fpsBox.top < distBox.bottom && distBox.top < fpsBox.bottom) {
        out.errors.push('floating: FPS badge overlaps the distance slider')
      }
      const contentBottom = rr.top + Math.max(root.scrollHeight, root.clientHeight)
      const inRoot = (b) => b.left >= rr.left - 0.5 && b.right <= rr.right + 0.5 && b.top >= rr.top - 0.5
        && (b.bottom <= rr.bottom + 0.5 || (out.portraitScroll.scrolls && b.bottom <= contentBottom + 0.5))
      for (const [name, sel] of [['left', '.side-left'], ['right', '.side-right']]) {
        const lane = root.querySelector(sel)?.getBoundingClientRect()
        if (!lane) { out.errors.push(`floating: ${name} lane missing`); continue }
        if (!inRoot(lane)) {
          out.errors.push(`floating: ${name} lane outside the workspace: ${JSON.stringify({ lane: [Math.round(lane.left - rr.left), Math.round(lane.top - rr.top), Math.round(lane.width), Math.round(lane.height)], root: [Math.round(rr.width), Math.round(rr.height)] })}`)
        }
        const other = root.querySelector(sel === '.side-left' ? '.side-right' : '.side-left')?.getBoundingClientRect()
        if (out.side && other && lane.left < other.right - 0.5 && other.left < lane.right - 0.5) {
          out.errors.push(`floating: ${name} lane overlaps the opposite lane`)
        }
      }
      const hudBox = root.querySelector('.hud')?.getBoundingClientRect()
      if (out.side) {
        for (const [name, sel] of [['left', '.side-left'], ['right', '.side-right']]) {
          const lane = root.querySelector(sel)?.getBoundingClientRect()
          if (!hudBox || !lane) continue
          if (hudBox.left < lane.right - 0.5 && lane.left < hudBox.right - 0.5) {
            out.errors.push(`floating: HUD horizontally overlaps the ${name} lane: ${JSON.stringify({ hud: [Math.round(hudBox.left), Math.round(hudBox.right)], lane: [Math.round(lane.left), Math.round(lane.right)] })}`)
          }
        }
      } else {
        const firstLane = root.querySelector('.side-left, .side-right')?.getBoundingClientRect()
        if (hudBox && firstLane && hudBox.bottom > firstLane.top + 0.5) {
          out.errors.push(`floating portrait: HUD must sit above the lanes (hud.bottom=${Math.round(hudBox.bottom)} > lane.top=${Math.round(firstLane.top)})`)
        }
      }
      const controls = root.querySelector('.controls')?.getBoundingClientRect()
      if (!controls) {
        out.errors.push('floating: transport controls missing')
      } else if (!inRoot(controls)) {
        out.errors.push(`floating: transport controls outside the workspace: ${JSON.stringify([Math.round(controls.left - rr.left), Math.round(controls.top - rr.top), Math.round(controls.width), Math.round(controls.height)])}`)
      }
      if (out.phone && out.side && !transient) {
        const cs = getComputedStyle(root)
        const borders = ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth']
          .reduce((sum, key) => sum + (parseFloat(cs[key]) || 0), 0)
        if (borders > 0.5) out.errors.push(`phone landscape: scene frame border must be 0, got ${borders}px`)
        if ((parseFloat(cs.borderTopLeftRadius) || 0) > 0.5) {
          out.errors.push(`phone landscape: scene frame radius must be 0, got ${cs.borderTopLeftRadius}`)
        }
        if (rr.left > 1 || rr.right < window.innerWidth - 1) {
          out.errors.push(`phone landscape: scene must reach viewport edges, got ${Math.round(rr.left)}..${Math.round(rr.right)} of ${window.innerWidth}`)
        }
      }
      out.floatingChecked = true
    }
  }
  const portraitRoot = root.classList.contains('portrait-flow')
  const primaryIds = out.phone && portraitRoot
    ? ['pb-back5', 'pb-play', 'pb-fwd5', 'pb-speed-current', 'pb-secondary-entry']
    : ['pb-back5', 'pb-play', 'pb-fwd5', 'pb-speed-current', 'pb-fullscreen', 'pb-secondary-entry']
  const transportControls = root.querySelector('.pb-controls')
  const primary = primaryIds.map((id) => transportControls && transportControls.querySelector(`[data-test="${id}"]`))
  if (primary.some((element) => !element)) out.errors.push('shared primary controls must be present in transport')
  else {
    const boxes = primary.map((element) => element.getBoundingClientRect())
    const scrollY = window.scrollY
    transportControls.scrollIntoView({ block: 'center' })
    const hitProbe = (element) => {
      const r = element.getBoundingClientRect()
      const x = r.left + r.width / 2, y = r.top + r.height / 2
      const half = hitComfortable / 2 - 0.25
      return [[x, y], [x - half, y], [x + half, y], [x, y - half], [x, y + half]]
        .every(([px, py]) => {
          const hit = document.elementFromPoint(px, py)
          return hit === element || element.contains(hit)
        })
    }
    out.primaryHitAreas = primary.map(hitProbe)
    window.scrollTo(0, scrollY)
    const domOrder = [...transportControls.querySelectorAll('button[data-test]')]
      .map((element) => element.dataset.test).filter((id) => primaryIds.includes(id))
    if (JSON.stringify(domOrder) !== JSON.stringify(primaryIds)) out.errors.push(`primary control DOM order: ${domOrder.join(',')}`)
    if (boxes.some((box, index) => index > 0 && box.left < boxes[index - 1].right - 1)
      || boxes.some((box) => Math.abs(box.top - boxes[0].top) > 1)) out.errors.push('primary controls must stay in x-order on one row')
    if (out.phone) {
      if (boxes.some((box) => Math.min(box.width, box.height) < hitComfortable - 4.5)) {
        out.errors.push(`primary touch targets must provide ${hitComfortable}px hit area`)
      }
      if (out.primaryHitAreas.some((hit) => !hit)) out.errors.push('primary touch hit probes must reach every control edge')
    }
  }
  if (out.phone) {
    const inline = transportControls && transportControls.querySelector('[data-test="pb-fullscreen"]')
    const floating = root.querySelector('.scene-fs-btn.floating')
    if (portraitRoot) {
      if (inline && inline.getClientRects().length > 0) out.errors.push('phone portrait: fullscreen entry must not be inline in transport')
      if (!floating || floating.getClientRects().length === 0) out.errors.push('phone portrait: floating fullscreen entry missing')
    } else {
      if (!inline || inline.getClientRects().length === 0) out.errors.push('phone landscape: inline fullscreen entry missing from transport')
      if (floating && floating.getClientRects().length > 0) out.errors.push('phone landscape: floating fullscreen entry must be hidden')
    }
    const entries = root.querySelectorAll('[data-test="pb-fullscreen"]')
    if (entries.length !== 1) out.errors.push(`phone: expected exactly one fullscreen entry, got ${entries.length}`)
  }
  out.laneWidths = ['.side-left', '.side-right'].map((selector) => root.querySelector(selector)?.getBoundingClientRect().width ?? 0)
  out.centerWidth = root.querySelector('.hud')?.getBoundingClientRect().width ?? null
  out.laneIds = ['.side-left', '.side-right'].map((sel) => [...root.querySelectorAll(`${sel} .pl`)].map((el) => el.textContent.trim().split(/\s+/)[0]))
  out.rowsComplete = [...root.querySelectorAll('.team-lane .pl')].every((row) => {
    const bar = row.querySelector('[data-test="roster-hp"]')
    return ['pb-roster-player', 'pb-roster-tank']
      .every((test) => (row.querySelector(`[data-test="${test}"]`)?.textContent || '').trim().length > 0)
      && !!bar && (bar.getAttribute('aria-label') || '').trim().length > 0
  })
  out.hpBar = !!root.querySelector('.team-lane [data-test="roster-hp"]')
  const overlap = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5
    && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5
  const panels = {}
  const panelBottom = out.portraitScroll.scrolls
    ? rr.top + Math.max(root.scrollHeight, root.clientHeight)
    : rr.bottom
  for (const name of ['team1', 'team2', 'team-unknown']) {
    const el = document.querySelector('.' + name)
    const cs = el ? getComputedStyle(el) : null
    if (!el || cs.display === 'none' || el.getClientRects().length === 0) continue
    const b = rect(el)
    panels[name] = b
    out.boxes[name] = { l: +b.left.toFixed(1), t: +b.top.toFixed(1), r: +b.right.toFixed(1), b: +b.bottom.toFixed(1) }
    if (!transient && (b.left < rr.left - 0.5 || b.right > rr.right + 0.5 || b.top < rr.top - 0.5 || b.bottom > panelBottom + 0.5)) {
      out.errors.push(`${name} is outside pb-root (root=${JSON.stringify({ l: +rr.left.toFixed(1), t: +rr.top.toFixed(1), r: +rr.right.toFixed(1), b: +rr.bottom.toFixed(1) })})`)
    }
  }
  if (transient) {
    const surface = root.querySelector('.roster-surface').getBoundingClientRect()
    if (surface.left < rr.left - 0.5 || surface.right > rr.right + 0.5
      || surface.top < rr.top - 0.5 || surface.bottom > rr.bottom + 0.5) {
      out.errors.push('transient roster surface is outside pb-root')
    }
  }
  const hudBoxes = transient ? [] : [...document.querySelectorAll('.hud > *')].map(rect).filter(Boolean)
  for (const [name, b] of Object.entries(panels)) {
    hudBoxes.forEach((h, i) => {
      if (overlap(b, h)) out.errors.push(`${name} overlaps hud child #${i} (${JSON.stringify(h)})`)
    })
  }
  const controls = rect(document.querySelector('.controls'))
  if (controls && !FLOATING_LAYOUT) {
    for (const [name, b] of Object.entries(panels)) {
      if (overlap(b, controls)) out.errors.push(`${name} overlaps controls (${JSON.stringify(controls)})`)
    }
  }
  const pairs = [['team1', 'team2'], ['team1', 'team-unknown'], ['team2', 'team-unknown']]
  for (const [a, c] of pairs) {
    if (panels[a] && panels[c] && overlap(panels[a], panels[c])) out.errors.push(`${a} overlaps ${c}`)
  }
  const hpBars = [...document.querySelectorAll('.pl [data-test="roster-hp"]')]
  out.hpCells = hpBars.length
  for (const bar of hpBars) {
    const text = (bar.getAttribute('aria-label') || '').trim()
    const ok = /^\d+ \/ \d+$/.test(text) || /^\d+%$/.test(text) || text === '—'
    if (!ok) out.errors.push(`roster HP label has unexpected shape: ${JSON.stringify(text)}`)
    if (bar.clientWidth <= 0 || bar.clientHeight <= 0) {
      out.errors.push(`roster HP bar is not visible: ${JSON.stringify({ text, w: bar.clientWidth, h: bar.clientHeight })}`)
    }
  }
  const rows = [...document.querySelectorAll('.roster-surface .pl')].filter((el) => el.getClientRects().length > 0)
  out.rows = rows.length
  for (const row of rows) {
    const bar = row.querySelector('[data-test="roster-hp"]')
    if (!bar || !(bar.getAttribute('aria-label') || '').trim()) {
      out.errors.push(`roster row without HP bar: ${JSON.stringify(row.textContent)}`)
    }
    const reload = row.querySelector('[data-test="roster-reload"]')
    if (bar && reload) {
      const bb = bar.getBoundingClientRect()
      const rb = reload.getBoundingClientRect()
      if (Math.abs(rb.width - bb.width) > 1) out.errors.push(`roster reload must span the HP bar width: ${JSON.stringify({ hp: bb.width, reload: rb.width })}`)
      if (!(rb.height < bb.height - 1)) out.errors.push(`roster reload must be thinner than the HP bar: ${JSON.stringify({ hp: bb.height, reload: rb.height })}`)
    }
    if (!transient && !mobileRosterScroll) {
      const r = row.getBoundingClientRect()
      const group = row.closest('.team').getBoundingClientRect()
      if (r.top < group.top - 0.5 || r.bottom > group.bottom + 0.5
        || r.top < rr.top - 0.5 || r.bottom > rr.bottom + 0.5) {
        out.errors.push(`wide roster row is clipped: ${JSON.stringify(row.textContent)}`)
      }
    }
  }

  if (!transient && out.rows >= 5) {
    const sections = [...root.querySelectorAll('.roster-surface .pb-roster-team')]
      .filter((el) => el.getClientRects().length > 0)
    for (const section of sections) {
      const head = section.querySelector('.pb-team-head')
      const list = section.querySelector('.pb-roster-list')
      const sectionRows = [...list.querySelectorAll('.pl')].filter((el) => el.getClientRects().length > 0)
      if (!head || sectionRows.length < 5) continue
      const sr = section.getBoundingClientRect()
      const hr = head.getBoundingClientRect()
      const lr = list.getBoundingClientRect()
      const first = sectionRows[0].getBoundingClientRect()
      const last = sectionRows[sectionRows.length - 1].getBoundingClientRect()
      if (hr.bottom > lr.top + 1) out.errors.push('roster header must sit above the list')
      const listShare = lr.height / Math.max(1, sr.height)
      if (listShare < 0.6) out.errors.push(`roster list must consume the section's remaining height: ${JSON.stringify({ listShare: +listShare.toFixed(3), section: sr.height, list: lr.height })}`)
      if (first.top - lr.top > Math.max(6, lr.height * 0.06)) out.errors.push(`first roster row must start near the list top: ${JSON.stringify({ gap: +(first.top - lr.top).toFixed(1) })}`)
      if (lr.bottom - last.bottom > Math.max(6, lr.height * 0.06)) out.errors.push(`last roster row must end near the list bottom: ${JSON.stringify({ gap: +(lr.bottom - last.bottom).toFixed(1) })}`)
      const gaps = []
      for (let i = 1; i < sectionRows.length; i++) {
        gaps.push(sectionRows[i].getBoundingClientRect().top - sectionRows[i - 1].getBoundingClientRect().bottom)
      }
      const minGap = Math.min(...gaps)
      const maxGap = Math.max(...gaps)
      if (maxGap - minGap > Math.max(4, maxGap * 0.25)) {
        out.errors.push(`roster row spacing must be roughly even: ${JSON.stringify({ minGap: +minGap.toFixed(1), maxGap: +maxGap.toFixed(1) })}`)
      }
      out.rosterFill = { listShare: +listShare.toFixed(3), minGap: +minGap.toFixed(1), maxGap: +maxGap.toFixed(1), rows: sectionRows.length }
    }
  }
  for (const element of root.querySelectorAll('.team, .team-lane, .roster')) {
    const style = getComputedStyle(element)
    if (['auto', 'scroll'].includes(style.overflowY) && element.scrollHeight > element.clientHeight + 1) {
      if (!(mobileRosterScroll && element.classList.contains('pb-roster-list'))) out.errors.push(`independent/nested roster scroll: ${element.className}`)
      else {
        const previous = element.scrollTop
        element.scrollTop = element.scrollHeight
        const last = element.lastElementChild.getBoundingClientRect()
        const bounds = element.getBoundingClientRect()
        if (last.bottom > bounds.bottom + 1 || last.top < bounds.top - 1) out.errors.push('last mobile roster row cannot be reached by scrolling')
        element.scrollTop = previous
      }
    }
  }
  if (!transient) {
    const surface = root.querySelector('.roster-surface')
    if (surface && ['auto', 'scroll'].includes(getComputedStyle(surface).overflowY)
      && surface.scrollHeight > surface.clientHeight + 1) out.errors.push('normal wide roster requires scrolling')
  }

  if (out.phone && !transient) {
    const box = (el) => (el && el.getClientRects().length ? el.getBoundingClientRect() : null)
    const toolbar = box(document.querySelector('.toolbar'))
    const controlsBox = box(document.querySelector('.controls'))
    const rootH = rr.height
    const toolbarEl = document.querySelector('.toolbar')
    const toolbarChildren = toolbarEl
      ? [...toolbarEl.children]
        .filter((el) => el.getClientRects().length > 0)
        .map((el) => ({
          label: el.querySelector('[data-testid="display-toggle"]')
            ? 'display'
            : (el.dataset.testid || el.className || el.tagName).toString(),
          w: +el.getBoundingClientRect().width.toFixed(1),
        }))
      : []
    out.compact = {
      rootH: +rootH.toFixed(1),
      controlsH: controlsBox ? +controlsBox.height.toFixed(1) : null,
      parts: controlsBox ? (() => {
        const controlsEl = document.querySelector('.controls')
        const part = (sel) => {
          const el = controlsEl.querySelector(sel)
          return el && el.getClientRects().length ? +el.getBoundingClientRect().height.toFixed(1) : null
        }
        return {
          timeline: part('.pb-progress'),
          row: part('.pb-controls'),
          play: part('.pb-play-btn'),
          time: part('.pb-time'),
          speed: part('[data-test="pb-speed-current"]'),
          step: part('[data-test="pb-fwd5"]'),
          gap: getComputedStyle(controlsEl).rowGap,
          pad: getComputedStyle(controlsEl).paddingTop,
        }
      })() : null,
      toolbarChildren,
      speedButtons: document.querySelectorAll('.pb-speed .pb-btn').length,
      speedPicker: !!box(document.querySelector('[data-test="pb-speed-current"]')),
      displayEntry: !!box(document.querySelector('[data-testid="display-toggle"]')),
    }
    if (!out.compact.displayEntry) out.errors.push('compact: display entry point is not visible')
    const extra = toolbarChildren.filter((c) => c.label !== 'display').map((c) => c.label)
    if (extra.length) out.errors.push(`compact: secondary controls still permanent on the toolbar: ${extra.join(', ')}`)
    if (document.querySelectorAll('.pb-speed .pb-btn').length > 0) {
      out.errors.push(`compact: ${out.compact.speedButtons} permanent speed buttons (must be progressive disclosure)`)
    }
    if (!out.compact.speedPicker) out.errors.push('compact: current-speed control is missing')
    if (controlsBox) {
      if (!FLOATING_LAYOUT) {
        const sceneH = rootH - controlsBox.height
        out.compact.sceneH = +sceneH.toFixed(1)
        if (sceneH < rootH * 0.55) {
          out.errors.push(`compact: controls take too much scene height (scene=${sceneH.toFixed(1)} of root=${rootH.toFixed(1)}; controls=${controlsBox.height.toFixed(1)}; parts=${JSON.stringify(out.compact.parts)})`)
        }
      }
    } else {
      out.errors.push('compact: playback controls missing')
    }
  }
  return out
}

function sceneDistanceProbe() {
  const root = document.querySelector('.pb-root')
  const slider = root && root.querySelector('[data-testid="scene-distance-slider"]')
  const box = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return {
      l: +r.left.toFixed(2), t: +r.top.toFixed(2), r: +r.right.toFixed(2), b: +r.bottom.toFixed(2),
      w: +r.width.toFixed(2), h: +r.height.toFixed(2),
    }
  }
  const out = {
    present: !!slider,
    root: !!root,
    viewport: { width: innerWidth, height: innerHeight },
    errors: [],
  }
  if (!root || !slider) return out
  const overlap = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5
  out.rootBox = box(root)
  out.pageScroll = { x: scrollX, y: scrollY }
  out.slider = box(slider)
  out.track = box(slider.querySelector('.scene-dist-track'))
  out.controls = box(root.querySelector('.controls'))
  out.fps = box(root.querySelector('.pb-fps'))
  out.labels = [...slider.querySelectorAll('.scene-dist-label')].map((el) => {
    const style = getComputedStyle(el)
    return { text: (el.textContent || '').trim(), ...box(el), writingMode: style.writingMode, textOrientation: style.textOrientation }
  })
  const lane = root.querySelector('.side-right')
  out.lane = box(lane)
  const rows = [...root.querySelectorAll('.side-right .pb-roster-row')]
  out.rows = rows.length
  out.rowBoxes = rows.map((row, index) => ({
    index,
    ...box(row),
    hp: box(row.querySelector('.pb-roster-hpfill')),
  }))
  out.last3 = out.rowBoxes.slice(-3)
  out.rowOverlap = out.rowBoxes.filter((row) => overlap(out.slider, row)).map((row) => row.index)
  out.labelOverlap = out.labels.flatMap((label, labelIndex) => out.rowBoxes
    .filter((row) => overlap(label, row))
    .map((row) => ({ label: labelIndex, row: row.index })))
  out.laneOverlap = out.lane ? overlap(out.slider, out.lane) : false
  out.rowHits = rows.map((row, index) => {
    const r = row.getBoundingClientRect()
    const target = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return { index, hit: target === row || row.contains(target) }
  })
  out.labelHits = [...slider.querySelectorAll('.scene-dist-label')].map((label, index) => {
    const r = label.getBoundingClientRect()
    const target = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return { index, hit: target === label || slider.contains(target) }
  })
  out.inViewport = out.slider.l >= -0.5 && out.slider.r <= innerWidth + 0.5
    && out.slider.t >= -0.5 && out.slider.b <= innerHeight + 0.5
  out.hpOverlap = out.rowBoxes
    .filter((row) => row.hp && overlap(out.slider, row.hp))
    .map((row) => row.index)
  out.laneScroll = lane ? {
    scrollH: lane.scrollHeight,
    clientH: lane.clientHeight,
    scrolls: lane.scrollHeight > lane.clientHeight + 1,
  } : null
  out.overflowX = document.documentElement.scrollWidth > innerWidth + 1
  return out
}

const DISTANCE_LABELS = {
  zh: ['近', '远'],
  en: ['Near', 'Far'],
  ru: ['Ближе', 'Дальше'],
}

function sceneDistanceViolations(dist, scenario, viewport) {
  const errors = []
  if (!dist.present || !dist.root) return ['distance slider missing']
  if (dist.rows !== 7) errors.push(`expected 7 enemy rows, got ${dist.rows}`)
  if (!dist.slider || dist.slider.h > 64) errors.push(`slider too tall: ${JSON.stringify(dist.slider)}`)
  if (!dist.track || dist.track.h < 40) errors.push(`slider track too short for touch: ${JSON.stringify(dist.track)}`)
  if (dist.rowOverlap.length) errors.push(`slider overlaps roster rows ${JSON.stringify(dist.rowOverlap)}`)
  if (dist.labelOverlap.length) errors.push(`slider labels overlap roster rows ${JSON.stringify(dist.labelOverlap)}`)
  if (dist.hpOverlap.length) errors.push(`slider overlaps HP bars of rows ${JSON.stringify(dist.hpOverlap)}`)
  if (dist.laneOverlap) errors.push('slider overlaps right roster lane')
  if (!dist.laneScroll || dist.laneScroll.scrolls) errors.push(`right roster must not scroll: ${JSON.stringify(dist.laneScroll)}`)
  if (!dist.rowHits.every((row) => row.hit)) errors.push(`roster rows not hit-testable: ${JSON.stringify(dist.rowHits)}`)
  if (dist.labelHits.length !== 2 || !dist.labelHits.every((label) => label.hit)) errors.push(`slider labels not hit-testable: ${JSON.stringify(dist.labelHits)}`)
  if (!dist.inViewport) errors.push(`slider outside viewport: ${JSON.stringify(dist.slider)}`)
  if (dist.slider.l < -0.5 || dist.slider.r > viewport.width + 0.5) errors.push('slider crosses viewport horizontally')
  if (dist.controls && dist.slider.b > dist.controls.t + 0.5) errors.push(`slider overlaps transport: slider=${JSON.stringify(dist.slider)} controls=${JSON.stringify(dist.controls)}`)
  if (dist.overflowX) errors.push('page has horizontal overflow')
  const labels = DISTANCE_LABELS[scenario.locale ?? 'zh'] || DISTANCE_LABELS.zh
  const texts = dist.labels.map((label) => label.text)
  if (texts[0] !== labels[0] || texts[1] !== labels[1]) errors.push(`distance labels wrong: ${JSON.stringify(texts)}`)
  if (!dist.labels.every((label) => label.w > 0 && label.h > 0 && label.h <= 24)) errors.push(`distance labels are not compact: ${JSON.stringify(dist.labels)}`)
  if (!dist.labels.every((label) => label.writingMode === 'horizontal-tb')) errors.push(`distance labels must be horizontal: ${JSON.stringify(dist.labels.map((label) => label.writingMode))}`)
  return errors
}

function displayPanelProbe() {
  const root = document.querySelector('.pb-root')
  const out = { root: !!root, errors: [], panel: null }
  if (!root) return out
  const rr = root.getBoundingClientRect()
  const panel = document.querySelector('[data-testid="display-panel"]')
  if (!panel) { out.errors.push('display panel not open'); return out }
  const pb = panel.getBoundingClientRect()
  out.panel = { l: +pb.left.toFixed(1), t: +pb.top.toFixed(1), r: +pb.right.toFixed(1), b: +pb.bottom.toFixed(1) }
  if (root.classList.contains('portrait-flow')) {
    const controls = document.querySelector('.controls')?.getBoundingClientRect()
    const square = document.querySelector('.stage-square')?.getBoundingClientRect()
    if (getComputedStyle(panel).position !== 'static') out.errors.push('portrait display panel must be an in-flow block')
    if (controls && pb.top < controls.bottom - 1) out.errors.push('portrait display panel must follow the transport')
    if (square && pb.top < square.bottom - 1) out.errors.push('portrait display panel must not cover the Stage')
    for (const id of ['disp-topbar', 'disp-roster', 'disp-killfeed', 'disp-base', 'disp-player', 'disp-tank', 'disp-hp', 'disp-reload', 'disp-glb', 'hide-all-ui']) {
      if (!document.querySelector(`[data-testid="${id}"]`)) out.errors.push(`display panel control missing: ${id}`)
    }
    return out
  }
  const visTop = Math.max(rr.top, 0)
  const visBottom = Math.min(rr.bottom, document.documentElement.clientHeight)
  if (pb.left < -0.5 || pb.top < visTop - 0.5
    || pb.right > document.documentElement.clientWidth + 0.5 || pb.bottom > visBottom + 0.5) {
    out.errors.push(`display panel outside visible pane: ${JSON.stringify(out.panel)} visible=[${visTop.toFixed(1)},${visBottom.toFixed(1)}]`)
  }
  if (pb.height < 60) {
    out.errors.push(`display panel too short to be usable: ${Math.round(pb.height)}px`)
  }
  if (pb.height > visBottom - visTop - 8) {
    out.errors.push(`display panel taller than the visible pane: ${Math.round(pb.height)}px`)
  }
  const gear = root.querySelector('[data-testid="display-toggle"]')?.getBoundingClientRect()
  if (!gear) out.errors.push('display anchor gear missing')
  else {
    const distanceX = Math.max(0, pb.left - gear.right, gear.left - pb.right)
    const distanceY = Math.max(0, pb.top - gear.bottom, gear.top - pb.bottom)
    if (Math.hypot(distanceX, distanceY) > 16) out.errors.push(`Display must stay anchored to gear: distance=${Math.hypot(distanceX, distanceY).toFixed(1)}`)
  }
  if (pb.left < rr.left - 1 || pb.right > rr.right + 1) out.errors.push('Display exceeds workspace width')
  if (innerWidth >= 1600 && innerHeight >= 900 && panel.scrollHeight > panel.clientHeight + 1) {
    out.errors.push(`standard Display must not scroll on large screens: ${panel.scrollHeight} > ${panel.clientHeight}`)
  }
  for (const id of ['disp-topbar', 'disp-roster', 'disp-killfeed', 'disp-base', 'disp-player', 'disp-tank', 'disp-hp', 'disp-reload', 'disp-glb', 'hide-all-ui']) {
    const el = document.querySelector(`[data-testid="${id}"]`)
    if (!el) { out.errors.push(`display panel control missing: ${id}`); continue }
    const hit = id === 'hide-all-ui' ? el : el.closest('label')
    if (!hit) { out.errors.push(`display panel control has no label hit area: ${id}`); continue }
    const r = hit.getBoundingClientRect()
    if (r.width < 20 || r.height < 20) {
      out.errors.push(`display panel control hit area too small: ${id} (${Math.round(r.width)}x${Math.round(r.height)})`)
    }
  }
  return out
}

function workspaceColumnsProbe() {
  const root = document.querySelector('.pb-root')
  if (!root) return { root: false }
  const box = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return {
      left: +r.left.toFixed(1), right: +r.right.toFixed(1),
      top: +r.top.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1),
    }
  }
  const main = root.querySelector('.pb-main')
  const left = box(root.querySelector('.side-left'))
  const right = box(root.querySelector('.side-right'))
  const square = box(document.querySelector('.stage-square'))
  const hud = box(root.querySelector('.hud'))
  const controls = box(root.querySelector('.controls'))
  const rootBox = box(root)
  const mainBox = box(main)
  const cs = getComputedStyle(root)
  const padL = parseFloat(cs.paddingLeft) || 0
  const padR = parseFloat(cs.paddingRight) || 0
  const contentW = +(root.clientWidth - padL - padR).toFixed(1)
  const centerW = hud ? hud.w : null
  const laneGutter = left && hud ? +(hud.left - left.right).toFixed(1) : null
  return {
    root: true,
    portrait: root.classList.contains('portrait-flow'),
    rosterSide: root.classList.contains('roster-side'),
    laneCount: root.querySelectorAll('.team-lane').length,
    columns: cs.gridTemplateColumns,
    left, right, square, hud, controls, rootBox, mainBox, contentW, centerW, laneGutter,
    laneW: left ? +left.w.toFixed(1) : null,
    rootW: rootBox ? +rootBox.w.toFixed(1) : null,
  }
}

function rosterLayoutSignature() {
  const root = document.querySelector('.pb-root')
  if (!root) return null
  const lane = root.querySelector('.team-lane')
  const controls = root.querySelector('.controls')
  const box = (el) => (el ? [Math.round(el.getBoundingClientRect().top), Math.round(el.getBoundingClientRect().height)].join(',') : '-')
  return [
    box(root),
    box(lane),
    box(controls),
    root.style.getPropertyValue('--pb-workspace-h'),
    root.className,
  ].join('|')
}


export { rosterGeometryProbe, sceneDistanceProbe, sceneDistanceViolations, displayPanelProbe, workspaceColumnsProbe, rosterLayoutSignature }
