<script setup lang="ts">
/**
 * 装甲查看器侧配置卡外壳（拆分自 AgentArmorView.vue 模板，行为原样）：
 * 角色标签 + 场景选择的换车按钮（静态 DOM ID 契约）+ 可选展开/收起开关 + 内容插槽。
 */
import { ChevronDown } from 'lucide-vue-next'

defineProps({
    roleLabel: { type: String, required: true },
    /** 场景脚本按 ID 查找的换车按钮（DOM 契约，不可改） */
    selectId: { type: String, required: true },
    /** aria-controls 引用的模块容器 ID（DOM 契约） */
    modulesId: { type: String, required: true },
    showToggle: { type: Boolean, default: false },
    expanded: { type: Boolean, default: false },
})
defineEmits(['open-picker', 'toggle'])
</script>

<template>
    <section class="armor-side-card">
        <header class="armor-side-head">
            <span class="armor-side-role">{{ roleLabel }}</span>
            <button type="button" class="tank-btn armor-side-tank" :id="selectId" disabled @click="$emit('open-picker')">—</button>
            <button
                type="button"
                class="armor-side-toggle"
                v-if="showToggle"
                :aria-expanded="expanded ? 'true' : 'false'"
                :aria-controls="modulesId"
                :aria-label="roleLabel"
                :data-testid="`armor-side-toggle-${selectId === 'shooter-select' ? 'shooter' : 'target'}`"
                @click="$emit('toggle')"
            ><ChevronDown :size="18" aria-hidden="true" :class="{ 'is-open': expanded }" /></button>
        </header>
        <div :id="modulesId" class="armor-side-body">
            <slot />
        </div>
    </section>
</template>
