<script setup>
/**
 * 首页 = 营销落地页（2026-10-18 重排）。信息架构的唯一不变量：**每个功能入口全页只出现一次**。
 * 重排前首页是三份互相重复的导航副本（hero 按钮 / feature 卡 / 快捷面板），回放解析出现四次，
 * 而坦克百科、联赛积分榜、联赛直播回放、bilibili 推荐完全没有首页入口。
 *
 * 分段职责：① Hero（价值主张 + 唯一主 CTA + 装饰插槽）② 数据带 ③ 核心能力 ④ 社区与数据 ⑤ 页脚条。
 * 项目历史 / 技术演进 / 联系我 不在首页重复，由 `useMoreMenu.js` 的「更多」信息组承载。
 *
 * 门禁边界：**请求**受 capability 门禁约束（名人堂数据），**导航链接**不受约束 —— 与
 * `app/navigation.js` 的 PRIMARY_NAV 一致（侧边栏 / 底部 Tab 栏同样无条件呈现这些入口），
 * 避免为「入口是否可见」建立第二个 owner；目标页各自拥有自己的离线态。
 */
import { computed, inject, ref, watch } from 'vue'
import * as api from '../utils/api.js'
import { ArrowRight, Compass } from 'lucide-vue-next'
import AppButton from './AppButton.vue'
import heroDecorImg from '../assets/showcase/home/hero-v4.webp'
import cardAiReviewImg from '../assets/showcase/home/card-ai-review-v1.webp'
import cardBattlePlaybackImg from '../assets/showcase/home/card-battle-playback-v1.webp'
import cardHofImg from '../assets/showcase/home/card-hall-of-fame-v1.webp'
import { isAndroidApp } from '../composables/usePlatformBridge.js'
import { RouterLink } from 'vue-router'
import { ONBOARDING_KEY } from '../shared/onboarding.js'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'

const onboarding = inject(ONBOARDING_KEY, null)

const topRecord = ref(null)
const recordTotal = ref(null)

const topDamageDisplay = computed(() => {
  const damage = Number(topRecord.value?.damageDealt)
  return Number.isFinite(damage) ? formatCount(damage) : '--'
})
const recordTotalDisplay = computed(() => {
  // `?? NaN` 是必需的：Number(null) === 0，缺失的总数会伪装成「收录 0 条」这个事实。
  const total = Number(recordTotal.value ?? NaN)
  return Number.isFinite(total) ? formatCount(total) : '--'
})

/** 核心能力：回放解析由 Hero 的唯一主 CTA 拥有，不在此重复出现。 */
const coreFeatures = [
  { id: 'ai-review', href: '/?view=ai-review', image: cardAiReviewImg, titleKey: 'home.aiReview', descKey: 'home.aiReviewDesc' },
  { id: 'battle-playback', href: '/?view=battle-playback', image: cardBattlePlaybackImg, titleKey: 'home.battlePlayback', descKey: 'home.battlePlaybackDesc' },
  { id: 'hof', href: '/?view=hof', image: cardHofImg, titleKey: 'hof.btn', descKey: 'home.hofDesc' },
]

