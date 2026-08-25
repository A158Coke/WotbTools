<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import PlayerRatingRadar from './PlayerRatingRadar.vue'
import { CW_DIM_KEYS } from '../utils/playerSummaryMerge.js'
import { leagueMaxByKey, ratingTotalText } from '../utils/helpers.js'
import {
  RADAR_METRIC_DEFS,
  RADAR_AVAILABLE_KEYS,
  RADAR_MIN_AXES,
  RADAR_MAX_AXES,
  loadRadarPreference,
  saveRadarPreference,
  resolveRadarMetric,
} from '../utils/radarMetrics.js'

/**
 * 选手详情 Side Drawer。
 * - position: fixed 右侧 overlay，不占 Table 布局空间。
 * - 打开时 focus 关闭按钮；Escape / × / backdrop 关闭；关闭后 focus 回到触发行。
 * - selection identity = accountId：排序/刷新后由父组件按 accountId 重新 resolve 数据。
 * - scope 语义：summary = 当前批次（Rating 中位数 + 七维算术平均（dimensionMeans，
 *   Radar 平均能力画像）+ 跨场 Performance Metrics + 比赛事实）；battle = 本场表现
 *   （单场 Rating + 本场七维（dimensionScores）+ 本场 Performance + 单场 facts）。
 *   battle scope 禁止使用 dimensionMeans / dimensionMedians（那是跨场数据）。
 * - Radar：默认七维，用户可自定义指标/顺序（Radar Metric Registry，presentation-only，
 *   独立于 Table ColumnPicker，独立 localStorage）；axis 缺失 → '--'，不冒充 0/0%。
 *   League 维度归一化使用后端 resp.league.columns 满分 metadata（key/max），不复制常量。
 */
const props = defineProps({
  /** 当前选中上下文；null = 关闭。 */
  context: { type: Object, default: null },
  /** Drawer 标题区域数据（父组件已按 context 解析好当前行）。 */
  player: { type: Object, default: null },
  /** League Rating 列满分元数据（resp.league.columns：key → max；Radar 归一化唯一事实源）。 */
  leagueColumns: { type: Array, default: () => [] },
})
const emit = defineEmits(['close'])
const { t } = useI18n()

const open = computed(() => !!props.context && !!props.player)
const closeBtn = ref(null)

const isSummary = computed(() => props.context?.scope === 'summary')

/** 顶部 Rating 信息：缺失（null/undefined/非有限）→ '--'，不冒充 0；
 * 只显示整数（927）——总 Rating 格式化统一走 helpers.ratingTotalText。 */
function ratingLine() {
  const p = props.player
  if (!p) return { rating: '--' }
  return { rating: ratingTotalText(p.rating ?? p.ratingMedian) }
}

// ---- Radar Metric Selection：默认七维，用户可自定义指标与顺序 ----
// 偏好独立于 Table ColumnPicker，Summary/Battle 共用同一配置。
const radarOrder = ref(loadRadarPreference())
const showRadarPicker = ref(false)
const radarHint = ref('')

function persistRadarOrder() {
  saveRadarPreference(radarOrder.value)
}

function toggleRadarMetric(key) {
  const cur = [...radarOrder.value]
  const idx = cur.indexOf(key)
  if (idx >= 0) {
    if (cur.length <= RADAR_MIN_AXES) {
      radarHint.value = t('league.drawer.radar_min_hint', { n: RADAR_MIN_AXES })
      return
    }
    cur.splice(idx, 1)
    radarHint.value = ''
  } else {
    if (cur.length >= RADAR_MAX_AXES) {
      radarHint.value = t('league.drawer.radar_max_hint', { n: RADAR_MAX_AXES })
      return
    }
    cur.push(key)
    radarHint.value = ''
  }
  radarOrder.value = cur
  persistRadarOrder()
}

function moveRadarMetric(key, dir) {
  const cur = [...radarOrder.value]
  const idx = cur.indexOf(key)
  const to = idx + dir
  if (idx < 0 || to < 0 || to >= cur.length) return
  const [moved] = cur.splice(idx, 1)
  cur.splice(to, 0, moved)
  radarOrder.value = cur
  persistRadarOrder()
}

