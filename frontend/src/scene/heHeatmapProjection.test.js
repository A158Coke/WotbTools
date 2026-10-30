import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

// 源码级锁：HE 热力图必须投影在相机可见的首层主装甲上。
// 主装甲深度遮罩（renderOrder 0 的 omit 克隆）先写深度，renderOrder 1 的着色克隆
// 再按深度测试只让最近的主装甲通过。若给 HE 单独关闭遮罩，后层主装甲的颜色会
// 穿透前板参与混合，画面上的颜色就不再属于可见主装甲。
// 穿透材质族 2026-10-24 出仓 viewer/armorShaders.js（current-plan.md Step B2）：
// 着色器模式断言随实现覆盖两份源（拼接读取，not.toMatch 同时约束两侧）
const viewer = fs.readFileSync(new URL('./tankViewer.js', import.meta.url), 'utf8')
    + fs.readFileSync(new URL('./viewer/armorShaders.js', import.meta.url), 'utf8');
const splash = fs.readFileSync(new URL('./heSplash.js', import.meta.url), 'utf8');

describe('HE 热力图投影到可见主装甲（源码级锁）', () => {
    it('主装甲深度遮罩对所有弹种开启，HE 不得关闭', () => {
        expect(viewer).toContain('excludeMaterial.visible = true;');
        expect(viewer).not.toContain('excludeMaterial.visible = !isHE');
    });
    it('HE 局部伤害用 AI shader 67 的热力图口径：满伤 − 1.3×装甲，按满伤归一', () => {
        expect(viewer).toContain('float heArmor = (thickness + spacedThick) * 1.3;');
        expect(viewer).toContain('damage * (1.0 - heDist / max(explosionRadius, 1e-3)) - heArmor');
        expect(viewer).toContain('clamp(splashDamage / max(damage, 1e-3), 0.0, 1.0)');
        // 旧口径（0.5·D − 名义装甲）会把 225mm 近爆板压成近透明。
        expect(viewer).not.toContain('0.5 * damage * (1.0 - heDist');
        // 零伤害仍是热力图 0 端（暗红），只有未激活才透明（默认视图分支）。
        expect(viewer).toContain('float heAlpha = heActive ? mix(0.18, 0.95, heDamageNorm) : 0.0;');
    });
    it('击穿视图 HE 白色遮罩 = 点击卡片的「击穿」判定（首层主装 + 100%），渐变两视图都保留', () => {
        expect(viewer).toContain('uniform bool heatmapMask;');
        expect(viewer).toContain('heatmapMask: { value: false },');
        // 判据与判定链逐条同源：① 主装必须是该像素的第一层（履带/模块/间隙甲在前
        // 时 HE 首面即被挡，卡片出 SPLASH/BLOCKED）；② 卡片 CDF 在
        // thickness <= 0.95×穿深 时夹到 100% 才叫击穿（「可能击穿」不着白）；
        // ③ 穿深为 0 不亮。
        expect(viewer).toContain('if (canSplash && !underSpaced && penetration > 0.0 && finalThick <= pMin) {');
        // 旧的连续判据（允许穿透主装身后的前置层、且用 ±5% 区间中点当边界）必须消失。
        expect(viewer).not.toContain('penetration - spacedThick > finalThick');
        // 渐变（点击判定口径）在**两个视图都保留**：不得再用 `if (heatmapMask)` 把整个
        // canSplash 分支换成白遮罩；白色只是叠在「可直穿」像素上、盖住该处渐变。
        expect(viewer).not.toContain('if (heatmapMask) {');
        expect(viewer).toContain('if (heatmapMask && hePenMask > 0.5) {');
        expect(viewer).toContain('vec3 heColor = heDamageRamp(heDamageNorm);');
        expect(viewer.indexOf('vec3 heColor = heDamageRamp(heDamageNorm);'))
            .toBeLessThan(viewer.indexOf('if (heatmapMask && hePenMask > 0.5) {'));
        // 卡片侧的权威规则（遮罩必须与它一致）：首层必须是主装，且 CDF 夹到 100%
        // 才写 PENETRATION；首面非主装走 SPLASH/BLOCKED，0%<chance<100% 是“可能击穿”。
        expect(viewer).toContain('const heFirstPrimary = isHE && hitsForCheck.length > 0');
        expect(viewer).toContain('&& isPrimary(hitsForCheck[0].section);');
        expect(viewer).toContain(': (heChance >= 1');
        expect(viewer).toContain("? L.resultName('PENETRATION')");
    });
    it('默认视图 HE 渐变复用热力图机械：点击建/放、逐帧管线与 uniforms 刷新随机械走', () => {
        expect(viewer).toContain('function heGradientWanted()');
        expect(viewer).toContain('function syncHeatOverlay()');
        // 逐帧管线门：击穿视图，或默认视图下机械已建且 HE+爆点仍在。
        expect(viewer).toContain('if ((penetrationMode || (!!primaryArmorScene && heGradientWanted())) && armorModel) {');
        // 换弹在机械存在时也刷新 uniforms，并同步叠加层生命周期。
        expect(viewer).toContain('if (penetrationMode || primaryArmorScene) { updatePenetrationUniforms(selectedShell); updateSpacedUniforms(selectedShell); }');
        // 退出击穿视图不再无条件释放：保留/释放由 syncHeatOverlay 裁决。
        expect(viewer).toMatch(/applyPenetrationMode\(on\) \{[\s\S]*?syncHeatOverlay\(\);[\s\S]*?return;\s*\n            \}/);
        // 模型卸载释放机械，配置变化释放后按需重建。
        expect(viewer).toMatch(/heHeatmapCenter = null;\s*\n\s*disposePenetrationResources\(\);/);
        expect(viewer).toContain('else if (primaryArmorScene) { disposePenetrationResources(); syncHeatOverlay(); }');
    });
    it('点击判定特效走独立 fxScene，击穿概率模式下画在热力图之上', () => {
        expect(viewer).toContain('fxScene = new THREE.Scene();');
        // 轨迹/命中标记/溅射半径球全部挂在 fxScene，不再留在主场景。
        expect(viewer).toContain('fxScene.add(trajGroup);');
        expect(viewer).toContain('fxScene.add(marker);');
        expect(viewer).toMatch(/fxScene\.add\(group\);\s*\n\s*heSplashGroup = group;/);
        expect(viewer).not.toContain('scene.add(trajGroup)');
        expect(viewer).not.toContain('scene.add(marker)');
        // 渲染顺序：热力图 pass 之后再叠一次特效 pass（否则被 0.5/0.95 alpha 盖掉）。
        expect(viewer).toMatch(/renderer\.render\(primaryArmorScene, camera\); \}\s*\n\s*renderFxPass\(\);/);
        expect(viewer).toMatch(/renderer\.render\(scene, camera\);\s*\n\s*renderFxPass\(\);/);
        // 特效之间也按 renderOrder 定序（全部 depthTest:false）：球壳 996 → 轨迹 997
        // → 命中点 999 → 靶环 1000。renderOrder 不随父级继承，必须写在 mesh 上。
        expect(viewer).toContain('sphere.renderOrder = 996;');
        expect(viewer).not.toContain('group.renderOrder = 998;');
        expect(viewer).toContain("trajGroup.traverse((o) => { if (o.isMesh) o.renderOrder = 997; });");
        expect(viewer).toContain('ring.renderOrder = 1000;');
        // fxScene 没有背景：pass 内必须临时关闭 autoClear，否则整帧被清空。
        expect(viewer).toMatch(/const prevAutoClear = renderer\.autoClear;\s*\n\s*renderer\.autoClear = false;\s*\n\s*renderer\.render\(fxScene, camera\);\s*\n\s*renderer\.autoClear = prevAutoClear;/);
    });
    it('800 射线采样走空间网格，不在 UI 线程全扫三角形', () => {
        expect(splash).toContain('raycastGridAll');
        expect(splash).not.toContain('raycastPackAll');
        expect(viewer).toContain('buildRicochetGrid(hePack)');
    });
    it('HE 弹种切换重跑判定、炮管裁切面进采样、半径回退单一来源、卡片按画布限宽', () => {
        expect(viewer).toContain('lastClickNdc');
        expect(viewer).toContain('lastClickNdc = null;');
        expect(viewer).toContain('clipPlane: gunClipPlane');
        expect(viewer).toContain('explosion_radius: isHE ? heRadius : 0');
        expect(viewer).toContain("document.getElementById('canvas-container')");
        expect(viewer).not.toContain('100vw');
    });
    it('8 位 RT 饱和时 HE 热力图走 0 伤害端', () => {
        expect(viewer).toMatch(/if \(spacedSatBlocked\) \{\s*\n\s*splashChance = 0\.0;\s*\n\s*heDamageNorm = 0\.0;/);
    });
});
