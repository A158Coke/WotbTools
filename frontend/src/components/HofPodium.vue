<script setup lang="ts">
// 名人堂单场榜前三名领奖台（4.0 设计探索「名人堂」页）：第 1 名居中加高、强调色描边，
// 大号名次水印 + 地图封面背景 + 车辆图。只是表格前三行的视觉强调，表格本身仍完整列出前三名（不改数据与分页）。
// 小屏只显示第 1 名。车辆图缺失时隐藏，不显示破图标。
import { computed } from 'vue'
import { tankImageUrl } from '../scene/agentData.js'
import { mapCoverUrl } from '../scene/replaySource.js'
import { mapImages } from '../data/mapImages.js'
import { mapLabel } from '../utils/helpers.js'

interface PodiumRow {
  id: number | string
  rank: number
  nickname?: string
  tankId?: number | string
  tankName?: string
  damageDealt: number
  mapName?: string
}

const props = defineProps<{ rows: PodiumRow[], compact?: boolean, locale: string }>()

/** 大屏按 2 · 1 · 3 排列（第 1 名居中）；小屏只留第 1 名。 */
const ordered = computed(() => {
  const [first, second, third] = props.rows
  if (props.compact) return first ? [first] : []
  return [second, first, third].filter((row): row is PodiumRow => Boolean(row))
})

/** 资产源未配置时 tankImageUrl 会抛错：领奖台只是装饰，退化为不显示车辆图。 */
function tankImage(row: PodiumRow) {
  if (row.tankId == null) return null
  try { return tankImageUrl(Number(row.tankId)) } catch { return null }
}

/** 卡片背景：该记录的地图封面（资源服务器 cover.webp），不可用时回退打包地图图；都没有就不画。 */
function mapBackground(row: PodiumRow) {
  if (!row.mapName) return null
  try {
    const cover = mapCoverUrl(row.mapName)
    if (cover) return cover
  } catch { /* 资产源未配置 / 离线门控：回退打包图 */ }
  return (mapImages as Record<string, { src?: string } | undefined>)[row.mapName]?.src ?? null
}

function hideBrokenImage(event: Event) {
  (event.target as HTMLImageElement).hidden = true
}
</script>

<template>
  <section class="hof-podium" :class="{ 'is-compact': compact }" :aria-label="$t('hof.podium')" data-testid="hof-podium">
    <article v-for="row in ordered" :key="row.id" class="hof-podium-card" :class="{ 'is-first': row.rank === 1 }">
      <img v-if="mapBackground(row)" class="hof-podium-map" :src="mapBackground(row) ?? undefined" alt="" decoding="async" loading="lazy" @error="hideBrokenImage">
      <span class="hof-podium-scrim" aria-hidden="true" />
      <span class="hof-podium-watermark" aria-hidden="true">{{ row.rank }}</span>
      <img
        v-if="tankImage(row)"
        class="hof-podium-tank"
        :src="tankImage(row) ?? undefined"
        alt=""
        width="208"
        height="130"
        decoding="async"
        loading="lazy"
        @error="hideBrokenImage"
      >
      <div class="hof-podium-body">
        <p class="hof-podium-rank">{{ $t('hof.podiumRank', { rank: row.rank }) }}</p>
        <strong class="hof-podium-damage">{{ row.damageDealt.toLocaleString(locale) }}</strong>
        <div class="hof-podium-who">
          <p class="hof-podium-name">{{ row.nickname || '—' }}</p>
          <p class="hof-podium-meta">{{ row.tankName || '—' }} · {{ mapLabel(row.mapName, locale) || '—' }}</p>
        </div>
      </div>
    </article>
  </section>
</template>

<style scoped>
.hof-podium {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.24fr) minmax(0, 1fr);
  align-items: end;
  gap: var(--space-4);
  margin-block-end: var(--space-5);
}
.hof-podium.is-compact { grid-template-columns: minmax(0, 1fr); }

.hof-podium-card {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  block-size: calc(var(--space-12) * 5.5);
  padding: var(--space-5);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
}
.hof-podium-card.is-first { block-size: calc(var(--space-12) * 6.25); border-color: var(--color-accent); }
.is-compact .hof-podium-card.is-first { block-size: calc(var(--space-12) * 4.5); padding: var(--space-4); }

.hof-podium-map {
  position: absolute;
  inset: 0;
  inline-size: 100%;
  block-size: 100%;
  object-fit: cover;
  opacity: .55;
}
/* 遮罩：左下是文字区，压成接近卡片底色；右上让地图透出来 */
.hof-podium-scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(to top right, var(--color-surface-1) 30%, color-mix(in srgb, var(--color-surface-1) 55%, transparent) 70%, color-mix(in srgb, var(--color-surface-1) 20%, transparent));
}
.hof-podium-watermark {
  position: absolute;
  inset-block-start: var(--space-2);
  inset-inline-end: var(--space-3);
  color: color-mix(in srgb, var(--color-text-primary) 18%, transparent);
  /* 展示字阶（--type-display-showcase）只给 Showcase Hero（DC-TYP-03），水印用数据区最大字阶 */
  font: var(--type-display-hero);
  font-weight: 700;
  letter-spacing: -0.04em;
}

.hof-podium-tank {
  position: absolute;
  inset-block-end: var(--space-12);
  inset-inline-end: var(--space-2);
  inline-size: 52%;
  block-size: auto;
  object-fit: contain;
}

.hof-podium-body { position: relative; display: flex; flex-direction: column; block-size: 100%; }
.hof-podium-rank { margin: 0; color: var(--color-text-secondary); font: var(--type-caption); font-weight: 600; }
.is-first .hof-podium-rank { color: var(--color-accent-text); }
.hof-podium-damage { color: var(--color-text-primary); font: var(--type-display); font-variant-numeric: tabular-nums; letter-spacing: -0.03em; }
.is-first .hof-podium-damage { color: var(--color-accent-text); font: var(--type-display-hero); }
.hof-podium-who { margin-block-start: auto; min-inline-size: 0; }
.hof-podium-name { margin: 0; overflow: hidden; color: var(--color-text-primary); font: var(--type-h3); text-overflow: ellipsis; white-space: nowrap; }
.hof-podium-meta { margin: 0; overflow: hidden; color: var(--color-text-secondary); font: var(--type-caption); text-overflow: ellipsis; white-space: nowrap; }
</style>
