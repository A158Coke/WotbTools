<script setup>
import { computed, getCurrentInstance, inject } from 'vue'
import {
  BookOpen, Box, ChevronRight, Cpu, Crosshair, Download, ExternalLink, FileText, FlaskConical, Gauge,
  Heart, History, Mail, MessageSquare, ShieldCheck, Users,
} from 'lucide-vue-next'
import { useAuth } from '../composables/useAuth.js'
import { useUiProfile } from '../composables/useUiProfile.js'
import { isAndroidApp } from '../composables/usePlatformBridge.js'
import { NAVIGATE_VIEW_KEY } from '../shared/navigation.js'
import PageHeader from './PageHeader.vue'
import SegmentedControl from './SegmentedControl.vue'

// "更多"：显示设置、工具、管理、关于与支持（审计 §8.1）。
// 账户（登录 / 个人中心 / 登出）不在这里，由顶栏头像进入 profile。
const navigate = inject(NAVIGATE_VIEW_KEY)
const { isAdmin, isHofAdmin } = useAuth()
const { uiProfilePreference, setUiProfile } = useUiProfile()
const i18n = getCurrentInstance().proxy.$i18n

const FEEDBACK_URL = 'https://github.com/A158Coke/WotbTools/issues/new'
const LANGUAGES = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
  { value: 'ru', label: 'Русский' },
]

function setLocale(value) {
  i18n.locale = value
  localStorage.setItem('wotb-lang', value)
}

const groups = computed(() => [
  {
    id: 'tools',
    titleKey: 'more.sections.tools',
    links: isAdmin.value
      ? [
          { view: 'agent-replay', labelKey: 'agentNav.replay', icon: Box },
          { view: 'agent-shots', labelKey: 'agentNav.shots', icon: Crosshair },
          { view: 'agent-tankopedia', labelKey: 'agentNav.tanks', icon: BookOpen },
        ]
      : [],
  },
  {
    id: 'admin',
    titleKey: 'more.sections.admin',
    links: [
      isAdmin.value && { view: 'admin-users', labelKey: 'admin.title', icon: Users },
      isHofAdmin.value && { view: 'hof-admin', labelKey: 'hofAdmin.cardTitle', icon: ShieldCheck },
      isAdmin.value && { view: 'rating-v2', labelKey: 'ratingV2.title', icon: Gauge },
      isAdmin.value && { view: 'playback-qa', labelKey: 'more.playbackQa', icon: FlaskConical },
    ].filter(Boolean),
  },
  {
    id: 'about',
    titleKey: 'more.sections.about',
    links: [
      { view: 'history', labelKey: 'history.btn', icon: History },
      { view: 'technical-evolution', labelKey: 'technicalEvolution.btn', icon: Cpu },
      { view: 'rating-docs', labelKey: 'more.ratingDocs', icon: FileText },
      { view: 'contact', labelKey: 'contact.nav', icon: Mail },
      { view: 'sponsor', labelKey: 'more.sponsor', icon: Heart },
      !isAndroidApp() && { view: 'android', labelKey: 'android.nav', icon: Download },
    ].filter(Boolean),
    feedback: true,
  },
].filter(group => group.links.length))
</script>

<template>
  <div class="more-page" data-testid="more-page">
    <PageHeader :title="$t('more.title')" />

    <section class="more-section" aria-labelledby="more-display">
      <h2 id="more-display" class="more-section-title">{{ $t('more.sections.display') }}</h2>
      <div class="more-card">
        <div class="more-setting">
          <span class="more-setting-label">{{ $t('uiProfile.title') }}</span>
          <SegmentedControl
            :model-value="uiProfilePreference"
            :options="[{ value: 'showcase', label: $t('uiProfile.showcase') }, { value: 'classic', label: $t('uiProfile.classic') }, { value: 'auto', label: $t('uiProfile.auto') }]"
            :aria-label="$t('uiProfile.title')"
            data-testid="more-ui-profile"
            @update:model-value="setUiProfile"
          />
        </div>
        <div class="more-setting">
          <span class="more-setting-label">{{ $t('more.language') }}</span>
          <SegmentedControl
            :model-value="$i18n.locale"
            :options="LANGUAGES"
            :aria-label="$t('more.language')"
            data-testid="more-language"
            @update:model-value="setLocale"
          />
        </div>
      </div>
    </section>

    <section v-for="group in groups" :key="group.id" class="more-section" :aria-labelledby="`more-${group.id}`">
      <h2 :id="`more-${group.id}`" class="more-section-title">{{ $t(group.titleKey) }}</h2>
      <div class="more-card">
        <button
          v-for="link in group.links"
          :key="link.view"
          type="button"
          class="more-row"
          :data-testid="`more-link-${link.view}`"
          @click="navigate(link.view)"
        >
          <component :is="link.icon" :size="20" aria-hidden="true" />
          <span class="more-row-label">{{ $t(link.labelKey) }}</span>
          <ChevronRight :size="20" aria-hidden="true" />
        </button>
        <a
          v-if="group.feedback"
          class="more-row"
          :href="FEEDBACK_URL"
          target="_blank"
          rel="noopener noreferrer"
          data-testid="more-link-feedback"
        >
          <MessageSquare :size="20" aria-hidden="true" />
          <span class="more-row-label">{{ $t('app.feedback') }}</span>
          <ExternalLink :size="16" aria-hidden="true" />
        </a>
      </div>
    </section>
  </div>
</template>

<style scoped>
.more-page {
  width: 100%;
  max-width: 760px;
  margin-inline: auto;
  padding: var(--space-6) var(--gutter) var(--space-12);
}

.more-section + .more-section { margin-top: var(--space-6); }

.more-section-title {
  margin: 0 0 var(--space-2);
  color: var(--color-text-secondary);
  font: var(--type-caption);
  font-weight: 600;
}

.more-card {
  overflow: hidden;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
  box-shadow: var(--elevation-1);
}

.more-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: var(--row-h);
  padding: var(--space-2) var(--space-4);
  border: 0;
  border-top: 1px solid var(--color-border-subtle);
  background: transparent;
  color: var(--color-text-primary);
  font: var(--type-body);
  text-align: start;
  text-decoration: none;
  cursor: pointer;
}

.more-row:first-child { border-top: 0; }
.more-row > svg { flex: none; color: var(--color-text-secondary); }
.more-row-label { flex: 1 1 auto; min-width: 0; }
.more-row:focus-visible { outline: var(--focus-outline); outline-offset: calc(var(--focus-outline-offset) * -1); }

.more-setting {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
  padding: var(--space-3) var(--space-4);
}

.more-setting + .more-setting { border-top: 1px solid var(--color-border-subtle); }
.more-setting-label { color: var(--color-text-primary); font: var(--type-body); }

@media (hover: hover) {
  .more-row:hover { background: var(--color-surface-2); }
}
</style>
