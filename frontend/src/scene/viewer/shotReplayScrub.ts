import * as THREE from 'three'
import { poseFromYPR } from '../glbRig.js'
import { interpTick, lerpTl, lerpTlAngle } from './shotReplayInterp.js'
import { poseShooterTurretGun } from './shotReplayPose.js'
import type { ShotReplayPanelCtx } from './shotReplayPanel.js'

export function installTimeScrubHandler(ctx: ShotReplayPanelCtx): void {
    const { s, cx, cy, cz, tPos, tankModel, armorModel, rig, jc, dbgInfo, fmt3, currentShot } = ctx;
    const timeSlider = document.getElementById('time-scrub') as
        (HTMLInputElement & { __penTimer?: ReturnType<typeof setTimeout> | null }) | null;
    if (!timeSlider) return;
    const rSample = (s.tick_samples || []).find(function(t) { return t.render; });
    let vRaw = (s.tick_samples || []).filter(function(t) {
        return !t.render && (t.dt ?? NaN) <= 0.001 && Math.abs(t.dt ?? NaN) > 0.025; });
    if (rSample) {
        vRaw.push({ dt: rSample.dt, pos: rSample.pos, yaw: rSample.yaw,
            pitch: rSample.pitch, roll: rSample.roll, render: true });
        vRaw.sort(function(a, b) { return (a.dt ?? 0) - (b.dt ?? 0); });
    }
    const sRaw = (s.shooter_tick_samples || []).filter(function(t) { return !t.render; });
    const tlT = (s.target_render_timeline && s.target_render_timeline.length > 1) ? s.target_render_timeline : null;
    const tlS = (s.shooter_render_timeline && s.shooter_render_timeline.length > 1) ? s.shooter_render_timeline : null;
    if (tlT) for (const t of tlT) t[1] = -t[1];
    if (tlS) for (const t of tlS) t[1] = -t[1];
    timeSlider.oninput = function() {
        const dt = parseInt(timeSlider.value, 10) / 1000;
        const lbl = document.getElementById('time-scrub-label');
        if (lbl) lbl.textContent = (dt >= 0 ? '+' : '') + dt.toFixed(2) + 's';
        const inCovT = !tlT || (dt >= (tlT[0].dt ?? 0) - 0.001
            && dt <= (tlT[tlT.length - 1].dt ?? 0) + 0.001);
        const inCovS = !tlS || (dt >= (tlS[0].dt ?? 0) - 0.001
            && dt <= (tlS[tlS.length - 1].dt ?? 0) + 0.001);
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
        const sInt = interpTick(tlS ? tlS : sRaw, dt);
        if (sInt && window.__shooterModel) {
            window.__shooterModel.position.set(
                sInt.pos[0] - cx, sInt.pos[1] - cy, sInt.pos[2] - cz);
            window.__shooterModel.quaternion.copy(poseFromYPR(sInt.yaw, sInt.pitch, sInt.roll));
            window.__shooterModel.updateMatrixWorld(true);
        }
        const relT = lerpTlAngle(s.target_turret_timeline ?? null, dt);
        if (relT != null) {
            let deg = -relT * 180 / Math.PI;
            deg = ((deg + 180) % 360 + 360) % 360 - 180;
            const gpT = lerpTl(s.target_gun_timeline ?? null, dt);
            rig.updateTurretGun(deg, gpT != null ? gpT * 180 / Math.PI
                : (window.__fireGunDegT != null ? window.__fireGunDegT : 0));
        }
        const relS = lerpTlAngle(s.shooter_turret_timeline ?? null, dt);
        if (sInt && window.__shooterModel && window.__shooterData) {
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
        if (window.__worldTickCtx && window.__worldImpactMk && armorModel && window.__worldTickCtx.lvDir) {
            if (window.__worldSegMk && window.__worldSegMk.p1) {
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
        if (window.__worldSegMk && armorModel) {
            armorModel.updateWorldMatrix(true, false);
            window.__worldSegMk.update(!!window.__debugOn && inCovT);
        }
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
