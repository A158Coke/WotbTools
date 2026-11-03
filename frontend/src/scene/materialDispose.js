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

/** root 外持有者的纹理排除集（disposeObject3D 第二参数消费）：candidate 场景材质
 *  经 uniforms 引用地面分层（makeDecalMaterial 的 colormap/colormapLm）与海岸线
 *  高度纹理（makeWaterMaterial 的 uHeightmap），但释放责任在 groundLayers /
 *  waterCoast 一侧——candidate 失败回收时排除，不替 owner 释放（评审 P2 纹理归属）。
 *  @param {object|null} groundLayers  会话分层地表（.texs 值为共享纹理）
 *  @param {THREE.Texture|null} waterHeightTex  已建未移交的 waterCoast.heightTex
 */
export function sharedOwnedTextures(groundLayers, waterHeightTex = null) {
  const out = new Set();
  if (groundLayers && groundLayers.texs) {
    for (const k in groundLayers.texs) {
      const t = groundLayers.texs[k];
      if (t) out.add(t);
    }
  }
  if (waterHeightTex) out.add(waterHeightTex);
  return out;
}