/** League 维度满分 metadata（resp.league.columns：key → max），Radar 归一化使用，不复制后端常量。 */
const maxByKey = computed(() => leagueMaxByKey(props.leagueColumns))

/** 雷达轴（顺序 = 用户偏好；league 维度按 scope 取数：
 *  summary → dimensionMeans[i]（rated-battle 算术平均），battle → dimensionScores[i]
 *  （本场七维）；均按后端 column.max 归一化，performance 取 cells[key] 按 /100。
 *  禁止 battle 复用跨场聚合字段、禁止 summary 用 median 冒充 mean）。 */
const radarMetrics = computed(() => {
  const p = props.player
  if (!p) return []
  return radarOrder.value
    .map((key) => {
      const def = RADAR_METRIC_DEFS[key]
      if (!def) return null
      let raw
      if (def.source === 'league') {
        const idx = CW_DIM_KEYS.indexOf(key)
        raw = isSummary.value ? p.dimensionMeans?.[idx] : p.dimensionScores?.[idx]
      } else {
        raw = p.cells?.[key]
      }
      const resolved = resolveRadarMetric(key, raw, maxByKey.value)
      return { ...resolved, label: t(resolved.label) }
    })
    .filter(Boolean)
})

const radarAvailableCount = computed(() => radarMetrics.value.filter(m => m.available).length)
const radarHasMissing = computed(() =>
  radarMetrics.value.length > 0 && radarAvailableCount.value < radarMetrics.value.length)

// ---- 表现指标（Performance Metrics；独立区域，不是 Rating）----
const perfFacts = computed(() => {
  const p = props.player
  if (!p) return []
  return ['contribution', 'kast', 'impact'].map((key) => {
    const v = p.cells?.[key]
    const display = (v == null || v === '' || !Number.isFinite(Number(v)))
      ? '--'
      : (Math.round(Number(v) * 10) / 10) + '%'
    return [t('player_labels.' + key), display]
  })
})

