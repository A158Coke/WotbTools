<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowRight } from 'lucide-vue-next'
import { formatUpgradeValue } from '../utils/formatUpgradeValue'

const props = defineProps({
  message: { type: Object, required: true },
  sections: { type: Array, required: true },
})
const { t } = useI18n()
const copy = (key, params) => t(`agentTanks.configurator.summary_copy.${key}`, params)
const stem = computed(() => props.message.stem)
const clip = computed(() => stem.value === 'externalAmmoModule')
const rocket = computed(() => stem.value === 'unguidedRocket')
const secondary = computed(() => rocket.value || stem.value === 'auxilliaryWeapons')
const rows = computed(() => props.sections.flatMap(section => section.rows))
function row(name) {
  // A summary has no selected projectile. Leave ambiguous multi-shot values in their individual tables.
  const matches = rows.value.filter(entry => entry.name === name)
  return matches.length === 1 ? matches[0] : undefined
}
const trigger = computed(() => row('EXTERNAL_AMMO_MODULE_ALLOW_NON_DAMAGING_HITS'))
const currentCondition = computed(() => {
  if (typeof trigger.value?.value !== 'boolean') return copy('unknown')
  return copy(trigger.value.value ? 'all_hit' : 'all_damage')
})
const stockClip = computed(() => row('CLIP_CAPACITY')?.initial)
const enhancedClip = computed(() => row('ENHANCED_CLIP_CAPACITY')?.initial)
const stockCount = computed(() => row('AUX_COUNT')?.initial)
const facts = computed(() => {
  if (!secondary.value) return []
  const fields = rocket.value
    ? ['UNGUIDED_ROCKET_DAMAGE', 'AUX_PENETRATION', 'AUX_RANGE']
    : ['AUX_SHELL_TYPE', 'AUX_PENETRATION', 'AUXILLIARY_WEAPONS_GUN_DAMAGE']
  return fields.flatMap(name => {
    const value = row(name)?.initial
    return value == null ? [] : [{ label: t(`agentTanks.configurator.upgrade_attributes.${name}`), value: formatUpgradeValue(t, name, value) }]
  })
})
const shell = computed(() => formatUpgradeValue(t, 'AUX_SHELL_TYPE', row('AUX_SHELL_TYPE')?.initial ?? null))
const unchangedCeiling = computed(() => {
  const boost = props.message.item?.script?.params?.maxBoostToMaxAlpha
  return boost === 0 || (typeof boost === 'string' && boost.trim() !== '' && Number(boost) === 0)
})
const title = computed(() => clip.value ? copy('clip_title') : stem.value === 'auxilliaryWeapons' ? copy('gun_title') : props.message.name)
</script>

<template>
  <section class="tp-base-mechanic" data-testid="tank-base-mechanic">
    <header>
      <h3>{{ t('agentTanks.configurator.mechanic_summary', { name: title }) }}</h3>
      <span v-if="message.item" class="origin">{{ copy('built_in') }}</span>
    </header>
    <template v-if="clip">
      <div v-if="stockClip != null && enhancedClip != null" class="cycle">
        <div><strong>{{ copy('rounds', { n: stockClip }) }}</strong><span>{{ copy('normal_clip') }}</span></div>
        <ArrowRight aria-hidden="true" :size="20" />
        <div><strong>{{ copy('rounds', { n: enhancedClip }) }}</strong><span>{{ copy('next_clip') }}</span></div>
      </div>
      <p>{{ typeof trigger?.initial === 'boolean' ? copy(trigger.initial ? 'default_hits' : 'default_damage') : copy('clip_rule') }}</p>
      <p class="condition" data-testid="tank-current-trigger" aria-live="polite">
        <span>{{ copy('trigger') }}</span><strong>{{ currentCondition }}</strong>
      </p>
      <details v-if="stockClip != null && enhancedClip != null">
        <summary>{{ copy('rules') }}</summary>
        <p>{{ copy('reset_clip') }}</p>
      </details>
    </template>
    <template v-else-if="secondary">
      <strong class="headline" v-if="stockCount != null">
        {{ copy(rocket ? 'rockets' : 'salvo', { n: stockCount }) }}<template v-if="rocket && shell !== '—'"> · {{ shell }}</template>
      </strong>
      <p>{{ copy(rocket ? 'rocket_cycle' : 'gun_cycle') }}</p>
      <div v-if="facts.length" class="weapon">
        <span class="caption">{{ copy('weapon_base') }}</span>
        <dl><div v-for="fact in facts" :key="fact.label"><dt>{{ fact.label }}</dt><dd>{{ fact.value }}</dd></div></dl>
      </div>
    </template>
    <template v-else-if="stem === 'shellOverheat'">
      <strong class="headline">{{ copy('damage_floor') }}</strong>
      <p>{{ copy('charge_rule') }}</p>
      <p v-if="unchangedCeiling" class="caption">{{ copy('ceiling') }}</p>
    </template>
    <p v-else>{{ message.description }}</p>
  </section>
</template>

<style scoped>
.tp-base-mechanic {
  display: grid;
  gap: var(--space-2);
  min-inline-size: 0;
  padding: var(--space-3);
  margin-block: var(--space-1);
  border: 1px solid var(--color-border-strong);
  border-inline-start: 3px solid var(--color-accent);
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
  overflow-wrap: anywhere;
}
header, .condition, .cycle { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
h3, p, dl, dd { margin: 0; }
h3 { font: var(--type-body); font-weight: 600; }
.origin, .caption, dt, .cycle span, summary, .condition > span { color: var(--color-text-secondary); font: var(--type-caption); }
.origin { border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); padding-inline: var(--space-1); }
.headline, .cycle strong { color: var(--color-accent-text); font: var(--type-h3); font-weight: 700; }
.cycle { gap: var(--space-3); }
.cycle > div { display: grid; }
.condition, .weapon { border-block-start: 1px solid var(--color-border-subtle); padding-block-start: var(--space-2); }
.condition strong { color: var(--color-accent-text); }
dl { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-2); margin-block-start: var(--space-1); }
dd { font-weight: 650; color: var(--color-accent-text); font-variant-numeric: tabular-nums; }
summary { cursor: pointer; min-block-size: var(--hit-min-comfortable); align-content: center; }
</style>
