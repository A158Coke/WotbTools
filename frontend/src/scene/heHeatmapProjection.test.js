import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

// 源码级锁：HE 热力图必须投影在相机可见的首层主装甲上。
// 主装甲深度遮罩（renderOrder 0 的 omit 克隆）先写深度，renderOrder 1 的着色克隆
// 再按深度测试只让最近的主装甲通过。若给 HE 单独关闭遮罩，后层主装甲的颜色会
// 穿透前板参与混合，画面上的颜色就不再属于可见主装甲。
const viewer = fs.readFileSync(new URL('./tankViewer.js', import.meta.url), 'utf8');
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
        // 零伤害仍是热力图 0 端（暗红），只有未激活才透明。
        expect(viewer).toContain('float heAlpha = heActive ? mix(0.18, 0.95, heDamageNorm) : 0.0;');
    });
    it('800 射线采样走空间网格，不在 UI 线程全扫三角形', () => {
        expect(splash).toContain('raycastGridAll');
        expect(viewer).toContain('buildRicochetGrid(hePack)');
    });
    it('HE 弹种切换重跑判定、炮管裁切面进采样、半径回退单一来源、卡片按画布限宽', () => {
        expect(viewer).toContain('lastClickNdc');
        expect(viewer).toContain('clipPlane: gunClipPlane');
        expect(viewer).toContain('explosion_radius: isHE ? heRadius : 0');
        expect(viewer).toContain("document.getElementById('canvas-container')");
        expect(viewer).not.toContain('100vw');
    });
});