/** 社区与数据：此前只在侧边栏存在、首页完全没有入口的四项。label 复用导航既有译文，不新增文案。 */
const communityEntries = [
  { id: 'tankopedia', href: '/?view=agent-tankopedia', labelKey: 'nav.tankopedia' },
  { id: 'tournament-points', href: '/?view=tournament-points', labelKey: 'tournament.title' },
  { id: 'league-broadcasts', href: '/?view=league-broadcasts', labelKey: 'leagueBroadcasts.title' },
  { id: 'creators', href: '/?view=recommendations', labelKey: 'creators.nav' },
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
  <main class="homepage-landing layout-wide">
    <!-- ① Hero：价值主张 + 唯一主 CTA；装饰插槽（design-language §2）仅 Showcase 呈现 -->
    <section class="home-hero" :style="{ '--home-hero-image': `url(${heroDecorImg})` }">
      <div class="home-hero-copy">
        <h1>{{ $t('app.title') }}</h1>
        <p class="home-hero-subtitle">{{ $t('app.subtitle') }}</p>
        <div class="home-hero-actions">
          <AppButton class="home-cta-primary" variant="primary" size="lg" href="/?view=replay">{{ $t('home.replayParse') }}<ArrowRight :size="16" aria-hidden="true" /></AppButton>
          <AppButton v-if="onboarding" class="home-cta-guide" size="lg" data-testid="home-onboarding" aria-describedby="home-onboarding-hint" @click="onboarding.openDirectory()"><Compass :size="18" aria-hidden="true" />{{ $t('onboarding.newbie') }}</AppButton>
        </div>
        <p v-if="onboarding" id="home-onboarding-hint" class="home-hero-hint">{{ $t('onboarding.newbieHint') }}</p>

        <!-- ② 数据带：两个数字同源于一次 /api/hof 响应 -->
        <dl class="home-stats">
          <div class="home-stat">
            <dt>{{ $t('home.highestDamageRecord') }}</dt>
            <dd>
              <strong>{{ topDamageDisplay }}</strong>
              <span v-if="topRecord" class="home-stat-meta">
                <b>{{ topRecord.tankName || topRecord.vehicleName || '—' }}</b>
                <small>{{ topRecord.nickname || topRecord.playerNickname || '—' }}</small>
                <small>{{ topRecord.map || topRecord.mapName || '—' }}</small>
              </span>
            </dd>
          </div>
          <div class="home-stat">
            <dt>{{ $t('home.recordTotal') }}</dt>
            <dd><strong>{{ recordTotalDisplay }}</strong></dd>
          </div>
        </dl>
      </div>
      <div class="home-hero-decor" aria-hidden="true"></div>
    </section>

    <!-- ③ 核心能力 -->
    <section class="home-section" aria-labelledby="home-core-title">
      <h2 id="home-core-title" class="home-section-title">{{ $t('home.coreTitle') }}</h2>
      <div class="home-core-grid">
        <a v-for="feature in coreFeatures" :key="feature.id" class="home-core-card" :href="feature.href">
          <div class="home-core-visual"><img :src="feature.image" width="840" height="560" loading="lazy" decoding="async" alt="" aria-hidden="true"></div>
          <div class="home-core-copy">
            <h3>{{ $t(feature.titleKey) }}</h3>
            <p>{{ $t(feature.descKey) }}</p>
            <span class="home-core-action">{{ $t(feature.titleKey) }} <ArrowRight :size="16" aria-hidden="true" /></span>
          </div>
        </a>
      </div>
    </section>

    <!-- ④ 社区与数据：此前首页缺失的四个入口 -->
    <section class="home-section" aria-labelledby="home-community-title">
      <h2 id="home-community-title" class="home-section-title">{{ $t('home.communityTitle') }}</h2>
      <div class="home-community-grid">
        <a v-for="entry in communityEntries" :key="entry.id" class="home-community-card" :href="entry.href">
          <span>{{ $t(entry.labelKey) }}</span>
          <ArrowRight :size="16" aria-hidden="true" />
        </a>
      </div>
    </section>

    <!-- ⑤ 页脚条：项目历史 / 技术演进 / 联系我 由「更多」承载，首页不再抄一份 -->
    <section class="home-footer-bar">
      <RouterLink to="/sponsor">{{ $t('home.sponsorTitle') }} <ArrowRight :size="16" aria-hidden="true" /></RouterLink>
      <a v-if="!isAndroidApp()" href="/download/android">{{ $t('android.nav') }} <ArrowRight :size="16" aria-hidden="true" /></a>
      <a href="https://github.com/A158Coke/WotbTools/issues/new" target="_blank" rel="noopener">{{ $t('app.feedback') }} <ArrowRight :size="16" aria-hidden="true" /></a>
    </section>
  </main>
</template>

<style scoped>
.homepage-landing {
  display: grid;
  gap: var(--space-8);
  color: var(--color-text-primary);
}

/* ① Hero —— 装饰插槽（design-language §2）：Showcase 显示，Classic 置 none。
   文案压在纯色表面上、图像只占右侧一栏，避免 WCAG 1.4.3 的「文字压图」对比度不可控。
   图片 URL 由 JS import 经 `--home-hero-image` 内联传入（与全站资产引用方式一致）；
   插槽开关是另一个变量 `--home-hero-decor`，因此 Profile 与断点仍能在 CSS 里把它关掉。 */
.home-hero {
  --home-hero-decor: var(--home-hero-image);
  display: grid;
  grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
  align-items: center;
  gap: var(--space-8);
  overflow: hidden;
  padding: var(--space-10) var(--space-8);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
}
html[data-ui-profile="classic"] .home-hero { --home-hero-decor: none; }

.home-hero-copy { min-width: 0; }
.home-hero h1 { margin: 0; color: var(--color-text-primary); font: var(--type-display); }
.home-hero-subtitle { max-width: var(--reading-measure); margin: var(--space-3) 0 0; color: var(--color-text-secondary); font: var(--type-body); line-height: var(--line-height-prose); }
.home-hero-actions { display: flex; gap: var(--space-3); flex-wrap: wrap; margin-top: var(--space-6); }
.home-cta-primary, .home-cta-guide { white-space: normal; text-align: center; }
.home-cta-guide { border-color: var(--color-accent); color: var(--color-accent-text); }
.home-hero-hint { margin: var(--space-2) 0 0; color: var(--color-text-secondary); font: var(--type-caption); }

/* ② 数据带 */
.home-stats { display: flex; gap: var(--space-8); flex-wrap: wrap; margin: var(--space-8) 0 0; padding-top: var(--space-5); border-top: 1px solid var(--color-border-subtle); }
.home-stat { min-width: 0; }
.home-stat dt { color: var(--color-text-secondary); font: var(--type-caption); }
.home-stat dd { margin: var(--space-2) 0 0; }
.home-stat strong { display: block; color: var(--color-accent-text); font: var(--type-display); font-variant-numeric: tabular-nums; }
.home-stat-meta { display: grid; gap: var(--space-1); margin-top: var(--space-2); color: var(--color-text-secondary); font: var(--type-caption); overflow-wrap: anywhere; }
.home-stat-meta b { color: var(--color-text-primary); }
.home-stat-meta small { font: inherit; }

.home-hero-decor {
  align-self: stretch;
  min-height: 260px;
  border-radius: var(--radius-md);
  background-image: var(--home-hero-decor);
  background-position: center;
  background-size: cover;
}

/* ③ / ④ 区块外壳 */
.home-section { display: grid; gap: var(--space-5); }
.home-section-title { margin: 0; color: var(--color-text-primary); font: var(--type-h2); }

.home-core-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-4); }
.home-core-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
  color: var(--color-text-primary);
  text-decoration: none;
  transition: border-color var(--duration-fast) var(--ease-standard);
}
.home-core-visual { aspect-ratio: 3 / 1; overflow: hidden; background: var(--color-surface-2); }
.home-core-visual img { width: 100%; height: 100%; object-fit: cover; object-position: center; }
.home-core-copy { display: flex; flex: 1; flex-direction: column; align-items: start; padding: var(--space-5); }
.home-core-copy h3 { margin: 0 0 var(--space-2); color: var(--color-text-primary); font: var(--type-h3); }
.home-core-copy p { margin: 0 0 var(--space-4); color: var(--color-text-secondary); font: var(--type-body); line-height: var(--line-height-prose); }
.home-core-action { display: inline-flex; align-items: center; gap: var(--space-2); margin-top: auto; color: var(--color-accent-text); font: var(--type-caption); font-weight: 600; }
.home-core-action svg { flex: none; }
.home-core-card:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

