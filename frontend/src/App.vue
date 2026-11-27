<script setup lang="ts">
import { computed } from 'vue'
import { RouterView } from 'vue-router'
import { useMediaQuery } from '@vueuse/core'
import { MotionConfig } from 'motion-v'
import { motionTransition } from './shared/motion/motionPolicy'

const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
const transition = computed(() => (reducedMotion.value, motionTransition('base')))
</script>

<template>
  <MotionConfig :transition="transition" reduced-motion="user">
    <RouterView />
  </MotionConfig>
</template>
