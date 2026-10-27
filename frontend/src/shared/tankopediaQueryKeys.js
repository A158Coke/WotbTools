/**
 * 只属于坦克百科的 query 键（搜索/筛选/详情/配置器选择）。
 *
 * 单一来源：`utils/tankopediaQuery.js`（解析/序列化）与 `app/navigation.js`（离开视图时清理）
 * 都必须消费这一份；此模块不引入任何场景/资产依赖，可安全进入应用壳。
 */
export const TANKOPEDIA_QUERY_KEYS = Object.freeze([
  'q', 'tier', 'nation', 'type', 'sort', 'tank', 'config',
  'engine', 'track', 'shell', 'dev', 'cons', 'prov', 'skills', 'camo',
])
