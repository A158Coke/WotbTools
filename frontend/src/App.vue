<script setup lang="ts">
import { computed } from 'vue'
import { RouterView } from 'vue-router'
import { useMediaQuery } from '@vueuse/core'
import { MotionConfig } from 'motion-v'
import { TooltipProvider } from 'reka-ui'
import { motionTransition } from './shared/motion/motionPolicy'

// 全应用唯一的 motion / tooltip 配置点：时长与缓动来自 CSS token，reduced-motion 变化时重新读取。
const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
const transition = computed(() => (reducedMotion.value, motionTransition('base')))
</script>

<template>
  <MotionConfig :transition="transition" reduced-motion="user">
    <TooltipProvider :delay-duration="400" :skip-delay-duration="300">
      <RouterView />
    </TooltipProvider>
  </MotionConfig>
</template>
