<script setup lang="ts">
import { ChevronDown } from 'lucide-vue-next'

defineProps({
    roleLabel: { type: String, required: true },
    selectId: { type: String, required: true },
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
