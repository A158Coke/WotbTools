<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check } from 'lucide-vue-next'
import AppButton from './AppButton.vue'
import SegmentedControl from './SegmentedControl.vue'
import TankMechanicSummary from './TankMechanicSummary.vue'
import { formatUpgradeValue } from '../utils/formatUpgradeValue'
import { fullResearchXp, boundAbility, resolveUpgradeSelection, mechanicParameterGroups } from '../replay-local/compute/tankUpgrades'
import { parseAugmentProgression, researchGroupChoice } from '../replay-local/compute/tankAugmentTree'
import type { SetupSelection } from '../replay-local/compute/tankSetupTypes'
import type { UpgradeGroup, UpgradeSelection } from '../replay-local/compute/tankUpgradeTypes'

interface MechanicMessage { stem?: string; item?: { script?: { params?: { maxBoostToMaxAlpha?: unknown } } }; name: string; description: string }
interface AbilityEffect { name: string; label: string; amount: string }
interface AbilityOption { label: string; description: string; effects: AbilityEffect[] }
interface AbilityGroup extends UpgradeGroup { number: number; label: string; options: AbilityOption[] }
const asAbilityOption = (option: unknown) => option as AbilityOption

const props = defineProps<{
  detail: { tier?: number | string }; modules: { vehicleAbilities?: string[]; tankId?: number | string }
  selection: SetupSelection; catalog: object; upgrades: UpgradeSelection; embedded?: boolean; showUpgradeDetails?: boolean
  itemName: (item: unknown) => string
}>()
const emit = defineEmits(['update', 'reset'])
const { t, te, locale } = useI18n()
const lang = computed(() => (locale.value === 'zh' ? 'zh-Hans' : 'en'))
const upgrades = computed(() => props.upgrades)
const fullXp = computed(() => fullResearchXp(upgrades.value))
const fullXpText = computed(() => fullXp.value == null
  ? t('agentTanks.configurator.xp_incomplete')
  : t('agentTanks.configurator.xp_value', { value: fullXp.value.toLocaleString(locale.value) }))
const upgradeOptions = computed(() => [
  { value: 'stock', label: t('agentTanks.configurator.upgrade_stock'), testid: 'tank-upgrade-stock' },
  { value: 'top', label: t('agentTanks.configurator.upgrade_top'), testid: 'tank-upgrade-top', disabled: !upgrades.value.supported },
])
const parameterGroups = computed(() => mechanicParameterGroups(upgrades.value, props.modules, props.catalog))
const mechanicMessages = computed<MechanicMessage[]>(() => {
  const abilities = props.modules?.vehicleAbilities
  const messages: MechanicMessage[] = (Array.isArray(abilities) ? abilities : []).flatMap(stem => {
    const path = `agentTanks.configurator.augment_mechanics.${stem}`
    const item = boundAbility(props.modules, props.catalog, 'consumables', stem) || boundAbility(props.modules, props.catalog, 'provisions', stem)
    return te(`${path}.name`) ? [{ stem, item, name: t(`${path}.name`), description: t(`${path}.description`) }] : []
  })
  for (const group of upgrades.value.groups || []) {
    const description = (group[`description_${lang.value}`] || group.description_en) as string | undefined
    if (description && !messages.some(message => message.description === description)) {
      messages.push({ name: props.itemName(group), description })
    }
  }
  return messages
})
const abilityGroups = computed(() => (upgrades.value.groups || []).map((group, groupIndex) => ({
  ...group,
  number: group.choices.indexOf(upgrades.value.choices[group.id]) + 1,
  label: props.itemName(group) || t('agentTanks.configurator.upgrade_skill_group', { index: groupIndex + 1 }),
  options: group.choices.map((id, index) => {
    const node = upgrades.value.nodes.find(node => node.id === id)
    const effects = (node?.attributes || []).map(({ name, value }) => ({
      name, label: t(`agentTanks.configurator.upgrade_attributes.${name}`),
      amount: formatUpgradeValue(t, name, value, upgrades.value.attributeDefinitions[name]?.modifier || 'MODIFIER_ADD'),
    }))
    const relaxesClip = effects.length === 1 && effects[0].name === 'EXTERNAL_AMMO_MODULE_ALLOW_NON_DAMAGING_HITS'
      && node?.attributes[0]?.value === true
    const copy = effects.length === 1 ? `agentTanks.configurator.branch_copy.${effects[0].name}` : ''
    const hasCopy = copy && te(`${copy}.title`)
      && (effects[0].name !== 'ATTRIBUTE_NAME_GUN_RELOAD_TIME' || props.modules.vehicleAbilities?.includes('externalAmmoModule'))
      && (effects[0].name !== 'EXTERNAL_AMMO_MODULE_ALLOW_NON_DAMAGING_HITS' || relaxesClip)
    if (relaxesClip) effects[0].amount = t('agentTanks.configurator.upgrade_all_hits')
    return {
      value: String(id),
      label: hasCopy ? t(`${copy}.title`) : props.itemName(node) || effects.map(effect => effect.label).join(' · ') || t('agentTanks.configurator.upgrade_skill_option', { index: index + 1 }),
      description: hasCopy ? t(`${copy}.scope`) : (node?.[`description_${lang.value}`] || node?.description_en || '') as string,
      disabled: !upgrades.value.supported,
      effects,
      testid: `tank-ability-${id}`,
    }
  }),
})))
const upgradeStatusKey = computed(() => (upgrades.value.mode === 'top' ? 'upgrade_top'
  : upgrades.value.mode === 'custom' ? 'upgrade_custom' : 'upgrade_inactive'))
