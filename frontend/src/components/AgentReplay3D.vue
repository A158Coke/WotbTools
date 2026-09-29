<script setup>
/**
 * Agent 三维回放页（上游 WoT-Blitz-Agent 切面消费，契约见
 * contracts/agent/replay-facets-v1.md）：本地 .wotbreplay 文件 → 浏览器 WASM
 * 解析 → three.js 全场回放。文件不出本机（契约 §6 纯客户端）。
 */
import { onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import * as THREE from 'three'
import { parseAgentFacetsFromBytes } from '../api/agent-replay-facets.js'

const { t } = useI18n()

const fileInput = ref(null)
const phase = ref('idle') // idle | loading | ready | error
const errorDetail = ref('')
const facet = ref(null)
const playing = ref(false)
const progress = ref(0) // 0..1（相对切片时长）

const TEAM_COLORS = { 1: 0xe0665b, 2: 0x5b8fe1 }
const UNKNOWN_COLOR = 0x9aa4ad
const GROUND_HALF = 300

const container = ref(null)
let renderer = null
let scene = null
let camera = null
let raf = 0
let lastTs = 0
let vehicleMeshes = []

function statusText(key, detail = '') {
  status.value = detail ? `${t(key)} ${detail}` : t(key)
}

function buildScene(containerEl) {
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x11161d)
  camera = new THREE.PerspectiveCamera(55, containerEl.clientWidth / 480, 1, 3000)
  camera.position.set(0, 260, 260)
  camera.lookAt(0, 0, 0)

  const grid = new THREE.GridHelper(GROUND_HALF * 2, 60, 0x3a4654, 0x232b35)
  scene.add(grid)
  scene.add(new THREE.AmbientLight(0xffffff, 0.7))
  const sun = new THREE.DirectionalLight(0xffffff, 0.8)
  sun.position.set(200, 400, 150)
  scene.add(sun)

  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(containerEl.clientWidth, 480)
  containerEl.appendChild(renderer.domElement)
}

function buildVehicles(pb) {
  const geometry = new THREE.BoxGeometry(3.4, 2.2, 6.6)
  vehicleMeshes = pb.vehicles.map((v) => {
    const color = v.team === 1 ? TEAM_COLORS[1] : v.team === 2 ? TEAM_COLORS[2] : UNKNOWN_COLOR
    const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color }))
    scene.add(mesh)
    return { mesh, track: v }
  })
}

function sampleAt(track, index, k) {
  const i = Math.min(index, track.pos.length / 3 - 2)
  const a = i * 3
  const b = a + 3
  const lerp = (arr, o) => arr[o] + (arr[b + (o - a)] - arr[a + (o - a)]) * k
  return {
    x: lerp(track.pos, a),
    y: lerp(track.pos, a + 1),
    z: lerp(track.pos, a + 2),
    yaw: track.hull_yaw[i] + (track.hull_yaw[i + 1] - track.hull_yaw[i]) * k,
  }
}

function applyTime() {
  const pb = facet.value
  if (!pb) return
  const span = Math.max(pb.meta.duration - pb.meta.t_start, 0.1)
  const t = pb.meta.t_start + progress.value * span
  const idx = Math.min(Math.floor((t - pb.meta.t_start) / 0.1), pb.meta.samples - 2)
  const k = Math.min(Math.max((t - pb.meta.t_start - idx * 0.1) / 0.1, 0), 1)
  for (const { mesh, track } of vehicleMeshes) {
    if (track.pos.length < 6) continue
    const s = sampleAt(track, idx, k)
    mesh.position.set(s.x, s.y + 1.2, s.z)
    mesh.rotation.y = -s.yaw
    mesh.visible = track.death_t === null || t <= track.death_t
  }
}

function tick(ts) {
  raf = requestAnimationFrame(tick)
  if (!lastTs) lastTs = ts
  const dt = (ts - lastTs) / 1000
  lastTs = ts
  if (playing.value && facet.value) {
    progress.value = Math.min(progress.value + dt / 10, 1)
    if (progress.value >= 1) playing.value = false
    applyTime()
  }
  renderer?.render(scene, camera)
}

async function onFilePicked(event) {
  const file = event.target.files && event.target.files[0]
  event.target.value = ''
  if (!file) return
  phase.value = 'loading'
  errorDetail.value = ''
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    facet.value = await parseAgentFacetsFromBytes(bytes)
    phase.value = 'ready'
    playing.value = false
    progress.value = 0
    buildVehicles(facet.value.playback)
    applyTime()
  } catch (e) {
    phase.value = 'error'
    errorDetail.value = String(e?.message || e).slice(0, 200)
  }
}

function togglePlay() {
  if (phase.value !== 'ready') return
  playing.value = !playing.value
  if (playing.value && progress.value >= 1) progress.value = 0
}

function onResize() {
  const el = container.value
  if (!el || !renderer) return
  camera.aspect = el.clientWidth / 480
  camera.updateProjectionMatrix()
  renderer.setSize(el.clientWidth, 480)
}

onMounted(() => {
  raf = requestAnimationFrame(tick)
  window.addEventListener('resize', onResize)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('resize', onResize)
  renderer?.dispose()
  renderer = null
})
</script>

<template>
  <section class="agent-replay">
    <h2>{{ t('agentReplay.title') }}</h2>
    <p class="hint">{{ t('agentReplay.pick_hint') }}</p>
    <div class="controls">
      <input ref="fileInput" type="file" accept=".wotbreplay" @change="onFilePicked" />
      <button type="button" :disabled="phase !== 'ready'" @click="togglePlay">
        {{ playing ? t('agentReplay.pause') : t('agentReplay.play') }}
      </button>
      <input
        v-model.number="progress"
        class="timeline"
        type="range"
        min="0"
        max="1"
        step="0.001"
        :disabled="phase !== 'ready'"
        @input="applyTime"
      />
    </div>
    <p v-if="phase === 'loading'" class="status">{{ t('agentReplay.parsing') }}</p>
    <p v-else-if="phase === 'error'" class="status error">
      {{ t('agentReplay.error_parse') }} {{ errorDetail }}
    </p>
    <p v-else-if="phase === 'ready'" class="status">
      {{ t('agentReplay.ready', { count: facet.playback.vehicles.length, map: facet.playback.meta.map_name }) }}
    </p>
    <div ref="container" class="stage"></div>
  </section>
</template>

<style scoped>
.agent-replay { padding: 16px; }
.hint { color: var(--text-label, #8a94a3); margin: 4px 0 12px; }
.controls { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.controls input[type='file'] { max-width: 320px; }
.timeline { flex: 1; min-width: 200px; }
.stage { margin-top: 12px; border: 1px solid var(--line, #2a3441); }
.status { margin-top: 8px; }
.status.error { color: var(--danger, #e0665b); }
</style>
