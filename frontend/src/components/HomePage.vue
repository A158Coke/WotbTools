<script setup>
/**
 * 首页 = 纯展示页（2026-10-18 重排）。它**不承担导航**。
 *
 * 依据：`AppSidebar.vue`（桌面 / 平板）与 `AppTabBar.vue` + `MorePage`（手机）已经覆盖
 * `app/navigation.js:PRIMARY_NAV` 的全部功能入口，三档都在。首页再摆一排功能卡就是把
 * 侧边栏抄一遍，所以这里只留一个功能入口（Replay Workspace / 上传回放）和 Web 侧边栏没有的
 * 非功能 / 转化入口：Android 下载、Sponsor、Feedback。Android App 内隐藏 Android 下载卡，
 * Sponsor 保留并单列占满。
 *
 * 另一条硬约束：`app/viewRegistry.js:30-32` 的 `replay` / `battle-playback` / `ai-review` /
 * `agent-replay` / `agent-shots` 五个 view 落在同一个 `ReplayWorkspace`，只是初始 capability
 * tab 不同。它们不是独立目的地，整页只能有 Hero 那一个回放入口。
 *
 * 分段：① 全出血 Hero ② 实时数据带 ③ 能力展示（**无链接**，纯视觉）④ 带走它 / 赞助
 * ⑤ 极简页脚。③ 的截图全部来自产品自带的匿名官方示例回放与公开页面，不含用户的私有数据。
 */
import { computed, inject, ref, watch } from 'vue'
import * as api from '../api/hall-of-fame.js'
import { ArrowRight, Heart, Smartphone } from 'lucide-vue-next'
import AppButton from './AppButton.vue'
import heroDecorImg from '../assets/showcase/home/hero-v4.webp'
import phoneShotImg from '../assets/showcase/home/showcase-android-v1.webp'
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
import { isAndroidApp } from '../composables/usePlatformBridge.js'

const onboarding = inject(ONBOARDING_KEY, null)
// 地图名走 common/map_names.json 的三语表（与 Playback / Workspace 同一个 mapLabel），
// 不把 `savanna` 这种原始 key 直接摆在 hero 上。
const { locale } = useI18n()
// Android App / WebView 内已经有应用本身，再给一个「下载 Android」既不可能也不合理。
// 平台判断复用 `usePlatformBridge.js` 的唯一实现（与 useMoreMenu 的 Android 入口同一 owner）。
const androidApp = isAndroidApp()

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
function formatCount(value) { return countFormatter.value.format(Math.round(value)) }
</script>

<template>
  <main class="home-stage">
    <!-- ① 全出血 Hero -->
    <section class="home-hero" :style="{ '--home-hero-image': `url(${heroDecorImg})` }">
      <!-- 装饰层放在内容**之前**：两者都定位，后出现的内容自然压在上面，不需要 z-index。 -->
      <div class="home-hero-decor" aria-hidden="true"></div>
      <div class="home-hero-inner layout-wide">
        <h1>
          <span class="home-hero-line">{{ $t('home.heroLine1') }}</span>
          <span class="home-hero-line is-accent">{{ $t('home.heroLine2') }}</span>
        </h1>
        <p class="home-hero-subtitle">{{ $t('home.heroSubtitle') }}</p>
        <div class="home-hero-actions">
          <AppButton class="home-cta" variant="primary" size="lg" href="/?view=replay">{{ $t('home.replayParse') }}<ArrowRight :size="18" aria-hidden="true" /></AppButton>
          <AppButton v-if="!androidApp" class="home-cta-android" variant="secondary" size="lg" href="/download/android">
            <Smartphone :size="18" aria-hidden="true" />{{ $t('android.nav') }}
          </AppButton>
          <button v-if="onboarding" type="button" class="home-cta-ghost" data-testid="home-onboarding" @click="onboarding.openDirectory()">{{ $t('onboarding.newbie') }}</button>
        </div>

        <!-- ② 实时数据带：两个数字同源于一次 /api/hof 响应 -->
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

    <!-- ④ 带走它，也养着它：Android 与赞助是转化动作，不是功能导航。Android 卡只在 Web 出现；Sponsor 两端都保留。 -->
    <section class="home-take layout-wide" aria-labelledby="home-take-title">
      <h2 id="home-take-title" class="home-showcase-title">{{ $t('home.takeItTitle') }}</h2>
      <div class="home-take-grid" :class="{ 'is-sponsor-only': androidApp }">
        <article v-if="!androidApp" class="home-take-card">
          <div class="home-take-phone">
            <img :src="phoneShotImg" width="390" height="844" loading="lazy" decoding="async" alt="" aria-hidden="true">
          </div>
          <div class="home-take-copy">
            <h3><Smartphone :size="20" aria-hidden="true" />{{ $t('home.androidTitle') }}</h3>
            <p>{{ $t('home.androidDesc') }}</p>
            <a class="home-take-cta" href="/download/android">{{ $t('android.nav') }} <ArrowRight :size="16" aria-hidden="true" /></a>
          </div>
        </article>
        <article class="home-take-card is-sponsor">
          <div class="home-take-copy">
            <h3><Heart :size="20" aria-hidden="true" />{{ $t('home.sponsorTitle') }}</h3>
            <p>{{ $t('home.sponsorDesc') }}</p>
            <RouterLink class="home-take-cta" to="/sponsor">{{ $t('home.sponsorCta') }} <ArrowRight :size="16" aria-hidden="true" /></RouterLink>
          </div>
        </article>
      </div>
    </section>

    <!-- ⑤ 极简页脚 -->
    <section class="home-footer-bar layout-wide">
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
  min-height: var(--home-hero-min-h-desktop);
  overflow: hidden;
  padding-block: var(--space-12);
  border-bottom: 1px solid var(--color-border-subtle);
}
/* 不要写 width：`.layout-wide` 的左右边距就是靠 `width: min(max, 100% - gutter*2)` 做出来的，
   在这里补一条 `width: 100%` 会把它盖掉，Hero 就贴着屏幕边缘、还比下面的区块少一个 gutter。 */
