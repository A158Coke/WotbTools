<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import PlayerRatingRadar from './PlayerRatingRadar.vue'
import { CW_DIM_KEYS } from '../utils/playerSummaryMerge.js'

/**
 * 选手详情 Side Drawer（plan §8/§9/§16）。
 * - position: fixed 右侧 overlay，不占 Table 布局空间（§8.4/§15）。
 * - 打开时 focus 关闭按钮；Escape / × / backdrop 关闭；关闭后 focus 回到触发行（§16）。
 * - selection identity = accountId（§8.7）：排序/刷新后由父组件按 accountId 重新 resolve 数据。
 * - 单场（scope=battle）与汇总（scope=summary）共用；雷达图七轴归一化（§10）。
 */
const props = defineProps({
  /** 当前选中上下文；null = 关闭（§34）。 */
  context: { type: Object, default: null },
  /** Drawer 标题区域数据（父组件已按 context 解析好当前行）。 */
  player: { type: Object, default: null },
})
const emit = defineEmits(['close'])
const { t } = useI18n()

const open = computed(() => !!props.context && !!props.player)
const closeBtn = ref(null)

const RADAR_LABELS = [
  'league.drawer.radar.damage',
  'league.drawer.radar.assist',
  'league.drawer.radar.kill',
  'league.drawer.radar.exchange',
  'league.drawer.radar.blocked',
  'league.drawer.radar.survival',
  'league.drawer.radar.shooting',
]

/** 七维原始分数（summary: dimensionMedians；battle: 单场 cells）。 */
const radarScores = computed(() => {
  const p = props.player
  if (!p) return []
  if (p.dimensionMedians) return p.dimensionMedians
  return CW_DIM_KEYS.map(k => p.cells?.[k])
})

const RADAR_MAXES = [400, 100, 100, 150, 50, 100, 100]

/** 顶部 Rating 信息（null/undefined/非有限 → '--'，不冒充 0；plan §8.6 缺失侧）。 */
function ratingLine() {
  const p = props.player
  if (!p) return { rating: '--', pct: '' }
  const raw = p.rating ?? p.ratingMedian
  if (raw == null || raw === '') return { rating: '--', pct: '' }
  const v = Number(raw)
  if (!Number.isFinite(v)) return { rating: '--', pct: '' }
  const pct = Math.round(1000 * v / 1000) / 10
  return { rating: Math.round(v), pct: pct + '%' }
}

const facts = computed(() => {
  const p = props.player
  if (!p) return []
  const num = v => (v == null || v === '' || !Number.isFinite(Number(v))) ? '--' : String(Math.round(Number(v) * 10) / 10)
  const rows = []
  if (p.cells && p.cells.battles != null) rows.push([t('league.drawer.battles'), p.cells.battles])
  else if (p.battles != null) rows.push([t('league.drawer.battles'), p.battles])
  if (p.cells && p.cells.win_rate != null) rows.push([t('league.drawer.win_rate'), num(p.cells.win_rate) + '%'])
  else if (p.winRate != null) rows.push([t('league.drawer.win_rate'), num(p.winRate) + '%'])
  if (p.cells && p.cells.wins != null) rows.push([t('league.drawer.wins'), p.cells.wins])
  else if (p.wins != null) rows.push([t('league.drawer.wins'), p.wins])
  if (p.mvpCount != null) rows.push([t('league.drawer.mvp'), p.mvpCount])
  if (p.cells && p.cells.damage_avg != null) rows.push([t('league.drawer.damage_avg'), num(p.cells.damage_avg)])
  if (p.cells && p.cells.assisted_avg != null) rows.push([t('league.drawer.assist_avg'), num(p.cells.assisted_avg)])
  if (p.cells && p.cells.kills_avg != null) rows.push([t('league.drawer.kills_avg'), num(p.cells.kills_avg)])
  if (p.cells && p.cells.earned_avg != null) rows.push([t('league.drawer.earned_avg'), num(p.cells.earned_avg)])
  // 单场字段
  if (p.cells && p.cells.damage_dealt != null) rows.push([t('league.drawer.damage'), num(p.cells.damage_dealt)])
  if (p.cells && p.cells.damage_assisted != null) rows.push([t('league.drawer.assist'), num(p.cells.damage_assisted)])
  if (p.cells && p.cells.kills != null) rows.push([t('league.drawer.kills'), p.cells.kills])
  if (p.cells && p.cells.victory_points_earned != null) rows.push([t('league.drawer.points_earned'), p.cells.victory_points_earned])
  if (p.cells && p.cells.survived_label != null) rows.push([t('league.drawer.survived'), p.cells.survived_label === 'SURVIVED' ? t('survived.alive') : t('survived.dead')])
  return rows
})

