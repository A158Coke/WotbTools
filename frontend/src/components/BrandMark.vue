<script setup>
import { useId } from 'vue'

defineProps({
  label: { type: String, default: '' },
})

const maskId = `brand-wrench-${useId()}`
</script>

<template>
  <svg
    class="brand-mark"
    viewBox="230 360 780 365"
    :role="label ? 'img' : undefined"
    :aria-label="label || undefined"
    :aria-hidden="label ? undefined : 'true'"
    focusable="false"
  >
    <mask :id="maskId" maskUnits="userSpaceOnUse" x="230" y="360" width="780" height="375">
      <rect x="230" y="360" width="780" height="375" fill="#fff" />
      <circle cx="530" cy="622" r="46" fill="none" stroke="#000" stroke-width="20" />
      <path d="M535 595.8 L576 554.8 L597.2 576 L556.2 617 Z" fill="#fff" />
      <path d="M497 655 L430 722" stroke="#000" stroke-width="22" />
    </mask>
    <g class="brand-mark-body">
      <path d="M238 462 H305 V467 H548 L572 452 H520 L563 395 H728 L768 437 L652 522 H490 L462 500 H305 V505 H245 Z" />
      <path :mask="`url(#${maskId})`" d="M315 640 L410 545 H683 V600 H648 L600 693 H385 Z" />
      <path d="M668 618 H912 V555 H930 L1000 610 L935 693 H625 Z" />
    </g>
    <g class="brand-mark-accent">
      <path d="M705 612 V525 L748 500 V612 Z" />
      <path d="M781 612 V470 L834 440 V612 Z" />
      <path d="M857 612 V405 L912 372 V612 Z" />
    </g>
  </svg>
</template>

<style scoped>
.brand-mark { display: block; width: auto; aspect-ratio: 780 / 365; }
.brand-mark-body { fill: var(--color-text-primary); }
.brand-mark-accent { fill: var(--color-accent); }
</style>
