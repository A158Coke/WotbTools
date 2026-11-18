<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Zap } from 'lucide-vue-next'
import AppButton from './AppButton.vue'
import { skillIconUrl } from '../utils/researchCatalog'
import { isConditionalCrewSkill } from '../replay-local/compute/crewStats'
import type { CrewSettings } from '../composables/tankMobility'
type CrewSkill = { effects?: Record<string, number>; [key: string]: unknown }
const props = defineProps<{ catalog: { skills: Record<string, CrewSkill>; crewSkillClasses?: Record<string, string[]> }; selection: Partial<CrewSettings>; crewCount?: number; showTitle?: boolean }>()
const emit = defineEmits(['update', 'cycle-skill', 'max-skills', 'clear-skills'])
const { t, locale } = useI18n()
const lang = computed(() => locale.value === 'zh' ? 'zh-Hans' : 'en')
const SKILL_CLASS_ORDER = [
  { key: 'lightTank', labelKey: 'light' },
  { key: 'mediumTank', labelKey: 'medium' },
  { key: 'heavyTank', labelKey: 'heavy' },
  { key: 'AT-SPG', labelKey: 'tank_destroyer' },
]

function skillText(item: CrewSkill | null, field: string): string {
  const value = item?.[field + '_' + lang.value] || item?.[field + '_en']
  return typeof value === 'string' ? value : ''
}

/**
 * 客户端 effect 模板的占位符替换：模板在占位符后带 `%` 时，effects 值是**比例**
 * （0.15 → 15%，1.0 → 100%）；`*PerLevel` 再乘当前等级。其余计数/半径等原样；
 * 未提供的参数不显示（不猜）。数值全部来自 avatar.xml。
 */
function skillEffectText(item: CrewSkill | null, level: number) {
  const effects = item?.effects || {}
  return skillText(item, 'effect')
    .replace(/%\(highlight_start\)|%\(highlight_end\)/g, '')
    .replace(/%\(([^)]+)\)(%)?/g, (_match, key, percent) => {
      if (key === 'level') return `7${percent || ''}`
      const value = Number(effects[key])
      if (!Number.isFinite(value)) return ''
      const isPercent = percent === '%'
      const scaled = value *
        (isPercent ? 100 : 1) *
        (key.endsWith('PerLevel') ? level : 1)
      const rendered = isPercent
        ? Math.round(scaled * 10) / 10
        : (Number.isInteger(scaled) ? scaled : Math.round(scaled * 1000) / 1000)
      return `${rendered}${percent || ''}`
    })
    .trim() || skillText(item, 'tip')
}

/** 全部 20 个车型技能（训练资格按车型，效果全局；这里按类分组展示）。 */
const skillGroups = computed(() => SKILL_CLASS_ORDER.map(({ key, labelKey }) => {
  const ids: string[] = props.catalog?.crewSkillClasses?.[key] || []
  return {
    key,
    label: t(`agentTanks.configurator.skill_classes.${labelKey}`),
    skills: ids.map(id => {
      const item = props.catalog?.skills?.[id] || null
      const level = Number(props.selection.skills?.[id]) || 0
      const effect = skillEffectText(item, level || 1)
      return {
        id,
        level,
        name: skillText(item, 'name') || id,
        effect,
        title: level
          ? `${skillText(item, 'name') || id} — ${effect}`
          : `${skillText(item, 'name') || id} — ${t('agentTanks.configurator.skill_untrained')} · ${effect}`,
        icon: skillIconUrl(id),
        active: level > 0,
        conditional: isConditionalCrewSkill(id),
      }
    }),
  }
}))

