<script setup>
import { computed } from 'vue'
import GunMarksBadge from './GunMarksBadge.vue'
import { useI18n } from 'vue-i18n'
import { hpPresentationFor } from '../scene/rosterState.js'

defineOptions({ name: 'PlaybackRoster' })

const props = defineProps({
  teams: { type: Object, required: true },
  friendlyTeam: { type: Number, default: null },
  gunMarks: { type: Map, default: () => new Map() },
  destroyed: { type: Set, default: () => new Set() },
  health: { type: Object, default: null },
  reload: { type: Object, default: null },
  variant: { type: String, default: '2d' },
  selectedId: { type: null, default: null },
  showEmptyTeams: { type: Boolean, default: false },
  compact: { type: Boolean, default: false },
  dense: { type: Boolean, default: false },
})
const emit = defineEmits(['select'])
const { t } = useI18n()

const SECTIONS = Object.freeze([
  { key: 'team1', labelKey: 'agentReplay.team1', className: 'pb-roster-team1 team team1' },
  { key: 'unknown', labelKey: 'agentReplay.teamUnknown', className: 'pb-roster-unknown team team-unknown' },
  { key: 'team2', labelKey: 'agentReplay.team2', className: 'pb-roster-team2 team team2' },
])

const groups = computed(() => (props.friendlyTeam === 2 ? [SECTIONS[2], SECTIONS[1], SECTIONS[0]] : SECTIONS)
  .map((section) => {
    let labelKey = section.labelKey
    if ([1, 2].includes(props.friendlyTeam) && section.key !== 'unknown') {
      labelKey = section.key === `team${props.friendlyTeam}` ? 'recon.map.team_friendly' : 'recon.map.team_enemy'
    }
    return { ...section, labelKey, rows: (props.teams?.[section.key] || []).map(decorate) }
  })
  .filter((section) => section.rows.length > 0 || (props.showEmptyTeams && section.key in props.teams)))

function decorate(row) {
  const id = props.variant === '3d' ? row.eid : (row.accountId ?? row.eid)
  const subset = props.health?.[id] || null
  const rawHp = subset ? subset.currentHp : row.hp
  const currentHp = rawHp == null ? null : Math.max(0, Math.round(Number(rawHp) || 0))
  const maxHp = subset ? subset.maxHp : row.maxHp
  const destroyed = props.destroyed.has(id) || row.dead === true
  const hp = hpPresentationFor({
    currentHp,
    maxHp,
    pct: subset?.pct,
    relativeFull: subset?.relativeFull,
    state: destroyed ? 'DESTROYED' : (subset?.state ?? null),
  }, destroyed)
  return {
    ...row,
    id,
    teamColor: [1, 2].includes(props.friendlyTeam) && [1, 2].includes(row.team)
      ? (row.team === props.friendlyTeam ? 'var(--color-team-ally)' : 'var(--color-team-enemy)')
      : 'var(--color-text-secondary)',
    player: row.playerName ?? row.nick ?? '—',
    tank: row.tankName || row.tank || row.tankId || '—',
    hp,
    hpMode: hp.mode,
    hpValue: hpValueOf(hp),
    destroyed,
    followed: row.followed === true,
    selected: props.selectedId != null && props.selectedId === id,
  }
}
const fillHeight = computed(() => props.compact === true && props.dense !== true)
function hpValueOf(hp) {
  if (hp.mode === 'exact') return String(Math.round(hp.currentHp))
  if (hp.mode === 'relative') return hp.text
  return hp.mode === 'unknown' ? hp.text : ''
}

const ROSTER_ROW_MIN_PX = 26

function listRows(rowCount) {
  const count = Math.max(1, rowCount)
  if (props.dense) return `repeat(${count}, var(--roster-row-dense, 30px))`
  return `repeat(${count}, minmax(var(--roster-row-min, ${ROSTER_ROW_MIN_PX}px), 1fr))`
}
</script>

