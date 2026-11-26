<script setup lang="ts">
import { TooltipContent, TooltipPortal, TooltipProvider, TooltipRoot, TooltipTrigger } from 'reka-ui'

withDefaults(defineProps<{
  label: string
  side?: 'top' | 'right' | 'bottom' | 'left'
}>(), { side: 'bottom' })
</script>

<template>
  <TooltipProvider :delay-duration="400" :skip-delay-duration="300">
    <TooltipRoot>
      <TooltipTrigger as-child><slot /></TooltipTrigger>
      <TooltipPortal>
        <TooltipContent class="app-tooltip" :side="side" :side-offset="6">{{ label }}</TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>

<style scoped>
:deep(.app-tooltip) {
  z-index: var(--z-tooltip);
  max-width: 320px;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--color-surface-3);
  box-shadow: var(--elevation-2);
  color: var(--color-text-primary);
  font: var(--type-caption);
  pointer-events: none;
}

:deep(.app-tooltip[data-state="delayed-open"]),
:deep(.app-tooltip[data-state="instant-open"]) { animation: wotb-tooltip-in var(--duration-fast) var(--ease-standard); }
</style>

<style>
@keyframes wotb-tooltip-in { from { opacity: 0; } }
</style>

