/**
 * Android 地图派生物的**纯校验**（2.1.0 Phase 10/11-Maps）。
 *
 * 背景：APK 里随包携带 29 张 2D 离线底图（`src/assets/maps/*.webp`，canonical 1254×1254、
 * 合计 ~18.3 MiB）。Android 构建把它们派生成更小的同比例副本（budgets 见下），Web 构建
 * 继续用 canonical 资源。派生是**有损**的，所以必须有可验证的不变量：
 *
 *  1. 文件集合一致（不多不少，名称逐字相同）；
 *  2. **不改几何语义**：等比缩放（宽高比在容差内一致）、无裁剪 / 无补边 / 无旋转——
 *     派生尺寸必须等于按 maxDimension 计算的期望尺寸；
 *  3. 单张与总量都在预算内（超预算即失败，不靠"看着差不多"）；
 *  4. 不放大（源本身小于上限时保持原尺寸，绝不 upscale）。
 *
 * 本模块刻意不依赖任何图像库（只解析 WebP 头部），因此可在 frontend CI 直接单测；
 * 真正的重编码由 optimize-android-maps.py（Pillow，版本在 workflow 里 pin）完成，
 * 构建期用这里的检查器对**真实输出**做 fail-closed 校验。
 */

/** 预算与参数（改这里就是改产品决策；文档见 docs/android/architecture.md）。 */
export const MAP_DERIVATIVE_BUDGETS = Object.freeze({
  /** 派生后最长边上限（px）：手机 DPR3 下 ~1024 覆盖常见绘制宽度，再大只是白烧 3MB/图。 */
  maxDimension: 1024,
  /** 全套地图的总字节上限（APK 体积目标）。 */
  totalBytes: 10 * 1024 * 1024,
  /** 单张地图字节上限。 */
  perFileBytes: 500 * 1024,
  /** 宽高比容差（相对值）：等比缩放 + 整数取整带来的偏差上限。 */
  aspectTolerance: 0.002,
})

/** WebP 头部尺寸解析（VP8X / VP8 / VP8L）；无法识别返回 null。 */
export function webpDimensions(buffer) {
  if (!buffer || buffer.length < 30) return null
  const riff = buffer.toString('latin1', 0, 4)
  const kind = buffer.toString('latin1', 12, 16)
  if (riff !== 'RIFF' || buffer.toString('latin1', 8, 12) !== 'WEBP') return null
  if (kind === 'VP8X') {
    const width = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16))
    const height = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16))
    return { width, height }
  }
  if (kind === 'VP8 ') {
    const width = buffer.readUInt16LE(26) & 0x3fff
    const height = buffer.readUInt16LE(28) & 0x3fff
    return { width, height }
  }
  if (kind === 'VP8L') {
    const bits = buffer.readUInt32LE(21)
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) }
  }
  return null
}

/** 期望的派生尺寸：等比缩放到 maxDimension 以内（不放大），四舍五入到整数像素。 */
export function expectedDerivativeSize({ width, height }, maxDimension = MAP_DERIVATIVE_BUDGETS.maxDimension) {
  const longest = Math.max(width, height)
  if (longest <= maxDimension) return { width, height }
  const scale = maxDimension / longest
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/**
 * 校验派生集合。`sources` / `derivatives` 是 [{ name, bytes, dimensions }]（dimensions 可为 null）。
 * 返回 { errors, summary }——errors 非空即 fail closed。
 */
export function checkDerivativeInvariants({ sources, derivatives, budgets = MAP_DERIVATIVE_BUDGETS }) {
  const errors = []
  const sourceByName = new Map(sources.map((s) => [s.name, s]))
  const derivativeByName = new Map(derivatives.map((d) => [d.name, d]))

  for (const name of sourceByName.keys()) {
    if (!derivativeByName.has(name)) errors.push(`派生集合缺少 ${name}`)
  }
  for (const name of derivativeByName.keys()) {
    if (!sourceByName.has(name)) errors.push(`派生集合多出 ${name}`)
  }

  let totalBytes = 0
  for (const derivative of derivatives) {
    totalBytes += derivative.bytes
    const source = sourceByName.get(derivative.name)
    if (!source) continue
    const src = source.dimensions
    const dst = derivative.dimensions
    if (!src || !dst) {
      errors.push(`${derivative.name}: 无法解析 WebP 尺寸（src=${JSON.stringify(src)} dst=${JSON.stringify(dst)}）`)
      continue
    }
    // 2/4：等比 + 不放大 + 无裁剪/补边——派生尺寸必须等于按上限计算的期望值
    const expected = expectedDerivativeSize(src, budgets.maxDimension)
    if (dst.width !== expected.width || dst.height !== expected.height) {
      errors.push(
        `${derivative.name}: 派生尺寸 ${dst.width}x${dst.height} ≠ 期望 ${expected.width}x${expected.height}` +
        `（源 ${src.width}x${src.height}；改尺寸会破坏地图坐标语义）`,
      )
    }
    // 宽高比容差（防御性第二判据：即使期望计算被改坏，比例也必须在容差内）
    const srcAspect = src.width / src.height
    const dstAspect = dst.width / dst.height
    if (Math.abs(srcAspect - dstAspect) / srcAspect > budgets.aspectTolerance) {
      errors.push(`${derivative.name}: 宽高比漂移 ${dstAspect.toFixed(5)} vs 源 ${srcAspect.toFixed(5)}`)
    }
    // 3：单张预算
    if (derivative.bytes > budgets.perFileBytes) {
      errors.push(`${derivative.name}: ${(derivative.bytes / 1024).toFixed(0)} KiB 超过单张预算 ${budgets.perFileBytes / 1024} KiB`)
    }
  }

  if (totalBytes > budgets.totalBytes) {
    errors.push(`地图总量 ${(totalBytes / 1048576).toFixed(2)} MiB 超过预算 ${(budgets.totalBytes / 1048576).toFixed(0)} MiB`)
  }

  return {
    errors,
    summary: {
      files: derivatives.length,
      totalBytes,
      totalMiB: Number((totalBytes / 1048576).toFixed(2)),
      largest: derivatives.reduce((max, d) => (d.bytes > (max?.bytes ?? -1) ? d : max), null)?.name ?? null,
    },
  }
}
