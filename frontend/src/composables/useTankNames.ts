// 车型名表（tank_cache `{id: name}`）单例：事件流与 3D 快捷指令/聊天滚动流共用。
// facet 的 `tank_name` 是 `tank_<id>` 占位（WASM 未注入名表）——真实车型名必须走本表，
// 否则身份只剩数字编号。
import { ref } from 'vue'
import { fetchTankEncyclopedia } from '../scene/agentData.js'

const tankNames = ref<Record<number, string>>({})
let attempted = false

/**
 * 返回车型名表 **ref**（调用方在 computed 里读 `.value` 以保持响应式）。
 * 首次消费即触发加载（fire-and-forget；失败/空表允许重试——上游 promise 已备忘）。
 */
export function useTankNames() {
  // 空表（首用 / 上次失败 / 资产面暂不可用）→ 允许重取：上游 fetchTankCacheStatic
  // 自带 promise 备忘，重复消费是廉价的；表非空即命中缓存不再发请求。
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
        // 资产面暂不可用：保留 facet 名/昵称；下次进入或换文件时重试。
        attempted = false
      }
    })()
  }
  return tankNames
}
