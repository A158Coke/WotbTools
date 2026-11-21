<script setup>
/**
 * 装甲查看器左上角「参数」面板（拆分自 AgentArmorView.vue 模板，行为原样）。
 * 场景静态 DOM 契约（info-panel / config-row / shooter-select / target-select /
 * tank-selection-status 等静态 id）原样保留；装配改动经事件回宿主写 URL 并驱动场景。
 */
import { useRoute } from 'vue-router'
import { SlidersHorizontal, X } from 'lucide-vue-next'
import ArmorSideConfig from '../ArmorSideConfig.vue'
import ArmorSideCard from './ArmorSideCard.vue'

defineProps({
    cleanQuery: { type: Boolean, default: false },
    isShotPage: { type: Boolean, default: false },
    toolsOpen: { type: Boolean, default: false },
    hudReady: { type: Boolean, default: false },
    pitchDeviceAvailable: { type: Boolean, default: false },
    isXiTank: { type: Function, required: true },
    shooterSetupId: { type: [Number, String], default: null },
    targetSetupId: { type: [Number, String], default: null },
    shooterConfigValue: { type: [String, Number], default: null },
    loadoutActive: { type: Boolean, default: false },
    shooterOpen: { type: Boolean, default: false },
    targetOpen: { type: Boolean, default: false },
    armorUpgrade: { type: Function, required: true },
})
const emit = defineEmits(['update:toolsOpen', 'update:shooterOpen', 'update:targetOpen', 'open-picker', 'apply-side', 'shooter-ready', 'target-ready'])
const route = useRoute()
</script>

<template>
<div id="corner-tl">
    <div id="info-panel" style="display:none;">
        <h1 id="tank-name">{{ $t('armor.loading') }}</h1>
        <div class="stat"><span class="label">{{ $t('armor.tier') }}</span><span class="value" id="tank-tier"></span></div>
        <div class="stat"><span class="label">{{ $t('armor.type') }}</span><span class="value" id="tank-type"></span></div>
        <div class="stat"><span class="label">{{ $t('armor.nation') }}</span><span class="value" id="tank-nation"></span></div>
    </div>
    <!-- 「参数」开关：展开 / 收起装备、射击方、目标、配置；桌面与手机均默认收起 -->
    <button
        v-if="!cleanQuery"
        type="button"
        class="armor-tools"
        data-testid="armor-tools"
        aria-controls="tank-selectors"
        :aria-expanded="toolsOpen ? 'true' : 'false'"
        :aria-label="$t('armor.tools')"
        :title="$t('armor.tools')"
        @click="emit('update:toolsOpen', !toolsOpen)"
    ><SlidersHorizontal :size="18" aria-hidden="true" /><span class="armor-tools-label">{{ $t('armor.tools') }}</span></button>
    <div id="tank-selectors" :class="{ 'has-shot-hud': hudReady }">
        <div class="armor-setup-head">
            <h2 class="armor-panel-title">{{ $t('armor.setup') }}</h2>
            <button
                type="button"
                class="armor-tools-close"
                data-testid="armor-tools-close"
                :aria-label="$t('armor.tools_close')"
                :title="$t('armor.tools_close')"
                @click="emit('update:toolsOpen', false)"
            ><X :size="18" aria-hidden="true" /></button>
        </div>
        <p v-if="isShotPage" class="armor-setup-note">{{ $t('armor.recording_vs_preview') }}</p>
        <div class="sel-row" id="config-row" style="display:none;"><label id="config-label" for="config-select">{{ $t('armor.config') }}</label><select id="config-select"></select></div>
        <div class="sel-row">
            <label class="armor-equipment-caption">{{ $t('armor.equip') }}</label>
            <label class="eq-opt"><input type="checkbox" id="eq-calibrated"> <span class="eq-opt-label">{{ $t('armor.calibrated') }}</span></label>
            <label class="eq-opt"><input type="checkbox" id="eq-enhanced"> <span class="eq-opt-label">{{ $t('armor.enhanced') }}</span></label>
            <label v-show="pitchDeviceAvailable" class="eq-opt" id="pitch-device-opt"><input type="checkbox" id="eq-pitch-device"> <span class="eq-opt-label">{{ $t('armor.pitch_device') }}</span></label>
            <label class="eq-opt" id="armor-state-opt" style="display:none;"><input type="checkbox" id="armor-state-toggle"> <span class="eq-opt-label">{{ $t('armor.dynamic_armor') }}</span></label>
        </div>
        <!-- 射击方 / 受击方：坦克切换 + 模块选择同一张卡，模块默认收起。 -->
        <div class="armor-side-cards" data-testid="armor-side-configs">
            <ArmorSideCard
                :role-label="$t('armor.loadout_shooter')"
                select-id="shooter-select"
                modules-id="shooter-modules"
                :show-toggle="!isXiTank(shooterSetupId)"
                :expanded="shooterOpen"
                @open-picker="emit('open-picker', 'shooter')"
                @toggle="emit('update:shooterOpen', !shooterOpen)"
            >
                <ArmorSideConfig
                    v-if="loadoutActive"
                    :key="`shooter-${shooterSetupId ?? 'none'}`"
                    :tank-id="shooterSetupId"
                    :expanded="shooterOpen"
                    :config="shooterConfigValue"
                    :engine="route.query.sengine"
                    :track="route.query.strack"
                    :dev="route.query.sdev"
                    :upgrade="armorUpgrade(route.query.supgrade)"
                    :abilities="route.query.sabilities"
                    @apply="patch => emit('apply-side', 'shooter', patch)"
                    @ready="value => emit('shooter-ready', value)"
                />
            </ArmorSideCard>
            <ArmorSideCard
                :role-label="$t('armor.loadout_target')"
                select-id="target-select"
                modules-id="target-modules"
                :show-toggle="!isXiTank(targetSetupId)"
                :expanded="targetOpen"
                @open-picker="emit('open-picker', 'target')"
                @toggle="emit('update:targetOpen', !targetOpen)"
            >
                <ArmorSideConfig
                    v-if="loadoutActive"
                    :key="`target-${targetSetupId ?? 'none'}`"
                    :tank-id="targetSetupId"
                    :expanded="targetOpen"
                    :config="route.query.config"
                    :engine="route.query.engine"
                    :track="route.query.track"
                    :dev="route.query.dev"
                    :upgrade="armorUpgrade(route.query.upgrade)"
                    :abilities="route.query.abilities"
                    @apply="patch => emit('apply-side', 'target', patch)"
                    @ready="value => emit('target-ready', value)"
                />
            </ArmorSideCard>
            <p id="tank-selection-status" role="status">{{ $t('armor.picker_loading') }}</p>
        </div>
    </div>
</div>
</template>
