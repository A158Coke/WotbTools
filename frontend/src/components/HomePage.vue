<script setup>
/**
 * 首页 = 纯展示页（2026-10-18 重排）。它**不承担导航**。
 *
 * 依据：`AppSidebar.vue`（桌面 / 平板）与 `AppTabBar.vue` + `MorePage`（手机）已经覆盖
 * `app/navigation.js:PRIMARY_NAV` 的全部功能入口，三档都在。首页再摆一排功能卡就是把
 * 侧边栏抄一遍，所以这里只留一个转化动作（上传回放）和两个侧边栏没有的非功能入口。
 *
 * 另一条硬约束：`app/viewRegistry.js:30-32` 的 `replay` / `battle-playback` / `ai-review` /
 * `agent-replay` / `agent-shots` 五个 view 落在同一个 `ReplayWorkspace`，只是初始 capability
 * tab 不同。它们不是独立目的地，整页只能有 Hero 那一个回放入口。
 *
 * 分段：① 全出血 Hero ② 实时数据带 ③ 能力展示（**无链接**，纯视觉）④ 极简页脚。
 * ③ 的截图全部来自产品自带的匿名官方示例回放与公开页面，不含真实用户的私有数据。
 */
import { computed, inject, onMounted, ref, watch } from 'vue'
import * as api from '../utils/api.js'
import { ArrowRight } from 'lucide-vue-next'
import AppButton from './AppButton.vue'
import heroDecorImg from '../assets/showcase/home/hero-v4.webp'
import shotPlayback3dImg from '../assets/showcase/home/showcase-playback-3d-v1.webp'
import shotArmorImg from '../assets/showcase/home/showcase-armor-v1.webp'
import shotTankopediaImg from '../assets/showcase/home/showcase-tankopedia-v1.webp'
import shotRatingImg from '../assets/showcase/home/showcase-rating-v1.webp'
import { useI18n } from 'vue-i18n'
import { mapLabel } from '../utils/helpers.js'
import { RouterLink } from 'vue-router'
import { ONBOARDING_KEY } from '../shared/onboarding.js'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'

const onboarding = inject(ONBOARDING_KEY, null)
// 地图名走 common/map_names.json 的三语表（与 Playback / Workspace 同一个 mapLabel），
// 不把 `savanna` 这种原始 key 直接摆在 hero 上。
const { locale } = useI18n()

const topRecord = ref(null)
const recordTotal = ref(null)
/** 进场动效只跑一次；`prefers-reduced-motion` 由 CSS 短路，这里不做第二份判断。 */
const revealed = ref(false)
onMounted(() => requestAnimationFrame(() => { revealed.value = true }))

const topDamageDisplay = computed(() => {
  const damage = Number(topRecord.value?.damageDealt)
  return Number.isFinite(damage) ? formatCount(damage) : '--'
})
const recordTotalDisplay = computed(() => {
  // `?? NaN` 是必需的：Number(null) === 0，缺失的总数会伪装成「收录 0 条」这个事实。
  const total = Number(recordTotal.value ?? NaN)
  return Number.isFinite(total) ? formatCount(total) : '--'
})

/** ③ 能力展示：纯视觉，没有链接。截图尺寸写死在模板里以免加载时抖版。 */
const showcase = [
  { id: 'playback-3d', image: shotPlayback3dImg, w: 1600, h: 798, titleKey: 'home.showcasePlaybackTitle', descKey: 'home.showcasePlaybackDesc' },
  { id: 'armor', image: shotArmorImg, w: 1600, h: 1043, titleKey: 'home.showcaseArmorTitle', descKey: 'home.showcaseArmorDesc' },
  { id: 'rating', image: shotRatingImg, w: 1600, h: 696, titleKey: 'home.showcaseRatingTitle', descKey: 'home.showcaseRatingDesc' },
  { id: 'tankopedia', image: shotTankopediaImg, w: 1600, h: 1165, titleKey: 'home.showcaseTankopediaTitle', descKey: 'home.showcaseTankopediaDesc' },
]

// 首次连通性检测完成前 HoF 门禁按设计 fail-closed（useFeatureGate.requireFeature）：
// 冷启动时 onMounted 直接请求会被拒绝，必须等名人堂真正可用再加载（与 HoFPage 同一模式）。
const { availability } = useFeatureGate()
watch(() => availability(Feature.HALL_OF_FAME).available, (available) => {
  if (available && !topRecord.value) loadTopDamageRecord()
}, { immediate: true })

