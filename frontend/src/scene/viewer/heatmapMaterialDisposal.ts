import * as THREE from 'three'
export function createHeatmapMaterialDisposal(emptySpacedTexture: () => THREE.Texture) {
function disposeMaterial(mat: THREE.Material | null) {
            if (!mat) return;
            const shader = mat as THREE.ShaderMaterial;
            if (shader.uniforms) {
                for (const u of Object.values(shader.uniforms)) {
                    const v = u.value as THREE.Texture | null | undefined;
                    if (v && v.isTexture && v !== emptySpacedTexture() && !v.isRenderTargetTexture) v.dispose();
                }
            }
            const mapped = mat as THREE.MeshBasicMaterial;
            if (mapped.map && mapped.map.isTexture && mapped.map !== emptySpacedTexture()) mapped.map.dispose();
            mat.dispose();
        }

function disposeSceneMaterials(scene: THREE.Scene | null) {
            if (!scene) return;
            scene.traverse(function(node){
                const mesh = node as THREE.Mesh;
                if (mesh.isMesh) {
                    const mat = mesh.material as THREE.ShaderMaterial | undefined;
                    if (mat && mat.uniforms) disposeMaterial(mat);
                }
            });
            scene.clear();
        }

  return { disposeSceneMaterials }
}
