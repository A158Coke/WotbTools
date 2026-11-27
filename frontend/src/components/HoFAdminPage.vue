<script setup lang="ts">
import { computed, inject, onMounted, ref, watch } from 'vue'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { useBreakpoint } from '../composables/useBreakpoint.js'
import { useAuth } from '../composables/useAuth.js'
import { useI18n } from 'vue-i18n'
import { HOF_PENDING_COUNT_KEY } from '../shared/hofPendingCount.js'
import AppButton from './AppButton.vue'
import Banner from './Banner.vue'
import ShowcaseHero from './ShowcaseHero.vue'
import HoFAdminAudit from './HoFAdminAudit.vue'
import HoFAdminModeration from './HoFAdminModeration.vue'
import HoFAdminRecords from './HoFAdminRecords.vue'

const { initPromise, isAuthenticated, tokenParsed, login } = useAuth()
const { availability, requireFeature } = useFeatureGate()
const { isDrawerShell } = useBreakpoint()
const hofAvailability = computed(() => availability(Feature.HALL_OF_FAME))

const canAdmin = computed(() => {
  const roles = tokenParsed.value?.realm_access?.roles
  return Array.isArray(roles) && (roles.includes('HoF-admin') || roles.includes('wotbtools-admin'))
})

const pending = inject(HOF_PENDING_COUNT_KEY, null)
const { t, locale } = useI18n()
const pendingStatus = computed(() => pending?.status.value ?? 'hidden')
const pendingDescription = computed(() => {
  const sample = pending?.snapshot.value
  if (pendingStatus.value === 'loading') return t(sample ? 'hofAdmin.pendingCount.updating' : 'hofAdmin.pendingCount.loading')
  if (pendingStatus.value === 'unknown') return t('hofAdmin.pendingCount.' + (pending?.reason.value ?? 'unavailable'))
  if (!sample || pendingStatus.value !== 'ready') return ''
  const time = new Intl.DateTimeFormat(locale.value, { dateStyle: 'short', timeStyle: 'short' }).format(sample.sampledAt)
  return t(sample.total ? 'hofAdmin.pendingCount.totals' : 'hofAdmin.pendingCount.empty', { ...sample, time })
})

const authPhase = ref('init')
const denied = ref(false)
const activeTab = ref('records')
const ADMIN_TABS = [
  { key: 'records', label: 'hofAdmin.recordsTab' },
  { key: 'audit', label: 'hofAdmin.auditTab' },
  { key: 'hundred', label: 'hundredAdmin.tab' },
  { key: 'mark3', label: 'mark3Admin.tab' },
]
const size = ref(50)
const ready = computed(() => authPhase.value === 'ready' && canAdmin.value)
const section = ref<{ reload: () => unknown } | null>(null)

let initializing = false
async function initialize() {
  if (initializing || !requireFeature(Feature.HALL_OF_FAME)) return
  initializing = true
  try {
    await initPromise
  } catch {
    // init 失败视作未登录。
  } finally {
    initializing = false
  }
  if (!availability(Feature.HALL_OF_FAME).available) return
  if (!isAuthenticated()) {
    authPhase.value = 'login'
    login('hof-admin')
    return
  }
  authPhase.value = 'ready'
  if (!canAdmin.value) denied.value = true
}
onMounted(initialize)
watch(() => hofAvailability.value.available, (available, previous) => {
  if (!available || previous !== false) return
  if (authPhase.value === 'init') { void initialize(); return }
  if (!canAdmin.value) return
  section.value?.reload()
})
</script>

