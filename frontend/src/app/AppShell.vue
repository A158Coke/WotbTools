<script setup>
import { provide } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth.js'
import { useError } from '../composables/useError.js'
import { locationForView } from './navigation.js'
import AppHeader from './AppHeader.vue'
import GlobalErrorDialog from './GlobalErrorDialog.vue'

const router = useRouter()
const route = useRoute()
const { initPromise, login, isAuthenticated } = useAuth()
const { error: globalError, showError: showGlobalError, close: closeGlobalError } = useError()

function navigate(view) {
  const destination = router.resolve(locationForView(view, route))
  if (destination.fullPath !== route.fullPath) router.push(destination)
}

provide('isAuthenticated', isAuthenticated)
provide('login', login)
provide('authInit', initPromise)
provide('navigate', navigate)
</script>

<template>
  <AppHeader />
  <RouterView />
  <GlobalErrorDialog :error="globalError" :visible="showGlobalError" @close="closeGlobalError" />
</template>