const hasMissingValues = computed(() => parameterGroups.value.some(section =>
  section.rows.some(row => row.initial == null || row.value == null)))
const effectiveGroup = computed(() => abilityGroups.value.length === 1 && abilityGroups.value[0].number
  && upgrades.value.mode !== 'stock' ? abilityGroups.value[0] : null)
function choiceStatus(group: AbilityGroup) {
  const cfg = 'agentTanks.configurator'
  if (!upgrades.value.supported) return t(`${cfg}.choice_unavailable`)
  if (!group.number) return t(`${cfg}.choice_unresearched`)
  const key = upgrades.value.mode === 'stock' ? 'choice_preview' : 'choice_applied'
  return t(`${cfg}.${key}`, { n: String(group.number).padStart(2, '0') })
}
function selectAbility(group: AbilityGroup, value: string) {
  if (props.selection.upgrade === 'custom') {
    const progression = parseAugmentProgression(props.modules)
    const installed = new Set(props.selection.abilities || [])
    const next = progression
      ? researchGroupChoice(progression, group.id, Number(value), installed)
      : installed
    emit('update', { abilities: [...next] })
    return
  }
  const choices = { ...upgrades.value.choices, [group.id]: Number(value) }
  const next = resolveUpgradeSelection(props.modules, props.selection.upgrade, choices)
  emit('update', { abilities: next.abilities })
}

</script>

