<script setup>
import { onMounted, provide } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth.js'
import { useBusinessUserBootstrap } from '../composables/useBusinessUserBootstrap.js'
import { useError } from '../composables/useError.js'
import { NAVIGATE_VIEW_KEY } from '../shared/navigation.js'
import { locationForView } from './navigation.js'
import AppHeader from './AppHeader.vue'
import GlobalErrorDialog from './GlobalErrorDialog.vue'

const router = useRouter()
const route = useRoute()
const { error: globalError, showError: showGlobalError, close: closeGlobalError } = useError()

/**
 * 全局业务用户 bootstrap：只要 Keycloak 认证成功并进入 SPA（任意 view —— home /
 * replay / battle-playback / AI Review / HoF / admin / profile / boost），
 * 就在这里 ensure 当前用户的 user_profile。
 *
 * 这里也是唯一触发点：页面不再各自负责「读不到资料 → 自己创建」。
 */
const { initPromise, isAuthenticated } = useAuth()
const { failed, ensure, retry } = useBusinessUserBootstrap()

onMounted(async () => {
  // 先等 Keycloak 初始化，再决定是否需要业务补全；失败不回退认证状态。
  // ensure 只在 ready 时短路，因此失败后的重新挂载会自然重试（不做自动循环）。
  await initPromise
  if (isAuthenticated()) await ensure()
})

function navigate(view) {
  const destination = router.resolve(locationForView(view, route))
  if (destination.fullPath !== route.fullPath) router.push(destination)
}

provide(NAVIGATE_VIEW_KEY, navigate)
</script>

<template>
  <AppHeader />
  <RouterView />
  <div v-if="failed" class="business-bootstrap-notice" role="alert" data-testid="business-bootstrap-notice">
    <span>{{ $t('bootstrap.profileFailed') }}</span>
    <button type="button" class="business-bootstrap-retry" @click="retry">{{ $t('bootstrap.retry') }}</button>
  </div>
  <GlobalErrorDialog :error="globalError" :visible="showGlobalError" @close="closeGlobalError" />
</template>
