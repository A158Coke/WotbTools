import { computed, reactive } from 'vue'

export function createShellChrome() {
  const owners = reactive(new Set())
  const navHosts = reactive(new Set())
  return {
    immersive: computed(() => owners.size > 0),
    request(owner, on) {
      if (on) owners.add(owner)
      else owners.delete(owner)
    },
    navHosted: computed(() => navHosts.size > 0),
    hostNav(owner, on) {
      if (on) navHosts.add(owner)
      else navHosts.delete(owner)
    },
  }
}
