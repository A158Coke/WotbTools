const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function dispatchTouchStroke(page, points) {
  const [first, ...rest] = points
  await page.client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ ...first, id: 7, radiusX: 3, radiusY: 3, force: 1 }],
  }, page.sessionId)
  for (const point of rest) {
    await page.client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ ...point, id: 7, radiusX: 3, radiusY: 3, force: 1 }],
    }, page.sessionId)
    await delay(30)
  }
  await page.client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, page.sessionId)
}

export async function verifyMapPreviewTouchDrawing(page) {
  const pen = await page.probe(() => {
    const button = document.querySelector('[data-testid="map-2d-annotations"] [data-test="pb-annot-pen"]')
    if (!button) return null
    const rect = button.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })
  if (!pen) throw new Error('pen tool missing for real touch stroke')
  await page.tap({ ...pen, touch: true })
  await page.waitForValue(
    `document.querySelector('[data-testid="map-2d-annotations"] [data-test="pb-annot-pen"]').getAttribute('aria-pressed')`,
    (value) => value === 'true',
    { label: 'pen tool selected' },
  )
  const stroke = await page.probe(() => {
    const stage = document.querySelector('[data-testid="map-2d-stage"]')
    window.__mapTouchTrace = []
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
      stage.addEventListener(type, (event) => window.__mapTouchTrace.push({ type, pointerType: event.pointerType, x: event.clientX, y: event.clientY }), true)
    }
    const rect = stage.getBoundingClientRect()
    return [0.36, 0.44, 0.53, 0.62].map((x, index) => ({ x: rect.left + rect.width * x, y: rect.top + rect.height * (0.43 + index * 0.04) }))
  })
  await dispatchTouchStroke(page, stroke)
  try {
    await page.waitForValue(`document.querySelectorAll('[data-test="pb-annotations"] .pb-annot-item').length`, (value) => value === 1, { label: 'touch stroke committed', timeout: 5000 })
  } catch {
    const state = await page.probe(() => ({
      count: document.querySelectorAll('[data-test="pb-annotations"] .pb-annot-item').length,
      tool: document.querySelector('[data-testid="map-2d-annotations"] [data-test="pb-annot-pen"]')?.getAttribute('aria-pressed'),
      trace: window.__mapTouchTrace,
    }))
    throw new Error(`touch stroke not committed: ${JSON.stringify(state)}; errors=${JSON.stringify(page.consoleErrors)}`)
  }
  const drawing = await page.probe(() => {
    const line = document.querySelector('[data-test="pb-annotations"] .pb-annot-item[data-annotation-type="pen"] polyline')
    return { connected: !!line?.isConnected, points: line?.getAttribute('points') || '' }
  })
  const pointCount = drawing.points.trim().split(/\s+/).length
  if (!drawing.connected || pointCount < 2) throw new Error(`touch stroke did not render: ${JSON.stringify(drawing)}`)
  console.log(`[PASS] phone-390x844 real touch stroke committed (${pointCount} points)`)
}

export async function verifyMapPreviewCanvasPersistence(page, scenario) {
  await page.waitForValue(`!!window.__mapPreviewPane.sceneApi && !!document.querySelector('[data-testid="map-3d-stage"] canvas')`, Boolean,
    { label: '3D scene canvas attached', timeout: 15000 })
  await page.evaluate(`window.__mapPreviewCanvasBeforeSwitch = document.querySelector('[data-testid="map-3d-stage"] canvas')`)
  const tapMode = async (testId) => {
    const point = await page.evaluate(`(() => {
      const element = document.querySelector('[data-testid="${testId}"]')
      const rect = element.getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    })()`)
    await page.tap({ ...point, touch: scenario.touch })
  }
  await tapMode('map-mode-2d')
  await page.waitForValue(`!!document.querySelector('[data-testid="map-2d-stage"]')`, Boolean, { label: '2D pane shown during canvas persistence check' })
  await tapMode('map-mode-3d')
  await page.waitForValue(`!!document.querySelector('[data-testid="map-3d-stage"] canvas')`, Boolean, { label: '3D pane restored after mode switch' })
  const retained = await page.probe(() => {
    const stage = document.querySelector('[data-testid="map-3d-stage"]')
    const canvas = stage?.querySelector('canvas')
    return !!canvas && canvas === window.__mapPreviewCanvasBeforeSwitch
      && canvas.isConnected && getComputedStyle(stage.closest('.map-stage-pane')).display !== 'none'
  })
  if (!retained) throw new Error(`${scenario.name} 3D canvas was replaced or detached across mode switch`)
  console.log(`[PASS] map-3d-${scenario.name} canvas retained across 2D/3D mode switch`)
}
