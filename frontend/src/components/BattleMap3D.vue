<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

const props = defineProps({
  mapCode: { type: String, default: '' },
})

const host = ref(null)
const status = ref('loading')
const detail = ref('')

let renderer = null
let scene = null
let camera = null
let controls = null
let resizeObserver = null
let animationFrame = 0
let loadToken = 0

function disposeScene() {
  cancelAnimationFrame(animationFrame)
  animationFrame = 0
  resizeObserver?.disconnect()
  resizeObserver = null
  controls?.dispose()
  controls = null
  scene?.traverse((object) => {
    object.geometry?.dispose?.()
    if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose())
    else object.material?.dispose?.()
  })
  renderer?.dispose()
  if (renderer?.domElement.parentElement) renderer.domElement.parentElement.removeChild(renderer.domElement)
  renderer = null
  scene = null
  camera = null
}

function fitRenderer() {
  if (!host.value || !renderer || !camera) return
  const width = Math.max(1, host.value.clientWidth)
  const height = Math.max(1, host.value.clientHeight)
  renderer.setSize(width, height, false)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  camera.aspect = width / height
  camera.updateProjectionMatrix()
}

function animate() {
  if (!renderer || !scene || !camera) return
  controls?.update()
  renderer.render(scene, camera)
  animationFrame = requestAnimationFrame(animate)
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

function finiteNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function terrainColor(height, minHeight, maxHeight, target) {
  const span = Math.max(1e-6, maxHeight - minHeight)
  const t = Math.max(0, Math.min(1, (height - minHeight) / span))
  // Renderer-neutral derived presentation: elevation shading only. No client texture/material data.
  const low = [0.16, 0.20, 0.20]
  const mid = [0.30, 0.36, 0.33]
  const high = [0.52, 0.56, 0.52]
  const a = t < 0.58 ? low : mid
  const b = t < 0.58 ? mid : high
  const local = t < 0.58 ? t / 0.58 : (t - 0.58) / 0.42
  target[0] = a[0] + (b[0] - a[0]) * local
  target[1] = a[1] + (b[1] - a[1]) * local
  target[2] = a[2] + (b[2] - a[2]) * local
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

  // DAVA semantic contract maps samples with range / size spacing (not range / (size - 1)).
  const xSpacing = (xMax - xMin) / size
  const ySpacing = (yMax - yMin) / size
  const positions = new Float32Array(size * size * 3)
  const colors = new Float32Array(size * size * 3)
  const minHeight = finiteNumber(terrainMeta?.heightRangeMeters?.min, Math.min(...heights))
  const maxHeight = finiteNumber(terrainMeta?.heightRangeMeters?.max, Math.max(...heights))
  const rgb = [0, 0, 0]

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sample = y * size + x
      const offset = sample * 3
      const z = heights[sample]
      positions[offset] = xMin + x * xSpacing
      positions[offset + 1] = yMin + y * ySpacing
      positions[offset + 2] = z
      terrainColor(z, minHeight, maxHeight, rgb)
      colors[offset] = rgb[0]
      colors[offset + 1] = rgb[1]
      colors[offset + 2] = rgb[2]
    }
  }

  const cellCount = (size - 1) * (size - 1)
  const indices = new Uint32Array(cellCount * 6)
  let cursor = 0
  for (let y = 0; y < size - 1; y++) {
    const row = y * size
    const nextRow = (y + 1) * size
    for (let x = 0; x < size - 1; x++) {
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
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

async function loadMap() {
  const token = ++loadToken
  disposeScene()
  status.value = 'loading'
  detail.value = ''
  if (!host.value || !props.mapCode) {
    status.value = 'missing'
    return
  }

  try {
    const indexResponse = await fetch('/map-3d-local/index.json', { cache: 'no-store' })
    if (token !== loadToken) return
    if (!indexResponse.ok) {
      status.value = 'missing'
      detail.value = 'Local 3D map assets are missing. Run export_playback_3d_assets.py first.'
      return
    }
    const indexText = await indexResponse.text()
    if (looksLikeHtml(indexResponse, indexText)) {
      status.value = 'missing'
      detail.value = 'Local 3D map assets are missing. Run export_playback_3d_assets.py first.'
      return
    }
    let index
    try {
      index = JSON.parse(indexText)
    } catch (error) {
      throw new Error(`Invalid local 3D asset index: ${error instanceof Error ? error.message : String(error)}`)
    }
    const entry = index?.maps?.[props.mapCode]
    if (!entry?.manifest) {
      status.value = 'missing'
      detail.value = `No local 3D asset for mapCode=${props.mapCode}. Re-run the exporter with this map.`
      return
    }
    if (!entry?.terrain?.heightBuffer) {
      status.value = 'missing'
      detail.value = 'Local 3D terrain is missing. Re-run export_playback_3d_assets.py after pulling the latest PR branch.'
      return
    }

    const referenceGroundZ = Number.isFinite(Number(entry.referenceGroundZMeters))
      ? Number(entry.referenceGroundZMeters)
      : 0
    const manifestResponse = await fetchRequired(entry.manifest)
    const manifestText = await manifestResponse.text()
    if (looksLikeHtml(manifestResponse, manifestText)) {
      throw new Error(`Local 3D manifest is missing for mapCode=${props.mapCode}. Re-run the exporter.`)
    }
    const manifest = JSON.parse(manifestText)
    if (manifest?.schemaVersion !== 3) throw new Error(`Unsupported geometry schema: ${manifest?.schemaVersion}`)
    const baseUrl = entry.manifest.slice(0, entry.manifest.lastIndexOf('/') + 1)
    const [positionsBuffer, indicesBuffer, terrainBuffer] = await Promise.all([
      fetchRequired(baseUrl + manifest.buffers.positions.file).then((response) => response.arrayBuffer()),
      fetchRequired(baseUrl + manifest.buffers.indices.file).then((response) => response.arrayBuffer()),
      fetchRequired(entry.terrain.heightBuffer).then((response) => response.arrayBuffer()),
    ])
    if (token !== loadToken || !host.value) return

    const terrainBounds = entry.terrain.worldBounds || {}
    const xMin = finiteNumber(terrainBounds.xMin, -300)
    const yMin = finiteNumber(terrainBounds.yMin, -300)
    const xMax = finiteNumber(terrainBounds.xMax, 300)
    const yMax = finiteNumber(terrainBounds.yMax, 300)
    const actualMinZ = finiteNumber(entry.terrain?.heightRangeMeters?.min, referenceGroundZ)
    const actualMaxZ = finiteNumber(entry.terrain?.heightRangeMeters?.max, referenceGroundZ + 80)
    const centerX = (xMin + xMax) / 2
    const centerY = (yMin + yMax) / 2
    const span = Math.max(xMax - xMin, yMax - yMin, 1)

    const nextScene = new THREE.Scene()
    nextScene.background = new THREE.Color(0x0c1318)
    nextScene.fog = new THREE.Fog(0x0c1318, span * 1.35, span * 3.15)

    const nextCamera = new THREE.PerspectiveCamera(45, 1, 0.5, span * 6)
    nextCamera.up.set(0, 0, 1)
    nextCamera.position.set(
      centerX + span * 0.76,
      centerY - span * 0.88,
      actualMaxZ + span * 0.52,
    )

    const nextRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    nextRenderer.outputColorSpace = THREE.SRGBColorSpace
    nextRenderer.toneMapping = THREE.ACESFilmicToneMapping
    nextRenderer.toneMappingExposure = 1.08
    nextRenderer.shadowMap.enabled = false
    host.value.appendChild(nextRenderer.domElement)

    const ambient = new THREE.HemisphereLight(0xcfe0e9, 0x20292b, 1.72)
    nextScene.add(ambient)
    const sun = new THREE.DirectionalLight(0xfff4dd, 2.75)
    sun.position.set(centerX - span * 0.72, centerY - span * 0.92, actualMaxZ + span * 1.15)
    nextScene.add(sun)
    const fill = new THREE.DirectionalLight(0x9fc7dc, 0.72)
    fill.position.set(centerX + span * 0.8, centerY + span * 0.45, actualMaxZ + span * 0.38)
    nextScene.add(fill)

    const terrainGeometry = buildTerrainGeometry(entry.terrain, terrainBuffer)
    const terrainMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      metalness: 0,
      side: THREE.FrontSide,
    })
    const terrainMesh = new THREE.Mesh(terrainGeometry, terrainMaterial)
    terrainMesh.name = 'derived-real-heightmap-terrain'
    nextScene.add(terrainMesh)

    const staticMaterial = new THREE.MeshStandardMaterial({
      color: 0x9aa7ad,
      roughness: 0.9,
      metalness: 0.015,
      side: THREE.DoubleSide,
    })

    const geometries = new Map()
    for (const record of manifest.geometry || []) {
      const positions = new Float32Array(
        positionsBuffer,
        Number(record.positionFloatOffset) * 4,
        Number(record.positionFloatCount),
      )
      const indices = new Uint32Array(
        indicesBuffer,
        Number(record.indexOffset) * 4,
        Number(record.indexCount),
      )
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      geometry.setIndex(new THREE.BufferAttribute(indices, 1))
      geometry.computeVertexNormals()
      geometries.set(Number(record.id), geometry)
    }

    const instancesByDatasource = new Map()
    for (const instance of manifest.instances || []) {
      const id = Number(instance.datasourceId)
      const bucket = instancesByDatasource.get(id) || []
      bucket.push(instance)
      instancesByDatasource.set(id, bucket)
    }

    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    const scale = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    for (const [datasourceId, instances] of instancesByDatasource) {
      const geometry = geometries.get(datasourceId)
      if (!geometry || instances.length === 0) continue
      const mesh = new THREE.InstancedMesh(geometry, staticMaterial, instances.length)
      mesh.frustumCulled = false
      instances.forEach((instance, instanceIndex) => {
        const transform = instance.worldTransform || {}
        const t = transform.translation || [0, 0, 0]
        const s = transform.scale || [1, 1, 1]
        const q = transform.rotationQuaternionXYZW || [0, 0, 0, 1]
        position.set(Number(t[0]), Number(t[1]), Number(t[2]))
        scale.set(Number(s[0]), Number(s[1]), Number(s[2]))
        quaternion.set(Number(q[0]), Number(q[1]), Number(q[2]), Number(q[3])).normalize()
        matrix.compose(position, quaternion, scale)
        mesh.setMatrixAt(instanceIndex, matrix)
      })
      mesh.instanceMatrix.needsUpdate = true
      nextScene.add(mesh)
    }

    const nextControls = new OrbitControls(nextCamera, nextRenderer.domElement)
    nextControls.target.set(centerX, centerY, Math.max(actualMinZ, referenceGroundZ))
    nextControls.enableDamping = true
    nextControls.dampingFactor = 0.075
    nextControls.minDistance = Math.max(22, span * 0.055)
    nextControls.maxDistance = span * 2.45
    nextControls.maxPolarAngle = Math.PI * 0.49
    nextControls.screenSpacePanning = true
    nextControls.update()

    scene = nextScene
    camera = nextCamera
    renderer = nextRenderer
    controls = nextControls
    resizeObserver = new ResizeObserver(fitRenderer)
    resizeObserver.observe(host.value)
    fitRenderer()
    status.value = 'ready'
    animate()
  } catch (error) {
    if (token !== loadToken) return
    console.error('[map-3d] failed to load local derived map geometry', error)
    status.value = 'error'
    detail.value = error instanceof Error ? error.message : String(error)
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
  <div class="map3d-shell" data-test="pb-map-3d">
    <div ref="host" class="map3d-host"></div>
    <div v-if="status !== 'ready'" class="map3d-status" :data-state="status">
      <strong>{{ status === 'loading' ? '3D loading…' : '3D unavailable' }}</strong>
      <span v-if="detail">{{ detail }}</span>
    </div>
    <div v-else class="map3d-help">Drag: orbit · wheel: zoom · right-drag: pan</div>
  </div>
</template>

<style scoped>
.map3d-shell {
  position: relative;
  width: 100%;
  min-height: clamp(520px, 72vh, 900px);
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #0c1318;
}
.map3d-host { position: absolute; inset: 0; }
.map3d-host :deep(canvas) { display: block; width: 100%; height: 100%; touch-action: none; }
.map3d-status {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  gap: 8px;
  padding: 24px;
  text-align: center;
  color: var(--text-label);
  background: color-mix(in srgb, var(--bg-card) 86%, transparent);
}
.map3d-status span { max-width: 680px; font-size: .82rem; color: var(--text-secondary); }
.map3d-help {
  position: absolute;
  right: 12px;
  bottom: 12px;
  padding: 6px 9px;
  border-radius: 6px;
  background: rgb(0 0 0 / 55%);
  color: #d8e2ea;
  font: 600 11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
  pointer-events: none;
}
@media (max-width: 767px) {
  .map3d-shell { min-height: 68vh; }
  .map3d-help { display: none; }
}
</style>