function onKeydown(e) {
  if (e.key === 'Escape' && open.value) {
    emit('close')
  }
}

watch(open, (v) => {
  if (v) {
    nextTick(() => closeBtn.value?.focus?.())
  } else {
    // 关闭后 focus 回到触发行由父组件负责（§16）
  }
})

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="drawer-backdrop" @click.self="emit('close')">
      <aside class="player-drawer" role="dialog" aria-modal="true"
             :aria-labelledby="'pd-title-' + (player?.accountId ?? 'x')">
        <div class="pd-head">
          <div>
            <div class="pd-title" :id="'pd-title-' + (player?.accountId ?? 'x')">{{ player?.nickname || '--' }}</div>
            <div class="pd-sub">{{ player?.clan || t('league.drawer.no_clan') }}</div>
          </div>
          <button ref="closeBtn" class="pd-close" :aria-label="t('league.drawer.close')" @click="emit('close')">✕</button>
        </div>
        <div class="pd-rating">
          <span class="pd-rating-value">{{ ratingLine().rating }}</span>
          <span class="pd-rating-pct">{{ ratingLine().pct }}</span>
        </div>
        <div class="pd-section">{{ t('league.drawer.radar_title') }}</div>
        <PlayerRatingRadar :scores="radarScores" :maxes="RADAR_MAXES"
                           :labels="RADAR_LABELS.map(k => t(k))" />
        <div class="pd-section">{{ t('league.drawer.facts_title') }}</div>
        <dl class="pd-facts">
          <template v-for="(f, i) in facts" :key="i">
            <dt>{{ f[0] }}</dt>
            <dd>{{ f[1] }}</dd>
          </template>
        </dl>
      </aside>
    </div>
  </Teleport>
</template>

<style scoped>
.drawer-backdrop {
  position: fixed; inset: 0; z-index: 60;
  background: color-mix(in srgb, #000 35%, transparent);
}
.player-drawer {
  position: fixed; top: 56px; right: 8px; bottom: 8px; width: min(380px, calc(100vw - 16px));
  background: var(--bg-card2); border: 1px solid var(--border); border-radius: 12px;
  box-shadow: var(--surface-shadow); overflow-y: auto; padding: 16px;
  animation: pd-slide-in .22s ease-out;
}
@keyframes pd-slide-in {
  from { transform: translateX(30px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
.pd-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
.pd-title { font-size: 1.1rem; font-weight: 800; color: var(--text-heading); }
.pd-sub { font-size: .8rem; color: var(--text-sub); margin-top: 2px; }
.pd-close {
  border: 1px solid var(--border); background: transparent; color: var(--text-sub);
  width: 30px; height: 30px; border-radius: 7px; cursor: pointer; font-size: .9rem; flex: none;
}
.pd-close:hover { color: var(--text-heading); border-color: var(--accent); }
.pd-rating { display: flex; align-items: baseline; gap: 8px; margin: 12px 0 4px; }
.pd-rating-value { font-size: 1.6rem; font-weight: 800; color: var(--accent-dark); font-variant-numeric: tabular-nums; }
.pd-rating-pct { font-size: .9rem; color: var(--text-sub); font-weight: 700; }
.pd-section { margin: 14px 0 8px; font-size: .8rem; font-weight: 800; color: var(--text-sub); letter-spacing: .02em; }
.pd-facts { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 0; font-size: .82rem; }
.pd-facts dt { color: var(--text-sub); font-weight: 600; }
.pd-facts dd { margin: 0; color: var(--text-heading); font-weight: 700; font-variant-numeric: tabular-nums; text-align: right; }
</style>
