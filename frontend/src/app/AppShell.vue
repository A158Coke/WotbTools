<script setup>
import { provide, watch } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth.js'
import { useBusinessUserBootstrap } from '../composables/useBusinessUserBootstrap.js'
import { useError } from '../composables/useError.js'
import { NAVIGATE_VIEW_KEY } from '../shared/navigation.js'
import { locationForView } from './navigation.js'
import AppHeader from './AppHeader.vue'
import GlobalErrorDialog from './GlobalErrorDialog.vue'
import publicSecurityFilingIcon from '../assets/public-security-filing.png'

const router = useRouter()
const route = useRoute()
const { error: globalError, showError: showGlobalError, close: closeGlobalError } = useError()

/**
 * 全局业务用户 bootstrap：只要 Keycloak 认证成功并进入 SPA（任意 view —— home /
 * replay / battle-playback / AI Review / HoF / admin / profile），
 * 就在这里 ensure 当前用户的 user_profile。
 *
 * 这里也是唯一触发点：页面不再各自负责「读不到资料 → 自己创建」。
 */
const { authInitState, authenticated } = useAuth()
const { failed, ensure, retry } = useBusinessUserBootstrap()

watch([authInitState, authenticated], ([state, isLoggedIn]) => {
  if (state !== 'authenticated' || !isLoggedIn) return
  // Auth generation changes are authoritative; ensure itself deduplicates ready/in-flight work.
  void ensure()
}, { immediate: true })

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
  <footer class="app-footer" data-testid="app-footer">
    <div class="app-footer-filings">
      <a
        href="https://beian.miit.gov.cn/"
        target="_blank"
        rel="noopener noreferrer"
        data-testid="icp-filing-link"
      >{{ $t('home.icpFiling') }}</a>
      <span class="app-footer-separator" aria-hidden="true">|</span>
      <a
        class="app-footer-public-security"
        href="https://beian.mps.gov.cn/#/query/webSearch?code=35018202000555"
        target="_blank"
        rel="noopener noreferrer"
        data-testid="public-security-filing-link"
      >
        <img :src="publicSecurityFilingIcon" alt="" aria-hidden="true">
        <span>{{ $t('home.publicSecurityFiling') }}</span>
      </a>
    </div>
    <p class="app-footer-disclaimer" data-testid="wargaming-disclaimer">{{ $t('home.wargamingDisclaimer') }}</p>
  </footer>
  <GlobalErrorDialog :error="globalError" :visible="showGlobalError" @close="closeGlobalError" />
</template>

<style scoped>
/* Keep the shared footer at the viewport bottom on short pages without pinning it over content. */
:global(#app) {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.app-footer {
  margin-top: auto;
}

.app-footer a {
  color: var(--text-sub);
}

.app-footer-disclaimer {
  color: var(--text-sub);
}

.app-footer-filings {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 4px 8px;
  min-width: 0;
}

.app-footer-public-security {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.app-footer-public-security img {
  width: 16px;
  height: 16px;
  object-fit: contain;
}

.app-footer-disclaimer {
  flex-basis: 100%;
  margin: 0;
}

@media (width < 768px) {
  .app-footer-filings {
    column-gap: 6px;
  }
}
</style>
