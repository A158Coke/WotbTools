<script setup>
/**
 * 首页 = 纯展示页（2026-10-18 重排）。它**不承担导航**。
 *
 * 依据：`AppSidebar.vue`（桌面 / 平板）与 `AppNavDrawer.vue`（手机抽屉）已经覆盖
 * `app/navigation.js:PRIMARY_NAV` 的全部功能入口，三档都在。首页再摆一排功能卡就是把
 * 侧边栏抄一遍，所以这里只留一个功能入口（Replay Workspace / 上传回放）和 Web 侧边栏没有的
 * 非功能 / 转化入口：Android 下载（只在 Web 首屏）、赞助、反馈。
 *
 * 另一条硬约束：`app/viewRegistry.js` 的 `replay` / `battle-playback` / `ai-review` /
 * `agent-replay` / `agent-shots` 五个 view 落在同一个 `ReplayWorkspace`，只是初始 capability
 * tab 不同。它们不是独立目的地，整页只能有 Hero 那一个回放入口。
 *
 * 分段（4.0）：① 整屏 Hero（当前主题主视觉：大屏横版、小屏竖版；数据带、赞助卡、反馈都在首屏）
 * ② 能力展示（**无链接**，纯视觉：两段整幅截图 + 叠字、两张卡片）。小屏与 Android App 用同一套首页。
 * ② 的截图全部来自产品自带的匿名官方示例回放与公开页面，不含用户的私有数据。
 */
import { computed, inject, ref, watch } from 'vue'
import * as api from '../api/hall-of-fame.js'
import { ArrowRight, Heart, MessageSquare, Smartphone } from 'lucide-vue-next'
import AppButton from './AppButton.vue'
import shotPlayback3dImg from '../assets/showcase/home/showcase-playback-3d-v1.webp'
import shotArmorImg from '../assets/showcase/home/showcase-armor-v1.webp'
import shotTankopediaImg from '../assets/showcase/home/showcase-tankopedia-v1.webp'
import shotRatingImg from '../assets/showcase/home/showcase-rating-v1.webp'
import { useI18n } from 'vue-i18n'
import { mapLabel } from '../utils/helpers.js'
import { RouterLink } from 'vue-router'
import { FEEDBACK_KEY } from '../shared/feedback.js'
import { ONBOARDING_KEY } from '../shared/onboarding.js'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { isAndroidApp } from '../composables/usePlatformBridge.js'
import { useUiProfile } from '../composables/useUiProfile.js'

const onboarding = inject(ONBOARDING_KEY, null)
const openFeedback = inject(FEEDBACK_KEY, null)
// 地图名走 common/map_names.json 的三语表（与 Playback / Workspace 同一个 mapLabel），
// 不把 `savanna` 这种原始 key 直接摆在 hero 上。
const { locale } = useI18n()
// Android App 内已经有应用本身，「下载 Android 版」不出现（平台判断复用 usePlatformBridge 的唯一实现）。
const androidApp = isAndroidApp()
// kicker 跟随当前主题名（春 · 青山 …）；主视觉由主题 token 提供
const { uiProfile } = useUiProfile()

const topRecord = ref(null)
const recordTotal = ref(null)

/** 数字格式跟随当前 locale（design-language §4）；Intl 自己决定千分位，不写死 ASCII 空格。 */
const countFormatter = computed(() => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 0 }))
const topDamageDisplay = computed(() => {
  const damage = Number(topRecord.value?.damageDealt)
  return Number.isFinite(damage) ? formatCount(damage) : '--'
})
const recordTotalDisplay = computed(() => {
  // `?? NaN` 是必需的：Number(null) === 0，缺失的总数会伪装成「收录 0 条」这个事实。
  const total = Number(recordTotal.value ?? NaN)
  return Number.isFinite(total) ? formatCount(total) : '--'
})