async function loadTopDamageRecord() {
  try {
    // 同一响应同时给出榜首记录与收录总数（HallOfFamePageDto.totalItems），数据带不额外发请求。
    const res = await api.hofList({ page: 1, size: 1 })
    topRecord.value = res?.items?.[0] ?? null
    recordTotal.value = res?.totalItems ?? null
  } catch {
    topRecord.value = null
    recordTotal.value = null
  }
}
function formatCount(value) { return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') }
</script>

<template>
  <main class="home-stage" :class="{ 'is-revealed': revealed }">
    <!-- ① 全出血 Hero -->
    <section class="home-hero" :style="{ '--home-hero-image': `url(${heroDecorImg})` }">
      <!-- 装饰层放在内容**之前**：两者都定位，后出现的内容自然压在上面，不需要 z-index。 -->
      <div class="home-hero-decor" aria-hidden="true"></div>
      <div class="home-hero-inner layout-wide">
        <h1>{{ $t('app.title') }}</h1>
        <p class="home-hero-subtitle">{{ $t('app.subtitle') }}</p>
        <div class="home-hero-actions">
          <AppButton class="home-cta" variant="primary" size="lg" href="/?view=replay">{{ $t('home.replayParse') }}<ArrowRight :size="18" aria-hidden="true" /></AppButton>
          <button v-if="onboarding" type="button" class="home-cta-ghost" data-testid="home-onboarding" @click="onboarding.openDirectory()">{{ $t('onboarding.newbie') }}</button>
        </div>

        <!-- ② 实时数据带：两个数字同源于一次 /api/hof 响应 -->
        <dl class="home-stats">
          <div class="home-stat">
            <dt>{{ $t('home.highestDamageRecord') }}</dt>
            <dd>
              <strong>{{ topDamageDisplay }}</strong>
              <span v-if="topRecord" class="home-stat-meta">
                {{ topRecord.tankName || topRecord.vehicleName || '—' }}
                · {{ topRecord.nickname || topRecord.playerNickname || '—' }}
                · {{ mapLabel(topRecord.map || topRecord.mapName, locale) || '—' }}
              </span>
            </dd>
          </div>
          <div class="home-stat">
            <dt>{{ $t('home.recordTotal') }}</dt>
            <dd><strong>{{ recordTotalDisplay }}</strong></dd>
          </div>
        </dl>
      </div>
    </section>

    <!-- ③ 能力展示：没有一个链接，导航由侧边栏 / 底部 Tab 栏承担 -->
    <section class="home-showcase layout-wide" aria-labelledby="home-showcase-title">
      <h2 id="home-showcase-title" class="home-showcase-title">{{ $t('home.showcaseTitle') }}</h2>
      <article v-for="(item, index) in showcase" :key="item.id" class="home-shot" :class="{ 'is-flipped': index % 2 === 1 }">
        <div class="home-shot-figure">
          <img
            :src="item.image" :width="item.w" :height="item.h"
            :loading="index === 0 ? 'eager' : 'lazy'" :fetchpriority="index === 0 ? 'high' : 'auto'"
            decoding="async" alt="" aria-hidden="true"
          >
        </div>
        <div class="home-shot-copy">
          <h3>{{ $t(item.titleKey) }}</h3>
          <p>{{ $t(item.descKey) }}</p>
        </div>
      </article>
    </section>

    <!-- ④ 极简页脚 -->
    <section class="home-footer-bar layout-wide">
      <RouterLink to="/sponsor">{{ $t('home.sponsorTitle') }} <ArrowRight :size="16" aria-hidden="true" /></RouterLink>
      <a href="https://github.com/A158Coke/WotbTools/issues/new" target="_blank" rel="noopener">{{ $t('app.feedback') }} <ArrowRight :size="16" aria-hidden="true" /></a>
    </section>
  </main>
</template>

<style scoped>
.home-stage { display: grid; gap: var(--space-12); color: var(--color-text-primary); }

/* ① Hero —— 全出血：它是页面唯一的「整屏」元素，所以自己负责左右留白，
   不套 layout-wide 的最大宽度（内层才套）。 */
.home-hero {
  --home-hero-decor: var(--home-hero-image);
  position: relative;
  display: grid;
  align-items: center;
  min-height: 460px;
  overflow: hidden;
  padding-block: var(--space-12);
  border-bottom: 1px solid var(--color-border-subtle);
}
.home-hero-inner { position: relative; width: 100%; }

/* 装饰插槽（design-language §2）：Showcase 显示，Classic 关闭。
   图只铺右半边并由 scrim 压到纯色，文字永远落在稳定底色上（WCAG 1.4.3）。 */
.home-hero-decor {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(to right, var(--color-canvas) 0%, var(--color-canvas) 38%, transparent 78%),
    linear-gradient(to top, var(--color-canvas) 0%, transparent 42%),
    var(--home-hero-decor);
  background-position: center, center, right center;
  background-size: cover, cover, cover;
}
html[data-ui-profile="classic"] .home-hero { --home-hero-decor: none; }
html[data-ui-profile="classic"] .home-hero-decor { display: none; }

.home-hero h1 { max-width: 16ch; margin: 0; color: var(--color-text-primary); font: var(--type-display-hero); letter-spacing: -0.02em; }
.home-hero-subtitle { max-width: 40ch; margin: var(--space-4) 0 0; color: var(--color-text-secondary); font: var(--type-body); font-size: clamp(1rem, 1.6vw, 1.25rem); line-height: var(--line-height-prose); }
.home-hero-actions { display: flex; gap: var(--space-4); flex-wrap: wrap; align-items: center; margin-top: var(--space-8); }
.home-cta { padding-inline: var(--space-8); }
.home-cta-ghost {
  min-height: var(--control-h-md);
  padding: 0 var(--space-2);
  border: 0;
  background: none;
  color: var(--color-text-secondary);
  font: var(--type-body);
  cursor: pointer;
}
.home-cta-ghost:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

/* ② 数据带 */
.home-stats { display: flex; gap: var(--space-10); flex-wrap: wrap; margin: var(--space-10) 0 0; }
.home-stat { min-width: 0; }
.home-stat dt { color: var(--color-text-tertiary); font: var(--type-caption); text-transform: uppercase; letter-spacing: 0.08em; }
.home-stat dd { margin: var(--space-1) 0 0; }
.home-stat strong { display: block; color: var(--color-accent-text); font: var(--type-display); font-variant-numeric: tabular-nums; }
.home-stat-meta { display: block; margin-top: var(--space-1); color: var(--color-text-secondary); font: var(--type-caption); overflow-wrap: anywhere; }

/* ③ 能力展示 */
.home-showcase { display: grid; gap: var(--space-12); }
.home-showcase-title { margin: 0; color: var(--color-text-tertiary); font: var(--type-caption); text-transform: uppercase; letter-spacing: 0.14em; }

.home-shot { display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 4fr); align-items: center; gap: var(--space-10); }
.home-shot.is-flipped .home-shot-figure { order: 2; }
.home-shot-figure {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-2);
  box-shadow: var(--elevation-3);
}
.home-shot-figure img { display: block; width: 100%; height: auto; }
.home-shot-copy { min-width: 0; }
.home-shot-copy h3 { margin: 0; color: var(--color-text-primary); font: var(--type-h2); }
.home-shot-copy p { max-width: 42ch; margin: var(--space-3) 0 0; color: var(--color-text-secondary); font: var(--type-body); line-height: var(--line-height-prose); }