<template>
    <section v-if="upgrades.available" class="tp-config-block tp-upgrades" data-testid="tank-upgrades">
      <h3 v-if="!embedded">{{ t('agentTanks.configurator.upgrade_title') }}</h3>
      <div class="tp-upgrade-row">
        <SegmentedControl class="tp-upgrade-mode" :model-value="upgrades.mode" :options="upgradeOptions"
          :ariaLabel="t('agentTanks.configurator.upgrade_title')" @update:model-value="emit('update', { upgrade: $event })" />
        <span v-if="showUpgradeDetails" class="tp-upgrade-xp" data-testid="tank-full-xp">{{ t('agentTanks.configurator.full_xp') }} <strong>{{ fullXpText }}</strong></span>
        <AppButton v-if="embedded" variant="ghost" size="sm" data-testid="tank-config-reset" @click="emit('reset')">
          {{ t('agentTanks.configurator.reset') }}
        </AppButton>
      </div>
      <p v-if="!embedded" class="tp-muted">{{ t('agentTanks.configurator.upgrade_hint') }}</p>
      <p v-if="!upgrades.supported" class="tp-muted" role="status">{{ t('agentTanks.configurator.upgrade_unsupported') }}</p>
      <template v-if="showUpgradeDetails">
        <TankMechanicSummary v-for="message in mechanicMessages" :key="`${modules.tankId}-${message.name}`"
          :message="message" :sections="parameterGroups" />
        <div v-for="group in abilityGroups" :key="group.id" class="tp-config-block" data-testid="tank-upgrade-skills">
          <header class="tp-block-head">
            <h3>{{ abilityGroups.length === 1 ? t('agentTanks.configurator.mechanic_choices') : group.label }}</h3>
            <span class="tp-ability-status" aria-live="polite">{{ choiceStatus(group) }}</span>
          </header>
          <SegmentedControl class="tp-ability-options" presentation="tiles" :ariaLabel="group.label"
            :options="group.options" :model-value="String(upgrades.choices[group.id])"
            @update:model-value="selectAbility(group, $event)">
            <template #option="{ option, index, selected }">
            <span class="tp-ability-content">
              <span class="tp-ability-top"><span class="tp-ability-number">{{ String(index + 1).padStart(2, '0') }}</span>
                <Check v-if="selected" :size="16" aria-hidden="true" />
              </span>
              <span class="tp-ability-name">{{ asAbilityOption(option).label }}</span>
              <strong class="tp-ability-value">{{ asAbilityOption(option).effects.map(effect => effect.amount).join(' / ') }}</strong>
              <span v-if="asAbilityOption(option).description" class="tp-muted">{{ asAbilityOption(option).description }}</span>
            </span>
            </template>
          </SegmentedControl>
        </div>
        <section v-if="parameterGroups.length" class="tp-mechanic-effects" aria-live="polite" data-testid="tank-mechanic-effects">
          <header class="tp-block-head"><h3>{{ t('agentTanks.configurator.upgrade_effects') }}</h3>
            <span class="tp-ability-status">{{ t(`agentTanks.configurator.${upgradeStatusKey}`) }}<template v-if="effectiveGroup"> · {{ t('agentTanks.configurator.choice_number', { n: String(effectiveGroup.number).padStart(2, '0') }) }}</template></span>
          </header>
          <component :is="section.label ? 'details' : 'div'" v-for="(section, index) in parameterGroups"
            :key="`${modules.tankId}-${index}`" :open="section.label ? true : undefined">
            <summary v-if="section.label">{{ t(`agentTanks.configurator.${section.label}`) }} {{ section.index }}</summary>
            <table>
              <thead><tr><th scope="col">{{ t('agentTanks.configurator.upgrade_effect_attribute') }}</th>
                <th scope="col">{{ t('agentTanks.configurator.upgrade_stock') }}</th>
                <th scope="col">{{ t('agentTanks.configurator.upgrade_effect_current') }}</th></tr></thead>
              <tbody><tr v-for="effect in section.rows" :key="effect.name" :data-testid="`tank-mechanic-${effect.name}`">
                <th scope="row">{{ t(`agentTanks.configurator.upgrade_attributes.${effect.name}`) }}</th>
                <td>{{ formatUpgradeValue(t, effect.name, effect.initial) }}</td>
                <td :class="{ 'tp-effect-current': effect.value !== effect.initial }"><strong>{{ formatUpgradeValue(t, effect.name, effect.value) }}</strong>
                  <span v-if="effect.current != null" class="tp-effect-delta">{{ t('agentTanks.configurator.upgrade_effect_change', { value: formatUpgradeValue(t, effect.name, effect.current, effect.modifier) }) }}</span>
                </td>
              </tr></tbody>
            </table>
          </component>
          <p class="tp-muted">{{ t('agentTanks.configurator.upgrade_effect_delta_note') }}</p>
          <p v-if="hasMissingValues" class="tp-muted">{{ t('agentTanks.configurator.missing_mechanic_values') }}</p>
        </section>
      </template>
    </section>

    <p v-if="showUpgradeDetails && Number(detail.tier) === 11 && !upgrades.available" class="tp-upgrade-xp" data-testid="tank-full-xp">
      {{ t('agentTanks.configurator.full_xp') }} <strong>{{ fullXpText }}</strong>
    </p>

