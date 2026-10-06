<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { Shield } from 'lucide-vue-next'
import ReplayCapabilityAuthGate from '../components/ReplayCapabilityAuthGate.vue'
import Banner from '../components/Banner.vue'
import { useAuth } from '../composables/useAuth.js'
import { viewFromRoute } from './navigation.js'
import { replayInitialCapability, VIEW_COMPONENTS } from './viewRegistry.js'

const route = useRoute()
const { authenticated, isTournamentAdmin } = useAuth()
const activeView = computed(() => viewFromRoute(route))
// 装甲查看器匿名可用，ViewHost 只保留锦标赛管理页的登录门。
const tournamentAdmin = computed(() => ['tournament-points-config', 'tournament-points-admin'].includes(activeView.value))
const tournamentNeedsLogin = computed(() => tournamentAdmin.value && !authenticated.value)
const tournamentDenied = computed(() => tournamentAdmin.value && authenticated.value
  && !isTournamentAdmin.value)
const loginDestination = computed(() => ({ path: route.path, query: { ...route.query }, hash: route.hash }))
const currentView = computed(() => VIEW_COMPONENTS[activeView.value] || VIEW_COMPONENTS.replay)
const initialCapability = computed(() => replayInitialCapability(activeView.value))
</script>

<template>
  <main id="main" class="app-main">
    <ReplayCapabilityAuthGate
      v-if="tournamentNeedsLogin"
      :icon="Shield"
      :title="$t('tournament.adminTitle')"
      :description="$t('tournament.loginRequired')"
      :login-destination="loginDestination"
    />
    <Banner v-if="tournamentDenied" tone="danger">{{ $t('tournament.adminRequired') }}</Banner>
    <!-- 回放工作台是唯一 capability host：五种能力切换、从装甲查看器返回都保留同一个工作台实例 -->
    <KeepAlive :include="['ReplayWorkspace']">
      <component v-if="!tournamentNeedsLogin && !tournamentDenied" :is="currentView" :initial-capability="initialCapability" />
    </KeepAlive>
  </main>
</template>

<style scoped>
/* 顶栏是 fixed：内容区只在这里让出一次高度（含顶部安全区） */
.app-main {
  flex: 1 0 auto;
  padding-top: calc(var(--header-h) + env(safe-area-inset-top));
}
</style>