/** ② 能力展示：纯视觉，没有链接。截图尺寸写死在模板里以免加载时抖版。前两段整幅 + 叠字，后两段卡片。 */
const featured = [
  { id: 'playback-3d', image: shotPlayback3dImg, w: 1600, h: 798, titleKey: 'home.showcasePlaybackTitle', descKey: 'home.showcasePlaybackDesc' },
  { id: 'armor', image: shotArmorImg, w: 1600, h: 1043, titleKey: 'home.showcaseArmorTitle', descKey: 'home.showcaseArmorDesc', callouts: ['home.calloutRicochet', 'home.calloutPenetration', 'home.calloutChance'] },
]
const cards = [
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
function formatCount(value) { return countFormatter.value.format(Math.round(value)) }
</script>

<template>
  <main class="home-stage">
    <!-- ① 整屏 Hero：主视觉、标题、主按钮、数据带；赞助卡与反馈在首屏（大屏右下，小屏紧接其后） -->
    <section class="home-hero" data-testid="home-hero">
      <!-- 装饰层放在内容**之前**：两者都定位，后出现的内容自然压在上面，不需要 z-index。 -->
      <div class="home-hero-decor" aria-hidden="true"></div>
      <div class="home-hero-inner">
        <p class="home-hero-kicker">WOTBTOOLS · {{ $t(`uiProfile.${uiProfile}`) }}</p>
        <h1>
          <span class="home-hero-line">{{ $t('home.heroLine1') }}</span>
          <span class="home-hero-line is-accent">{{ $t('home.heroLine2') }}</span>
        </h1>
        <!-- 副标题 + 按钮在左，瞄准框在右列：放进布局流而不是绝对定位，它只能占标题与数据带之间的空白，
             任何视口、任何语言下都不会压到文字和按钮（之前按百分比定位，会盖住新手教程 / 赞助卡） -->
        <div class="home-hero-mid">
        <div class="home-hero-lead">
        <p class="home-hero-subtitle">{{ $t('home.heroSubtitle') }}</p>
        <div class="home-hero-actions">
          <AppButton class="home-cta" variant="primary" size="lg" href="/?view=replay">{{ $t('home.replayParse') }}<ArrowRight :size="18" aria-hidden="true" /></AppButton>
          <AppButton v-if="!androidApp" class="home-cta-android" variant="secondary" size="lg" href="/download/android">
            <Smartphone :size="18" aria-hidden="true" />{{ $t('android.nav') }}
          </AppButton>
          <button v-if="onboarding" type="button" class="home-cta-ghost" data-testid="home-onboarding" @click="onboarding.openDirectory()">{{ $t('onboarding.newbie') }}</button>
        </div>
        </div>
        <div class="home-hero-reticle" aria-hidden="true"><span></span><span></span><span></span><span></span><i></i></div>
        </div>

        <div class="home-hero-foot">
          <!-- 实时数据带：两个数字同源于一次 /api/hof 响应 -->
          <dl class="home-stats">
            <div class="home-stat">
              <dt>{{ $t('home.highestDamageRecord') }}</dt>
              <dd>
                <strong>{{ topDamageDisplay }}</strong>
                <span v-if="topRecord" class="home-stat-meta">
                  {{ topRecord.tankName || '—' }}
                  · {{ topRecord.nickname || '—' }}
                  · {{ mapLabel(topRecord.mapName, locale) || '—' }}
                </span>
              </dd>
            </div>
            <div class="home-stat">
              <dt>{{ $t('home.recordTotal') }}</dt>
              <dd><strong class="is-plain">{{ recordTotalDisplay }}</strong></dd>
            </div>
          </dl>
          <div class="home-support">
            <RouterLink class="home-sponsor" to="/sponsor" data-testid="home-sponsor">
              <span class="home-sponsor-icon" aria-hidden="true"><Heart :size="20" /></span>
              <span class="home-sponsor-text"><strong>{{ $t('home.sponsorTitle') }}</strong><span>{{ $t('home.sponsorDesc') }}</span></span>
              <span class="home-sponsor-cta">{{ $t('home.sponsorCta') }}</span>
            </RouterLink>
            <button type="button" class="home-feedback" data-testid="home-feedback" @click="openFeedback?.()">
              <MessageSquare class="home-feedback-icon" :size="18" aria-hidden="true" />
              <strong>{{ $t('app.feedback') }}</strong>
              <span>{{ $t('home.feedbackDesc') }}</span>
              <ArrowRight class="home-feedback-arrow" :size="16" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- ② 能力展示：没有一个链接，导航由侧边栏 / 抽屉承担 -->
    <section class="home-showcase" aria-labelledby="home-showcase-title">
      <h2 id="home-showcase-title" class="visually-hidden">{{ $t('home.showcaseTitle') }}</h2>
      <article v-for="(item, index) in featured" :key="item.id" class="home-feature" :class="`is-${item.id}`">
        <img
          class="home-feature-image"
          :src="item.image" :width="item.w" :height="item.h"
          :loading="index === 0 ? 'eager' : 'lazy'" :fetchpriority="index === 0 ? 'high' : 'auto'"
          decoding="async" alt="" aria-hidden="true"
        >
        <span class="home-feature-shade" aria-hidden="true"></span>
        <ul v-if="item.callouts" class="home-callouts" aria-hidden="true">
          <li v-for="key in item.callouts" :key="key">{{ $t(key) }}</li>
        </ul>
        <div class="home-feature-copy">
          <p class="home-feature-kicker">{{ $t('home.showcaseTitle') }} · 0{{ index + 1 }}</p>
          <h3>{{ $t(item.titleKey) }}</h3>
          <p class="home-feature-desc">{{ $t(item.descKey) }}</p>
        </div>
      </article>
      <div class="home-cards">
        <article v-for="item in cards" :key="item.id" class="home-card surface-glass-1">
          <div class="home-card-figure">
            <img :src="item.image" :width="item.w" :height="item.h" loading="lazy" decoding="async" alt="" aria-hidden="true">
          </div>
          <div class="home-card-copy">
            <h3>{{ $t(item.titleKey) }}</h3>
            <p>{{ $t(item.descKey) }}</p>
          </div>
        </article>
      </div>
    </section>
  </main>
</template>

<style scoped>
.home-stage { display: grid; color: var(--color-text-primary); }

/* ① Hero —— 整屏：主视觉跟随主题（design-language §2 装饰插槽 1），文字落在主题遮罩压出的纯色区（WCAG 1.4.3） */
.home-hero {
  position: relative;
  display: grid;
  /* 抽屉外壳的顶栏浮在主视觉上：Hero 向上伸进 ViewHost 为顶栏让出的空间（桌面 --header-block 为 0） */
  min-height: 100dvh;
  margin-block-start: calc(-1 * (var(--header-block) + env(safe-area-inset-top)));
  overflow: hidden;
  border-bottom: 1px solid var(--color-border-subtle);
}

.home-hero-decor {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(to top, var(--color-canvas) 0%, transparent 34%),
    var(--theme-hero-scrim),
    var(--theme-hero-image) right center / cover;
}

/* 中段：左列副标题 + 按钮，右列瞄准框；中段吃掉标题与数据带之间的剩余高度，瞄准框随之伸缩 */
.home-hero-mid { display: grid; grid-template-columns: minmax(0, auto) minmax(0, 1fr); flex: 1 0 auto; gap: var(--space-12); }
.home-hero-lead { min-width: 0; }
/* 瞄准框装饰：四角 + 十字，纯装饰；太窄 / 太矮时不画（min 尺寸之下装饰没有意义） */
.home-hero-reticle { position: relative; align-self: stretch; min-block-size: calc(var(--space-12) * 3); margin-block: var(--space-10) var(--space-6); pointer-events: none; }
.home-hero-reticle span { position: absolute; inline-size: var(--space-10); block-size: var(--space-10); border: 0 solid var(--color-accent); }
.home-hero-reticle span:nth-child(1) { inset-block-start: 0; inset-inline-start: 0; border-block-start-width: 2px; border-inline-start-width: 2px; }
.home-hero-reticle span:nth-child(2) { inset-block-start: 0; inset-inline-end: 0; border-block-start-width: 2px; border-inline-end-width: 2px; }
.home-hero-reticle span:nth-child(3) { inset-block-end: 0; inset-inline-start: 0; border-block-end-width: 2px; border-inline-start-width: 2px; }
.home-hero-reticle span:nth-child(4) { inset-block-end: 0; inset-inline-end: 0; border-block-end-width: 2px; border-inline-end-width: 2px; }
.home-hero-reticle i {
  position: absolute;
  inset-block-start: 50%;
  inset-inline-start: 50%;
  inline-size: var(--space-6);
  block-size: var(--space-6);
  transform: translate(-50%, -50%);
  background:
    linear-gradient(var(--color-accent), var(--color-accent)) center / 100% 1px no-repeat,
    linear-gradient(var(--color-accent), var(--color-accent)) center / 1px 100% no-repeat;
}

.home-hero-inner { position: relative; display: flex; flex-direction: column; padding: calc(var(--header-block) + env(safe-area-inset-top) + var(--space-12)) var(--space-12) var(--space-10); }

.home-hero-kicker { margin: 0 0 var(--space-5); color: var(--color-accent-text); font: var(--type-caption); font-weight: 600; letter-spacing: .22em; }
.home-hero h1 { max-width: var(--home-hero-title-measure); margin: 0; color: var(--color-text-primary); font: var(--type-display-showcase); letter-spacing: -0.03em; }
/* 中文不收字距：负字距会让「一」贴到下一个字上，看起来像破折号（「—站式」） */
.home-hero h1:lang(zh) { letter-spacing: 0; }
.home-hero h1:lang(zh) .home-hero-line + .home-hero-line { margin-block-start: var(--space-2); }
.home-hero-line { display: block; }
.home-hero-line.is-accent { color: var(--color-accent-text); }

/* 渐变文字 + 一次性扫光；background-clip 不被支持时回落到纯强调色（不会变透明） */
@supports (((background-clip: text) or (-webkit-background-clip: text)) and (color: color-mix(in oklab, red, blue))) {
  .home-hero-line.is-accent {
    /* 高光带放在前 45%：入场时从 0 扫到 100%，停下后可见区域（后 55%）是统一的强调色，不会有几个字发白 */
    background-image: linear-gradient(100deg, var(--color-accent-text) 0%, var(--color-accent-text) 18%, color-mix(in oklab, var(--color-accent-text) 42%, var(--color-text-primary)) 30%, var(--color-accent-text) 42%, var(--color-accent-text) 100%);
    background-size: 220% 100%;
    background-position: 100% 0;
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
}
@keyframes home-sheen { from { background-position: 0 0; } }

.home-hero-subtitle { max-width: var(--home-hero-subtitle-measure); margin: var(--space-6) 0 0; color: var(--color-text-primary); font: var(--type-body); font-size: var(--home-hero-subtitle-size); line-height: var(--line-height-prose); }
.home-hero-actions { display: flex; gap: var(--space-4); flex-wrap: wrap; align-items: center; margin-top: var(--space-8); }
.home-cta { padding-inline: var(--space-8); }
.home-cta-android { background: var(--theme-glass); }
.home-cta-ghost { min-height: var(--control-h-lg); padding: 0 var(--space-2); border: 0; background: none; color: var(--color-text-primary); font: var(--type-body); cursor: pointer; }
.home-cta-ghost:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

/* 首屏底部：数据带 + 赞助 / 反馈同一行 */
.home-hero-foot { display: flex; align-items: flex-end; gap: var(--space-12); flex-wrap: wrap; margin-top: auto; padding-top: var(--space-10); }
.home-stats { display: flex; gap: var(--space-12); flex-wrap: wrap; margin: 0; }
.home-stat { min-width: 0; }
.home-stat dt { color: var(--color-text-secondary); font: var(--type-caption); font-weight: 600; letter-spacing: .12em; }
.home-stat dd { margin: var(--space-1) 0 0; }
.home-stat strong { display: block; color: var(--color-accent-text); font: var(--type-display-hero); font-variant-numeric: tabular-nums; }
.home-stat strong.is-plain { color: var(--color-text-primary); }
.home-stat-meta { display: block; margin-top: var(--space-1); color: var(--color-text-secondary); font: var(--type-caption); overflow-wrap: anywhere; }

.home-support { display: grid; gap: var(--space-2); inline-size: min(28rem, 100%); margin-inline-start: auto; }
.home-sponsor {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-lg);
  background: var(--theme-glass);
  color: var(--color-text-primary);
  text-decoration: none;
  box-shadow: 0 0 0 var(--space-2) color-mix(in oklab, var(--color-accent) 10%, transparent);
}
.home-sponsor-icon { display: inline-flex; flex: none; align-items: center; justify-content: center; inline-size: var(--space-12); block-size: var(--space-12); border-radius: var(--radius-full); corner-shape: round; background: var(--color-accent); color: var(--color-on-accent); }
.home-sponsor-text { display: grid; flex: 1 1 auto; gap: var(--space-1); min-width: 0; }
.home-sponsor-text strong { font: var(--type-h3); }
.home-sponsor-text span { color: var(--color-text-secondary); font: var(--type-caption); }
.home-sponsor-cta { display: inline-flex; flex: none; align-items: center; min-height: var(--control-h-md); padding: 0 var(--space-4); border-radius: var(--radius-md); background: var(--color-accent); color: var(--color-on-accent); font: var(--type-body); font-weight: 700; }
.home-feedback {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--hit-min-comfortable);
  padding: 0 var(--space-4);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--theme-glass);
  color: var(--color-text-primary);
  font: var(--type-body);
  text-align: start;
  cursor: pointer;
}
.home-feedback-icon { flex: none; color: var(--color-accent-text); }
.home-feedback strong { flex: none; font-weight: 600; }
.home-feedback span { flex: 1 1 auto; min-width: 0; color: var(--color-text-secondary); font: var(--type-caption); }
.home-feedback-arrow { flex: none; color: var(--color-text-secondary); }
.home-sponsor:focus-visible,
.home-feedback:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

