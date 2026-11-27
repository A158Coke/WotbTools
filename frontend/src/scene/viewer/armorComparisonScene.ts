import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { armorCompareWidth } from './armorComparisonModel.js'
import type { ArmorComparisonChoice, ComparisonSide } from './armorComparisonModel.js'
import { createArmorThicknessScene, loadArmorComparisonModels, disposeArmorComparisonModels } from './armorComparisonLayer.js'
import type { ComparisonLayer, Models, Source, SurfaceSample } from './armorComparisonLayer.js'

export { createArmorThicknessScene, loadArmorComparisonModels, disposeArmorComparisonModels }
export type { ComparisonLayer, Models, Source }


export type ArmorComparisonLabel = {
  key: string
  side: ComparisonSide
  /** 附着点：板件表面上朝向相机的采样点（世界坐标），由场景投影到屏幕。 */
  x: number
  y: number
  /** 同一块板的两侧数值；单值 = 只在一侧存在（新增/移除）。 */
  left: number | null
  right: number | null
  kind: string | null
  plate: string
  module: string
}

function traceChip(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2)
  context.beginPath()
  context.moveTo(x + radius, y)
  context.lineTo(x + w - radius, y)
  context.arcTo(x + w, y, x + w, y + radius, radius)
  context.lineTo(x + w, y + h - radius)
  context.arcTo(x + w, y + h, x + w - radius, y + h, radius)
  context.lineTo(x + radius, y + h)
  context.arcTo(x, y + h, x, y + h - radius, radius)
  context.lineTo(x, y + radius)
  context.arcTo(x, y, x + radius, y, radius)
  context.closePath()
}

