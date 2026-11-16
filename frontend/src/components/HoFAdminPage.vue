<script setup lang="ts">
// 名人堂管理页：只持有管理员门控（auth 初始化 → 登录 / 无权限 / 就绪）、分区切换与各分区共享的每页条数。
// 每个分区的列表、筛选、选择集、审核详情与批量删除状态都归各自的 HoFAdmin* 组件；HTTP 只经 api/hall-of-fame.ts。
import { computed, onMounted, ref, watch } from 'vue'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { useAuth } from '../composables/useAuth.js'
import Banner from './Banner.vue'
import ShowcaseHero from './ShowcaseHero.vue'
import HoFAdminAudit from './HoFAdminAudit.vue'
import HoFAdminModeration from './HoFAdminModeration.vue'
import HoFAdminRecords from './HoFAdminRecords.vue'

const { initPromise, isAuthenticated, tokenParsed, login } = useAuth()
const { availability, requireFeature } = useFeatureGate()
const hofAvailability = computed(() => availability(Feature.HALL_OF_FAME))

// 授权在 auth 初始化完成后决定（不先渲染再等 403）；直接访问无权限 → 明确无权限状态。
const canAdmin = computed(() => {
  const roles = tokenParsed.value?.realm_access?.roles
  return Array.isArray(roles) && (roles.includes('HoF-admin') || roles.includes('wotbtools-admin'))
})

const authPhase = ref('init') // init | login | ready
const denied = ref(false)
const activeTab = ref('records')
const ADMIN_TABS = [
  { key: 'records', label: 'hofAdmin.recordsTab' },
  { key: 'audit', label: 'hofAdmin.auditTab' },
  { key: 'hundred', label: 'hundredAdmin.tab' },
  { key: 'mark3', label: 'mark3Admin.tab' },
]
// 每页条数跨分区共享：任一分区改动后只重载当前分区，其他分区下次加载时使用新值。
const size = ref(50)
const ready = computed(() => authPhase.value === 'ready' && canAdmin.value)
// 当前分区实例（KeepAlive 保活；切回已有数据的分区不重载）。
const section = ref<{ reload: () => unknown } | null>(null)

let initializing = false
async function initialize() {
  if (initializing || !requireFeature(Feature.HALL_OF_FAME)) return
  initializing = true
  try {
    // 只等 bootstrap 落定；登录态只认当前 reactive session，绝不读历史 promise 的值
    // （它是一次性 init 交易的结果，logout 之后仍可能停留在 true）。
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
  // 就绪后单场分区经 ready prop 自行加载列表与车辆选项。
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
  <div class="hof-admin">
    <Banner v-if="!hofAvailability.pending && !hofAvailability.available" tone="info" data-testid="hof-admin-connectivity"><p>{{ $t(hofAvailability.messageKey ?? '') }}</p></Banner>
    <!-- 登录流程 -->
    <div v-if="authPhase === 'login'" class="hof-admin-login muted">{{ $t('hofAdmin.login') }}</div>

    <!-- 无权限 -->
    <div v-else-if="denied" class="hof-admin-denied">
      <h2>{{ $t('hofAdmin.deniedTitle') }}</h2>
      <p>{{ $t('hofAdmin.deniedHint') }}</p>
    </div>

    <template v-else>
      <ShowcaseHero compact section="admin" :kicker="$t('more.sections.admin')" :title="$t('hofAdmin.cardTitle')" />
      <!-- 页面级分区（design-language §7 Tabs）：窄屏横向滚动，不再被裁掉（审计 PG-10） -->
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
        <HoFAdminModeration v-else-if="activeTab === 'hundred'" key="hundred" ref="section" v-model:size="size" kind="hundred" />
        <HoFAdminModeration v-else key="mark3" ref="section" v-model:size="size" kind="mark3" />
      </KeepAlive>
    </template>
  </div>
</template>

<style scoped>
/* 设计语言 token（docs/frontend/design-language.md）：本组件只持有页面容器、Tab 条与门控状态的样式；
 * 各分区共用外观在 HoFAdminShared.css（各分区 scoped 引用），审核详情外观在 HoFReviewPane。 */
.hof-admin { padding-block: var(--space-6) var(--space-12); color: var(--color-text-primary); font: var(--type-body); }

/* Tabs：吸顶于顶栏下方；窄屏横向滚动而不是被裁掉（审计 PG-10） */
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
  .hof-admin-tabs { position: static; }
}
</style>