<template>
  <div
    class="pb-roster"
    :class="['pb-roster-' + variant, { 'pb-roster-compact': compact, 'pb-roster-dense': dense, 'pb-roster-fill': fillHeight }]"
    data-test="pb-shell-roster"
  >
    <section
      v-for="section in groups"
      :key="section.key"
      class="pb-roster-team team"
      :class="section.className"
      :data-team="section.key"
    >
      <h3 class="pb-team-head">{{ t(section.labelKey) }}</h3>
      <div class="pb-roster-list roster" :style="{ gridTemplateRows: listRows(section.rows.length) }">
        <button
          v-for="row in section.rows"
          :key="row.id"
          type="button"
          class="pb-roster-row pl"
          :class="{ 'is-destroyed': row.destroyed, dead: row.destroyed, 'is-selected': row.selected, selected: row.selected, followed: row.followed, ['hp-mode-' + row.hp.mode]: true }"
          data-test="pb-roster-row"
          :data-account-id="row.id"
          :style="{ '--roster-team-color': row.teamColor }"
          :aria-pressed="row.selected"
          @click="emit('select', row.id, $event)"
        >
          <span v-if="variant === '3d'" class="dot" :style="{ background: row.teamColor }" aria-hidden="true" />
          <span class="nick pb-team-player" data-test="pb-roster-player">{{ row.player }}</span>
          <span class="tank pb-team-tank" data-test="pb-roster-tank">{{ row.tank }}</span>
          <GunMarksBadge v-if="!dense" :marks="gunMarks.get(row.accountId)" />
          <span
            class="pb-roster-hpbar pb-roster-hp"
            :class="'hp-mode-' + row.hp.mode"
            data-test="roster-hp"
            role="img"
            :aria-label="row.hp.text"
          >
            <span v-if="row.hp.fill > 0" class="pb-roster-hpfill" :style="{ width: (row.hp.fill * 100) + '%' }" aria-hidden="true"></span>
            <span v-if="row.hpValue" class="pb-roster-hpvalue" data-test="roster-hp-value" aria-hidden="true">{{ row.hpValue }}</span>
          </span>
        </button>
      </div>
    </section>
    <p v-if="!compact" class="pb-roster-hint">{{ t('workspace.playback_roster_hint') }}</p>
  </div>
</template>

<style scoped>
.pb-roster-row {
  --roster-rowfill-z: -1;
  position: relative;
  isolation: isolate;
  overflow: hidden;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--space-1);
  width: 100%;
  min-inline-size: 0;
  min-height: var(--hit-min);
  padding: var(--space-1) var(--space-2);
  border: 1px solid transparent;
  border-radius: 0;
  background: transparent;
  color: var(--color-text-primary);
  font: var(--type-caption);
  text-align: start;
  cursor: pointer;
}
.pb-roster-row .dot { inline-size: var(--space-2); block-size: var(--space-2); border-radius: var(--radius-sm); flex: none; }
.pb-roster-row .nick { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pb-roster-row .tank { flex: 0 1 auto; max-inline-size: 86px; min-width: 0; overflow: hidden; color: var(--color-text-secondary); text-overflow: ellipsis; white-space: nowrap; }

.pb-roster-hpbar {
  display: block;
  flex: none;
  inline-size: 52px;
  block-size: var(--space-4);
}
.pb-roster-hpvalue {
  display: flex;
  align-items: center;
  justify-content: center;
  block-size: 100%;
  color: var(--color-text-primary);
  font: var(--type-caption);
  font-size: var(--font-size-caption-xs);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  line-height: var(--space-4);
  text-shadow: var(--text-shadow-playback-label);
}
.pb-roster-hpfill {
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  z-index: var(--roster-rowfill-z);
  background: var(--roster-team-color);
  opacity: .55;
}
.pb-roster-team .pb-roster-row.hp-mode-unknown { background: var(--color-surface-3); }

.pb-roster-row.is-selected { background: var(--color-surface-3); outline: 1px solid var(--color-text-secondary); }
.pb-roster-row.followed { outline: 1px solid var(--color-accent); }
.pb-roster-row.selected.followed { outline-color: var(--color-accent); }
.pb-roster-row.is-destroyed { opacity: .42; }
.pb-roster-row.dead .nick { text-decoration: line-through; }
.pb-roster-row:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

.pb-roster { display: grid; grid-template-columns: minmax(0, 1fr); min-inline-size: 0; align-content: start; gap: var(--space-3); width: 100%; min-block-size: 0; padding: var(--space-3); }


.pb-roster.pb-roster-fill { align-content: stretch; block-size: 100%; }
.pb-roster.pb-roster-fill .pb-roster-team { grid-template-rows: auto minmax(0, 1fr); min-block-size: 0; }
.pb-roster.pb-roster-fill .pb-roster-list { align-content: stretch; min-block-size: 0; }
.pb-roster.pb-roster-fill .pb-roster-row {
  min-block-size: var(--roster-row-min, 26px);
  block-size: 100%;
  overflow: hidden;
}

.pb-roster-team { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-1); min-width: 0; padding: var(--space-1); }
.pb-roster-3d {
  inline-size: 100%;
  max-inline-size: 100%;
  flex: 0 0 auto;
  min-block-size: 0;
  padding: var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--color-surface-1);
}
.pb-roster-3d .pb-roster-team { background: none; border: 0; }
.pb-roster-3d.pb-roster-compact:not(.pb-roster-dense) { flex: 0 0 66.667%; }
.pb-team-head { margin: 0; color: var(--color-text-secondary); font: var(--type-caption); font-weight: 800; }
.pb-roster-list { display: grid; grid-template-columns: minmax(0, 1fr); min-inline-size: 0; gap: var(--space-1); margin: 0; padding: 0; }
.pb-roster-team.pb-roster-team1 .pb-roster-row { border-inline-start: 3px solid var(--roster-team-color); }
.pb-roster-team.pb-roster-team2 .pb-roster-row { border-inline-start: 3px solid var(--roster-team-color); }
.pb-roster-team.pb-roster-unknown .pb-roster-row { border-inline-start: 3px solid var(--color-border-subtle); opacity: .8; }
.pb-roster-team .pb-roster-row { background: var(--color-playback-label-track); }
.pb-roster-row:hover { background: var(--color-surface-3); }
.pb-roster-hint { margin: 0; color: var(--color-text-tertiary); font: var(--type-caption); }