/* ② 能力展示 */
.home-showcase { display: grid; }
.home-feature { position: relative; overflow: hidden; min-height: calc(var(--space-12) * 12); }
.home-feature-image { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.home-feature-shade { position: absolute; inset: 0; background: linear-gradient(to top, var(--color-canvas) 0%, color-mix(in srgb, var(--color-canvas) 72%, transparent) 22%, transparent 52%); }
.home-feature.is-armor { border-bottom: 1px solid var(--color-border-subtle); }
.home-feature.is-armor .home-feature-image { object-fit: contain; object-position: 70% center; }
.home-feature.is-armor .home-feature-shade { background: linear-gradient(to right, var(--color-canvas) 0%, color-mix(in srgb, var(--color-canvas) 80%, transparent) 32%, transparent 60%); }
.home-feature-copy { position: absolute; inset-inline: var(--space-12); inset-block-end: var(--space-10); max-width: calc(var(--space-12) * 11); }
.home-feature.is-armor .home-feature-copy { inset-block: 0; display: grid; align-content: center; }
.home-feature-kicker { margin: 0 0 var(--space-2); color: var(--color-accent-text); font: var(--type-caption); font-weight: 600; letter-spacing: .22em; }
.home-feature-copy h3 { margin: 0; color: var(--color-text-primary); font: var(--type-display); letter-spacing: -0.02em; }
.home-feature-desc { margin: var(--space-3) 0 0; color: var(--color-text-secondary); font: var(--type-body); line-height: var(--line-height-prose); }
.home-callouts { position: absolute; inset-inline-end: 12%; inset-block-start: 14%; display: grid; gap: var(--space-3); margin: 0; padding: 0; list-style: none; }
.home-callouts li { padding: var(--space-1) var(--space-3); border: 1px solid var(--color-accent); border-radius: var(--radius-md); background: var(--color-canvas); color: var(--color-accent-text); font: var(--type-caption); font-weight: 600; white-space: nowrap; }

.home-cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-6); padding: var(--space-10) var(--space-12); }
.home-card { display: flex; flex-direction: column; min-width: 0; overflow: hidden; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-lg); }
.home-card-figure { block-size: calc(var(--space-12) * 5); overflow: hidden; }
.home-card-figure img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: 50% 40%; }
.home-card-copy { padding: var(--space-5) var(--space-6); }
.home-card-copy h3 { margin: 0; font: var(--type-h2); }
.home-card-copy p { margin: var(--space-2) 0 0; color: var(--color-text-secondary); font: var(--type-body); line-height: var(--line-height-prose); }

