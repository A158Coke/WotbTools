<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { Shield } from 'lucide-vue-next'
import ReplayCapabilityAuthGate from '../components/ReplayCapabilityAuthGate.vue'
import Banner from '../components/Banner.vue'
import AppButton from '../components/AppButton.vue'
import { useCreatorAvailability } from '../composables/useCreatorAvailability.js'
import { useAuth } from '../composables/useAuth.js'
import { viewFromRoute } from './navigation.js'
import { replayInitialCapability, VIEW_COMPONENTS } from './viewRegistry.js'

const route = useRoute()
const { authenticated, isTournamentAdmin } = useAuth()
const activeView = computed(() => viewFromRoute(route))
const { available: creatorsAvailable, directoryVisible, contentKnown, error: creatorsError, loading: creatorsChecking, refresh: retryCreators } = useCreatorAvailability()
const creatorUnavailable = computed(() => activeView.value === 'creators' ? !directoryVisible.value : activeView.value === 'creators-config' && !creatorsAvailable.value)
const creatorsNotPublished = computed(() => creatorsAvailable.value && contentKnown.value && !directoryVisible.value)
// 装甲查看器匿名可用，ViewHost 只保留锦标赛管理页的登录门。
const tournamentAdmin = computed(() => ['tournament-points-config', 'tournament-points-admin', 'creators-config'].includes(activeView.value))
const tournamentNeedsLogin = computed(() => tournamentAdmin.value && !authenticated.value)
const tournamentDenied = computed(() => tournamentAdmin.value && authenticated.value
  && !isTournamentAdmin.value)
const adminTitleKey = computed(() => activeView.value === 'creators-config' ? 'creators.configTitle' : 'tournament.adminTitle')
const loginDestination = computed(() => ({ path: route.path, query: { ...route.query }, hash: route.hash }))
const currentView = computed(() => VIEW_COMPONENTS[activeView.value] || VIEW_COMPONENTS.replay)
const initialCapability = computed(() => replayInitialCapability(activeView.value))
</script>

<template>
  <main id="main" class="app-main">
    <ReplayCapabilityAuthGate
      v-if="tournamentNeedsLogin"
      :icon="Shield"
      :title="$t(adminTitleKey)"
      :description="$t('tournament.loginRequired')"
      :login-destination="loginDestination"
    />
    <Banner v-if="tournamentDenied" tone="danger">{{ $t('tournament.adminRequired') }}</Banner>
    <Banner v-if="creatorUnavailable && !tournamentNeedsLogin && !tournamentDenied" :data-testid="creatorsNotPublished ? 'creators-not-published' : 'creators-unavailable'">
      {{ $t(creatorsChecking ? 'creators.checkingAvailability' : creatorsError ? 'creators.availabilityFailed' : creatorsNotPublished ? 'creators.notPublished' : 'creators.notAvailable') }}
      <AppButton :disabled="creatorsChecking" data-testid="creators-availability-retry" @click="retryCreators">{{ $t('creators.retry') }}</AppButton>
    </Banner>
    <!-- 回放工作台是唯一 capability host：五种能力切换、从装甲查看器返回都保留同一个工作台实例 -->
    <KeepAlive :include="['ReplayWorkspace']">
      <component v-if="!tournamentNeedsLogin && !tournamentDenied && !creatorUnavailable" :is="currentView" :initial-capability="initialCapability" />
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
