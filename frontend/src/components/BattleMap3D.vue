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
      detail.value = 'Run the local 3D asset export command first.'
      return
    }
    const index = await indexResponse.json()
    const entry = index?.maps?.[props.mapCode]
    if (!entry?.manifest) {
      status.value = 'missing'
      detail.value = `No local 3D asset for mapCode=${props.mapCode}`
      return
    }

    const referenceGroundZ = Number.isFinite(Number(entry.referenceGroundZMeters))
      ? Number(entry.referenceGroundZMeters)
      : 0
    const manifestResponse = await fetchRequired(entry.manifest)
    const manifest = await manifestResponse.json()
    if (manifest?.schemaVersion !== 3) throw new Error(`Unsupported geometry schema: ${manifest?.schemaVersion}`)
    const baseUrl = entry.manifest.slice(0, entry.manifest.lastIndexOf('/') + 1)
    const [positionsBuffer, indicesBuffer] = await Promise.all([
      fetchRequired(baseUrl + manifest.buffers.positions.file).then((response) => response.arrayBuffer()),
      fetchRequired(baseUrl + manifest.buffers.indices.file).then((response) => response.arrayBuffer()),
    ])
    if (token !== loadToken || !host.value) return

    const nextScene = new THREE.Scene()
    nextScene.background = new THREE.Color(0x111820)
    nextScene.fog = new THREE.Fog(0x111820, 650, 1450)

    const nextCamera = new THREE.PerspectiveCamera(48, 1, 0.5, 3000)
    nextCamera.up.set(0, 0, 1)
    nextCamera.position.set(420, -460, referenceGroundZ + 300)

    const nextRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    nextRenderer.outputColorSpace = THREE.SRGBColorSpace
    nextRenderer.shadowMap.enabled = false
    host.value.appendChild(nextRenderer.domElement)

    const ambient = new THREE.HemisphereLight(0xd7e8ff, 0x28313a, 2.15)
    nextScene.add(ambient)
    const sun = new THREE.DirectionalLight(0xffffff, 2.4)
    sun.position.set(-260, -340, referenceGroundZ + 620)
    nextScene.add(sun)

    const material = new THREE.MeshStandardMaterial({
      color: 0x87939b,
      roughness: 0.92,
      metalness: 0.02,
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
      const mesh = new THREE.InstancedMesh(geometry, material, instances.length)
      mesh.frustumCulled = false
      instances.forEach((instance, index) => {
        const transform = instance.worldTransform || {}
        const t = transform.translation || [0, 0, 0]
        const s = transform.scale || [1, 1, 1]
        const q = transform.rotationQuaternionXYZW || [0, 0, 0, 1]
        position.set(Number(t[0]), Number(t[1]), Number(t[2]))
        scale.set(Number(s[0]), Number(s[1]), Number(s[2]))
        quaternion.set(Number(q[0]), Number(q[1]), Number(q[2]), Number(q[3])).normalize()
        matrix.compose(position, quaternion, scale)
        mesh.setMatrixAt(index, matrix)
      })
      mesh.instanceMatrix.needsUpdate = true
      nextScene.add(mesh)
    }

    // Reference plane only: this deliberately does not pretend to be the real heightmap terrain.
    const grid = new THREE.GridHelper(600, 12, 0x607080, 0x34414b)
    grid.rotation.x = Math.PI / 2
    grid.position.z = referenceGroundZ
    nextScene.add(grid)

    const nextControls = new OrbitControls(nextCamera, nextRenderer.domElement)
    nextControls.target.set(0, 0, referenceGroundZ)
    nextControls.enableDamping = true
    nextControls.dampingFactor = 0.08
    nextControls.minDistance = 40
    nextControls.maxDistance = 1350
    nextControls.maxPolarAngle = Math.PI * 0.48
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
  background: #111820;
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