// ---- 比赛事实（summary 批次中位数样本；battle 单场 facts）----
const facts = computed(() => {
  const p = props.player
  if (!p) return []
  const num = v => (v == null || v === '' || !Number.isFinite(Number(v))) ? '--' : String(Math.round(Number(v) * 10) / 10)
  const rows = []
  if (isSummary.value) {
    rows.push([t('league.drawer.battles'), p.cells?.battles ?? '--'])
    rows.push([t('league.drawer.rated_battles'), p.cells?.rated_battles ?? '--'])
    rows.push([t('league.drawer.wins'), p.cells?.wins ?? '--'])
    if (p.cells?.win_rate != null) rows.push([t('league.drawer.win_rate'), num(p.cells.win_rate) + '%'])
    if (p.mvpCount != null) rows.push([t('league.drawer.mvp'), p.mvpCount])
    rows.push([t('league.drawer.damage_avg'), num(p.cells?.damage_avg)])
    rows.push([t('league.drawer.assist_avg'), num(p.cells?.assisted_avg)])
    rows.push([t('league.drawer.kills_avg'), num(p.cells?.kills_avg)])
    rows.push([t('league.drawer.earned_avg'), num(p.cells?.earned_avg)])
  } else {
    rows.push([t('league.drawer.damage'), num(p.cells?.damage_dealt)])
    rows.push([t('league.drawer.assist'), num(p.cells?.damage_assisted)])
    rows.push([t('league.drawer.kills'), p.cells?.kills ?? '--'])
    rows.push([t('league.drawer.blocked'), num(p.cells?.damage_blocked)])
    rows.push([t('league.drawer.shots'), p.cells?.n_shots ?? '--'])
    rows.push([t('league.drawer.hits'), p.cells?.n_hits_dealt ?? '--'])
    rows.push([t('league.drawer.pens'), p.cells?.n_penetrations_dealt ?? '--'])
    rows.push([t('league.drawer.survived'),
      p.cells?.survived_label === 'SURVIVED' ? t('survived.alive')
        : p.cells?.survived_label === 'DESTROYED' ? t('survived.dead') : '--'])
    rows.push([t('league.drawer.points_earned'), p.cells?.victory_points_earned ?? '--'])
  }
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
  }
  // 关闭后 focus 回到触发行由父组件负责
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
            <div class="pd-sub">{{ player?.clan || t('league.drawer.no_clan') }}
              <span class="pd-scope">{{ isSummary ? t('league.drawer.scope_summary') : t('league.drawer.scope_battle') }}</span>
            </div>
          </div>
          <button ref="closeBtn" class="pd-close" :aria-label="t('league.drawer.close')" @click="emit('close')">✕</button>
        </div>
        <div class="pd-rating">
          <span class="pd-rating-value">{{ ratingLine().rating }}</span>
        </div>

        <!-- 七维 / 自定义 Radar -->
        <div class="pd-section-row">
          <div class="pd-section">{{ isSummary ? t('league.drawer.radar_title_summary') : t('league.drawer.radar_title_battle') }}</div>
          <button class="pd-linkbtn" data-testid="radar-settings" @click="showRadarPicker = !showRadarPicker">
            {{ showRadarPicker ? t('league.drawer.radar_done') : t('league.drawer.radar_settings') }}
          </button>
        </div>
        <div v-if="showRadarPicker" class="radar-picker" data-testid="radar-picker">
          <p v-if="radarHint" class="radar-hint">{{ radarHint }}</p>
          <ul class="radar-picker-list">
            <li v-for="key in RADAR_AVAILABLE_KEYS" :key="key"
                :class="{ checked: radarOrder.includes(key) }">
              <label class="rp-item">
                <input type="checkbox" :checked="radarOrder.includes(key)"
                       @change="toggleRadarMetric(key)" />
                {{ t(RADAR_METRIC_DEFS[key].labelKey) }}
              </label>
              <span class="rp-arrows">
                <button class="rp-arrow" :disabled="!radarOrder.includes(key) || radarOrder.indexOf(key) === 0"
                        :aria-label="t('league.drawer.radar_move_up')" @click="moveRadarMetric(key, -1)">↑</button>
                <button class="rp-arrow" :disabled="!radarOrder.includes(key) || radarOrder.indexOf(key) === radarOrder.length - 1"
                        :aria-label="t('league.drawer.radar_move_down')" @click="moveRadarMetric(key, 1)">↓</button>
              </span>
            </li>
          </ul>
        </div>
        <p v-if="radarHasMissing" class="radar-partial" data-testid="radar-partial">{{ t('league.drawer.radar_partial') }}</p>
        <div v-if="radarAvailableCount === 0" class="radar-empty" data-testid="radar-empty">{{ t('league.drawer.radar_unavailable') }}</div>
        <PlayerRatingRadar v-else :metrics="radarMetrics" />

        <!-- 表现指标（Contribution/KAST/Impact 独立区域，不是 Rating） -->
        <div class="pd-section">{{ t('league.drawer.perf_title') }}</div>
        <dl class="pd-facts" data-testid="perf-facts">
          <template v-for="(f, i) in perfFacts" :key="'p' + i">
            <dt>{{ f[0] }}</dt>
            <dd>{{ f[1] }}</dd>
          </template>
        </dl>

        <!-- 比赛事实（scope 语义） -->
        <div class="pd-section">{{ isSummary ? t('league.drawer.facts_title_summary') : t('league.drawer.facts_title_battle') }}</div>
        <dl class="pd-facts" data-testid="player-facts">
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
  /* Desktop：drawer 从 var(--topbar-h)+8 开始，topbar（--z-topbar）保持在 backdrop 之上
     （topbar 仍可见/可交互）。≤1080px 时提升到 --z-modal（见下方 media query），
     Drawer 成为 modal overlay，叠在 sticky topbar 之上，关闭按钮始终可见可操作。 */
  position: fixed; inset: 0; z-index: 60;
  background: color-mix(in srgb, #000 35%, transparent);
}
.player-drawer {
  position: fixed; top: calc(var(--topbar-h) + 8px); right: 8px; bottom: 8px; width: min(380px, calc(100vw - 16px));
  background: var(--bg-card2); border: 1px solid var(--border); border-radius: 12px;
  box-shadow: var(--surface-shadow); overflow-y: auto; padding: 16px;
  animation: pd-slide-in .22s ease-out;
}
@keyframes pd-slide-in {
  from { transform: translateX(30px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
@media (max-width: 1080px) {
  /* <=1080px 时 App.vue .topbar 变为 sticky + auto height（可换行、高度不定），
     固定偏移无法对齐；回退从视口顶部开始的右侧面板（backdrop/× 仍可关闭）。
     stacking contract：Drawer 是 modal overlay——backdrop 提升到 --z-modal（200，
     高于 --z-topbar 100），保证面板/关闭按钮在 sticky topbar 之上；全局 modal
     （--z-modal 200）仍可与 Drawer 同级，由 DOM 顺序决出。 */
  .drawer-backdrop { z-index: var(--z-modal); }
  .player-drawer { top: 8px; }
}
.pd-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
.pd-title { font-size: 1.1rem; font-weight: 800; color: var(--text-heading); }
.pd-sub { font-size: .8rem; color: var(--text-sub); margin-top: 2px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pd-scope { font-size: .68rem; font-weight: 700; color: var(--accent-dark); background: var(--bg-blue-light); border-radius: 8px; padding: 2px 8px; }
.pd-close {
  border: 1px solid var(--border); background: transparent; color: var(--text-sub);
  width: 30px; height: 30px; border-radius: 7px; cursor: pointer; font-size: .9rem; flex: none;
}
.pd-close:hover { color: var(--text-heading); border-color: var(--accent); }
.pd-rating { display: flex; align-items: baseline; gap: 8px; margin: 12px 0 4px; }
.pd-rating-value { font-size: 1.6rem; font-weight: 800; color: var(--accent-dark); font-variant-numeric: tabular-nums; }
.pd-section { margin: 14px 0 8px; font-size: .8rem; font-weight: 800; color: var(--text-sub); letter-spacing: .02em; }
.pd-section-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 14px 0 8px; }
.pd-section-row .pd-section { margin: 0; }
.pd-linkbtn {
  border: 1px solid var(--border-light); background: transparent; color: var(--text-sub);
  font-size: .72rem; font-weight: 700; border-radius: 6px; padding: 3px 10px; cursor: pointer; font-family: inherit;
}
.pd-linkbtn:hover { color: var(--accent-dark); border-color: var(--accent); }
.radar-picker { margin: 4px 0 8px; padding: 8px 10px; border: 1px solid var(--border-light); border-radius: 8px; }
.radar-hint { margin: 0 0 6px; font-size: .72rem; color: var(--warn-text); }
.radar-picker-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; max-height: 240px; overflow-y: auto; }
.radar-picker-list li { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: .78rem; }
.rp-item { display: flex; align-items: center; gap: 6px; color: var(--text-label); cursor: pointer; }
.rp-item input { accent-color: var(--accent); }
.rp-arrows { display: inline-flex; gap: 2px; }
.rp-arrow {
  width: 22px; height: 20px; border: 1px solid var(--border-light); background: transparent;
  color: var(--text-sub); border-radius: 5px; font-size: .7rem; cursor: pointer; font-family: inherit;
}
.rp-arrow:disabled { opacity: .35; cursor: default; }
.rp-arrow:not(:disabled):hover { color: var(--accent-dark); border-color: var(--accent); }
.radar-partial { margin: 2px 0 6px; font-size: .72rem; color: var(--warn-text); }
.radar-empty { margin: 10px 0; padding: 14px; text-align: center; color: var(--text-muted); font-size: .8rem; border: 1px dashed var(--border); border-radius: 8px; }
.pd-facts { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 0; font-size: .82rem; }
.pd-facts dt { color: var(--text-sub); font-weight: 600; }
.pd-facts dd { margin: 0; color: var(--text-heading); font-weight: 700; font-variant-numeric: tabular-nums; text-align: right; }
</style>
