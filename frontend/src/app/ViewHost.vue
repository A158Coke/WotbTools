<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Shield } from 'lucide-vue-next'
import ReplayCapabilityAuthGate from '../components/ReplayCapabilityAuthGate.vue'
import Banner from '../components/Banner.vue'
import AppButton from '../components/AppButton.vue'
import { useCreatorAvailability } from '../composables/useCreatorAvailability.js'
import { useAuth } from '../composables/useAuth.js'
import { locationForView, viewFromRoute } from './navigation.js'
import { replayInitialCapability, VIEW_COMPONENTS } from './viewRegistry.js'

const route = useRoute(), router = useRouter()
const { authenticated, isTournamentAdmin, isContentAdmin } = useAuth()
const activeView = computed(() => viewFromRoute(route))
const { typeAvailable, typeVisible, available: creatorsAvailable, directoryVisible, contentKnown, error: creatorsError, loading: creatorsChecking, refresh: retryCreators } = useCreatorAvailability()
const recommendationType = computed(() => activeView.value === 'recommended-videos' ? 'VIDEO' : 'UP')
const recommendationList = computed(() => ['creators', 'recommended-videos'].includes(activeView.value))
const creatorUnavailable = computed(() => recommendationList.value ? !typeVisible(recommendationType.value)
  : activeView.value === 'recommendations' ? !directoryVisible.value : activeView.value === 'creators-config' && !creatorsAvailable.value)
const creatorsNotPublished = computed(() => contentKnown.value && (recommendationList.value
  ? typeAvailable(recommendationType.value) && !typeVisible(recommendationType.value) : creatorsAvailable.value && !directoryVisible.value))
// 装甲查看器匿名可用，ViewHost 只保留管理页的登录/角色门：内容配置归 content-admin，积分赛归 tournament-admin。
const adminView = computed(() => ['tournament-points-config', 'tournament-points-admin', 'creators-config'].includes(activeView.value))
const adminAllowed = computed(() => activeView.value === 'creators-config' ? isContentAdmin.value : isTournamentAdmin.value)
const adminNeedsLogin = computed(() => adminView.value && !authenticated.value)
const adminDenied = computed(() => adminView.value && authenticated.value && !adminAllowed.value)
const adminTitleKey = computed(() => activeView.value === 'creators-config' ? 'creators.configTitle' : 'tournament.adminTitle')
// 内容管理页的登录/权限提示必须说「内容管理员」，不能复用联赛文案（否则会告诉已具备联赛权限的人缺联赛权限）。
const adminLoginKey = computed(() => activeView.value === 'creators-config' ? 'creators.loginRequired' : 'tournament.loginRequired')
const adminDeniedKey = computed(() => activeView.value === 'creators-config' ? 'creators.adminRequired' : 'tournament.adminRequired')
const loginDestination = computed(() => ({ path: route.path, query: { ...route.query }, hash: route.hash }))
const currentView = computed(() => VIEW_COMPONENTS[activeView.value] || VIEW_COMPONENTS.replay)
const initialCapability = computed(() => replayInitialCapability(activeView.value))
</script>

<template>
  <main id="main" class="app-main">
    <ReplayCapabilityAuthGate
      v-if="adminNeedsLogin"
      :icon="Shield"
      :title="$t(adminTitleKey)"
      :description="$t(adminLoginKey)"
      :login-destination="loginDestination"
    />
    <Banner v-if="adminDenied" tone="danger" data-testid="admin-required">{{ $t(adminDeniedKey) }}</Banner>
    <Banner v-if="creatorUnavailable && !adminNeedsLogin && !adminDenied" :data-testid="creatorsNotPublished ? 'creators-not-published' : 'creators-unavailable'">
      {{ $t(creatorsChecking ? 'creators.checkingAvailability' : creatorsError ? 'creators.availabilityFailed' : creatorsNotPublished ? 'creators.notPublished' : 'creators.notAvailable') }}
      <AppButton :disabled="creatorsChecking" data-testid="creators-availability-retry" @click="retryCreators">{{ $t('creators.retry') }}</AppButton>
      <AppButton v-if="recommendationList" data-testid="recommendations-back" @click="router.push(locationForView('recommendations', route))">{{ $t('creators.backToTypes') }}</AppButton>
    </Banner>
    <!-- 回放工作台是唯一 capability host：五种能力切换、从装甲查看器返回都保留同一个工作台实例 -->
    <KeepAlive :include="['ReplayWorkspace']">
      <component v-if="!adminNeedsLogin && !adminDenied && !creatorUnavailable" :is="currentView" :initial-capability="initialCapability" v-bind="recommendationList ? { type: recommendationType } : {}" />
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
