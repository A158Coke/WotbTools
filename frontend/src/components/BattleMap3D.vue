<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { mapImages } from '../data/mapImages.js'

const props = defineProps({
  mapCode: { type: String, default: '' },
})

const host = ref(null)
const status = ref('loading')

let renderer = null
let scene = null
let camera = null
let resizeObserver = null
let viewportElement = null
let loadToken = 0

function finiteNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function setViewportActive(active) {
  const next = host.value?.closest?.('.pb-viewport') || viewportElement
  if (active && next) {
    if (viewportElement && viewportElement !== next) viewportElement.classList.remove('pb-25d-active')
    viewportElement = next
    viewportElement.classList.add('pb-25d-active')
    return
  }
  viewportElement?.classList.remove('pb-25d-active')
  viewportElement = null
}

function disposeScene() {
  resizeObserver?.disconnect()
  resizeObserver = null
  setViewportActive(false)
  scene?.traverse((object) => {
    object.geometry?.dispose?.()
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) {
      material?.map?.dispose?.()
      material?.dispose?.()
    }
  })
  renderer?.dispose()
  if (renderer?.domElement.parentElement) renderer.domElement.parentElement.removeChild(renderer.domElement)
  renderer = null
  scene = null
  camera = null
}

function renderScene() {
  if (!renderer || !scene || !camera) return
  renderer.render(scene, camera)
}

