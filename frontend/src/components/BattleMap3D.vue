<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { mapImages } from '../data/mapImages.js'
import {
  activateTerrainRelief,
  clearTerrainRelief,
  createTerrainReliefModel,
  projectTerrainCoordinates,
} from '../utils/terrainReliefProjection.js'

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
let reliefModel = null
let loadToken = 0

// The 2.5D product is a tactical-map relief, not a physical 3D scene. Height
// perception comes from the Z-derived screen warp plus renderer-owned hillshade.
const RELIEF_NORMAL_GAIN = 2.15
const RELIEF_CONTRAST = 1.45
const RELIEF_MIN_SHADE = 0.56
const RELIEF_MAX_SHADE = 1.20
const RELIEF_SUN = new THREE.Vector3(-0.72, 0.58, 0.38).normalize()

function finiteNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
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
  clearTerrainRelief(reliefModel)
  reliefModel = null
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

function terrainShade(heights, size, sampleX, sampleY, spacingX, spacingY) {
  const x0 = Math.max(0, sampleX - 1)
  const x1 = Math.min(size - 1, sampleX + 1)
  const y0 = Math.max(0, sampleY - 1)
  const y1 = Math.min(size - 1, sampleY + 1)

  const left = heights[sampleY * size + x0]
  const right = heights[sampleY * size + x1]
  const down = heights[y0 * size + sampleX]
  const up = heights[y1 * size + sampleX]
  const dxMeters = Math.max(spacingX, (x1 - x0) * spacingX)
  const dyMeters = Math.max(spacingY, (y1 - y0) * spacingY)
  const dzdx = ((right - left) / dxMeters) * RELIEF_NORMAL_GAIN
  const dzdy = ((up - down) / dyMeters) * RELIEF_NORMAL_GAIN

  const normal = new THREE.Vector3(-dzdx, -dzdy, 1).normalize()
  const lit = normal.dot(RELIEF_SUN)
  const flatLit = RELIEF_SUN.z
  return clamp(
    1 + (lit - flatLit) * RELIEF_CONTRAST,
    RELIEF_MIN_SHADE,
    RELIEF_MAX_SHADE,
  )
}

function buildTerrainGeometry(terrainMeta, heights, model) {
  const size = Number(terrainMeta?.samplesPerAxis)
  const bounds = terrainMeta?.worldBounds || {}
  if (!Number.isInteger(size) || size < 2) throw new Error(`Invalid terrain sample size: ${size}`)
  if (heights.length !== size * size) {
    throw new Error(`Terrain buffer sample mismatch: expected ${size * size}, got ${heights.length}`)
  }

  const xMin = finiteNumber(bounds.xMin)
  const yMin = finiteNumber(bounds.yMin)
  const xMax = finiteNumber(bounds.xMax)
  const yMax = finiteNumber(bounds.yMax)
  if (!(xMax > xMin) || !(yMax > yMin)) throw new Error('Terrain world bounds are invalid')

  const spacingX = (xMax - xMin) / size
  const spacingY = (yMax - yMin) / size
  const grid = size + 1
  const positions = new Float32Array(grid * grid * 3)
  const uvs = new Float32Array(grid * grid * 2)
  const colors = new Float32Array(grid * grid * 3)

  for (let gy = 0; gy <= size; gy++) {
    const sampleY = Math.min(gy, size - 1)
    const worldY = yMin + gy * spacingY
    for (let gx = 0; gx <= size; gx++) {
      const sampleX = Math.min(gx, size - 1)
      const worldX = xMin + gx * spacingX
      const height = heights[sampleY * size + sampleX]
      const projected = projectTerrainCoordinates(model, worldX, worldY, height)
      const vertex = gy * grid + gx
      const p = vertex * 3
      const uv = vertex * 2

      // Pre-project the terrain into the tactical-map plane. The original 2D map
      // footprint remains authoritative; Z only warps interior Y. Edge fade pins
      // the perimeter to the original raster frame so the map never shrinks into
      // a physical-camera trapezoid/bowl.
      positions[p] = projected.u
      positions[p + 1] = projected.v
      positions[p + 2] = 0
      uvs[uv] = gx / size
      uvs[uv + 1] = gy / size

      const shade = terrainShade(heights, size, sampleX, sampleY, spacingX, spacingY)
      const c = vertex * 3
      colors[c] = shade
      colors[c + 1] = shade
      colors[c + 2] = shade
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
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
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
    if (index?.schemaVersion !== 6 || index?.renderMode !== 'TOP_DOWN_2_5D_HEIGHTFIELD') {
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
    const heights = new Float32Array(terrainBuffer)

    const model = createTerrainReliefModel({
      mapCode: props.mapCode,
      worldBounds: entry.terrain.worldBounds,
      heightRangeMeters: entry.terrain.heightRangeMeters,
      samplesPerAxis: entry.terrain.samplesPerAxis,
      heights,
    })

    const nextScene = new THREE.Scene()
    nextScene.background = new THREE.Color(0x111820)

    // Footprint-preserving orthographic presentation. The mesh has already been
    // transformed into its tactical relief plane, so this camera does not add any
    // second foreshortening/perspective step.
    const pb = model.projectedBounds
    const nextCamera = new THREE.OrthographicCamera(
      pb.left,
      pb.right,
      pb.top,
      pb.bottom,
      0.1,
      10,
    )
    nextCamera.position.set(0, 0, 1)
    nextCamera.up.set(0, 1, 0)
    nextCamera.lookAt(0, 0, 0)
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
    texture.generateMipmaps = true
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.anisotropy = nextRenderer.capabilities.getMaxAnisotropy()
    texture.needsUpdate = true

    const terrain = new THREE.Mesh(
      buildTerrainGeometry(entry.terrain, heights, model),
      new THREE.MeshBasicMaterial({
        map: texture,
        vertexColors: true,
        color: 0xffffff,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      }),
    )
    terrain.name = 'edge-pinned-2.5d-tactical-map'
    nextScene.add(terrain)

    scene = nextScene
    camera = nextCamera
    renderer = nextRenderer
    reliefModel = model
    activateTerrainRelief(model)
    resizeObserver = new ResizeObserver(fitRenderer)
    resizeObserver.observe(host.value)
    fitRenderer()
    setViewportActive(true)
    status.value = 'ready'
    renderScene()
  } catch (error) {
    if (token !== loadToken) return
    console.error('[map-2.5d] failed to render tactical heightfield relief', error)
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

/* BattleMap still owns tactical overlays and the replay clock. Only the original
   raster is hidden; the SVG/DOM layers are reprojected by the shared relief model. */
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
