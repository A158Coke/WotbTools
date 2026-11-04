// 场景材质纹理回收辅助（disposeObject3D 的可测核心）。
//
// 为什么单独存在：ShaderMaterial 的纹理挂在 `uniforms.<name>.value` 而非材质直接
// 属性上（如 makeSpeedtreeStaticMaterial 的 uniforms.map.value）——只枚举直接
// 属性找 isTexture 的清理路径对它们触发零次 dispose，切图累积 GPU 显存。
import type { Material, Texture } from 'three'

/** isTexture 鸭子判定命中的纹理（three 纹理以 isTexture 标记；fake 纹理也带该标记） */
interface TexturedValue {
  isTexture?: unknown
}

/** 材质 → 可枚举属性视图（鸭子扫描边界；three 材质子类的自有属性逐类各异）。 */
function duckProps(src: unknown): Record<string, TexturedValue | undefined> {
  return src as Record<string, TexturedValue | undefined>
}

/** 材质 → 其引用的纹理集合（直接属性 + uniforms 值；Set 天然去重共享纹理） */
export function collectMaterialTextures(m: Material, out: Set<Texture> = new Set()): Set<Texture> {
  // 直接属性按鸭子类型枚举（three 材质子类各异，isTexture 是唯一稳定标记）
  const props = duckProps(m)
  for (const k in props) {
    const v = props[k]
    if (v && v.isTexture) out.add(v as Texture)
  }
  const uniforms = (m as { uniforms?: Record<string, { value?: unknown }> }).uniforms
  if (uniforms) {
    for (const k in uniforms) {
      const v = uniforms[k]?.value as TexturedValue | undefined
      if (v && v.isTexture) out.add(v as Texture)
    }
  }
  return out
}