.home-community-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-3); }
.home-community-card {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
  min-height: var(--control-h-md);
  padding: var(--space-4);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
  color: var(--color-text-primary);
  font: var(--type-body);
  font-weight: 600;
  text-decoration: none;
  transition: border-color var(--duration-fast) var(--ease-standard);
}
.home-community-card span { min-width: 0; overflow-wrap: anywhere; }
.home-community-card svg { flex: none; margin-inline-start: auto; color: var(--color-accent-text); }
.home-community-card:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

/* ⑤ 页脚条 */
.home-footer-bar { display: flex; gap: var(--space-6); flex-wrap: wrap; padding-top: var(--space-5); border-top: 1px solid var(--color-border-subtle); }
.home-footer-bar a { display: inline-flex; align-items: center; gap: var(--space-2); min-height: var(--control-h-md); color: var(--color-text-secondary); font: var(--type-body); text-decoration: none; }
.home-footer-bar a svg { flex: none; }
.home-footer-bar a:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

@media (hover: hover) {
  .home-core-card:hover, .home-community-card:hover { border-color: var(--color-accent); text-decoration: none; }
  .home-footer-bar a:hover { color: var(--color-accent-text); text-decoration: none; }
}
@media (768px <= width < 1200px) {
  .home-hero { grid-template-columns: minmax(0, 1fr); padding: var(--space-8) var(--space-6); }
  .home-hero-decor { min-height: 180px; }
  .home-core-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .home-community-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (width < 768px) {
  .homepage-landing { gap: var(--space-6); }
  /* 手机：装饰插槽关闭，首屏留给价值主张、主 CTA 与数据带 */
  .home-hero { --home-hero-decor: none; grid-template-columns: minmax(0, 1fr); gap: var(--space-5); padding: var(--space-6) var(--space-5); }
  .home-hero-decor { display: none; }
  .home-hero-actions { display: grid; grid-template-columns: minmax(0, 1fr); }
  .home-stats { gap: var(--space-5); margin-top: var(--space-6); }
  .home-core-grid, .home-community-grid { grid-template-columns: minmax(0, 1fr); }
}
</style>
