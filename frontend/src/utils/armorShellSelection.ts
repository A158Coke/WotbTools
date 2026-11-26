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
