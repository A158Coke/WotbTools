import { ref } from 'vue'
import { fetchTankEncyclopedia } from '../scene/agentData.js'

const tankNames = ref<Record<number, string>>({})
let attempted = false

export function useTankNames() {
  if (!attempted || Object.keys(tankNames.value).length === 0) {
    attempted = true
    void (async () => {
      try {
        const cache = await fetchTankEncyclopedia() as Record<string, { name?: unknown }> | null
        const out: Record<number, string> = {}
        for (const [id, info] of Object.entries(cache || {})) {
          const tankId = Number(id)
          const name = typeof info?.name === 'string' ? info.name : ''
          if (name && Number.isFinite(tankId)) out[tankId] = name
        }
        tankNames.value = out
      } catch {
        attempted = false
      }
    })()
  }
  return tankNames
}
