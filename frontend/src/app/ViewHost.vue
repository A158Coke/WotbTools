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
// 装甲复现先过登录门：匿名不创建查看器，不启动场景；query 交给登录返回地址原样保留。
const armorNeedsLogin = computed(() => activeView.value === 'agent-armor' && !authenticated.value)
const tournamentAdmin = computed(() => ['tournament-points-config', 'tournament-points-admin'].includes(activeView.value))
const tournamentNeedsLogin = computed(() => tournamentAdmin.value && !authenticated.value)
const tournamentDenied = computed(() => tournamentAdmin.value && authenticated.value
  && !isTournamentAdmin.value)
const armorLoginDestination = computed(() => ({ path: route.path, query: { ...route.query }, hash: route.hash }))
const currentView = computed(() => VIEW_COMPONENTS[activeView.value] || VIEW_COMPONENTS.replay)
const initialCapability = computed(() => replayInitialCapability(activeView.value))
</script>

<template>
  <main id="main" class="app-main">
    <ReplayCapabilityAuthGate
      v-if="armorNeedsLogin || tournamentNeedsLogin"
      :icon="Shield"
      :title="$t(tournamentNeedsLogin ? 'tournament.adminTitle' : 'agentTanks.open3d_title')"
      :description="$t(tournamentNeedsLogin ? 'tournament.loginRequired' : 'workspace.login_required_armor')"
      :login-destination="armorLoginDestination"
    />
    <Banner v-if="tournamentDenied" tone="danger">{{ $t('tournament.adminRequired') }}</Banner>
    <!-- 回放工作台是唯一 capability host：五种能力切换、从装甲查看器返回都保留同一个工作台实例 -->
    <KeepAlive :include="['ReplayWorkspace']">
      <component v-if="!armorNeedsLogin && !tournamentNeedsLogin && !tournamentDenied" :is="currentView" :initial-capability="initialCapability" />
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
