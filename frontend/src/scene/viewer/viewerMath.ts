import type { PoseTickSample, ReplayShot } from './viewerContracts.js'

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
    if (Array.isArray(s.via)) for (const p of s.via) negX(p);
        negX(s.shooter_pos); negX(s.target_pos);
        negX(s.aim_point); negX(s.launch_point_rel);
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
        if (s.target_render) { negX(s.target_render.pos); negAng(s.target_render.ang); }
        if (s.shooter_render) { negX(s.shooter_render.pos); negAng(s.shooter_render.ang); }
    
}
