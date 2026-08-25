<!--
  独立 AI 复盘 / 战局回放视图（?view=reconstruction，深链 + 登录回跳入口）。
  单页 Workspace 改造后，主入口在 ReplayPage（原地切换），本页保留为独立深链：
  自己的单文件选择器 + 战局回放面板（BattlePlaybackPanel）+ AI 复盘面板（AiReviewPanel）。
  跨视图文件交接（replayTransfer）已随原地切换改造移除——文件不再离开 ReplayPage。
-->
<script setup>
import { nextTick, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth.js'
import AiReviewPanel from './AiReviewPanel.vue'
import BattlePlaybackPanel from './BattlePlaybackPanel.vue'
import ReplayInputPanel from './ReplayInputPanel.vue'

// KeepAlive include 匹配组件名：App.vue 仅缓存本页，切走视图时保持面板状态存活。
defineOptions({ name: 'ReconstructionPage' })

const { t } = useI18n()
const { initPromise, login, authenticated } = useAuth()

/** 登录后回跳到本页而不是个人中心。 */
const LOGIN_VIEW = 'reconstruction'

// 入口随时可见，但进入本页后检查登录状态：未登录则自动跳转登录页。
// 鉴权若已就绪（authenticated 为真）直接 ready，避免多余的加载闪屏；
// 否则先 'init' 不渲染内容，等 initPromise 落定再决定 ready / login。
const authPhase = ref(authenticated.value ? 'ready' : 'init')

onMounted(async () => {
  let loggedIn = false
  try {
    loggedIn = Boolean(await initPromise)
  } catch {
    loggedIn = false
  }
  if (loggedIn) {
    authPhase.value = 'ready'
    return
  }
  authPhase.value = 'login'
  login(LOGIN_VIEW)
})

const files = ref([])
const error = ref('')
// AI 报告时间跳转：传给 BattlePlaybackPanel（seekTo 自动加载/展开地图），并滚动定位到地图面板。
const mapSeek = ref(null)
const playbackPanelEl = ref(null)

function addFile(e) {
  const picked = Array.from(e.target.files || [])
    .filter(f => f.name.toLowerCase().endsWith('.wotbreplay'))
  if (picked.length === 0) {
    if ((e.target.files || []).length) {
      error.value = t('recon.invalid_file')
    }
    return
  }
  files.value = [picked[0]]
  error.value = ''
}

function removeFile(index) {
  files.value = files.value.filter((_, i) => i !== index)
  error.value = ''
}

function clearFile() {
  files.value = []
  error.value = ''
}

/** AI 报告时间链接 → 回滚到地图区块（MapOverview 已自动切到战局回放视图）。 */
async function onAiSeek(sec) {
  mapSeek.value = null
  await nextTick()
  mapSeek.value = sec
  await nextTick()
  if (playbackPanelEl.value) {
    playbackPanelEl.value.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}
</script>

<template>
  <main class="recon-page layout-data-workspace">
    <!-- 未登录：提示并已自动跳转登录页，按钮用于跳转失败时手动重试 -->
    <div v-if="authPhase === 'login'" class="recon-auth">
      <p>{{ $t('recon.pleaseLogin') }}</p>
      <button class="btn-primary" @click="login(LOGIN_VIEW)">{{ $t('app.login') }}</button>
    </div>

    <div v-else-if="authPhase === 'init'" class="recon-auth">
      <p>{{ $t('recon.auth_loading') }}</p>
    </div>

    <template v-else>
      <ReplayInputPanel
        :files="files"
        @add-file="addFile"
        @remove-file="removeFile"
        @clear="clearFile"
      />

      <p v-if="error" class="error" style="margin:12px 0">{{ error }}</p>

      <!-- 独立地图区块：热力/路线/战局回放，不依赖 AI 复盘 -->
      <div ref="playbackPanelEl">
        <BattlePlaybackPanel
          :file="files[0] || null"
          :seek-to="mapSeek"
          login-view="reconstruction"
        />
      </div>

      <AiReviewPanel
        :file="files[0] || null"
        login-view="reconstruction"
        @seek="onAiSeek"
      />
    </template>
  </main>
</template>

<style scoped>
.recon-page :deep(.sub-hint) { color: var(--text-sub); font-size: .88rem; margin: 6px 0 16px; }
.recon-page :deep(.fb-chips) { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 12px; }
.recon-page :deep(.chip) { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; padding: 3px 8px; border-radius: 5px; background: var(--bg-chip); color: var(--text-label); }
.error { font-size: .88rem; }
.recon-auth { text-align: center; padding: 40px; color: var(--text-secondary); }
</style>