.home-hero-inner { position: relative; }

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

.home-hero h1 { max-width: var(--home-hero-title-measure); margin: 0; color: var(--color-text-primary); font: var(--type-display-hero); letter-spacing: -0.02em; }
/* 两行对句：第二行是强调行，承载渐变与扫光。 */
.home-hero-line { display: block; }
.home-hero-line.is-accent { color: var(--color-accent-text); }

/* 渐变文字 + 一次性扫光。
   `color: transparent` 只在 @supports 命中时才写——不加这层保护，一旦 background-clip
   不被支持，强调行就是**透明的**，整句话直接消失。不命中时回落到上面的纯强调色。
   动画只扫一次（fill-mode none + 零延迟）：没跑起来时就是渐变静止态，不会空白。 */
@supports (((background-clip: text) or (-webkit-background-clip: text)) and (color: color-mix(in oklab, red, blue))) {
  .home-hero-line.is-accent {
    background-image: linear-gradient(
      100deg,
      var(--color-accent) 0%,
      var(--color-accent-text) 34%,
      color-mix(in oklab, var(--color-accent-text) 42%, var(--color-text-primary)) 58%,
      var(--color-accent-text) 100%
    );
    background-size: 220% 100%;
    background-position: 100% 0;
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
}
@keyframes home-sheen {
  from { background-position: 0 0; }
}

/* 副标题只做位移。试过「从模糊里浮出来」，但 `filter: blur()` 踩的是同一个坑：
   不绘制的页面里动画卡在第一帧，副标题永久停在 blur(6px) —— 实测后台标签页就是这样，
   等于一段读不了的正文。首屏之上一律只动 transform。 */
.home-hero-subtitle { max-width: var(--home-hero-subtitle-measure); margin: var(--space-4) 0 0; color: var(--color-text-secondary); font: var(--type-body); font-size: var(--home-hero-subtitle-size); line-height: var(--line-height-prose); }
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
/* 截图不加边框、不加底色、不加投影：四边用 mask 淡出，直接化进页面底色里，
   而不是摆成一张裱好的卡片。两条渐变取交集，所以四边都软。 */
.home-shot-figure { min-width: 0; }
.home-shot-figure img { display: block; width: 100%; height: auto; }
@supports (mask-composite: intersect) {
  .home-shot-figure img {
    mask-image:
      linear-gradient(to bottom, transparent 0%, currentcolor 7%, currentcolor 90%, transparent 100%),
      linear-gradient(to right, transparent 0%, currentcolor 6%, currentcolor 94%, transparent 100%);
    mask-composite: intersect;
  }
}
.home-shot-copy { min-width: 0; }
.home-shot-copy h3 { margin: 0; color: var(--color-text-primary); font: var(--type-h2); }
.home-shot-copy p { max-width: var(--home-shot-copy-measure); margin: var(--space-3) 0 0; color: var(--color-text-secondary); font: var(--type-body); line-height: var(--line-height-prose); }

/* ④ 带走它，也养着它 */
.home-take { display: grid; gap: var(--space-5); }
.home-take-grid { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); align-items: stretch; gap: var(--space-4); }
/* Android App 内整张 Android 转化卡不渲染：赞助卡独占一行，不留空列。 */
.home-take-grid.is-sponsor-only { grid-template-columns: minmax(0, 1fr); }
.home-take-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: var(--space-6);
  min-width: 0;
  overflow: hidden;
  padding: var(--space-6);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
  transition: border-color var(--duration-slow) var(--ease-standard);
}
.home-take-card.is-sponsor { grid-template-columns: minmax(0, 1fr); }
/* 同样不裱框：手机截图从底部淡出，像是从页面里浮起来的，而不是贴上去的一张图 */
.home-take-phone { width: var(--home-phone-preview-w); height: var(--home-phone-preview-h); min-width: 0; }
.home-take-phone img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top; }
@supports (mask-composite: intersect) {
  .home-take-phone img {
    mask-image:
      linear-gradient(to bottom, currentcolor 56%, transparent 100%),
      linear-gradient(to right, transparent 0%, currentcolor 9%, currentcolor 91%, transparent 100%);
    mask-composite: intersect;
  }
}
.home-take-copy { min-width: 0; }
.home-take-copy h3 { display: flex; align-items: center; gap: var(--space-2); margin: 0; color: var(--color-text-primary); font: var(--type-h3); }
.home-take-copy h3 svg { flex: none; color: var(--color-accent-text); }
.home-take-copy p { margin: var(--space-2) 0 var(--space-5); color: var(--color-text-secondary); font: var(--type-body); line-height: var(--line-height-prose); }
/* 轮廓按钮而非实心：design-language §3.2 每个视图只留一个橙色实心主操作，那个名额归 Hero 的 CTA */
.home-take-cta {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--control-h-md);
  padding: 0 var(--space-5);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-md);
  color: var(--color-accent-text);
  font: var(--type-body);
  font-weight: 600;
  text-decoration: none;
  transition: background-color var(--duration-base) var(--ease-standard);
}
.home-take-cta svg { flex: none; transition: transform var(--duration-base) var(--ease-standard); }
.home-take-cta:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

