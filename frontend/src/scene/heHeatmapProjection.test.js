import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { tankViewerSource } from './__tests__/sceneSource.ts';

const viewer = tankViewerSource() + [
        './viewer/heatmap.ts', './viewer/modelLifecycle.ts', './viewer/judgment.ts',
        './viewer/trajectoryCard.ts', './viewer/shotReplay.ts', './viewer/equipmentState.ts',
        './viewer/collisionView.ts', './viewer/debugUi.ts', './viewer/diagnosticProbe.ts', './viewer/dataLoader.ts', './viewer/aimInput.ts', './viewer/shotReplayMiss.ts',
        './viewer/turretRig.ts', './viewer/viewerMath.ts', './viewer/armorShaders.ts', './viewer/armorPrimaryShader.ts', './heSplash.ts',
    ].map((f) => fs.readFileSync(new URL(f, import.meta.url), 'utf8')).join('');
    + fs.readFileSync(new URL('./viewer/armorShaders.ts', import.meta.url), 'utf8');
const trajectoryGeometry = fs.readFileSync(new URL('./viewer/shotTrajectoryGeometry.ts', import.meta.url), 'utf8');
const card = fs.readFileSync(new URL('./viewer/shotResultCard.ts', import.meta.url), 'utf8');
const splash = fs.readFileSync(new URL('./heSplash.ts', import.meta.url), 'utf8');
const judgmentResult = fs.readFileSync(new URL('./viewer/judgmentResult.ts', import.meta.url), 'utf8');
const heVisual = fs.readFileSync(new URL('./viewer/heSplashVisual.ts', import.meta.url), 'utf8');
const ricochet = fs.readFileSync(new URL('./viewer/heatmapRicochet.ts', import.meta.url), 'utf8');

