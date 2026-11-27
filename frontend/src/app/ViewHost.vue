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
const { authenticated, isAdmin, isTournamentAdmin, isContentAdmin } = useAuth()
const activeView = computed(() => viewFromRoute(route))
const { typeAvailable, typeVisible, available: creatorsAvailable, directoryVisible, contentKnown, error: creatorsError, loading: creatorsChecking, refresh: retryCreators } = useCreatorAvailability()
const recommendationType = computed(() => activeView.value === 'recommended-videos' ? 'VIDEO'
  : activeView.value === 'creators' ? 'UP' : typeVisible('UP') ? 'UP' : 'VIDEO')
const recommendationList = computed(() => ['creators', 'recommended-videos', 'recommendations'].includes(activeView.value))
const creatorUnavailable = computed(() => activeView.value === 'recommendations' ? !directoryVisible.value
  : recommendationList.value ? !typeVisible(recommendationType.value) : activeView.value === 'creators-config' && !creatorsAvailable.value)
const creatorsNotPublished = computed(() => contentKnown.value && (recommendationList.value && activeView.value !== 'recommendations'
  ? typeAvailable(recommendationType.value) && !typeVisible(recommendationType.value) : creatorsAvailable.value && !directoryVisible.value))
const adminView = computed(() => ['tournament-points-config', 'tournament-points-admin', 'creators-config', 'admin-users', 'admin-battle-data', 'admin-ai-review-feedback', 'admin-site-feedback'].includes(activeView.value))
const adminCopy = computed(() => {
  if (activeView.value === 'admin-users') {
    return { allowed: isAdmin.value, title: 'admin.title', login: 'admin.loginRequired', denied: 'adminPreview.denied' }
  }
  if (activeView.value === 'admin-battle-data') {
    return { allowed: isAdmin.value, title: 'battleDataAdmin.title', login: 'battleDataAdmin.loginRequired', denied: 'battleDataAdmin.adminRequired' }
  }
  if (activeView.value === 'admin-ai-review-feedback') {
    return { allowed: isAdmin.value, title: 'aiFeedback.adminTitle', login: 'aiFeedback.loginRequired', denied: 'aiFeedback.adminRequired' }
  }
  if (activeView.value === 'admin-site-feedback') {
    return { allowed: isAdmin.value, title: 'siteFeedback.adminTitle', login: 'siteFeedback.loginRequired', denied: 'siteFeedback.adminRequired' }
  }
  if (activeView.value === 'creators-config') {
    return { allowed: isContentAdmin.value, title: 'creators.configTitle', login: 'creators.loginRequired', denied: 'creators.adminRequired' }
  }
  return { allowed: isTournamentAdmin.value, title: 'tournament.adminTitle', login: 'tournament.loginRequired', denied: 'tournament.adminRequired' }
})
const adminAllowed = computed(() => adminCopy.value.allowed)
const adminNeedsLogin = computed(() => adminView.value && !authenticated.value)
const adminDenied = computed(() => adminView.value && authenticated.value && !adminAllowed.value)
const adminTitleKey = computed(() => adminCopy.value.title)
const adminLoginKey = computed(() => adminCopy.value.login)
const adminDeniedKey = computed(() => adminCopy.value.denied)
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
      <AppButton v-if="recommendationList && activeView !== 'recommendations'" data-testid="recommendations-back" @click="router.push(locationForView('recommendations', route))">{{ $t('creators.backToTypes') }}</AppButton>
    </Banner>
    <KeepAlive :include="['ReplayWorkspace']">
      <component v-if="!adminNeedsLogin && !adminDenied && !creatorUnavailable" :is="currentView" :initial-capability="initialCapability" v-bind="recommendationList ? { type: recommendationType } : {}" />
    </KeepAlive>
  </main>
</template>

<style scoped>
.app-main {
  flex: 1 0 auto;
  padding-top: calc(var(--header-block) + env(safe-area-inset-top));
}

:global(.app-main:has(> .view-loading)),
:global(.app-main:has(> .view-load-error)) {
  display: flex;
  flex-direction: column;
}
</style>