/* ⑤ 页脚条 */
.home-footer-bar { display: flex; gap: var(--space-6); flex-wrap: wrap; padding-block: var(--space-6) var(--space-10); border-top: 1px solid var(--color-border-subtle); }
.home-footer-bar a { display: inline-flex; align-items: center; gap: var(--space-2); min-height: var(--control-h-md); color: var(--color-accent-text); font: var(--type-body); font-weight: 600; text-decoration: none; }
.home-footer-bar a svg { flex: none; }
.home-footer-bar a:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
@media (hover: hover) {
  .home-footer-bar a:hover { text-decoration: underline; }
  .home-take-card:hover { border-color: var(--color-accent); }
  .home-take-cta:hover { background: color-mix(in oklab, var(--color-accent) 16%, transparent); }
}

/* 位移 / 缩放 / 光晕都属于动效：reduce 用户连声明都拿不到，不依赖「补一条 reset」。 */
@media (hover: hover) and (prefers-reduced-motion: no-preference) {
  .home-footer-bar a svg { transition: transform var(--duration-base) var(--ease-standard); }
  .home-footer-bar a:hover svg { transform: translateX(var(--space-1)); }

  /* 主 CTA：箭头前移 + 强调色光晕，给一个「可以往下走」的暗示 */
  .home-cta svg { transition: transform var(--duration-base) var(--ease-standard); }
  .home-cta { transition: box-shadow var(--duration-base) var(--ease-standard); }
  .home-cta:hover svg { transform: translateX(var(--space-1)); }
  .home-cta:hover { box-shadow: 0 0 0 var(--space-2) color-mix(in oklab, var(--color-accent) 22%, transparent); }

  /* 展示图：抬起 + 内部缓慢推近，让静态截图有活物感。 */
  .home-shot-figure { transition: transform var(--duration-slow) var(--ease-standard); }
  .home-shot-figure img { transition: transform var(--duration-slow) var(--ease-standard); }
  .home-shot:hover .home-shot-figure { transform: translateY(calc(-1 * var(--home-hover-lift))); }
  .home-shot:hover .home-shot-figure img { transform: scale(var(--home-hover-zoom)); }

  .home-take-cta:hover svg { transform: translateX(var(--space-1)); }
}

/* 进场动效：一次淡入上浮。
   **元素的常态是可见的**，动效只是叠在上面的一段 animation，不涉及任何 JS。
   **只动位移，不动透明度**，这条是实测逼出来的：不绘制的标签页里动画会卡在第一帧
   （动画处于活动期但时间线不推进，`fill-mode` 改不改都一样），所以任何从 `opacity: 0`
   起步的进场动画都会让整页空白——后台标签页加载 10 秒后实测仍是 opacity 0。
   真人看不到这个空白（要看到就得切过去，一切过去就开始绘制），但**单帧抓取**会：
   社交分享预览、截图服务、打印，对一个营销首页正好要紧。
   卡在第一帧的最坏情况现在只是「内容下移一个 `--home-rise-travel`」，始终可读。
   同理不能用「默认 opacity: 0，等 JS 加 class 再显出来」：那把整页可见性挂在 rAF 回调上。
   错落统一用 duration + `animation-delay`；`backwards` 让延迟期保持初始位移，避免「先可见再跳」的空窗。 */
