// 时间滑块插值辅助（#820 从 shotReplay.ts 拆出以守住单文件行数预算）：
// 位姿采样线性插值 + 炮塔/炮管时间线插值（跨 ±π 按短弧）。逐行平移，语义不变。
import type { PoseTickSample, TimelineTuple, Vec3 } from './viewerContracts.js'

/** 渲染时间线条目在运行时以数字下标携带 [dt, value]，故需允许数字索引。 */
export type PoseSampleLike = PoseTickSample & Record<number, number>

export function interpTick(samples: PoseSampleLike[] | PoseTickSample[] | null,
    dt: number): PoseTickSample | null {
    if (!samples || !samples.length) return null;
    for (let i = 0; i < samples.length - 1; i++) {
        const a = samples[i], b = samples[i + 1];
        const aDt = a.dt ?? 0, bDt = b.dt ?? 0;
        if (aDt <= dt && bDt >= dt) {
            const span = bDt - aDt;
            const f = span > 1e-6 ? (dt - aDt) / span : 0;
            let dy = b.yaw - a.yaw;
            while (dy > Math.PI) dy -= 2 * Math.PI;
            while (dy < -Math.PI) dy += 2 * Math.PI;
            return {
                pos: [0, 1, 2].map(function(k) { return a.pos[k] + (b.pos[k] - a.pos[k]) * f; }) as Vec3,
                yaw: a.yaw + dy * f,
                pitch: (a.pitch ?? 0) + ((b.pitch ?? 0) - (a.pitch ?? 0)) * f,
                roll: a.roll + (b.roll - a.roll) * f
            };
        }
    }
    const firstDt = samples[0].dt ?? 0;
    return dt <= firstDt ? samples[0] : samples[samples.length - 1];
}

export function lerpTl(tl: TimelineTuple[] | null, dt2: number): number | null {
    if (!tl || tl.length < 2) return null;
    for (let i = 0; i < tl.length - 1; i++) {
        const a = tl[i], b = tl[i + 1];
        if (a[0] <= dt2 && b[0] >= dt2) {
            const f = (b[0] - a[0]) > 1e-6 ? (dt2 - a[0]) / (b[0] - a[0]) : 0;
            return a[1] + (b[1] - a[1]) * f;
        }
    }
    return dt2 <= tl[0][0] ? tl[0][1] : tl[tl.length - 1][1];
}

/** 角度版：跨 ±π 时按短弧插值（与客户端 0x1441e00 短弧归一化一致）。 */
export function lerpTlAngle(tl: TimelineTuple[] | null, dt2: number): number | null {
    if (!tl || tl.length < 2) return null;
    for (let i = 0; i < tl.length - 1; i++) {
        const a = tl[i], b = tl[i + 1];
        if (a[0] <= dt2 && b[0] >= dt2) {
            const f = (b[0] - a[0]) > 1e-6 ? (dt2 - a[0]) / (b[0] - a[0]) : 0;
            let d = b[1] - a[1];
            while (d > Math.PI) d -= 2 * Math.PI;
            while (d < -Math.PI) d += 2 * Math.PI;
            return a[1] + d * f;
        }
    }
    return dt2 <= tl[0][0] ? tl[0][1] : tl[tl.length - 1][1];
}
