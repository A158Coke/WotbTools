/**
 * 贴地基地圆盘的 UV 转正：圆盘平躺在地上，贴图随相机水平朝向旋转，从任何方向看字都是正的。
 *
 * offsets：每个顶点相对圆心的归一化偏移 (dx, dz)，范围 [-1, 1]（世界 x / z）。
 * (ux, uz)：从相机指向基地的水平单位向量 = 贴图"上"方向（远离观者）。
 * 观者右手方向 R = (−uz, ux)。CanvasTexture 默认 flipY：画布顶边对应 v = 1，
 * 所以 v 轴沿 U、u 轴沿 R。
 */
export function orientDiscUv(offsets, uv, ux, uz) {
  const rx = -uz, rz = ux
  for (let i = 0; i < offsets.length / 2; i++) {
    const dx = offsets[i * 2], dz = offsets[i * 2 + 1]
    uv[i * 2] = 0.5 + (dx * rx + dz * rz) * 0.5
    uv[i * 2 + 1] = 0.5 + (dx * ux + dz * uz) * 0.5
  }
  return uv
}