</script>
<template>
    <section class="tp-config-block tp-skills-block">
      <div class="tp-block-head tp-skill-head">
        <div class="tp-skill-heading">
          <h3 v-if="showTitle !== false" class="tp-section-title">{{ t('agentTanks.configurator.crew_skills') }}</h3>
          <span class="tp-muted"><template v-if="crewCount !== undefined">{{ t('agentTanks.configurator.crew_count') }} {{ crewCount }} · </template>{{ Object.values(selection.skills || {}).filter(level => level > 0).length }}/20</span>
        </div>
        <div class="tp-skill-actions">
          <AppButton variant="ghost" size="sm" data-testid="tank-skills-max" @click="emit('max-skills')">
            {{ t('agentTanks.configurator.skill_max') }}
          </AppButton>
          <AppButton variant="ghost" size="sm" data-testid="tank-skills-clear" @click="emit('clear-skills')">
            {{ t('agentTanks.configurator.skill_clear') }}
          </AppButton>
        </div>
      </div>
      <label class="tp-skill-trigger-control" data-testid="tank-skill-trigger-control">
        <input type="checkbox" data-testid="tank-skill-triggers" :checked="selection.conditionalSkills === true"
          @change="emit('update', { conditionalSkills: ($event.target as HTMLInputElement).checked })">
        <span><strong>{{ t('agentTanks.configurator.skill_triggers') }}</strong>
          <span class="tp-muted">{{ t('agentTanks.configurator.skill_triggers_hint') }}</span></span>
      </label>
      <div class="tp-skill-groups">
        <div v-for="group in skillGroups" :key="group.key" class="tp-skill-group" role="group" :aria-label="group.label">
          <h4 class="tp-skill-class">{{ group.label }}</h4>
          <div v-for="conditional in [false, true].filter(value => group.skills.some(skill => skill.conditional === value))"
            :key="String(conditional)" class="tp-skill-section">
            <span class="tp-skill-category">
              {{ t(`agentTanks.configurator.${conditional ? 'skill_conditional' : 'skill_permanent'}`) }}
            </span>
            <div class="tp-skill-row">
            <button
              v-for="skill in group.skills.filter(skill => skill.conditional === conditional)"
              :key="skill.id"
              type="button"
              class="tp-skill-btn"
              :class="{ 'is-on': skill.active, 'is-pending': skill.active && skill.conditional && !selection.conditionalSkills }"
              :aria-pressed="skill.active"
              :aria-label="skill.title"
              :title="skill.title"
              :data-testid="`tank-skill-${skill.id}`"
              @click="emit('cycle-skill', skill.id, $event.shiftKey)"
            >
              <img v-if="skill.icon" :src="skill.icon" alt="" width="32" height="32" loading="lazy">
              <span v-else class="tp-skill-fallback">{{ skill.name.slice(0, 2) }}</span>
              <span v-if="skill.active" class="tp-skill-level">{{ skill.level }}</span>
              <Zap v-if="skill.conditional" class="tp-skill-condition-icon" :size="12" aria-hidden="true" />
            </button>
            </div>
          </div>
        </div>
      </div>
      <div class="tp-skill-notes">
        <p class="tp-muted">{{ t('agentTanks.configurator.skill_level_hint') }}</p>
        <p class="tp-muted">{{ t('agentTanks.configurator.skill_note') }}</p>
      </div>
    </section>

</template>
<style scoped>
.tp-skill-trigger-control { display: flex; gap: var(--space-2); align-items: center; min-block-size: var(--hit-min-comfortable); padding-block: var(--space-2); cursor: pointer; }
.tp-skill-trigger-control > span { display: grid; gap: var(--space-1); min-inline-size: 0; font: var(--type-caption); }
.tp-skill-trigger-control input { flex: 0 0 var(--control-check); inline-size: var(--control-check); block-size: var(--control-check); margin: 0; accent-color: var(--color-accent); }
.tp-skill-section { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-1) var(--space-2); min-inline-size: 0; }
.tp-skill-category { flex: 0 1 auto; color: var(--color-text-secondary); font: var(--type-caption); overflow-wrap: anywhere; }
.tp-skill-condition-icon { position: absolute; inset-inline-start: 0; inset-block-start: 0; color: var(--color-accent-text); background: var(--color-surface-1); border-radius: var(--radius-sm); }
.tp-skill-head { align-items: center; }
.tp-skill-heading { display: grid; gap: var(--space-1); }
.tp-skill-actions { display: flex; gap: var(--space-1); }
.tp-skill-groups { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--tank-skill-group-min)), 1fr)); gap: var(--space-4); }
.tp-skill-group { display: grid; align-content: start; gap: var(--space-2); min-inline-size: 0; }
.tp-skill-class { margin: 0; color: var(--color-text-primary); font: var(--type-caption); font-weight: 600; }
.tp-skill-row { display: flex; flex: 1 1 auto; flex-wrap: wrap; gap: var(--space-1); min-inline-size: 0; }
.tp-skill-notes { display: grid; gap: var(--space-1); padding-block-start: var(--space-2); }
.tp-skill-btn {
  position: relative;
  display: grid;
  place-items: center;
  flex: 0 0 var(--control-h-lg);
  inline-size: var(--control-h-lg);
  block-size: var(--control-h-lg);
  padding: var(--space-1);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
  cursor: pointer;
}
.tp-skill-btn:hover { border-color: var(--color-border-strong); }
.tp-skill-btn.is-on { border-color: var(--color-accent); background: color-mix(in oklab, var(--color-accent) 14%, var(--color-surface-1)); }
.tp-skill-btn.is-pending { border-style: dashed; background: var(--color-surface-2); }
.tp-skill-btn:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.tp-skill-btn img { inline-size: 100%; block-size: 100%; object-fit: contain; }
.tp-skill-fallback { color: var(--color-text-secondary); font: var(--type-caption); font-weight: 600; }
.tp-skill-level {
  position: absolute;
  inset-block-end: 0;
  inset-inline-end: 0;
  padding: 0 var(--space-1);
  border-radius: var(--radius-sm);
  background: var(--color-surface-1);
  color: var(--color-accent-text);
  font: var(--type-caption);
  font-weight: 700;
}
.tp-block-head { display: flex; justify-content: space-between; flex-wrap: wrap; gap: var(--space-2); }
.tp-skills-block { display: grid; gap: var(--space-3); }
.tp-section-title { margin: 0; font: var(--type-body); font-weight: 600; }
.tp-muted { color: var(--color-text-secondary); font: var(--type-caption); margin: 0; }
</style>