.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

@media (hover: hover) {
  .home-sponsor:hover { box-shadow: 0 0 0 var(--space-2) color-mix(in oklab, var(--color-accent) 18%, transparent); }
  .home-feedback:hover { border-color: var(--color-accent); }
}

/* 位移 / 缩放 / 光晕都属于动效：reduce 用户连声明都拿不到 */
@media (hover: hover) and (prefers-reduced-motion: no-preference) {
  .home-cta svg { transition: transform var(--duration-base) var(--ease-standard); }
  .home-cta { transition: box-shadow var(--duration-base) var(--ease-standard); }
  .home-cta:hover svg { transform: translateX(var(--space-1)); }
  .home-cta:hover { box-shadow: 0 0 0 var(--space-2) color-mix(in oklab, var(--color-accent) 22%, transparent); }
  .home-card-figure img { transition: transform var(--duration-slow) var(--ease-standard); }
  .home-card:hover .home-card-figure img { transform: scale(var(--home-hover-zoom)); }
}

/* 进场动效：只动位移、不动透明度（不绘制的标签页里动画卡在第一帧时内容仍可见） */
@keyframes home-rise { from { transform: translateY(var(--home-rise-travel)); } }
@media (prefers-reduced-motion: no-preference) {
  .home-hero-line { animation: home-rise var(--home-enter-duration) var(--ease-standard) backwards; }
  .home-hero-line:nth-child(2) { animation-delay: var(--home-enter-stagger); }
  .home-hero-subtitle { animation: home-rise var(--home-enter-duration) var(--ease-standard) backwards; animation-delay: calc(var(--home-enter-stagger) * 2); }
  .home-hero-inner { animation: home-rise var(--home-enter-duration) var(--ease-standard) backwards; }
}
@supports (((background-clip: text) or (-webkit-background-clip: text)) and (color: color-mix(in oklab, red, blue))) {
  @media (prefers-reduced-motion: no-preference) {
    .home-hero-line.is-accent { animation: home-rise var(--home-enter-duration) var(--ease-standard) backwards, home-sheen var(--home-sheen-duration) var(--ease-standard); }
  }
}

