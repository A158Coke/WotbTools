<script setup>
import { computed, getCurrentInstance, inject } from 'vue'
import {
  BookOpen, Box, ChevronRight, Cpu, Crosshair, Download, ExternalLink, FileText, FlaskConical, Gauge,
  Heart, History, Mail, MessageSquare, ShieldCheck, UserRound, Users,
} from 'lucide-vue-next'
import { useAuth } from '../composables/useAuth.js'
import { useUiProfile } from '../composables/useUiProfile.js'
import { isAndroidApp } from '../composables/usePlatformBridge.js'
import { NAVIGATE_VIEW_KEY } from '../shared/navigation.js'
import AppButton from './AppButton.vue'
import PageHeader from './PageHeader.vue'
import SegmentedControl from './SegmentedControl.vue'

// "我的"：账户、显示设置、工具、管理、关于（审计 §8.1）。取代原顶栏用户菜单的全部入口。
const navigate = inject(NAVIGATE_VIEW_KEY)
const { login, logout, isAuthenticated, displayName, isAdmin, isHofAdmin } = useAuth()
const { uiProfile, setUiProfile } = useUiProfile()
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

const tools = computed(() => (isAdmin.value
  ? [
      { view: 'agent-replay', labelKey: 'agentNav.replay', icon: Box },
      { view: 'agent-shots', labelKey: 'agentNav.shots', icon: Crosshair },
      { view: 'agent-tankopedia', labelKey: 'agentNav.tanks', icon: BookOpen },
    ]
  : []))

const adminLinks = computed(() => [
  isAdmin.value && { view: 'admin-users', labelKey: 'admin.title', icon: Users },
  isHofAdmin.value && { view: 'hof-admin', labelKey: 'hofAdmin.cardTitle', icon: ShieldCheck },
  isAdmin.value && { view: 'rating-v2', labelKey: 'ratingV2.title', icon: Gauge },
  isAdmin.value && { view: 'playback-qa', labelKey: 'me.playbackQa', icon: FlaskConical },
].filter(Boolean))

const aboutLinks = computed(() => [
  { view: 'history', labelKey: 'history.btn', icon: History },
  { view: 'technical-evolution', labelKey: 'technicalEvolution.btn', icon: Cpu },
  { view: 'rating-docs', labelKey: 'me.ratingDocs', icon: FileText },
  { view: 'contact', labelKey: 'contact.nav', icon: Mail },
  { view: 'sponsor', labelKey: 'me.sponsor', icon: Heart },
  !isAndroidApp() && { view: 'android', labelKey: 'android.nav', icon: Download },
].filter(Boolean))
</script>

