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

/** Object3D 子树递归 dispose（geometry/material/texture 各一次；Set 去重，dispose 幂等）。
 *  原 playbackScene 内联实现出仓（#913 合并后行数门禁；语义逐字，含 InstancedMesh.dispose）。
 *  shared 参数保留调用方签名（root 级去重由调用方 disposed 集合完成）。 */
export function disposeObject3D(root: { traverse(cb: (o: never) => void): void }, shared: unknown = null): void {
  const geos = new Set<{ dispose(): void }>(), mats = new Set<Material>(), texs = new Set<Texture>();
  void shared;   // 去重由调用方的 disposed 集合按 root 级完成（资源级去重见本模块其余导出）
  root.traverse((o) => {
    const obj = o as unknown as {
      isInstancedMesh?: boolean; dispose?(): void; geometry?: { dispose(): void } | null;
      material?: Material | Material[] | null;
    };
    // InstancedMesh 的 instanceMatrix 是实例专属的 InstancedBufferAttribute，
    // 不随 geometry.dispose 释放，必须走 InstancedMesh.dispose 自己清理
    if (obj.isInstancedMesh) obj.dispose?.();
    if (obj.geometry) geos.add(obj.geometry);
    const ms: Material[] = Array.isArray(obj.material) ? obj.material : (obj.material ? [obj.material] : []);
    for (const m of ms) {
      mats.add(m);
      collectMaterialTextures(m, texs);   // 直接属性 + uniforms（ShaderMaterial 纹理在 uniforms.value）
    }
  });
  for (const t of texs) t.dispose();
  for (const m of mats) m.dispose();
  for (const g of geos) g.dispose();
}
