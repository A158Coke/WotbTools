<script setup>
import { useAuth } from '../composables/useAuth.js'
import EmptyState from './EmptyState.vue'
import AppButton from './AppButton.vue'

defineProps({
  icon: { type: [Object, Function], default: null },
  title: { type: String, required: true },
  description: { type: String, required: true },
  loginDestination: { type: [String, Object], required: true },
})

const { login } = useAuth()
</script>

<template>
  <EmptyState :icon="icon" :title="title" :description="description" data-testid="capability-auth-gate">
    <AppButton data-testid="capability-login" @click="login(loginDestination)">{{ $t('app.login') }}</AppButton>
  </EmptyState>
</template>