</template>

<style scoped>
.tp-config-block { display: grid; gap: var(--space-2); min-inline-size: 0; }
.tp-block-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: var(--space-1) var(--space-2); }
.tp-config-block > h3, .tp-block-head h3 { margin: 0; font: var(--type-body); font-weight: 600; }
.tp-muted { margin: 0; color: var(--color-text-secondary); font: var(--type-caption); }
.tp-upgrades { grid-template-columns: minmax(0, 1fr); }
.tp-upgrade-row { display: flex; align-items: center; gap: var(--space-2) var(--space-3); flex-wrap: wrap; }
.tp-upgrade-xp { margin: 0; color: var(--color-text-secondary); font: var(--type-caption); overflow-wrap: anywhere; }
.tp-upgrade-xp strong { color: var(--color-accent-text); font-variant-numeric: tabular-nums; }
.tp-upgrade-mode { flex: 0 0 auto; max-inline-size: 100%; }
.tp-upgrade-mode :deep(.segmented-option) { flex: 0 1 auto; white-space: normal; }
.tp-ability-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-2); }
.tp-ability-options :deep(.segmented-option) {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-2);
  min-inline-size: 0;
  min-block-size: var(--control-h-lg);
  padding: var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
  color: var(--color-text-primary);
  text-align: start;
  cursor: pointer;
}
.tp-ability-options :deep(.segmented-option:hover) { border-color: var(--color-border-strong); }
.tp-ability-options :deep(.segmented-option.is-active) { border-color: var(--color-accent); }
.tp-ability-content { display: flex; flex-direction: column; gap: var(--space-2); block-size: 100%; }
.tp-ability-options :deep(.segmented-label) { flex: 1; }
.tp-ability-top { display: flex; align-items: center; justify-content: space-between; color: var(--color-accent-text); }
.tp-ability-number { font: var(--type-caption); font-variant-numeric: tabular-nums; }
.tp-ability-name { flex: 1; font: var(--type-caption); font-weight: 600; overflow-wrap: anywhere; }
.tp-ability-value { font: var(--type-h3); font-variant-numeric: tabular-nums; color: var(--color-accent-text); }
.tp-mechanic-effects { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-2); min-inline-size: 0; padding-block-start: var(--space-2); }
.tp-ability-status { color: var(--color-text-secondary); font: var(--type-caption); }
.tp-mechanic-effects summary { cursor: pointer; align-content: center; min-block-size: var(--hit-min-comfortable); font-weight: 600; }
.tp-mechanic-effects table { inline-size: 100%; border-collapse: collapse; font: var(--type-caption); }
.tp-mechanic-effects th, .tp-mechanic-effects td { white-space: normal; overflow-wrap: anywhere; padding: var(--space-2) var(--space-1); border-block-end: 1px solid var(--color-border-subtle); text-align: end; font-variant-numeric: tabular-nums; }
.tp-mechanic-effects th:first-child { text-align: start; font-weight: 400; overflow-wrap: anywhere; }
.tp-mechanic-effects thead { color: var(--color-text-secondary); }
.tp-effect-current { color: var(--color-accent-text); font-weight: 600; }
.tp-effect-delta { display: block; color: var(--color-text-secondary); font: var(--type-caption); }

@media (width >= 768px) {
  .tp-ability-options { grid-template-rows: repeat(4, auto); }
  .tp-ability-options :deep(.segmented-option),
  .tp-ability-options :deep(.segmented-label),
  .tp-ability-content { display: grid; grid-row: span 4; grid-template-rows: subgrid; align-items: start; }
  .tp-ability-content { block-size: auto; }
}

@media (width < 768px) {
  .tp-upgrade-row .tp-upgrade-xp { order: 1; flex-basis: 100%; }
  .tp-ability-options.is-tiles { grid-template-columns: minmax(0, 1fr); grid-auto-flow: row; }
  .tp-ability-content { flex-direction: row; align-items: center; flex-wrap: wrap; }
  .tp-ability-content > .tp-muted { flex-basis: 100%; }
  .tp-ability-value { font: var(--type-body); font-weight: 600; }
}
</style>