function fitRenderer() {
  if (!host.value || !renderer) return
  const width = Math.max(1, host.value.clientWidth)
  const height = Math.max(1, host.value.clientHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(width, height, false)
  // Intentionally do not aspect-correct the orthographic frustum. BattleMap's
  // existing world->image mapping scales X and Y independently to the image box;
  // stretching this canvas the same way keeps every DOM/SVG vehicle marker,
  // base, trail and tracer aligned pixel-for-pixel with the 2.5D background.
  renderScene()
}

async function fetchRequired(url) {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`)
  return response
}

function looksLikeHtml(response, text = '') {
  const contentType = response.headers.get('content-type') || ''
  return contentType.includes('text/html') || text.trimStart().startsWith('<')
}

function buildTerrainGeometry(terrainMeta, terrainBuffer) {
  const size = Number(terrainMeta?.samplesPerAxis)
  const bounds = terrainMeta?.worldBounds || {}
  if (!Number.isInteger(size) || size < 2) throw new Error(`Invalid terrain sample size: ${size}`)

  const heights = new Float32Array(terrainBuffer)
  if (heights.length !== size * size) {
    throw new Error(`Terrain buffer sample mismatch: expected ${size * size}, got ${heights.length}`)
  }

  const xMin = finiteNumber(bounds.xMin)
  const yMin = finiteNumber(bounds.yMin)
  const xMax = finiteNumber(bounds.xMax)
  const yMax = finiteNumber(bounds.yMax)
  if (!(xMax > xMin) || !(yMax > yMin)) throw new Error('Terrain world bounds are invalid')

  // The proven client heightfield uses range/size sample spacing. Add one repeated
  // edge row/column at xMax/yMax so the textured surface covers the full 2D map
  // bounds without moving any authoritative sample away from its world position.
  const spacingX = (xMax - xMin) / size
  const spacingY = (yMax - yMin) / size
  const grid = size + 1
  const positions = new Float32Array(grid * grid * 3)
  const uvs = new Float32Array(grid * grid * 2)

  for (let gy = 0; gy <= size; gy++) {
    const sampleY = Math.min(gy, size - 1)
    for (let gx = 0; gx <= size; gx++) {
      const sampleX = Math.min(gx, size - 1)
      const vertex = gy * grid + gx
      const p = vertex * 3
      const uv = vertex * 2
      positions[p] = xMin + gx * spacingX
      positions[p + 1] = yMin + gy * spacingY
      positions[p + 2] = heights[sampleY * size + sampleX]
      uvs[uv] = gx / size
      uvs[uv + 1] = gy / size
    }
  }

  const indices = new Uint32Array(size * size * 6)
  let cursor = 0
  for (let y = 0; y < size; y++) {
    const row = y * grid
    const nextRow = (y + 1) * grid
    for (let x = 0; x < size; x++) {
      const a = row + x
      const b = a + 1
      const c = nextRow + x
      const d = c + 1
      indices[cursor++] = a
      indices[cursor++] = b
      indices[cursor++] = d
      indices[cursor++] = a
      indices[cursor++] = d
      indices[cursor++] = c
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

async function loadMap() {
  const token = ++loadToken
  disposeScene()
  status.value = 'loading'

  const image = mapImages[props.mapCode]
  if (!host.value || !props.mapCode || !image?.src) {
    status.value = 'missing'
    return
  }

  try {
    const indexResponse = await fetch('/map-3d-local/index.json', { cache: 'no-store' })
    if (token !== loadToken) return
    if (!indexResponse.ok) {
      status.value = 'missing'
      return
    }
    const indexText = await indexResponse.text()
    if (looksLikeHtml(indexResponse, indexText)) {
      status.value = 'missing'
      return
    }
    const index = JSON.parse(indexText)
    if (index?.schemaVersion !== 5 || index?.renderMode !== 'TOP_DOWN_2_5D_HEIGHTFIELD') {
      status.value = 'missing'
      console.warn('[map-2.5d] stale local assets; re-run export_playback_3d_assets.py')
      return
    }

    const entry = index?.maps?.[props.mapCode]
    if (!entry?.terrain?.heightBuffer) {
      status.value = 'missing'
      return
    }

    const terrainBuffer = await fetchRequired(entry.terrain.heightBuffer).then((response) => response.arrayBuffer())
    if (token !== loadToken || !host.value) return

    const bounds = entry.terrain.worldBounds || {}
    const xMin = finiteNumber(bounds.xMin, -300)
    const yMin = finiteNumber(bounds.yMin, -300)
    const xMax = finiteNumber(bounds.xMax, 300)
    const yMax = finiteNumber(bounds.yMax, 300)
    if (!(xMax > xMin) || !(yMax > yMin)) throw new Error('2.5D terrain bounds are invalid')

    const minZ = finiteNumber(entry.terrain?.heightRangeMeters?.min, 0)
    const maxZ = finiteNumber(entry.terrain?.heightRangeMeters?.max, minZ + 1)
    const centerX = (xMin + xMax) / 2
    const centerY = (yMin + yMax) / 2
    const span = Math.max(xMax - xMin, yMax - yMin, 1)

    const nextScene = new THREE.Scene()
    nextScene.background = new THREE.Color(0x111820)

    // Fixed 90-degree bird's-eye view. No orbit, pitch, roll or perspective.
    // X/Y frustum == BattleMap coordinateBounds, so existing DOM markers remain
    // the presentation authority and need no separate 3D projection path.
    const nextCamera = new THREE.OrthographicCamera(
      xMin - centerX,
      xMax - centerX,
      yMax - centerY,
      yMin - centerY,
      0.1,
      span * 6,
    )
    nextCamera.position.set(centerX, centerY, maxZ + span * 2)
    nextCamera.up.set(0, 1, 0)
    nextCamera.lookAt(centerX, centerY, minZ)
    nextCamera.updateProjectionMatrix()

    const nextRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    nextRenderer.outputColorSpace = THREE.SRGBColorSpace
    nextRenderer.toneMapping = THREE.NoToneMapping
    nextRenderer.shadowMap.enabled = false
    host.value.appendChild(nextRenderer.domElement)

    const texture = await new THREE.TextureLoader().loadAsync(image.src)
    if (token !== loadToken) {
      texture.dispose()
      nextRenderer.dispose()
      return
    }
    texture.colorSpace = THREE.SRGBColorSpace
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.anisotropy = Math.min(8, nextRenderer.capabilities.getMaxAnisotropy())

    // Original renderer lighting only: the existing 2D tactical map remains the
    // visual content, while normals derived from Z create the readable relief.
    nextScene.add(new THREE.AmbientLight(0xffffff, 1.12))
    const sun = new THREE.DirectionalLight(0xffffff, 1.18)
    sun.position.set(centerX - span * 0.7, centerY + span * 0.85, maxZ + span * 1.25)
    nextScene.add(sun)

    const terrain = new THREE.Mesh(
      buildTerrainGeometry(entry.terrain, terrainBuffer),
      new THREE.MeshLambertMaterial({
        map: texture,
        color: 0xffffff,
        side: THREE.FrontSide,
      }),
    )
    terrain.name = 'top-down-2.5d-tactical-map'
    nextScene.add(terrain)

    scene = nextScene
    camera = nextCamera
    renderer = nextRenderer
    resizeObserver = new ResizeObserver(fitRenderer)
    resizeObserver.observe(host.value)
    fitRenderer()
    setViewportActive(true)
    status.value = 'ready'
    renderScene()
  } catch (error) {
    if (token !== loadToken) return
    console.error('[map-2.5d] failed to render local heightfield', error)
    disposeScene()
    status.value = 'error'
  }
}

watch(() => props.mapCode, loadMap)
onMounted(loadMap)
onBeforeUnmount(() => {
  ++loadToken
  disposeScene()
})
</script>

<template>
  <div class="map25d-shell" data-test="pb-map-25d" :data-state="status">
    <div ref="host" class="map25d-host"></div>
  </div>
</template>

<style scoped>
.map25d-shell,
.map25d-host {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  pointer-events: none;
}
.map25d-host :deep(canvas) {
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

/* BattleMap continues to own every overlay. Only its original raster image is
   hidden while the aligned 2.5D canvas is ready. Keeping SVG/DOM overlays alive
   means hull.webp/turret.webp, HP, bases, tracers and annotations stay on the
   existing playback clock and do not need a parallel renderer. */
:global(.pb-viewport.pb-25d-active .pb-svg) {
  position: relative;
  z-index: 1;
  background: transparent;
}
:global(.pb-viewport.pb-25d-active .pb-svg > image) {
  visibility: hidden;
}
:global(.pb-viewport.pb-25d-active .pb-markers) {
  z-index: 2;
}
</style>
