// 场景材质纹理回收辅助（disposeObject3D 的可测核心）。
//
// 为什么单独存在：ShaderMaterial 的纹理挂在 `uniforms.<name>.value` 而非材质直接
// 属性上（如 makeSpeedtreeStaticMaterial 的 uniforms.map.value）——只枚举直接
// 属性找 isTexture 的清理路径对它们触发零次 dispose，切图累积 GPU 显存。

/** 材质 → 其引用的纹理集合（直接属性 + uniforms 值；Set 天然去重共享纹理） */
export function collectMaterialTextures(m, out = new Set()) {
  for (const k in m) {
    const v = m[k];
    if (v && v.isTexture) out.add(v);
  }
  if (m.uniforms) {
    for (const k in m.uniforms) {
      const v = m.uniforms[k] && m.uniforms[k].value;
      if (v && v.isTexture) out.add(v);
    }
  }
  return out;
}
