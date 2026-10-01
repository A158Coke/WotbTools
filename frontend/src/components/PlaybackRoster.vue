<script setup>
// 两队阵容（审计 BZ-13 / PB-03）：PC / 平板右侧栏、手机横屏右栏共用。点玩家 → 父组件选中该车。
import { useI18n } from 'vue-i18n'

defineOptions({ name: 'PlaybackRoster' })

defineProps({
  /** { friendly: Vehicle[], enemy: Vehicle[] }（来自结算名单） */
  teams: { type: Object, required: true },
  /** 当前时刻已被击毁的 accountId 集合 */
  destroyed: { type: Set, default: () => new Set() },
})
const emit = defineEmits(['select'])
const { t } = useI18n()
</script>

<template>
  <div class="pb-shell-roster" data-test="pb-shell-roster">
    <section v-for="side in ['friendly', 'enemy']" :key="side" class="pb-roster-team" :class="'pb-roster-' + side">
      <strong class="pb-team-head">{{ t(side === 'friendly' ? 'recon.map.playback.team_friendly' : 'recon.map.playback.team_enemy') }}</strong>
      <ul class="pb-roster-list">
        <li v-for="v in teams[side]" :key="v.accountId">
          <button
            type="button"
            class="pb-roster-row"
            :class="{ 'is-destroyed': destroyed.has(v.accountId) }"
            data-test="pb-roster-row"
            @click="emit('select', v.accountId)"
          >
            <span class="pb-team-player">{{ v.playerName }}</span>
            <span class="pb-team-tank">{{ v.tankName || v.tankId }}</span>
          </button>
        </li>
      </ul>
    </section>
    <p class="pb-roster-hint">{{ t('workspace.playback_roster_hint') }}</p>
  </div>
</template>