/* ④ 页脚条 */
.home-footer-bar { display: flex; gap: var(--space-6); flex-wrap: wrap; padding-block: var(--space-6) var(--space-10); border-top: 1px solid var(--color-border-subtle); }
.home-footer-bar a { display: inline-flex; align-items: center; gap: var(--space-2); min-height: var(--control-h-md); color: var(--color-accent-text); font: var(--type-body); font-weight: 600; text-decoration: none; }
.home-footer-bar a svg { flex: none; }
.home-footer-bar a:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
@media (hover: hover) {
  .home-footer-bar a:hover { text-decoration: underline; }
}

/* 进场动效：只做一次淡入上浮，逐段延迟。 */
.home-hero-inner, .home-shot, .home-footer-bar {
  opacity: 0;
  transform: translateY(18px);
  transition: opacity 620ms var(--ease-standard), transform 620ms var(--ease-standard);
}
.is-revealed .home-hero-inner, .is-revealed .home-shot, .is-revealed .home-footer-bar { opacity: 1; transform: none; }
.is-revealed .home-shot:nth-of-type(2) { transition-delay: 80ms; }
.is-revealed .home-shot:nth-of-type(3) { transition-delay: 160ms; }
.is-revealed .home-shot:nth-of-type(4) { transition-delay: 240ms; }
.is-revealed .home-shot:nth-of-type(5) { transition-delay: 320ms; }
@media (prefers-reduced-motion: reduce) {
  /* 动效整体短路：不做位移、不做延迟，内容直接就位。 */
  .home-hero-inner, .home-shot, .home-footer-bar { opacity: 1; transform: none; transition: none; }
  .is-revealed .home-shot { transition-delay: 0ms; }
}

@media (768px <= width < 1200px) {
  .home-hero { min-height: 380px; }
  .home-shot { gap: var(--space-8); }
}
@media (width < 768px) {
  .home-stage { gap: var(--space-10); }
  /* 手机：装饰插槽关闭，首屏留给标题、主 CTA 与数据带 */
  .home-hero { --home-hero-decor: none; min-height: 0; padding-block: var(--space-10); }
  .home-hero-decor { display: none; }
  .home-hero-actions { gap: var(--space-3); }
  .home-cta { width: 100%; }
  .home-stats { gap: var(--space-6); margin-top: var(--space-8); }
  .home-showcase { gap: var(--space-10); }
  .home-shot { grid-template-columns: minmax(0, 1fr); gap: var(--space-4); }
  .home-shot.is-flipped .home-shot-figure { order: 0; }
}
</style>
