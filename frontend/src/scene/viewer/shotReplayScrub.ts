// 射击复现（world 模式）连续时间滑块（自 runShotReplay 闭包原样平移）：
// 滤波时间线/原始采样插值、炮塔炮管实时驱动、弹着点重算与弦判定节流重跑。
// 闭包依赖经 ctx 注入；数值行为与插值约定不变。
import * as THREE from 'three'
import { poseFromYPR } from '../glbRig.js'
import { interpTick, lerpTl, lerpTlAngle } from './shotReplayInterp.js'
import { poseShooterTurretGun } from './shotReplayPose.js'
import type { ShotReplayPanelCtx } from './shotReplayPanel.js'

/** ===== 时间滑块：连续插值双模型位置/姿态（报告 §4.7 渲染层锚点可视化）===== */
export function installTimeScrubHandler(ctx: ShotReplayPanelCtx): void {
    const { s, cx, cy, cz, tPos, tankModel, armorModel, rig, jc, dbgInfo, fmt3, currentShot } = ctx;
    const timeSlider = document.getElementById('time-scrub') as
        (HTMLInputElement & { __penTimer?: ReturnType<typeof setTimeout> | null }) | null;
    if (!timeSlider) return;
    // 滑块 0 点 = 渲染位（玩家所见）：存在渲染位采样时，用它替换
    // dt≈0 的原始锚点采样作为插值关键帧——否则拖动滑块回 0 会回到
    // 判定层锚点位姿，与初始的渲染位姿相差一个滤波滞后位移。
    const rSample = (s.tick_samples || []).find(function(t) { return t.render; });
    // 剔除命中后（dt>0）的兜底采样：数据包源切换致瞬移/朝向跳变
    //（96 段实测 40 段反转），混入滑块末端 keyframe 会产生翻转行为
    let vRaw = (s.tick_samples || []).filter(function(t) {
        return !t.render && (t.dt ?? NaN) <= 0.001 && Math.abs(t.dt ?? NaN) > 0.025; });
    if (rSample) {
        vRaw.push({ dt: rSample.dt, pos: rSample.pos, yaw: rSample.yaw,
            pitch: rSample.pitch, roll: rSample.roll, render: true });
        vRaw.sort(function(a, b) { return (a.dt ?? 0) - (b.dt ?? 0); });
    }
    const sRaw = (s.shooter_tick_samples || []).filter(function(t) { return !t.render; });
    // 滤波时间线（渲染层严格对齐数据源）；null = 无时间线（回退原始采样）
    const tlT = (s.target_render_timeline && s.target_render_timeline.length > 1) ? s.target_render_timeline : null;
    const tlS = (s.shooter_render_timeline && s.shooter_render_timeline.length > 1) ? s.shooter_render_timeline : null;
    // 炮塔相对角：镜像系下取反（相对角 = 炮塔世界角 − 车体角，镜像时两者同时
    // 取反 → 相对角取反；直接透传会导致炮管指向镜像侧 = 方向反转 180°）
    if (tlT) for (const t of tlT) t[1] = -t[1];
    if (tlS) for (const t of tlS) t[1] = -t[1];
    // 炮塔相对角时间线：镜像系下需取反（车体/炮塔世界 yaw 在镜像系同时翻转，
    // 相对角 = −原始值；直接透传会导致炮管指向镜像侧 = 方向反转）
    timeSlider.oninput = function() {
        const dt = parseInt(timeSlider.value, 10) / 1000;
        const lbl = document.getElementById('time-scrub-label');
        if (lbl) lbl.textContent = (dt >= 0 ? '+' : '') + dt.toFixed(2) + 's';
        // 覆盖检查：滤波时间线未覆盖的时段 = 该实体在录像客户端无 volatile
        // 数据（AoI 外不渲染）——滑块拖入该区间时隐藏模型与附属标记
        const inCovT = !tlT || (dt >= (tlT[0].dt ?? 0) - 0.001
            && dt <= (tlT[tlT.length - 1].dt ?? 0) + 0.001);
        const inCovS = !tlS || (dt >= (tlS[0].dt ?? 0) - 0.001
            && dt <= (tlS[tlS.length - 1].dt ?? 0) + 0.001);
        // 插值受击方：优先滤波时间线（严格对齐游戏每帧实际显示位姿——
        // 含 latency 移位/误差盒钳位/外推，逆向报告六轮），回退原始采样线性插值。
        // 时间线 pos = 绝对世界坐标；原始采样 pos = 相对锚点（需 +tPos）
        const useTlT = !!tlT;
        const vInt = interpTick(useTlT ? tlT : vRaw, dt);
        if (vInt && tankModel) {
            const wp = useTlT
                ? [vInt.pos[0] - cx, vInt.pos[1] - cy, vInt.pos[2] - cz]
                : [vInt.pos[0] + tPos[0] - cx, vInt.pos[1] + tPos[1] - cy, vInt.pos[2] + tPos[2] - cz];
            tankModel.position.set(wp[0], wp[1], wp[2]);
            tankModel.quaternion.copy(poseFromYPR(vInt.yaw, vInt.pitch, vInt.roll));
            tankModel.updateMatrixWorld(true);
            if (armorModel) {
                armorModel.position.copy(tankModel.position);
                armorModel.quaternion.copy(tankModel.quaternion);
                armorModel.updateMatrixWorld(true);
            }
            tankModel.visible = inCovT;
            if (armorModel) armorModel.visible = inCovT;
        }
        // 插值射手方：优先滤波时间线（同受击方）。
        // 时间线/原始采样的 pos 均为绝对世界坐标——放置逻辑完全同构
        const sInt = interpTick(tlS ? tlS : sRaw, dt);
        if (sInt && window.__shooterModel) {
            window.__shooterModel.position.set(
                sInt.pos[0] - cx, sInt.pos[1] - cy, sInt.pos[2] - cz);
            window.__shooterModel.quaternion.copy(poseFromYPR(sInt.yaw, sInt.pitch, sInt.roll));
            window.__shooterModel.updateMatrixWorld(true);
        }
        // 炮塔/炮管实时：prop2（炮塔相对角）与 prop9（俯仰）时间线插值（shotReplayInterp）
        // 受击方炮塔实时：prop2 相对角直接驱动炮塔/炮管节点。
        // 时间线存游戏系相对角；镜像场景节点旋转角须取负（镜像翻转
        // 旋转方向）——与初始摆放一致：turretDegT = 镜像炮塔角−镜像车体角 = −rel
        // 炮管俯仰：target_gun_timeline（prop2 frac 解码，弧度）插值，
        // 缺时间线时回落命中时刻静态值 __fireGunDegT
        const relT = lerpTlAngle(s.target_turret_timeline ?? null, dt);
        if (relT != null) {
            let deg = -relT * 180 / Math.PI;
            deg = ((deg + 180) % 360 + 360) % 360 - 180;
            const gpT = lerpTl(s.target_gun_timeline ?? null, dt);
            rig.updateTurretGun(deg, gpT != null ? gpT * 180 / Math.PI
                : (window.__fireGunDegT != null ? window.__fireGunDegT : 0));
        }
        // 射手方炮塔实时：炮塔世界角 = 车体 yaw − prop2 相对角
        //（内部 tr = 炮塔角−车体角 = −rel，同初始摆放的镜像系约定）
        const relS = lerpTlAngle(s.shooter_turret_timeline ?? null, dt);
        if (sInt && window.__shooterModel && window.__shooterData) {
            // 射手炮塔实时：用射手自身的车体位姿（sInt），非受击方的 vInt
            // 炮管相对俯仰：shooter_gun_timeline（prop2 frac 解码）插值——
            // 与受击方同源同锚定（车体俯仰由 sInt.pitch 时序承载，
            // 两者是不同自由度）。无时间线（无锚定/回退）时传 null →
            // 弹速反解（method29 弹速仅开火帧存在，窗口内恒定保持）。
            const gpS = (s.quality && s.quality.gun_pitch_degraded &&
                s.quality.gun_pitch_degraded.indexOf('shooter') >= 0)
                ? null : lerpTl(s.shooter_gun_timeline ?? null, dt);
            poseShooterTurretGun(window.__shooterModel, window.__shooterData,
                sInt.yaw - (relS || 0), s.launch_velocity, sInt.yaw, sInt.pitch ?? 0, sInt.roll,
                gpS != null ? gpS : null, -(relS || 0), s.shooter_config_idx);
        }
        if (window.__updateMuzzleMarker) window.__updateMuzzleMarker();
        if (window.__updateAnchorMarkers) window.__updateAnchorMarkers();
        if (window.__victimAnchor) window.__victimAnchor.mk.visible = inCovT && !!window.__debugOn;
        if (window.__shooterAnchor) window.__shooterAnchor.mk.visible = inCovS && !!window.__debugOn;
        if (window.__shooterMuzzleMk) window.__shooterMuzzleMk.visible = inCovS && !!window.__debugOn;
        if (window.__shooterMuzzleLine) window.__shooterMuzzleLine.visible = inCovS && !!window.__debugOn;
        if (window.__updateMuzzleMarker) window.__updateMuzzleMarker();
        if (window.__updateAnchorMarkers) window.__updateAnchorMarkers();
        // 弹着点红点随当前位姿重算（部件约束与初始摆放一致）
        if (window.__worldTickCtx && window.__worldImpactMk && armorModel && window.__worldTickCtx.lvDir) {
            if (window.__worldSegMk && window.__worldSegMk.p1) {
                // 判定基准 = WI 同构射线（§七补7；update 内随位姿重建
                // 射线并重求交），红点贴射线入点（无交点回退解码点）
                window.__worldSegMk.update(!!window.__debugOn && inCovT);
                const showSeg = !!window.__debugOn && !!inCovT;
                window.__worldImpactMk.visible = showSeg;
                const hitPt = window.__worldSegMk.p1.position;
                window.__worldImpactMk.position.copy(hitPt);
                if (showSeg) {
                    dbgInfo('dbg-impact', '#ff2222', '弹着点',
                        fmt3(hitPt.x + cx, hitPt.y + cy, hitPt.z + cz)
                        + ' · DecodeShotSegment P1'
                        + (typeof s.server_part_index === 'number' ? ' · 部件P' + s.server_part_index : ''));
                }
            } else {
            const wc = window.__worldTickCtx;
            if (!wc?.launch || !wc.lvDir) return;
            const rc2 = new THREE.Raycaster();
            rc2.set(wc.launch.clone(), wc.lvDir);
            rc2.far = wc.rayFar;
            const sPart = (typeof s.server_part_index === 'number') ? s.server_part_index : null;
            const partOf = (o: THREE.Object3D): number => { const u = o.userData || {}; const sec = u.armorSectionOrig || u.armorSection;
                return sec === 'chassis' ? 0 : sec === 'hull' ? 1 : (sec === 'turret' || sec === 'gun') ? 2 : sec === 'gunBarrel' ? 3 : -1; };
            let iHits = rc2.intersectObject(armorModel, true)
                .filter(h => h.object.userData.armorSection !== 'deco');
            if (sPart != null) {
                const inPart = iHits.filter(h => partOf(h.object) === sPart);
                if (inPart.length) iHits = inPart;
            }
            const show = iHits.length > 0 && !!window.__debugOn && inCovT;
            window.__worldImpactMk.visible = show;
            if (show) {
                window.__worldImpactMk.position.copy(iHits[0].point);
                dbgInfo('dbg-impact', '#ff2222', '弹着点',
                    fmt3(iHits[0].point.x + cx, iHits[0].point.y + cy, iHits[0].point.z + cz)
                    + (sPart != null && iHits.some(h => partOf(h.object) === sPart) ? ' · 部件P' + sPart : ''));
            } else {
                dbgInfo('dbg-impact', '#ff2222', '弹着点', '（射线无交点）');
            }
            }
        }
        // DecodeShotSegment P1/P2 随位姿重摆（炮塔/炮管部件跟随旋转）
        if (window.__worldSegMk && armorModel) {
            armorModel.updateWorldMatrix(true, false);
            window.__worldSegMk.update(!!window.__debugOn && inCovT);
        }
        // 弦判定实时重跑（节流尾随 100ms）：滑块连续拖动时模型位姿每刻
        // 不同，判定/弹道/对比面板若不跟随重算就停留在上次的结果，
        // 与弹着点红点（上方 raycast）不一致。射线参数 = ctx 的
        // （launch + 弦向量），判定经 doPenetrationCheck → /api/penetrate，
        // 过期响应由 __penCheckSeq 丢弃，上屏结果恒对应当前位姿。
        if (window.__worldTickCtx && window.__worldTickCtx.lvDir && window.__worldPenMode) {
            if (timeSlider.__penTimer) clearTimeout(timeSlider.__penTimer);
            timeSlider.__penTimer = setTimeout(function() {
                timeSlider.__penTimer = null;
                if (!currentShot()) return;
                const wc2 = window.__worldTickCtx;
                if (!wc2 || !wc2.launch || !wc2.lvDir || !armorModel) return;
                jc.setShotRay(wc2.launch.clone(), wc2.launch.clone().addScaledVector(wc2.lvDir, wc2.rayFar));
                jc.doPenetrationCheck(0, 0);
                jc.clearShotRay();
            }, 100);
        }
    };
}
