/** 单车检视预设：相机沿炮线取景，卖头角度由当前配置的真实俯角决定。 */
export function armorCameraPreset(
  kind: 'front' | 'hull_down',
  gunHeight: number,
  distance: number,
  limits: { down: number; up: number },
) {
  const pitch = kind === 'hull_down'
    ? limits.down
    : Math.min(limits.up, Math.max(limits.down, 0))
  const radians = pitch * Math.PI / 180
  return {
    pitch,
    position: [0, gunHeight + distance * Math.sin(radians), -distance * Math.cos(radians)] as const,
    target: [0, gunHeight, 0] as const,
  }
}
