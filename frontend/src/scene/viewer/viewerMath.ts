// 查看器纯函数数学（#820 Agent A 出仓）：dolly-zoom FOV 标定与回放世界镜像。
// URL 契约基线（tankViewer.urlContract.test.js）直接锁定这两个函数的数值行为。
// tankViewer.js 保留同名 re-export。
import type { PoseTickSample, ReplayShot } from './viewerContracts.js'

/**
 * dolly-zoom FOV（纯函数，内核与单测共用）。
 * enabled 时按 k=d/refDist 缩放：d<refDist 时 FOV 变宽，车体屏幕尺寸保持 refDist 处比例；
 * farProductGain/farProductMax 可选：product = baseProduct + max(0,d-refDist)×gain，封顶 max；
 * product 随距离增大 → 远距车体略小（Armor Inspector 实测标定）。enabled=false 恒原生。
 * productScale 可选：整体放大 product（车体屏幕尺寸按 1/scale 缩小），默认 1；
 * 用于查看器的显示缩放，不改变距离曲线形状。maxFovDeg 封顶近距，minFovDeg 封顶远距——
 * 两车 world 总览必须传 false，否则会把远距受击车裁出视锥。
 */
export function dollyZoomFov(distanceM: number, enabled: boolean, baseFovDeg = 50, refDistM = 30, minFovDeg = 1, maxFovDeg = Infinity, farProductGain = 0, farProductMax = Infinity, productScale = 1): number {
    if (!enabled) return Math.min(maxFovDeg, Math.max(minFovDeg, baseFovDeg));
    const scale = Number.isFinite(productScale) && productScale > 0 ? productScale : 1;
    const baseProduct = Math.tan(baseFovDeg * Math.PI / 360) * refDistM;
    const unscaledProduct = Math.min(farProductMax, baseProduct + Math.max(0, distanceM - refDistM) * farProductGain);
    const product = unscaledProduct * scale;
    const fov = 2 * Math.atan(product / Math.max(distanceM, 1e-4)) * 180 / Math.PI;
    return Math.min(maxFovDeg, Math.max(minFovDeg, fov));
}

export function mirrorShotData(s: ReplayShot): void {
        if (s.__worldMirrored) return;
        s.__worldMirrored = true;
        const negX = (a: unknown) => { if (Array.isArray(a) && a.length >= 3) a[0] = -a[0]; };
        const negAng = (a: unknown) => { if (Array.isArray(a) && a.length >= 3) { a[0] = -a[0]; a[2] = -a[2]; } };
        negX(s.ball_a); negX(s.ball_b); negX(s.launch_velocity);
    if (Array.isArray(s.via)) for (const p of s.via) negX(p);   // 折线中间点同链镜像（review：只镜像端点会混坐标系）
        negX(s.shooter_pos); negX(s.target_pos);
        negX(s.aim_point); negX(s.launch_point_rel);
        // 炮塔相对角时间线：透传不取反（存游戏系原始值）。
        // 镜像场景的【节点旋转角】须取负（−rel，镜像翻转旋转方向），
        // 该取反在使用点完成——同初始摆放 turretDegT = 镜像炮塔角−镜像车体角 = −rel
        const mirTL = (tl: PoseTickSample[] | null | undefined) => { if (Array.isArray(tl)) for (const t of tl) { negX(t.pos); t.yaw = -t.yaw; t.roll = -t.roll; } };
        mirTL(s.target_render_timeline); mirTL(s.shooter_render_timeline);
        negAng(s.shooter_ang); negAng(s.target_ang);
        if (typeof s.shooter_turret_yaw === 'number') s.shooter_turret_yaw = -s.shooter_turret_yaw;
        if (typeof s.target_turret_yaw === 'number') s.target_turret_yaw = -s.target_turret_yaw;
        for (const t of (s.tick_samples || [])) { negX(t.pos); t.yaw = -t.yaw; t.roll = -t.roll; }
        for (const t of (s.shooter_tick_samples || [])) { negX(t.pos); t.yaw = -t.yaw; t.roll = -t.roll; }
        if (s.terrain_impact) { negX(s.terrain_impact.impact_point); negX(s.terrain_impact.terminal_dir); }
        if (s.shooter_aim && typeof s.shooter_aim.turret_rel_yaw === 'number') {
            s.shooter_aim.turret_rel_yaw = -s.shooter_aim.turret_rel_yaw;
        }
        // 渲染锚点与时间线同规则镜像：pos.x / yaw / roll 取反（pitch 不变）。
        // 此前漏取反 roll——初始摆放（锚点）与滑块 dt=0（时间线，已取反）在
        // 有侧倾的移动目标上姿态差一个侧倾符号，拖动滑块才"恢复"。
        if (s.target_render) { negX(s.target_render.pos); negAng(s.target_render.ang); }
        if (s.shooter_render) { negX(s.shooter_render.pos); negAng(s.shooter_render.ang); }
    
}
