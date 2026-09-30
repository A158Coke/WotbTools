<script setup>
/**
 * Agent 三维回放页（场景内核版 / client-only）：本地 .wotbreplay → 浏览器 WASM
 * parsePlayback 解析（契约 v2 时序能力，文件不出本机）→ playbackScene 全场渲染。
 * 拓扑（评审 P0-3）：无服务端通道——Business API / Agent 自托管服务端不参与
 * Playback；地图/GLB/坦克数据渲染资产经 ?assets= 资产平面（assetProvider）。
 * 车辆展示名：来自上游资产包 data/tank_names.json（wotbagent 数据口径）。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { createPlaybackStore } from '../scene/playbackStore.js'
import { initPlayback } from '../scene/playbackScene.js'
import { loadPlaybackData } from '../scene/replaySource.js'
import { assetProvider } from '../scene/assetProvider.js'

const { t } = useI18n()

const store = createPlaybackStore()
const stage = ref(null)
const fileInput = ref(null)
let sceneApi = null

const SPEEDS = [0.5, 1, 2, 4, 8, 16]
// 资产平面状态提示：回放解析不依赖资产；地图/地形/车模 GLB 需要 ?assets=
const assetsReady = assetProvider.configured()

async function onFilePicked(event) {
  const file = event.target.files && event.target.files[0]
  event.target.value = ''
  if (!file) return
  store.loading = true
  try {
    await sceneApi.loadData({ kind: 'local', file })
  } catch (e) {
    store.err = (t('agentReplay.error_parse') || '解析失败') + ' ' + String(e?.message || e).slice(0, 160)
  } finally {
    store.loading = false
  }
}

function onTogglePlay() {
  sceneApi?.togglePlay()
}

function onSeekInput(e) {
  sceneApi?.seekFraction(e.target.value / 1000)
}

function onSpeed(e) {
  sceneApi?.setSpeed(Number(e.target.value))
}

onMounted(() => {
  sceneApi = initPlayback(stage.value, store)
})
onBeforeUnmount(() => {
  sceneApi?.destroy?.()
})
</script>

<template>
  <section class="agent-replay">
    <h2>{{ t('agentReplay.title') }}</h2>
    <p class="hint">{{ t('agentReplay.pick_hint') }}</p>
    <p v-if="!assetsReady" class="hint warn">{{ t('agentReplay.assets_hint') }}</p>
    <div class="controls">
      <label class="pick">
        <input type="file" accept=".wotbreplay" @change="onFilePicked" />
        {{ t('agentReplay.local_file') }}
      </label>
      <select class="speed" :value="store.speed" @change="onSpeed" :disabled="!store.hasData">
        <option v-for="s in SPEEDS" :key="s" :value="s">{{ s }}×</option>
      </select>
      <button type="button" class="go" :disabled="!store.hasData" @click="onTogglePlay">
        {{ store.playing ? t('agentReplay.pause') : t('agentReplay.play') }}
      </button>
    </div>
    <p v-if="store.loading" class="status">{{ t('agentReplay.parsing') }}</p>
    <p v-else-if="store.err" class="status error">{{ store.err }}</p>
    <div ref="stage" class="stage"></div>
    <input
      class="timeline"
      type="range"
      min="0"
      max="1000"
      :value="store.seekFrac * 1000"
      :disabled="!store.hasData"
      @input="onSeekInput"
    />
  </section>
</template>

<style scoped>
.agent-replay { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.path { flex: 1; min-width: 240px; }
.pick input[type='file'] { display: none; }
.pick { cursor: pointer; border: 1px solid var(--line, #2a3441); padding: 4px 10px; border-radius: 4px; }
.stage { width: 100%; height: 70vh; min-height: 420px; border: 1px solid var(--line, #2a3441); }
.timeline { width: 100%; }
.status.error { color: var(--danger, #e0665b); }
.hint.warn { color: #ffcf5c; }
button, select { background: #1d242e; color: var(--fg, #dfe5ec); border: 1px solid var(--line, #2a3441); padding: 4px 10px; border-radius: 4px; }
input[type='text'] { background: #1d242e; color: var(--fg, #dfe5ec); border: 1px solid var(--line, #2a3441); padding: 4px 8px; border-radius: 4px; }
</style>