/* 首屏以下逐块进场（滚动驱动）；不支持时内容照常可见 */
@supports (animation-timeline: view()) {
  @media (prefers-reduced-motion: no-preference) {
    .home-feature-copy, .home-card { animation: home-reveal linear both; animation-timeline: view(); animation-range: entry 8% cover 34%; }
  }
}
@keyframes home-reveal { from { opacity: 0; transform: translateY(var(--home-reveal-travel)) scale(var(--home-reveal-scale)); } }

/* 主视觉视差：随滚动缓慢下沉（小屏关闭）。显式绑定 root 滚动（.home-hero 自己 overflow: hidden） */
@supports (animation-timeline: scroll()) {
  @media (prefers-reduced-motion: no-preference) and (width >= 768px) {
    .home-hero-decor { animation: home-parallax linear both; animation-timeline: scroll(root block); animation-range: 0 var(--home-parallax-range); }
  }
}
@keyframes home-parallax {
  from { transform: scale(var(--home-parallax-scale)) translateY(0); }
  to { transform: scale(var(--home-parallax-scale)) translateY(var(--home-parallax-shift)); }
}

@media (768px <= width < 1200px) {
  .home-hero-inner { padding: calc(var(--header-block) + env(safe-area-inset-top) + var(--space-10)) var(--space-10) var(--space-10); }
  .home-hero-mid { display: block; }
  .home-hero-reticle { display: none; }
  .home-feature-copy { inset-inline: var(--space-10); }
  .home-cards { padding: var(--space-8) var(--space-10); }
}

