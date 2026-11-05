/**
 * 换配置时是否让 URL 的 shell 失效。
 *
 * 弹种下标属于当前射手弹表：只有射手换炮必然改变弹表，需要清除旧下标；
 * 受击方换配置只改变装甲几何/厚度，射击方弹表是独立状态（&scfg= 或其自身
 * 默认顶级配置），不得因受击方换炮/换发动机/换履带而失效。
 */
export function shouldResetShellOnConfigChange({
  side,
  configChanged,
}: {
  side: string
  configChanged: boolean
}) {
  if (!configChanged) return false
  return side === 'shooter'
}
