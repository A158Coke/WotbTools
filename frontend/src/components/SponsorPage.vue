<script setup>
// 赞助（4.0「赞助与下载」稿）：主题主视觉 Hero + 三条理由 + 扫码卡。
// 大屏两种方式并排；小屏做成页签，一次显示一张大二维码，并说明「手机没法扫自己的屏幕，先保存再到相册里扫」。
// 「保存二维码」在 Web 上是带 download 的链接；Android App 内 WebView 是否支持下载 / 长按存图未验证，
// 所以 App 内只给长按提示、不渲染保存按钮。图片加载失败的方式隐藏，全部失败显示「赞助方式暂未配置」。
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Download, HandCoins, Server } from 'lucide-vue-next'
import ShowcaseHero from './ShowcaseHero.vue'
import SegmentedControl from './SegmentedControl.vue'
import { loadSponsorMethods } from '../utils/sponsor-config.js'
import { useBreakpoint } from '../composables/useBreakpoint.js'
import { isAndroidApp } from '../composables/usePlatformBridge.js'

const { t } = useI18n()
const { isCompact } = useBreakpoint()
const androidApp = isAndroidApp()
const methods = ref([])
const failedTypes = ref(new Set())
const visibleMethods = computed(() => methods.value.filter(method => !failedTypes.value.has(method.type)))
const activeType = ref('')
const reasons = [
  { key: 'reasonVoluntary', icon: HandCoins },
  { key: 'reasonNothingUnlocked', icon: Check },
  { key: 'reasonServers', icon: Server },
]

// 当前页签的方式加载失败（或配置变化）时回落到第一个可用方式
watch(visibleMethods, (list) => {
  if (!list.some(method => method.type === activeType.value)) activeType.value = list[0]?.type ?? ''
}, { immediate: true })

onMounted(async () => {
  methods.value = await loadSponsorMethods()
})

function hideUnavailableImage(type) {
  failedTypes.value = new Set([...failedTypes.value, type])
}

function isShown(type) {
  return !isCompact.value || type === activeType.value
}
</script>

<template>
  <main class="sponsor-page layout-content">
    <ShowcaseHero :kicker="t('sponsor.eyebrow')" :title="t('sponsor.title')" :description="t('sponsor.intro')" />

    <div class="sponsor-grid">
      <section class="sponsor-card" :aria-label="t('sponsor.aboutTitle')">
        <ul class="sponsor-reasons">
          <li v-for="reason in reasons" :key="reason.key">
            <component :is="reason.icon" class="sponsor-reason-icon" :size="20" aria-hidden="true" />
            <span><strong>{{ t(`sponsor.${reason.key}`) }}</strong><span>{{ t(`sponsor.${reason.key}Desc`) }}</span></span>
          </li>
        </ul>
        <p class="sponsor-note">{{ t('sponsor.note') }}</p>
      </section>

      <section class="sponsor-card" aria-labelledby="sponsor-methods-title">
        <h2 id="sponsor-methods-title">{{ t('sponsor.methodsTitle') }}</h2>
        <p v-if="visibleMethods.length === 0" class="sponsor-unconfigured" role="status" data-testid="sponsor-unconfigured">
          {{ t('sponsor.unconfigured') }}
        </p>
        <template v-else>
          <SegmentedControl
            v-if="isCompact && visibleMethods.length > 1"
            v-model="activeType"
            class="sponsor-tabs"
            :options="visibleMethods.map(method => ({ value: method.type, label: t(`sponsor.${method.type}`) }))"
            :aria-label="t('sponsor.methodsTitle')"
            data-testid="sponsor-tabs"
          />
          <div class="sponsor-methods" :class="{ 'is-single': isCompact }" data-testid="sponsor-methods">
            <figure v-for="method in visibleMethods" v-show="isShown(method.type)" :key="method.type" class="sponsor-method">
              <img
                :src="method.image"
                :alt="t(`sponsor.${method.type}`)"
                loading="lazy"
                decoding="async"
                @error="hideUnavailableImage(method.type)"
              >
              <figcaption>{{ t(`sponsor.${method.type}`) }}</figcaption>
            </figure>
          </div>
          <template v-if="isCompact">
            <p class="sponsor-save-hint">{{ t(androidApp ? 'sponsor.saveHintApp' : 'sponsor.saveHint') }}</p>
            <a
              v-if="!androidApp && activeType"
              class="sponsor-save"
              :href="visibleMethods.find(method => method.type === activeType)?.image"
              download
              data-testid="sponsor-save"
            ><Download :size="18" aria-hidden="true" />{{ t('sponsor.save') }}</a>
          </template>
        </template>
      </section>
    </div>
  </main>
</template>

<style scoped>
.sponsor-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); }

.sponsor-card {
  display: grid;
  align-content: start;
  gap: var(--space-4);
  min-width: 0;
  padding: var(--space-6);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
}
.sponsor-card h2 { margin: 0; color: var(--color-text-primary); font: var(--type-h2); }

.sponsor-reasons { display: grid; gap: var(--space-4); margin: 0; padding: 0; list-style: none; }
.sponsor-reasons li { display: flex; gap: var(--space-3); }
.sponsor-reasons li > span { display: grid; gap: var(--space-1); }
.sponsor-reasons strong { color: var(--color-text-primary); font: var(--type-h3); }
.sponsor-reasons li > span > span { color: var(--color-text-secondary); font: var(--type-body); line-height: var(--line-height-prose); }
.sponsor-reason-icon { flex: none; margin-block-start: var(--space-1); color: var(--color-accent-text); }

.sponsor-note { margin: 0; padding-block-start: var(--space-3); border-block-start: 1px solid var(--color-border-subtle); color: var(--color-text-secondary); font: var(--type-caption); }

.sponsor-unconfigured { margin: 0; padding-block: var(--space-8); color: var(--color-text-secondary); font: var(--type-body); text-align: center; }

.sponsor-methods { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); }
.sponsor-methods.is-single { grid-template-columns: minmax(0, 1fr); justify-items: center; }
.sponsor-method { display: grid; gap: var(--space-2); justify-items: center; min-width: 0; margin: 0; }
.sponsor-method img {
  display: block;
  inline-size: 100%;
  max-inline-size: calc(var(--space-12) * 6);
  aspect-ratio: 1;
  object-fit: contain;
  padding: var(--space-2);
  border-radius: var(--radius-md);
  background: var(--color-qr-surface);
}
.sponsor-method figcaption { color: var(--color-text-primary); font: var(--type-body); font-weight: 600; }

.sponsor-save-hint { margin: 0; color: var(--color-text-secondary); font: var(--type-caption); text-align: center; }
.sponsor-save {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-height: var(--control-h-lg);
  border-radius: var(--radius-md);
  background: var(--color-accent);
  color: var(--color-on-accent);
  font: var(--type-body);
  font-weight: 700;
  text-decoration: none;
}
.sponsor-save:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

@media (width < 768px) {
  .sponsor-grid { grid-template-columns: minmax(0, 1fr); }
  .sponsor-grid > .sponsor-card:last-child { order: -1; }
  .sponsor-card { padding: var(--space-4); }
}
</style>