<template>
  <div class="hof-admin" :class="{ 'uses-drawer': isDrawerShell }">
    <Banner v-if="!hofAvailability.pending && !hofAvailability.available" tone="info" data-testid="hof-admin-connectivity"><p>{{ $t(hofAvailability.messageKey ?? '') }}</p></Banner>
    <div v-if="authPhase === 'login'" class="hof-admin-login muted">{{ $t('hofAdmin.login') }}</div>

    <div v-else-if="denied" class="hof-admin-denied">
      <h2>{{ $t('hofAdmin.deniedTitle') }}</h2>
      <p>{{ $t('hofAdmin.deniedHint') }}</p>
    </div>

    <template v-else>
      <ShowcaseHero compact section="admin" :kicker="$t('more.sections.admin')" :title="$t('hofAdmin.cardTitle')" />
      <div v-if="pendingStatus !== 'hidden'" class="hof-pending-summary" data-testid="hof-pending-summary">
        <p role="status">{{ pendingDescription }}</p>
        <AppButton type="button" size="sm" :disabled="pendingStatus === 'loading'" data-testid="hof-pending-refresh" @click="pending?.retry()">
          {{ $t('hofAdmin.pendingCount.refresh') }}
        </AppButton>
      </div>
      <div class="hof-admin-tabs" role="tablist" :aria-label="$t('hofAdmin.tabsLabel')">
        <button
          v-for="tab in ADMIN_TABS"
          :key="tab.key"
          type="button"
          role="tab"
          :aria-selected="activeTab === tab.key"
          :class="{ active: activeTab === tab.key }"
          @click="activeTab = tab.key"
        >{{ $t(tab.label) }}</button>
      </div>

      <KeepAlive>
        <HoFAdminRecords v-if="activeTab === 'records'" key="records" ref="section" v-model:size="size" :ready="ready" />
        <HoFAdminAudit v-else-if="activeTab === 'audit'" key="audit" ref="section" :size="size" />
        <HoFAdminModeration v-else-if="activeTab === 'hundred'" key="hundred" ref="section" v-model:size="size" :capture-pending-settlement="pending?.captureInvalidation" kind="hundred" />
        <HoFAdminModeration v-else key="mark3" ref="section" v-model:size="size" :capture-pending-settlement="pending?.captureInvalidation" kind="mark3" />
      </KeepAlive>
    </template>
  </div>
</template>

<style scoped>
.hof-admin { padding-block: var(--space-6) var(--space-12); color: var(--color-text-primary); font: var(--type-body); }

.hof-pending-summary { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); margin-block-end: var(--space-3); }
.hof-pending-summary p { min-width: 0; margin: 0; color: var(--color-text-secondary); font: var(--type-body); }

.hof-admin-tabs {
  position: sticky;
  top: calc(var(--header-h) + var(--space-2));
  z-index: var(--z-sticky);
  display: flex;
  gap: var(--space-1);
  margin-bottom: var(--space-4);
  padding: var(--space-2);
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scrollbar-width: thin;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-1);
  box-shadow: var(--elevation-2);
}

.hof-admin-tabs button {
  flex: none;
  min-height: var(--control-h-md);
  padding: 0 var(--space-4);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font: var(--type-body);
  white-space: nowrap;
  cursor: pointer;
}

.hof-admin-tabs button.active {
  border-color: color-mix(in oklab, var(--color-accent) 45%, var(--color-border-subtle));
  background: color-mix(in oklab, var(--color-accent) 14%, var(--color-surface-1));
  color: var(--color-accent-text);
  font-weight: 600;
}

.hof-admin-tabs button:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

@media (hover: hover) {
  .hof-admin-tabs button:hover:not(.active) { background: var(--color-surface-2); color: var(--color-text-primary); }
}

.hof-admin-login { padding: var(--space-6) var(--space-1); color: var(--color-text-secondary); }
.hof-admin-denied { max-width: 52ch; margin: var(--space-12) auto; text-align: center; }
.hof-admin-denied h2 { margin: 0 0 var(--space-2); color: var(--color-text-primary); font: var(--type-h2); }
.hof-admin-denied p { color: var(--color-text-secondary); }

@media (width < 768px) {
  .hof-admin { padding-block: var(--space-3) var(--space-10); }
}
.uses-drawer .hof-admin-tabs,
.uses-drawer :deep(.hof-admin-table th),
.uses-drawer :deep(.hof-admin-table .actions) { position: static; }
</style>
