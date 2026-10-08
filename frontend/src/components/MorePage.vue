<script setup>
import { computed, inject } from 'vue'
import { ChevronRight, ExternalLink, MessageSquare } from 'lucide-vue-next'
import { FEEDBACK_URL, LANGUAGES, useMoreMenu } from '../composables/useMoreMenu.js'
import { NAVIGATE_VIEW_KEY } from '../shared/navigation.js'
import PageHeader from './PageHeader.vue'
import SegmentedControl from './SegmentedControl.vue'

// "更多"页：手机 / App 的低频入口（显示设置、回放工具、管理、关于与支持）。
// 平板 / 桌面的同一份内容在侧边栏底部的"更多"弹出面板里（useMoreMenu 是唯一内容源）；
// 坦克百科是主导航栏目，不在这里重复。账户由顶栏头像进入 profile。
const navigate = inject(NAVIGATE_VIEW_KEY)
const { uiProfilePreference, setUiProfile, uiProfileOptions, setLocale, replayToolLinks, adminLinks, aboutLinks } = useMoreMenu()

const groups = computed(() => [
  { id: 'tools', titleKey: 'more.sections.tools', links: replayToolLinks },
  { id: 'admin', titleKey: 'more.sections.admin', links: adminLinks.value },
  { id: 'about', titleKey: 'more.sections.about', links: aboutLinks.value, feedback: true },
].filter(group => group.links.length))
</script>

<template>
  <div class="more-page layout-content" data-testid="more-page">
    <PageHeader :title="$t('more.title')" />

    <section class="more-section" aria-labelledby="more-display">
      <h2 id="more-display" class="more-section-title">{{ $t('more.sections.display') }}</h2>
      <div class="more-card">
        <div class="more-setting">
          <span class="more-setting-label">{{ $t('uiProfile.title') }}</span>
          <SegmentedControl
            scrollable
            :model-value="uiProfilePreference"
            :options="uiProfileOptions($t)"
            :aria-label="$t('uiProfile.title')"
            data-testid="more-ui-profile"
            @update:model-value="setUiProfile"
          />
        </div>
        <div class="more-setting">
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
  max-width: calc(var(--reading-measure) + var(--gutter) * 2);
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

@media (hover: hover) {
  .more-row:hover { background: var(--color-surface-2); }
}
</style>