describe('HE 热力图投影到可见主装甲（源码级锁）', () => {
    it('主装甲深度遮罩对所有弹种开启，HE 不得关闭', () => {
        expect(viewer).toContain('excludeMaterial.visible = true;');
        expect(viewer).not.toContain('excludeMaterial.visible = !isHE');
    });
    it('HE 局部伤害用 AI shader 67 的热力图口径：满伤 − 1.3×装甲，按满伤归一', () => {
        expect(viewer).toContain('float heArmor = (thickness + spacedThick) * 1.3;');
        expect(viewer).toContain('damage * (1.0 - heDist / max(explosionRadius, 1e-3)) - heArmor');
        expect(viewer).toContain('clamp(splashDamage / max(damage, 1e-3), 0.0, 1.0)');
        expect(viewer).not.toContain('0.5 * damage * (1.0 - heDist');
        expect(viewer).toContain('float heAlpha = heActive ? mix(0.18, 0.95, heDamageNorm) : 0.0;');
    });
    it('击穿视图 HE 白色遮罩 = 点击卡片的「击穿」判定（首层主装 + 100%），渐变两视图都保留', () => {
        expect(viewer).toContain('uniform bool heatmapMask;');
        expect(viewer).toContain('heatmapMask: { value: false },');
        expect(viewer).toContain('if (canSplash && !underSpaced && penetration > 0.0 && finalThick <= pMin) {');
        expect(viewer).not.toContain('penetration - spacedThick > finalThick');
        expect(viewer).not.toContain('if (heatmapMask) {');
        expect(viewer).toContain('if (heatmapMask && hePenMask > 0.5) {');
        expect(viewer).toContain('vec3 heColor = heDamageRamp(heDamageNorm);');
        expect(viewer.indexOf('vec3 heColor = heDamageRamp(heDamageNorm);'))
            .toBeLessThan(viewer.indexOf('if (heatmapMask && hePenMask > 0.5) {'));
        expect(judgmentResult).toContain('const heFirstPrimary = isHE && hitsForCheck.length > 0');
        expect(judgmentResult.replace('const heFirstPrimary = isHE && hitsForCheck.length > 0', '')).not.toContain('const heFirstPrimary = isHE && hitsForCheck.length > 0');
        expect(judgmentResult).toContain('&& isPrimary(hitsForCheck[0].section);');
        expect(card).toContain(': (heChance >= 1');
        expect(card).toContain("? L.resultName('PENETRATION')");
    });
    it('默认视图 HE 渐变复用热力图机械：点击建/放、逐帧管线与 uniforms 刷新随机械走', () => {
        expect(viewer).toContain('function heGradientWanted()');
        expect(viewer).toContain('function syncHeatOverlay()');
        expect(viewer).toContain('if ((penetrationMode || (!!hm.getPrimaryArmorScene() && hm.heGradientWanted())) && ml.models.armorModel) {');
        expect(viewer).toContain('if (penetrationMode || hm.getPrimaryArmorScene()) { hm.updatePenetrationUniforms(selectedShell); hm.updateSpacedUniforms(selectedShell); }');
        expect(viewer).toMatch(/applyPenetrationMode\(on: boolean\)(?:: void)? \{[\s\S]*?syncHeatOverlay\(\);[\s\S]*?return;\s*\n            \}/);
        expect(viewer).toMatch(/clearHeBlast\(\);[\s\S]{0,120}?disposePenetrationResources\(\);/);
        expect(viewer).toContain('else if (hmRef().getPrimaryArmorScene()) { hmRef().disposePenetrationResources(); hmRef().syncHeatOverlay(); }');
    });
    it('逐帧管线只在机械真的建好时才走热力图分支（释放/重建生命周期行为见 viewer/heatmap.lifecycle.test.ts）', () => {
        expect(viewer).toContain('if ((penetrationMode || (!!hm.getPrimaryArmorScene() && hm.heGradientWanted())) && ml.models.armorModel) {');
    });
    it('普通检视的换弹/换装备清理与叠加层资源解耦（评审 + Codex 复核 P2）', () => {
        expect(viewer).toContain("if (!QP.get('shot') && (jc.getLastClickNdc() || hm.getHeHeatmapCenter())) {");
        expect(viewer).toMatch(/\} else if \(jc\.getLastClickNdc\(\) \|\| hm\.getHeHeatmapCenter\(\)\) \{/);
        expect(viewer).not.toContain('(penetrationMode || primaryArmorScene) && lastClickNdc');
        expect(viewer).not.toContain('if (!penetrationMode && !primaryArmorScene) return;');
        expect(viewer).toMatch(/refreshEquipmentEffects\(\) \{[\s\S]*?if \(!QP\.get\('shot'\) && \(jc\.getLastClickNdc\(\) \|\| hm\.getHeHeatmapCenter\(\)\)\) \{[\s\S]*?if \(penetrationMode \|\| hm\.getPrimaryArmorScene\(\)\) \{/);
        expect(viewer).toMatch(/jc\.clearLastClickNdc\(\);\s*\n\s*onJudgmentDistance\?\.\(null\);\s*\n\s*\}[\s\S]*?hm\.syncHeatOverlay\(\);/);
    });
    it('退出厚度视图时先恢复网格可见性再重建叠加层（Codex 复核 P2）', () => {
        expect(viewer).toMatch(/cvs\.applyArmorViewStyle\(collisionMode\);[\s\S]{0,800}?hm\.syncHeatOverlay\(\);/);
        expect(viewer).not.toMatch(/hm\.syncHeatOverlay\(\);\s*\n\s*if \(!ml\.models\.armorModel\) return;\s*\n\s*cvs\.applyArmorViewStyle\(collisionMode\);/);
    });
    it('点击判定特效走独立 fxScene，击穿概率模式下画在热力图之上', () => {
        expect(viewer).toContain('fxScene = new THREE.Scene();');
        expect(viewer).toContain('getFxScene().add(trajGroup);');
        expect(viewer).toContain('getFxScene().add(marker);');
        expect(heVisual).toMatch(/getFxScene\(\)\.add\(group\);\s*\n\s*heSplashGroup = group;/);
        expect(heVisual.replace('getFxScene().add(group);', '')).not.toMatch(/getFxScene\(\)\.add\(group\);\s*\n\s*heSplashGroup = group;/);
        expect(viewer).not.toContain('scene.add(trajGroup)');
        expect(viewer).not.toContain('scene.add(marker)');
        expect(viewer).toMatch(/renderer\.render\(hm\.getPrimaryArmorScene\(\), camera\); \}\s*\n\s*renderFxPass\(\);/);
        expect(viewer).toMatch(/renderer\.render\(scene, camera\);\s*\n\s*renderFxPass\(\);/);
        expect(heVisual).toContain('sphere.renderOrder = 995;');
        expect(heVisual).not.toContain('group.renderOrder = 998;');
        expect(viewer).toContain('getFxScene().add(trajGroup);');
        expect(trajectoryGeometry).toContain("from './overlayStroke.js'");
        expect(trajectoryGeometry).toContain('createScreenSpacePolyline');
        expect(trajectoryGeometry).not.toMatch(/new THREE\.TubeGeometry/);
        expect(trajectoryGeometry).not.toMatch(/new THREE\.SphereGeometry/);
        expect(viewer).not.toContain('RingGeometry');
        expect(viewer).toContain('createScreenSpaceDot(');
        expect(viewer).toMatch(/const prevAutoClear = renderer\.autoClear;\s*\n\s*renderer\.autoClear = false;\s*\n\s*renderer\.render\(fxScene, camera\);\s*\n\s*renderer\.autoClear = prevAutoClear;/);
    });
    it('800 射线采样走空间网格，不在 UI 线程全扫三角形', () => {
        expect(splash).toContain('raycastGridAll');
        expect(splash).not.toContain('raycastPackAll');
        expect(ricochet).toContain('buildRicochetGrid(pack)');
        expect(ricochet.replace('buildRicochetGrid(pack)', '')).not.toContain('buildRicochetGrid(pack)');
    });
    it('HE 弹种切换重跑判定、炮管裁切面进采样、半径回退单一来源、卡片按画布限宽', () => {
        expect(viewer).toContain('jc.getLastClickNdc');
        expect(viewer).toContain('jc.clearLastClickNdc();');
        expect(viewer).toContain('clipPlane: hm.getGunClipPlane()');
        expect(viewer).toContain('explosion_radius: isHE ? heRadius : 0');
        expect(viewer).toContain("document.getElementById('canvas-container')");
        expect(viewer).not.toContain('100vw');
    });
    it('8 位 RT 饱和时 HE 热力图走 0 伤害端', () => {
        expect(viewer).toMatch(/if \(spacedSatBlocked\) \{\s*\n\s*splashChance = 0\.0;\s*\n\s*heDamageNorm = 0\.0;/);
    });
});
