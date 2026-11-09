<script setup>
import { computed, inject } from 'vue'
import { RouterLink } from 'vue-router'
import { BookOpen, ChevronRight, Download, Heart, MessageSquare } from 'lucide-vue-next'
import { LANGUAGES, useMoreMenu } from '../composables/useMoreMenu.js'
import { useDataVersion } from '../composables/useDataVersion.js'
import DataVersionSelect from './DataVersionSelect.vue'
import { NAVIGATE_VIEW_KEY } from '../shared/navigation.js'
import ShowcaseHero from './ShowcaseHero.vue'
import SegmentedControl from './SegmentedControl.vue'
import ThemePicker from './ThemePicker.vue'
import AppSwitch from './AppSwitch.vue'
import { feedbackPrefs, setFeedbackPref } from '../composables/useFeedbackPrefs.js'

// 「更多与设置」（4.0）：显示设置、反馈与提示、赞助 / 反馈卡、关于与帮助。全部栏目都在左侧抽屉 / 侧边栏里，
// 这里不重复导航；管理入口只在抽屉 / 侧边栏的「管理」分组按角色显示。
// 平板 / 桌面的同一份链接清单也在侧边栏底部的"更多"弹出面板里（useMoreMenu 是唯一内容源）。账户由顶栏头像进入 profile。
const navigate = inject(NAVIGATE_VIEW_KEY)
const { setLocale, aboutLinks, openGuide, openFeedback, openAndroidUpdate } = useMoreMenu()
const { state: dataVersionState } = useDataVersion()
// 赞助单独做成强调卡，不在「关于与帮助」列表里重复
const helpLinks = computed(() => aboutLinks.value.filter(link => link.view !== 'sponsor'))
</script>

<template>
  <div class="more-page layout-content" data-testid="more-page">
    <ShowcaseHero section="community" :kicker="$t('nav.groups.community')" :title="$t('more.title')" />
    <section class="more-support" :aria-label="$t('more.sections.support')">
      <RouterLink class="more-sponsor" to="/sponsor" data-testid="more-link-sponsor">
        <span class="more-sponsor-icon" aria-hidden="true"><Heart :size="20" /></span>
        <span class="more-support-text"><strong>{{ $t('home.sponsorTitle') }}</strong><span>{{ $t('home.sponsorDesc') }}</span></span>
        <ChevronRight :size="20" aria-hidden="true" />
      </RouterLink>
      <button type="button" class="more-feedback-card" data-testid="more-link-feedback" @click="openFeedback?.()">
        <MessageSquare :size="20" aria-hidden="true" />
        <span class="more-support-text"><strong>{{ $t('app.feedback') }}</strong><span>{{ $t('home.feedbackDesc') }}</span></span>
        <ChevronRight :size="20" aria-hidden="true" />
      </button>
    </section>

    <section class="more-section" aria-labelledby="more-display">
      <h2 id="more-display" class="more-section-title">{{ $t('more.sections.display') }}</h2>
      <div class="more-card">
        <div class="more-setting more-setting-stack" data-tour="settings-theme">
          <span class="more-setting-label">{{ $t('uiProfile.title') }}</span>
          <ThemePicker :aria-label="$t('uiProfile.title')" data-testid="more-ui-profile" />
        </div>
        <div class="more-setting" data-tour="settings-language">
          <span class="more-setting-label">{{ $t('more.language') }}</span>
          <SegmentedControl
            scrollable
            :model-value="$i18n.locale"
            :options="LANGUAGES"
            :aria-label="$t('more.language')"
            data-testid="more-language"
            @update:model-value="setLocale"
          />
        </div>
        <div
          v-if="dataVersionState.status !== 'unavailable'"
          class="more-setting more-setting-stack"
          data-testid="more-data-version"
        >
          <label class="more-setting-label" for="more-data-version-select">{{ $t('dataVersion.title') }}</label>
          <DataVersionSelect id="more-data-version-select" variant="setting" />
        </div>
      </div>
    </section>

    <section class="more-section" aria-labelledby="more-feedback-prefs">
      <h2 id="more-feedback-prefs" class="more-section-title">{{ $t('feedbackPrefs.title') }}</h2>
      <div class="more-card">
        <div class="more-setting" data-testid="more-haptics">
          <AppSwitch :model-value="feedbackPrefs.haptics" :label="$t('feedbackPrefs.haptics')" :description="$t('feedbackPrefs.hapticsHint')" @update:model-value="value => setFeedbackPref('haptics', value)" />
        </div>
        <div class="more-setting" data-testid="more-sound">
          <AppSwitch :model-value="feedbackPrefs.sound" :label="$t('feedbackPrefs.sound')" :description="$t('feedbackPrefs.soundHint')" @update:model-value="value => setFeedbackPref('sound', value)" />
        </div>
      </div>
    </section>

    <section class="more-section" aria-labelledby="more-about">
      <h2 id="more-about" class="more-section-title">{{ $t('more.sections.about') }}</h2>
      <div class="more-card">
        <button v-if="openGuide" type="button" class="more-row" data-testid="more-link-guide" @click="openGuide"><BookOpen :size="20" aria-hidden="true" /><span class="more-row-label">{{ $t('onboarding.directory') }}</span><ChevronRight :size="20" aria-hidden="true" /></button>
        <button
          v-for="link in helpLinks"
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
        <button v-if="openAndroidUpdate" type="button" class="more-row" data-testid="more-link-app-update" @click="openAndroidUpdate()"><Download :size="20" aria-hidden="true" /><span class="more-row-label">{{ $t('androidUpdate.title') }}</span><ChevronRight :size="20" aria-hidden="true" /></button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.more-page {
  max-width: calc(var(--reading-measure) + var(--gutter) * 2);
}

.more-section + .more-section,
.more-support + .more-section { margin-top: var(--space-6); }

/* 赞助（强调色）与反馈卡并排；小屏上下堆叠，赞助在最上面 */
.more-support { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
.more-sponsor,
.more-feedback-card {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--row-h);
  padding: var(--space-4);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
  color: var(--color-text-primary);
  font: var(--type-body);
  text-align: start;
  text-decoration: none;
  cursor: pointer;
}
.more-sponsor { border-color: var(--color-accent); background: color-mix(in oklab, var(--color-accent) 10%, var(--color-surface-1)); }
.more-sponsor-icon { display: inline-flex; flex: none; align-items: center; justify-content: center; inline-size: var(--space-10); block-size: var(--space-10); border-radius: var(--radius-full); corner-shape: round; background: var(--color-accent); color: var(--color-on-accent); }
.more-feedback-card > svg:first-child { flex: none; color: var(--color-accent-text); }
.more-support-text { display: grid; flex: 1 1 auto; gap: var(--space-1); min-width: 0; }
.more-support-text span { color: var(--color-text-secondary); font: var(--type-caption); }
.more-sponsor > svg, .more-feedback-card > svg:last-child { flex: none; color: var(--color-text-secondary); }
.more-sponsor:focus-visible,
.more-feedback-card:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
@media (width < 768px) {
  .more-support { grid-template-columns: minmax(0, 1fr); }
}

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
.more-row-label { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
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
.more-setting-label { color: var(--color-text-primary); font: var(--type-body); font-weight: 600; }

.more-setting-stack { flex-direction: column; align-items: stretch; gap: var(--space-1); }

@media (hover: hover) {
  .more-row:hover { background: var(--color-surface-2); }
}
</style>