export function mountArmorComparison(
  host: HTMLDivElement,
  sources: [Source, Source],
  models: [Models, Models],
  contextLost: () => void,
  onInspect: (plate: { side: ComparisonSide; thickness: number } | null) => void,
  formatLabel: (label: ArmorComparisonLabel) => string = label => `#${label.plate}`,
  onIsolateRequest: (key: string) => void = () => {},
) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  const canvas = renderer.domElement
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000)
  camera.position.set(-1, 0.6, -1.4)
  const controls = new OrbitControls(camera, canvas)
  controls.enablePan = false
  controls.enableZoom = true
  controls.zoomSpeed = 0.6
  canvas.style.touchAction = 'pan-y'
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  const projected = new THREE.Vector3()
  const viewDir = new THREE.Vector3()
  const attachPoint = new THREE.Vector3()
  let width = 0
  let height = 0
  let pixelRatio = 1
  let percent = 50
  let isolatedKeys: string[] | null = null
  let chipRects: Array<{ key: string; x: number; y: number; w: number; h: number }> = []
  let layers: [ComparisonLayer, ComparisonLayer] | null = null
  let bounds = new THREE.Box3()

  // 旁注画布：与 WebGL 同一帧内同步绘制（旋转/缩放零延迟），DOM 只承载版本角标与悬停读数。
  const overlay = document.createElement('canvas')
  overlay.className = 'vd-armor-annotation'
  overlay.setAttribute('aria-hidden', 'true')
  overlay.style.position = 'absolute'
  overlay.style.inset = '0'
  overlay.style.inlineSize = '100%'
  overlay.style.blockSize = '100%'
  overlay.style.pointerEvents = 'none'

  function themeColor(name: string, fallback: string): string {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    return raw || fallback
  }

  function attachAnchor(anchor: ComparisonLayer['anchors'][number]): { x: number; y: number } {
    // 朝向相机的表面采样点里取离相机最近的——保证引线端点钉在板件可见表面上。
    let best: SurfaceSample | null = null
    let bestDistance = Number.POSITIVE_INFINITY
    for (const sample of anchor.samples) {
      viewDir.subVectors(camera.position, sample.pos)
      if (viewDir.dot(sample.normal) <= 0) continue
      const distance = viewDir.lengthSq()
      if (distance < bestDistance) {
        bestDistance = distance
        best = sample
      }
    }
    // 全部样本都背对相机（板件接近侧立）时，退回首个采样点兜底。
    attachPoint.copy(best ? best.pos : anchor.samples[0].pos)
    projected.copy(attachPoint).project(camera)
    return {
      x: (projected.x * 0.5 + 0.5) * width,
      y: (0.5 - projected.y * 0.5) * height,
    }
  }

  function drawAnnotations() {
    const context = overlay.getContext('2d')
    if (!context) return
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    context.clearRect(0, 0, width, height)
    chipRects = []
    if (!layers) return
    type Candidate = {
      side: ComparisonSide
      anchor: ComparisonLayer['anchors'][number]
      attach: { x: number; y: number }
      fits: boolean
    }
    // 同一块板在两个版本里投影到几乎同一屏幕位置：按 key 合并成一条旁注，
    // 文案同时带修改前后数值；引线端点取"当前分割下可见的那一侧"的板件。
    const byKey = new Map<string, Candidate>()
    layers.forEach((layer, index) => {
      const side = index as ComparisonSide
      for (const anchor of layer.anchors) {
        const attach = attachAnchor(anchor)
        const fits = side === 0 ? attach.x <= armorCompareWidth(width, percent) : attach.x >= armorCompareWidth(width, percent)
        const prev = byKey.get(anchor.key)
        if (!prev || (!prev.fits && fits)) byKey.set(anchor.key, { side, anchor, attach, fits })
      }
    })
    if (!byKey.size) return
    const lineColor = themeColor('--color-accent', '#3d8bff')
    const chipBackground = themeColor('--color-surface-1', '#ffffff')
    const chipBorder = themeColor('--color-border-strong', '#8a8f98')
    const textColor = themeColor('--color-text-primary', '#222')
    // 隔离激活时：选中板件的旁注保持全亮，其余板件的旁注/引线淡出。
    const active = isolatedKeys && isolatedKeys.length ? new Set(isolatedKeys) : null
    const rowHeight = 20
    const columnWidth = 112
    context.font = '600 11px system-ui, sans-serif'
    context.lineWidth = 1
    context.strokeStyle = lineColor
    context.fillStyle = lineColor
    for (const side of [0, 1] as const) {
      const items = [...byKey.values()]
        .filter(candidate => candidate.side === side)
        .sort((a, b) => a.attach.y - b.attach.y)
      let previous = 8
      items.forEach((item, index) => {
        const min = previous + rowHeight
        const max = height - 4 - (items.length - 1 - index) * rowHeight
        const labelY = Math.min(Math.max(item.attach.y - rowHeight / 2, min), Math.max(min, max))
        previous = labelY
        const text = formatLabel({
          key: item.anchor.key, side, x: item.attach.x, y: item.attach.y,
          left: item.anchor.left, right: item.anchor.right,
          kind: item.anchor.kind, plate: item.anchor.plate, module: item.anchor.module,
        })
        const textWidth = context.measureText(text).width
        const chipWidth = Math.min(textWidth + 12, columnWidth - 8)
        const chipX = side === 0 ? 4 : width - 4 - chipWidth
        const chipY = labelY
        chipRects.push({ key: item.anchor.key, x: chipX, y: chipY, w: chipWidth, h: rowHeight - 2 })
        const lineStartX = side === 0 ? 4 + chipWidth : chipX
        const lineStartY = chipY + rowHeight / 2
        const selected = !active || active.has(item.anchor.key)
        context.globalAlpha = selected ? 1 : 0.3
        context.beginPath()
        context.moveTo(lineStartX, lineStartY)
        context.lineTo(item.attach.x, item.attach.y)
        context.stroke()
        context.beginPath()
        context.arc(item.attach.x, item.attach.y, 2.5, 0, Math.PI * 2)
        context.fill()
        traceChip(context, chipX, chipY, chipWidth, rowHeight - 2, 4)
        context.globalAlpha = (selected ? 1 : 0.3) * 0.92
        context.fillStyle = chipBackground
        context.fill()
        context.globalAlpha = selected ? 1 : 0.3
        context.strokeStyle = chipBorder
        context.stroke()
        context.fillStyle = textColor
        context.fillText(text, chipX + 6, chipY + 13)
        context.globalAlpha = 1
        context.strokeStyle = lineColor
        context.fillStyle = lineColor
      })
    }
  }

  function draw() {
    if (!width || !height) return
    const split = armorCompareWidth(width, percent)
    if (layers) {
      renderer.setScissorTest(true)
      renderer.setViewport(0, 0, width, height)
      if (split > 0) {
        renderer.setScissor(0, 0, split, height)
        renderer.render(layers[0].scene, camera)
      }
      if (split < width) {
        renderer.setScissor(split, 0, width - split, height)
        renderer.render(layers[1].scene, camera)
      }
    }
    drawAnnotations()
  }

  // 隔离效果 = 装甲查看器厚度模式点击板件（applyArmorHighlight）的同一套数值：
  // 选中板 opacity 1；其余装甲板 0.18、模块网格（炮管/履带）0.15，且不写深度（几乎透明）。
  function applyIsolation() {
    const active = isolatedKeys && isolatedKeys.length ? new Set(isolatedKeys) : null
    layers?.forEach(layer => {
      for (const plate of layer.plates) {
        const mesh = plate as THREE.Mesh
        const material = mesh.material as THREE.MeshBasicMaterial
        const key = String(mesh.userData.armorKey || '')
        const isModule = key.startsWith('chassis:') || key.startsWith('gunBarrel:')
        let opacity: number
        let depthWrite: boolean
        if (!active) {
          opacity = Number(material.userData.baseOpacity ?? 1)
          depthWrite = Boolean(material.userData.baseDepthWrite ?? true)
        } else if (active.has(key)) {
          opacity = 1
          depthWrite = true
        } else {
          opacity = isModule ? 0.15 : 0.18
          depthWrite = false
        }
        const transparent = opacity < 1
        if (material.transparent !== transparent || material.depthWrite !== depthWrite
          || material.opacity !== opacity) {
          material.transparent = transparent
          material.opacity = opacity
          material.depthWrite = depthWrite
          material.needsUpdate = true
        }
        for (const child of mesh.children) {
          if ((child as THREE.LineSegments).isLineSegments) child.visible = !active || active.has(key)
        }
      }
    })
    draw()
  }

  function fit() {
    if (bounds.isEmpty()) return
    const sphere = bounds.getBoundingSphere(new THREE.Sphere())
    // 取景与装甲查看器厚度模式（tankTransport）同口径：方位 0、炮线高度、
    // target = 车体原点上的炮线——旋转中心与查看器一致，手感不再偏移。
    const maxDim = Math.max(
      bounds.max.x - bounds.min.x,
      bounds.max.y - bounds.min.y,
      bounds.max.z - bounds.min.z,
    )
    const gunLine = layers ? layers[1].gunLine : 0
    const distance = Math.max(4, maxDim * 0.95)
    controls.target.set(0, gunLine, 0)
    camera.position.set(0, gunLine, -distance)
    // 缩放范围相对模型尺寸钳制，滚轮再大也飞不出模型、再小也穿不进装甲。
    controls.minDistance = Math.max(1.2, sphere.radius * 0.4)
    controls.maxDistance = Math.max(20, sphere.radius * 8)
    controls.update()
    draw()
  }

  function resize() {
    width = host.clientWidth
    height = host.clientHeight
    if (!width || !height) return
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
    renderer.setPixelRatio(pixelRatio)
    renderer.setSize(width, height, false)
    overlay.width = Math.round(width * pixelRatio)
    overlay.height = Math.round(height * pixelRatio)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    fit()
  }

  function inspect(event: PointerEvent) {
    if (!layers || !width || !height) return
    const rect = canvas.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width
    const y = (event.clientY - rect.top) / rect.height
    const side = x * width < armorCompareWidth(width, percent) ? 0 : 1
    pointer.set(x * 2 - 1, 1 - y * 2)
    raycaster.setFromCamera(pointer, camera)
    const hit = raycaster.intersectObjects(layers[side].plates, false)[0]
    const thickness = hit?.object.userData.armorThickness
    onInspect(Number.isFinite(thickness) ? { side, thickness } : null)
    // 悬停在旁注芯片上时提示可点击（其余区域维持旋转光标）。
    const overChip = chipRects.some(r => (event.clientX - rect.left) >= r.x && (event.clientX - rect.left) <= r.x + r.w
      && (event.clientY - rect.top) >= r.y && (event.clientY - rect.top) <= r.y + r.h)
    canvas.style.cursor = overChip ? 'pointer' : '' 
  }

  function leave() { onInspect(null) }

  function lost(event: Event) {
    event.preventDefault()
    contextLost()
  }

  // 点击旁注芯片 = 点选对应文字行：透明化其它装甲、突出该板（拖拽超过 5px 视为旋转，不触发）。
  let pointerDown: { x: number; y: number } | null = null
  function onPointerDown(event: PointerEvent) {
    pointerDown = { x: event.clientX, y: event.clientY }
  }
  function onPointerUp(event: PointerEvent) {
    if (!pointerDown) return
    const moved = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y)
    pointerDown = null
    if (moved > 5) return
    const rect = canvas.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const chip = chipRects.find(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)
    if (chip) onIsolateRequest(chip.key)
  }

  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.15
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setClearColor(0x000000, 0)
  controls.addEventListener('change', draw)
  canvas.addEventListener('webglcontextlost', lost)
  canvas.addEventListener('pointermove', inspect)
  canvas.addEventListener('pointerleave', leave)
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointerup', onPointerUp)
  host.appendChild(canvas)
  host.appendChild(overlay)
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  resize()
  return {
    setCompare(percentVisible: number) {
      percent = percentVisible
      leave()
      draw()
    },
    setChoice(choice: ArmorComparisonChoice) {
      const old = createArmorThicknessScene(sources[0], models[0], choice, 0)
      let next: ReturnType<typeof createArmorThicknessScene>
      try {
        next = createArmorThicknessScene(sources[1], models[1], choice, 1)
      } catch (error) {
        old.dispose()
        throw error
      }
      layers?.forEach(layer => layer.dispose())
      layers = [old, next]
      leave()
      bounds = old.bounds.clone().union(next.bounds)
      applyIsolation()
      fit()
      return old.matched + next.matched
    },
    /** 文字行点击 → 隔离对应板件：目标保持原样，其余装甲整体淡化。传 null/[] 复原。 */
    setIsolated(keys: string[] | null) {
      isolatedKeys = keys && keys.length ? [...keys] : null
      applyIsolation()
    },
    destroy() {
      observer.disconnect()
      canvas.removeEventListener('webglcontextlost', lost)
      canvas.removeEventListener('pointermove', inspect)
      canvas.removeEventListener('pointerleave', leave)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointerup', onPointerUp)
      controls.removeEventListener('change', draw)
      controls.dispose()
      layers?.forEach(layer => layer.dispose())
      layers = null
      overlay.remove()
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
    },
  }
}
