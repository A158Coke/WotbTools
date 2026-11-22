/**
 * Agent 装甲查看器 —— tankViewer 场景文案注入表（拆分自 AgentArmorView.vue，行为原样）。
 * 职责：审计 3D-16 —— 场景脚本写入的文案与枚举值按当前语言提供；本表只做翻译映射，
 * 不持有状态。
 */
import { armorPartLabel, armorResultLabel, tankNationLabel, tankTypeLabel } from '../../scene/tankMeta.js'
import type { useI18n } from 'vue-i18n'

type Translate = ReturnType<typeof useI18n>['t']
type LabelContext = { t: Translate; te: (key: string) => boolean }
const PHASE_KEY: Record<string, string> = { 'armor model': 'armor_model', 'tank model': 'tank_model', 'tank data': 'tank_data', 'tank list': 'tank_list', 'shell data': 'shell_data' }

/** @param {{ t: (key: string, params?: unknown) => string, te: (key: string) => boolean }} i18n */
export function armorViewerLabels({ t, te }: LabelContext) {
    return {
        loading: t('armor.loading'),
        shellUnavailable: t('armor.shell_unavailable'),
        loadFailed: (phase: string, msg: string) => t('armor.load_failed', { phase, msg }),
        contextLost: t('armor.context_lost'),
        type: (value: string) => tankTypeLabel(t, te, value),
        nation: (value: string) => tankNationLabel(t, te, value),
        showCollision: t('armor.show_collision'),
        hideCollision: t('armor.hide_collision'),
        heatmap: t('armor.heatmap'),
        hideHeatmap: t('armor.hide_heatmap'),
        technicalEvidence: t('armor.technical_evidence'),
        shotView: t('armor.shot_view'),
        relativeView: t('armor.relative_view'),
        worldView: t('armor.world_view'),
        pitchDevice: t('armor.pitch_device'),
        replayEquipmentAutoTitle: t('armor.equipment_auto'),
        partName: (name: string | null | undefined) => armorPartLabel(name, t),
        resultName: (result: string | null | undefined) => armorResultLabel(result, t),
        shotDamage: t('armor.shot_damage'),
        shotPenChance: t('armor.penetration_chance'),
        shotPenDamage: t('armor.penetration_damage'),
        shotSplashDamage: t('armor.splash_damage'),
        shotMinDamage: t('armor.min_damage'),
        shotMaxDamage: t('armor.max_damage'),
        shotAvgDamage: t('armor.avg_damage'),
        shotAvgShort: t('armor.avg_short'),
        heRadius: t('armor.splash_radius'),
        heBestSample: t('armor.best_sample'),
        directHit: t('armor.direct_hit'),
        expectedDamage: t('armor.expected_damage'),
        heSamplingUnavailable: t('armor.sampling_unavailable'),
        noPrimaryBlocked: t('armor.no_primary_blocked'),
        heBestSampleUpper: t('armor.best_sample_upper'),
        heBestSampleLower: t('armor.best_sample_lower'),
        sectionName: (section: string) => {
            const key = section === 'gunBarrel' ? 'gun_barrel' : section
            return t(`armor.sections.${key}`)
        },
        shotRicochetSeg: t('armor.shot_ricochet_seg'),
        shotLoss: t('armor.shot_loss'),
        shotNominal: t('armor.shot_nominal'),
        shotBlocked: t('armor.shot_blocked'),
        shotDistance: t('armor.distance'),
        effectivePenetration: t('armor.effective_penetration'),
        distanceUnit: t('armor.distance_unit'),
        mayPenetrate: t('armor.may_penetrate'),
        armorStateLabel: t('armor.armor_state'),
        armorStateDefaultSuffix: t('armor.armor_state_default'),
        armorStateAutoTitle: t('armor.armor_state_auto'),
        phase: (phase: string) => (PHASE_KEY[phase] ? t(`armor.phase_${PHASE_KEY[phase]}`) : phase),
    }
}