/* 小屏与 Android App：同一套首页（2026-11-07 用户），整屏竖版主视觉、遮罩自下而上；
   赞助卡是主视觉下方第一块（实心按钮），反馈是第二块 */
@media (width < 768px) {
  .home-hero-decor { background: var(--theme-hero-scrim-portrait), var(--theme-hero-image-portrait) center 72% / cover; }
  .home-hero-mid { display: block; flex: none; }
  .home-hero-reticle { display: none; }
  .home-hero-inner { justify-content: flex-end; padding: calc(var(--header-block) + env(safe-area-inset-top) + var(--space-6)) var(--gutter) var(--space-8); }
  .home-hero-kicker { margin-bottom: var(--space-3); }
  /* 小屏优先缩字号与占用，而不是改布局（2026-11-08 用户）；34px 仍是首屏最大的字 */
  .home-hero h1 { font-size: var(--home-hero-title-size-compact); }
  .home-hero-subtitle { margin-top: var(--space-4); font-size: var(--font-size-body); }
  .home-hero-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2); margin-top: var(--space-5); }
  .home-cta { grid-column: 1 / -1; }
  .home-cta-android, .home-cta-ghost { width: 100%; justify-content: center; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md); background: var(--theme-glass); }
  .home-cta-ghost:nth-child(2) { grid-column: 1 / -1; }
  .home-hero-foot { display: block; margin-top: var(--space-6); padding-top: 0; }
  .home-stats { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: var(--space-4); padding-top: var(--space-4); border-top: 1px solid var(--color-border-subtle); }
  .home-stat strong { font: var(--type-display); }
  .home-support { inline-size: auto; margin: var(--space-6) 0 0; }
  .home-sponsor { flex-wrap: wrap; }
  .home-sponsor-text { flex-basis: 0; }
  .home-sponsor-cta { flex: 1 1 100%; justify-content: center; min-height: var(--control-h-lg); }
  .home-feature { min-height: calc(var(--space-12) * 9); }
  .home-feature-image { object-position: 30% top; }
  .home-feature-copy { inset-inline: var(--gutter); inset-block-end: var(--space-4); }
  .home-feature.is-armor .home-feature-copy { inset-block: auto var(--space-4); }
  .home-feature.is-armor .home-feature-shade { background: linear-gradient(to top, var(--color-canvas) 20%, transparent 70%); }
  .home-feature-copy h3 { font: var(--type-h1); }
  .home-callouts { inset-inline-end: var(--gutter); inset-block-start: var(--space-4); }
  .home-cards { grid-template-columns: minmax(0, 1fr); gap: var(--space-3); padding: var(--space-4) var(--gutter); }
  .home-card-figure { block-size: calc(var(--space-12) * 3.5); }
}
</style>