@keyframes home-rise {
  from { transform: translateY(var(--home-rise-travel)); }
}
/* 进场动画只在 no-preference 下存在；默认态（含 reduce）没有任何 animation。 */
@media (prefers-reduced-motion: no-preference) {
  .home-hero-line { animation: home-rise var(--home-enter-duration) var(--ease-standard) backwards; }
  .home-hero-line:nth-child(2) { animation-delay: var(--home-enter-stagger); }
  .home-hero-subtitle { animation: home-rise var(--home-enter-duration) var(--ease-standard) backwards; animation-delay: calc(var(--home-enter-stagger) * 2); }
  .home-hero-inner, .home-shot, .home-footer-bar { animation: home-rise var(--home-enter-duration) var(--ease-standard) backwards; }
  .home-shot:nth-of-type(2) { animation-delay: calc(var(--home-enter-stagger) * 1); }
  .home-shot:nth-of-type(3) { animation-delay: calc(var(--home-enter-stagger) * 2); }
  .home-shot:nth-of-type(4) { animation-delay: calc(var(--home-enter-stagger) * 3); }
  .home-shot:nth-of-type(5) { animation-delay: calc(var(--home-enter-stagger) * 4); }
}
/* 渐变强调行的扫光叠在 rise 上；放在基础动画之后，避免 nth-child 的 delay 污染 sheen。 */
@supports (((background-clip: text) or (-webkit-background-clip: text)) and (color: color-mix(in oklab, red, blue))) {
  @media (prefers-reduced-motion: no-preference) {
    .home-hero-line.is-accent { animation: home-rise var(--home-enter-duration) var(--ease-standard) backwards, home-sheen var(--home-sheen-duration) var(--ease-standard); }
  }
}

/* 滚动驱动的逐块进场。只给**首屏以下**的展示块，所以这里可以放心用透明度——
   上面那条「不动透明度」的约束是为了保住首屏单帧抓取（社交预览只截视口），
   视口之外的内容本来就不在那张图里。
   `animation-timeline` 不被支持时整条 @supports 不生效，退回上面基于时间线的
   位移动画，内容照样可见。 */
@supports (animation-timeline: view()) {
  @media (prefers-reduced-motion: no-preference) {
    .home-shot {
      animation: home-reveal linear both;
      animation-timeline: view();
      animation-range: entry 8% cover 34%;
    }
  }
}
@keyframes home-reveal {
  from { opacity: 0; transform: translateY(var(--home-reveal-travel)) scale(var(--home-reveal-scale)); }
}

/* Hero 装饰图的视差：随滚动缓慢下沉。先放大 8% 留出位移余量，避免露边。 */
@supports (animation-timeline: scroll()) {
  @media (prefers-reduced-motion: no-preference) {
    .home-hero-decor {
      animation: home-parallax linear both;
      /* 必须显式指定 root：`scroll()` 绑的是最近的滚动容器，而 `.home-hero` 自己带
         `overflow: hidden`，会被当成一个永不滚动的容器，动画直接不生效（实测 transform 恒为 none）。 */
      animation-timeline: scroll(root block);
      animation-range: 0 var(--home-parallax-range);
    }
  }
}
@keyframes home-parallax {
  from { transform: scale(var(--home-parallax-scale)) translateY(0); }
  to { transform: scale(var(--home-parallax-scale)) translateY(var(--home-parallax-shift)); }
}

@media (768px <= width < 1200px) {
  .home-hero { min-height: var(--home-hero-min-h-tablet); }
  .home-shot { gap: var(--space-8); }
}
@media (width < 768px) {
  .home-stage { gap: var(--space-10); }
  /* 手机：装饰插槽关闭，首屏留给标题、主 CTA 与数据带 */
  .home-hero { --home-hero-decor: none; min-height: 0; padding-block: var(--space-10); }
  .home-hero-decor { display: none; }
  .home-hero-actions { gap: var(--space-3); }
  .home-cta { width: 100%; }
  .home-cta-android { width: 100%; }
  .home-stats { gap: var(--space-6); margin-top: var(--space-8); }
  .home-showcase { gap: var(--space-10); }
  .home-shot { grid-template-columns: minmax(0, 1fr); gap: var(--space-4); }
  .home-shot.is-flipped .home-shot-figure { order: 0; }
  .home-take-grid { grid-template-columns: minmax(0, 1fr); }
  .home-take-card { grid-template-columns: minmax(0, 1fr); gap: var(--space-4); }
  .home-take-phone { width: var(--home-phone-preview-mobile-w); max-height: var(--home-phone-preview-mobile-max-h); }
}
</style>
