export function orientDiscUv(
  offsets: ArrayLike<number>,
  uv: { [index: number]: number },
  ux: number,
  uz: number,
): { [index: number]: number } {
  const rx = -uz, rz = ux
  for (let i = 0; i < offsets.length / 2; i++) {
    const dx = offsets[i * 2], dz = offsets[i * 2 + 1]
    uv[i * 2] = 0.5 + (dx * rx + dz * rz) * 0.5
    uv[i * 2 + 1] = 0.5 + (dx * ux + dz * uz) * 0.5
  }
  return uv
}