.pb-roster-compact { gap: var(--space-1); padding: 0; }
.pb-roster-compact .pb-roster-team { gap: 0; padding: 0; }
.pb-roster-compact .pb-roster-list { gap: 2px; }
.pb-roster-compact .pb-roster-row { min-height: 0; padding: 0 var(--space-1); border-block-width: 0; }

.pb-roster-dense { gap: 0; padding: 0; }
.pb-roster-dense .pb-roster-team { gap: 0; padding: 0; }
.pb-roster-dense .pb-team-head { padding-inline: var(--space-1); font-size: var(--font-size-caption-xs); line-height: var(--line-height-caption-xs); }
.pb-roster-dense .pb-roster-list { gap: 2px; }
.pb-roster-dense .pb-roster-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) 44px;
  grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  column-gap: var(--space-1);
  row-gap: 0;
  min-height: 30px;
  block-size: var(--roster-row-dense, 30px);
  padding: 1px var(--space-1);
  border-block-width: 0;
  overflow: hidden;
}
.pb-roster-dense .pb-roster-row .dot { grid-column: 1; grid-row: 1 / 3; align-self: center; }
.pb-roster-dense .pb-roster-row .nick {
  grid-column: 2; grid-row: 1; align-self: end;
  min-inline-size: 0; font-size: var(--font-size-caption-xs); line-height: var(--line-height-caption-xs);
}
.pb-roster-dense .pb-roster-row .tank {
  grid-column: 2; grid-row: 2; align-self: start;
  max-inline-size: none; min-inline-size: 0;
  font-size: var(--font-size-caption-xs); line-height: var(--line-height-caption-xs);
}
.pb-roster-dense .pb-roster-hpbar {
  grid-column: 3; grid-row: 1 / 3; align-self: center;
  inline-size: 44px; block-size: 20px;
}
.pb-roster-dense .pb-roster-hpvalue {
  font-size: var(--font-size-caption-xs);
  line-height: var(--line-height-body);
}
.pb-roster-dense.pb-roster-3d { flex: 0 0 auto; }
@media (width < 1200px) and (pointer: coarse) {
  .pb-roster:not(.pb-roster-dense) { --roster-row-min: calc(var(--space-4) * 4); }
  .pb-roster.pb-roster-fill:not(.pb-roster-dense) .pb-roster-list { overflow-y: auto; }
}
@media (pointer: coarse) and (orientation: landscape) and (height <= 520px) {
  .pb-roster { --roster-row-min: var(--row-h); }
}
</style>