<template>
  <div class="me-page" data-testid="me-page">
    <PageHeader :title="$t('me.title')" />

    <section class="me-section" aria-labelledby="me-account">
      <h2 id="me-account" class="me-section-title">{{ $t('me.sections.account') }}</h2>
      <div class="me-card">
        <template v-if="isAuthenticated()">
          <div class="me-account" data-testid="me-account-name">
            <UserRound :size="24" aria-hidden="true" />
            <span class="me-account-name">{{ displayName }}</span>
          </div>
          <button type="button" class="me-row" data-testid="me-link-profile" @click="navigate('profile')">
            <span class="me-row-label">{{ $t('app.profile') }}</span>
            <ChevronRight :size="20" aria-hidden="true" />
          </button>
          <div class="me-card-actions">
            <AppButton variant="danger" size="sm" data-testid="me-logout" @click="logout()">{{ $t('profile.logout') }}</AppButton>
          </div>
        </template>
        <div v-else class="me-signed-out">
          <p class="me-signed-out-title">{{ $t('me.signedOutTitle') }}</p>
          <p class="me-signed-out-hint">{{ $t('me.signedOutHint') }}</p>
          <AppButton variant="primary" data-testid="me-login" @click="login('me')">{{ $t('app.login') }}</AppButton>
        </div>
      </div>
    </section>

    <section class="me-section" aria-labelledby="me-display">
      <h2 id="me-display" class="me-section-title">{{ $t('me.sections.display') }}</h2>
      <div class="me-card">
        <div class="me-setting">
          <span class="me-setting-label">{{ $t('uiProfile.title') }}</span>
          <SegmentedControl
            :model-value="uiProfile"
            :options="[{ value: 'showcase', label: $t('uiProfile.showcase') }, { value: 'classic', label: $t('uiProfile.classic') }]"
            :aria-label="$t('uiProfile.title')"
            data-testid="me-ui-profile"
            @update:model-value="setUiProfile"
          />
        </div>
        <div class="me-setting">
          <span class="me-setting-label">{{ $t('me.language') }}</span>
          <SegmentedControl
            :model-value="$i18n.locale"
            :options="LANGUAGES"
            :aria-label="$t('me.language')"
            data-testid="me-language"
            @update:model-value="setLocale"
          />
        </div>
      </div>
    </section>

    <section v-if="tools.length" class="me-section" aria-labelledby="me-tools">
      <h2 id="me-tools" class="me-section-title">{{ $t('me.sections.tools') }}</h2>
      <div class="me-card">
        <button
          v-for="link in tools"
          :key="link.view"
          type="button"
          class="me-row"
          :data-testid="`me-link-${link.view}`"
          @click="navigate(link.view)"
        >
          <component :is="link.icon" :size="20" aria-hidden="true" />
          <span class="me-row-label">{{ $t(link.labelKey) }}</span>
          <ChevronRight :size="20" aria-hidden="true" />
        </button>
      </div>
    </section>

    <section v-if="adminLinks.length" class="me-section" aria-labelledby="me-admin">
      <h2 id="me-admin" class="me-section-title">{{ $t('me.sections.admin') }}</h2>
      <div class="me-card">
        <button
          v-for="link in adminLinks"
          :key="link.view"
          type="button"
          class="me-row"
          :data-testid="`me-link-${link.view}`"
          @click="navigate(link.view)"
        >
          <component :is="link.icon" :size="20" aria-hidden="true" />
          <span class="me-row-label">{{ $t(link.labelKey) }}</span>
          <ChevronRight :size="20" aria-hidden="true" />
        </button>
      </div>
    </section>

    <section class="me-section" aria-labelledby="me-about">
      <h2 id="me-about" class="me-section-title">{{ $t('me.sections.about') }}</h2>
      <div class="me-card">
        <button
          v-for="link in aboutLinks"
          :key="link.view"
          type="button"
          class="me-row"
          :data-testid="`me-link-${link.view}`"
          @click="navigate(link.view)"
        >
          <component :is="link.icon" :size="20" aria-hidden="true" />
          <span class="me-row-label">{{ $t(link.labelKey) }}</span>
          <ChevronRight :size="20" aria-hidden="true" />
        </button>
        <a class="me-row" :href="FEEDBACK_URL" target="_blank" rel="noopener noreferrer" data-testid="me-link-feedback">
          <MessageSquare :size="20" aria-hidden="true" />
          <span class="me-row-label">{{ $t('app.feedback') }}</span>
          <ExternalLink :size="16" aria-hidden="true" />
        </a>
      </div>
    </section>
  </div>
</template>

<style scoped>
.me-page {
  width: 100%;
  max-width: 760px;
  margin-inline: auto;
  padding: var(--space-6) var(--gutter) var(--space-12);
}

.me-section + .me-section { margin-top: var(--space-6); }

.me-section-title {
  margin: 0 0 var(--space-2);
  color: var(--color-text-secondary);
  font: var(--type-caption);
  font-weight: 600;
}

.me-card {
  overflow: hidden;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
  box-shadow: var(--elevation-1);
}

.me-row {
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

.me-row:first-child { border-top: 0; }
.me-row > svg { flex: none; color: var(--color-text-secondary); }
.me-row-label { flex: 1 1 auto; min-width: 0; }
.me-row:focus-visible { outline: var(--focus-outline); outline-offset: calc(var(--focus-outline-offset) * -1); }

.me-account {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4);
  color: var(--color-text-primary);
}

.me-account-name { font: var(--type-h3); }
.me-account + .me-row { border-top: 1px solid var(--color-border-subtle); }

.me-card-actions {
  display: flex;
  justify-content: flex-end;
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--color-border-subtle);
}

.me-signed-out { display: grid; justify-items: start; gap: var(--space-2); padding: var(--space-4); }
.me-signed-out-title { margin: 0; color: var(--color-text-primary); font: var(--type-h3); }
.me-signed-out-hint { margin: 0 0 var(--space-2); color: var(--color-text-secondary); font: var(--type-body); }

.me-setting {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
  padding: var(--space-3) var(--space-4);
}

.me-setting + .me-setting { border-top: 1px solid var(--color-border-subtle); }
.me-setting-label { color: var(--color-text-primary); font: var(--type-body); }

@media (hover: hover) {
  .me-row:hover { background: var(--color-surface-2); }
}
</style>
