import * as THREE from 'three'
import { poseFromYPR } from '../glbRig.js'
import { shotResultClass } from '../../utils/shotResultClass.js'
import { shellTypeOf } from './armorPlateModel.js'
import { ANNOTATION_COLORS, cssHex } from './shotResultPalette.js'
import type {
    PoseTickSample, ReplayShot, ShellSpec, TankData, Vec3,
} from './viewerContracts.js'
import type { TurretRigHandle } from './turretRig.js'

export interface ShotReplayPanelCtx {
    s: ReplayShot
    QP: URLSearchParams
    L: { shotView: string; relativeView: string; worldView: string }
    cx: number
    cy: number
    cz: number
    tPos: Vec3
    tankModel: THREE.Object3D
    armorModel: THREE.Object3D | null
    rig: TurretRigHandle
    jc: {
        setShotRay(origin: THREE.Vector3, target: THREE.Vector3): void
        clearShotRay(): void
        doPenetrationCheck(ndcX: number, ndcY: number): void
    }
    getScene(): THREE.Scene
    getCamera(): THREE.PerspectiveCamera
    getControls(): { target: THREE.Vector3; update(): void }
    currentShot(): boolean
    dbgInfo(id: string, color: string, name: string, text: string): void
    fmt3(x: number, y: number, z: number): string
}

export function buildMoveAnnotation(
    ctx: Pick<ShotReplayPanelCtx, 's' | 'tPos' | 'cx' | 'cy' | 'cz' | 'getScene'>,
): void {
    const { s, tPos, cx, cy, cz, getScene } = ctx;
    if (window.__moveAnno) { getScene().remove(window.__moveAnno); }
    const moveAnno = new THREE.Group();
    window.__moveAnno = moveAnno;
    const tksD = s.tick_samples || [];
    const moveDirColor = (i: number): number => {
        if (i <= 0) return 0xffdd33;
        const dx = tksD[i].pos[0]-tksD[i-1].pos[0], dz = tksD[i].pos[2]-tksD[i-1].pos[2];
        if (Math.sqrt(dx*dx + dz*dz) < 0.05) return 0xffdd33;
        let e = Math.abs(Math.atan2(dx, dz) - tksD[i].yaw) % (2*Math.PI);
        if (e > Math.PI) e = 2*Math.PI - e;
        const deg = e*180/Math.PI;
        return deg < 60 ? 0x33ff66 : (deg > 120 ? 0xff6622 : 0xffdd33);
    };
    const setArrowDepthTestOff = (m: THREE.Material | THREE.Material[]): void => {
        (Array.isArray(m) ? m : [m]).forEach(function(mt) { mt.depthTest = false; });
    };
    const mkMoveArrow = (len: number, color: number): THREE.ArrowHelper => {
        const arr = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1),
            new THREE.Vector3(), len, color, 0.55, 0.3);
        setArrowDepthTestOff(arr.line.material);
        setArrowDepthTestOff(arr.cone.material);
        arr.renderOrder = 996;
        return arr;
    };
    const moveArrow = mkMoveArrow(3.0, 0xffdd33);
    const moveVecArrow = mkMoveArrow(2.2, 0x00ccff);
    window.__moveArrow = moveArrow;
    window.__moveVecArrow = moveVecArrow;
    moveAnno.add(moveArrow);
    moveAnno.add(moveVecArrow);
    window.updateMoveArrow = function(idx: number): void {
        if (!tksD[idx]) return;
        const ts = tksD[idx];
        const q = poseFromYPR(ts.yaw, ts.pitch ?? 0, ts.roll);
        const fwd = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
        if (fwd.lengthSq() < 0.01) return;
        fwd.normalize();
        const side = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
        side.y = 0;
        if (side.lengthSq() > 0.01) side.normalize();
        const base = new THREE.Vector3(
            ts.pos[0]+tPos[0]-cx, ts.pos[1]+tPos[1]-cy+0.10, ts.pos[2]+tPos[2]-cz);
        moveArrow.position.copy(base).addScaledVector(side, 0.9);
        moveVecArrow.position.copy(base).addScaledVector(side, -0.9);
        moveArrow.setDirection(fwd);
        moveArrow.setColor(moveDirColor(idx));
        if (idx > 0) {
            const p0 = tksD[idx-1];
            const mv = new THREE.Vector3(
                ts.pos[0]-p0.pos[0], ts.pos[1]-p0.pos[1], ts.pos[2]-p0.pos[2]);
            if (mv.lengthSq() > 0.0025) {
                moveVecArrow.visible = true;
                moveVecArrow.setDirection(mv.normalize());
            } else {
                moveVecArrow.visible = false;
            }
        } else {
            moveVecArrow.visible = false;
        }
    };
    tksD.forEach((ts: PoseTickSample, i: number): void => {
        if (i === 0) return;
        const p0 = tksD[i-1];
        const geo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(p0.pos[0]+tPos[0]-cx, p0.pos[1]+tPos[1]-cy+0.10, p0.pos[2]+tPos[2]-cz),
            new THREE.Vector3(ts.pos[0]+tPos[0]-cx, ts.pos[1]+tPos[1]-cy+0.10, ts.pos[2]+tPos[2]-cz),
        ]);
        const ln = new THREE.Line(geo, new THREE.LineBasicMaterial({
            color: 0x00ccff, depthTest: false, transparent: true, opacity: 0.9 }));
        ln.renderOrder = 995;
        moveAnno.add(ln);
        const dx = ts.pos[0]-p0.pos[0], dz = ts.pos[2]-p0.pos[2];
        if (Math.sqrt(dx*dx + dz*dz) >= 0.05) {
            const dd = Math.sqrt(dx*dx + dz*dz);
            const v = dd/Math.max(1e-3, (ts.dt ?? 0) - (p0.dt ?? 0));
            const mvAz = Math.atan2(dx, dz);
            let e = Math.abs(mvAz - ts.yaw) % (2*Math.PI);
            if (e > Math.PI) e = 2*Math.PI - e;
            e = e*180/Math.PI;
            console.log('[move] dt=%+f yaw=%s° move=%s° err=%s° v=%sm/s %s',
                (ts.dt ?? 0).toFixed(3), (ts.yaw*180/Math.PI).toFixed(1),
                (mvAz*180/Math.PI).toFixed(1), e.toFixed(1), v.toFixed(1),
                e < 60 ? '前进' : (e > 120 ? '倒车' : '转向'));
        } else {
            console.log('[move] dt=%+f yaw=%s° pivot/静止',
                (ts.dt ?? 0).toFixed(3), (ts.yaw*180/Math.PI).toFixed(1));
        }
    });
    window.updateMoveArrow(tksD.length - 1);
    getScene().add(moveAnno);
    {
        const errs: number[] = [];
        for (let i = 1; i < tksD.length; i++) {
            const dx = tksD[i].pos[0]-tksD[i-1].pos[0], dz = tksD[i].pos[2]-tksD[i-1].pos[2];
            if (Math.sqrt(dx*dx + dz*dz) < 0.05) continue;
            let e = Math.abs(Math.atan2(dx, dz) - tksD[i].yaw) % (2*Math.PI);
            if (e > Math.PI) e = 2*Math.PI - e;
            errs.push(e*180/Math.PI);
        }
        errs.sort((a,b)=>a-b);
        const el = document.getElementById('move-err');
        if (el) el.textContent = errs.length
            ? '位移vs朝向: 中位' + errs[errs.length>>1].toFixed(1) + '° 最大' + errs[errs.length-1].toFixed(1) + '° (' + errs.length + '段)'
            : '';
    }
}

export function autoSelectReplayShell(
    ctx: Pick<ShotReplayPanelCtx, 's' | 'QP'> & {
        getShooterShells(): ShellSpec[]
        getShooterData(): TankData | null
        setSelectedShell(shell: ShellSpec): void
        getSelectedShell(): ShellSpec | null
        getPenetrationMode(): boolean
        hm: {
            getPrimaryArmorScene(): THREE.Object3D | null
            updatePenetrationUniforms(shell: ShellSpec | null): void
            updateSpacedUniforms(shell: ShellSpec | null): void
            syncHeatOverlay(): void
        }
    },
): void {
    const { s, QP, hm } = ctx;
    window.__worldShellSlot = (typeof s.shell_slot === 'number') ? s.shell_slot : null;
    window.__worldIsHE = !!((s.hit_flags || 0) & 0x1000);
    window.__worldShellId = (typeof s.shell_id === 'number' && s.shell_id) ? s.shell_id : null;
    {
        const sel = document.getElementById('shell-select') as HTMLSelectElement | null;
        let want = -1;
        if (window.__worldIsHE) {
            want = (ctx.getShooterShells() || []).findIndex(sh =>
                shellTypeOf(sh) === 'he' || (sh && (sh.explosion_radius || 0) > 0));
        }
        if (want < 0 && window.__worldShellId) {
            const shooterData = ctx.getShooterData();
            const cfgArr = (shooterData && shooterData.configs) || null;
            const scfg = parseInt(QP.get('scfg') || '', 10);
            const tryGids = (gids: number[] | null): void => {
                if (!gids || want >= 0) return;
                const shellGlobalId = window.__worldShellId;
                if (shellGlobalId == null) return;
                const gi = gids.indexOf(shellGlobalId);
                if (gi >= 0) want = gi;
            };
            if (!isNaN(scfg) && cfgArr && cfgArr[scfg]) {
                tryGids(cfgArr[scfg].shell_global_ids || null);
            }
            if (cfgArr) {
                for (let ci = cfgArr.length - 1; ci >= 0 && !(want >= 0); ci--) {
                    tryGids(cfgArr[ci].shell_global_ids || null);
                }
            }
        }
        if (want < 0 && window.__worldShellId == null) {
            want = window.__worldShellSlot ?? -1;
        }
        const pickedShell = ctx.getShooterShells()[want];
        if (sel && pickedShell && want >= 0 && want < sel.options.length) {
            sel.value = String(want);
            ctx.setSelectedShell(pickedShell);
            if (ctx.getPenetrationMode() || hm.getPrimaryArmorScene()) {
                hm.updatePenetrationUniforms(ctx.getSelectedShell());
                hm.updateSpacedUniforms(ctx.getSelectedShell());
            }
            hm.syncHeatOverlay();
        }
    }
}

export function buildWorldPanelHtml(
    ctx: Pick<ShotReplayPanelCtx, 's'> & {
        shotErrorHtml(): string
        eqBadge(equipment: unknown): string
        shellIdParts(gid: number): { local: number; nation: number } | null
        decodeModules(mask: number): string[]
        srQualityIssues(shot: ReplayShot): string[]
        sTS: PoseTickSample[]
    },
): string {
    const { s } = ctx;
    const cls2 = shotResultClass(s) === 'MISS' ? 'MISS'
        : (shotResultClass(s) === 'RICOCHET') ? 'RICO'
        : (shotResultClass(s) === 'PENETRATION') ? 'PEN'
        : (shotResultClass(s) === 'HE BLAST') ? 'HE'
        : (shotResultClass(s) === 'UNVERIFIED') ? 'R4?'
        : (shotResultClass(s) === 'NO PENETRATION') ? 'NOPEN' : 'HIT';
    const qIssues = ctx.srQualityIssues(s);
    const tksW = s.tick_samples || [];
    return ctx.shotErrorHtml() + '<div class="ctrl-row"><b>World View — Shot #' + s.index + '</b></div>' +
        (function() {
            const t4 = s.is_author ? '作者' : (s.shooter_team === 'enemy' ? '敌方' : (s.shooter_team === 'ally' ? '我方' : ''));
            return '<div class="ctrl-row">Shooter: <b style="color:var(--yellow);">' + (s.shooter_name || '—') + '</b>' + (t4 ? ' · ' + t4 : '') + '</div>' +
                '<div class="ctrl-row" style="font-size:10px;">搭载: 射手 ' + ctx.eqBadge(s.shooter_equipment) +
                (s.target_equipment || s.game_hit_result !== undefined ? ' · 目标 ' + ctx.eqBadge(s.target_equipment) : '') + '</div>';
        })() +
        '<div class="ctrl-row">DMG ' + s.damage + ' · ' + cls2 + ' · ' + (s.target_name || '—') + '</div>' +
        (function() {
            if (s.shell_id == null) return '';
            const sp3 = ctx.shellIdParts(s.shell_id);
            if (!sp3) return '';
            return '<div class="ctrl-row" style="font-size:10px;color:var(--blue);">弹种: shell_id=' + s.shell_id +
                ' (局部' + sp3.local + ' · 国家0x' + sp3.nation.toString(16) + ')' +
                (s.shell_kind ? ' · <b>' + s.shell_kind + '</b>' : '') +
                (s.shell && s.shell.penetration ? ' · ' + Math.round(s.shell.penetration) + 'mm/' + Math.round(s.shell.damage || 0) + 'dmg（弹种反解表）' : '') +
                ((s.quality && s.quality.shell_from_broadcast) ? ' · 来源0x07广播' : '') +
                ((s.quality && s.quality.shell_from_terrain) ? ' · 来源0x1b广播' : '') +
                (s.segment ? ' · 装甲组=' + (s.armor_group || '—') : '') + '</div>';
        })() +
        (function() {
            const cr3 = ctx.decodeModules(s.crit_modules || 0);
            const ds3 = ctx.decodeModules(s.destroyed_modules || 0);
            if (!cr3.length && !ds3.length) return '';
            return '<div class="ctrl-row" style="font-size:10px;color:var(--yellow);">模块: ' +
                cr3.concat(ds3.map(n3 => n3 + '(摧毁)')).join(' · ') + '</div>';
        })() +
        (s.shooter_aim ? '<div class="ctrl-row" style="font-size:10px;color:var(--muted);">瞄准: 炮塔偏航 ' +
            s.shooter_aim.turret_rel_yaw.toFixed(4) + ' rad' +
            (typeof s.shooter_aim.state_before === 'number'
                ? ' · 状态 ' + s.shooter_aim.state_before.toFixed(3) + '→' +
                  (s.shooter_aim.state_after != null ? s.shooter_aim.state_after.toFixed(3) : '—')
                : '') + '</div>' : '') +
        (s.server_part_index != null ? '<div class="ctrl-row" style="font-size:10px;color:var(--orange);">服务器部件: ' +
            s.server_part_index + '（0=底盘/履带 1=车体 2=炮塔 3=炮管）· 弹着点已按部件约束</div>' : '') +
        (s.target_render ? '<div class="ctrl-row" style="font-size:10px;color:var(--blue);">渲染锚点(游戏画面): 滞后 ' +
            s.target_render.latency.toFixed(3) + 's · 渲染-判定偏差 ' +
            s.target_render.dist_to_judgment.toFixed(2) + 'm</div>' : '') +
        (function() {
            const tlDt = (s.target_render_timeline || []).map(t => t.dt ?? NaN);
            const sTlDt = (s.shooter_render_timeline || []).map(t => t.dt ?? NaN);
            const allDt: number[] = ([] as number[]).concat(
                tksW.filter(t => !t.render).map(t => t.dt ?? NaN),
                ctx.sTS.filter(t => !t.render).map(t => t.dt ?? NaN),
                tlDt, sTlDt
            ).filter((d): d is number => !isNaN(d));
            if (allDt.length < 2) return '';
            const tMin = Math.min(...allDt);
            const tMax = Math.max(...allDt);
            if (tMax - tMin < 0.1) return '';
            return '<div class="ctrl-row" style="margin-top:6px;gap:6px;">'
                + '<span style="font-size:10px;color:var(--scrub);flex:none;">⏱</span>'
                + '<input type="range" id="time-scrub" min="' + (tMin*1000).toFixed(0) + '" max="' + (tMax*1000).toFixed(0) + '" value="0" step="10"'
                + ' style="flex:1;min-width:0;accent-color:var(--scrub);">'
                + '<span id="time-scrub-label" style="font-size:10px;color:var(--scrub);flex:none;min-width:50px;text-align:right;"></span>'
                + '</div>';
        })() +
        (qIssues.length ? '<div class="ctrl-row" style="font-size:10px;color:var(--yellow);">⚠ '
            + qIssues.join(' · ') + '</div>' : '') +
        '<div class="ctrl-row" style="font-size:10px;color:var(--muted);">' +
        '<span style="color:' + cssHex(ANNOTATION_COLORS.launch) + ';">●</span> LaunchPoint <span style="color:' + cssHex(ANNOTATION_COLORS.velocity) + ';">┄</span> 速度向量 ' +
        '<span style="color:' + cssHex(ANNOTATION_COLORS.chord) + ';">—</span> 弹道弦 <span style="color:' + cssHex(ANNOTATION_COLORS.impact) + ';">●</span> 弹着点 ' +
        '<span style="color:' + cssHex(ANNOTATION_COLORS.endpoint) + ';">●</span> 服务器终点 ' +
        '<span style="color:' + cssHex(ANNOTATION_COLORS.breech) + ';">●</span> 炮闩(发射起点) <span style="color:' + cssHex(ANNOTATION_COLORS.deviation) + ';">┄</span> 偏差线</div>' +
        '<div class="ctrl-row" style="font-size:10px;color:var(--muted);">' +
        '<span style="color:' + cssHex(ANNOTATION_COLORS.trackHeading) + ';">↑</span>履带朝向 <span style="color:' + cssHex(ANNOTATION_COLORS.velocity) + ';">↑</span>位移方向 ' +
        '<span style="color:' + cssHex(ANNOTATION_COLORS.launch) + ';">↑</span>倒车(橙) <span style="color:' + cssHex(ANNOTATION_COLORS.turn) + ';">↑</span>转向(黄) ' +
        '<span style="color:' + cssHex(ANNOTATION_COLORS.velocity) + ';">—</span>tick路径(3D)</div>' +
        '<div class="ctrl-row" style="font-size:10px;color:var(--muted);">' +
        '<span style="color:' + cssHex(ANNOTATION_COLORS.victimAnchor) + ';">●</span>基准点·受击(type10锚) ' +
        '<span style="color:' + cssHex(ANNOTATION_COLORS.shooterAnchor) + ';">●</span>基准点·射手(type10锚)</div>' +
        '<div class="ctrl-row"><label style="font-size:11px;cursor:pointer;">' +
        '<input type="checkbox" id="move-toggle" checked> 移动方向标注</label>' +
        '<span id="move-err" style="font-size:10px;color:var(--blue);margin-left:8px;"></span></div>';
}

export function installViewSwitch(
    ctx: Pick<ShotReplayPanelCtx, 'QP' | 'L' | 'tankModel' | 'armorModel' | 'getCamera' | 'getControls'> & {
        setWorldOverviewMode(on: boolean): void
    },
): void {
    const { L, tankModel, armorModel, getCamera, getControls } = ctx;
    let impactViewOn = false;
    let savedOverview: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
    const viewSwitch = document.createElement('div');
    viewSwitch.className = 'armor-shot-view-switch';
    viewSwitch.setAttribute('role', 'group');
    viewSwitch.setAttribute('aria-label', L.shotView);
    const relBtn = document.createElement('button');
    relBtn.id = 'rel-view-toggle';
    relBtn.textContent = L.relativeView;
    relBtn.type = 'button';
    relBtn.className = 'armor-scene-button';
    const worldBtn = document.createElement('button');
    worldBtn.id = 'world-view-toggle';
    worldBtn.textContent = L.worldView;
    worldBtn.type = 'button';
    worldBtn.className = 'armor-scene-button';
    function setImpactView(on: boolean): void {
        if (on === impactViewOn) return;
        if (on) {
            const ctx2 = window.__worldTickCtx;
            if (!ctx2?.launch || !ctx2.lvDir || !armorModel || !tankModel) return;
            savedOverview = { pos: getCamera().position.clone(), target: getControls().target.clone() };
            const dir = ctx2.lvDir.clone().normalize();
            let aim = tankModel.position.clone();
            const rc = new THREE.Raycaster(ctx2.launch.clone(), dir);
            rc.far = ctx2.rayFar;
            const hits = rc.intersectObject(armorModel, true)
                .filter(h => h.object.userData.armorSection !== 'deco');
            if (hits.length) aim = hits[0].point.clone();
            getCamera().position.copy(aim.clone().addScaledVector(dir, -15));
            getControls().target.copy(aim);
        } else if (savedOverview) {
            getCamera().position.copy(savedOverview.pos);
            getControls().target.copy(savedOverview.target);
        }
        ctx.setWorldOverviewMode(!on);
        getControls().update();
        impactViewOn = on;
        relBtn.setAttribute('aria-pressed', String(on));
        worldBtn.setAttribute('aria-pressed', String(!on));
    }
    relBtn.setAttribute('aria-pressed', 'false');
    worldBtn.setAttribute('aria-pressed', 'true');
    relBtn.disabled = !window.__shotIsHit || !window.__worldTickCtx?.launch || !window.__worldTickCtx?.lvDir;
    relBtn.onclick = () => setImpactView(true);
    worldBtn.onclick = () => setImpactView(false);
    viewSwitch.append(relBtn, worldBtn);
    (document.getElementById('corner-br') || document.body).appendChild(viewSwitch);
    if (window.__shotIsHit) setImpactView(true);
    else setImpactView(false);
}

export function installMoveToggle(): void {
    const mt2 = document.getElementById('move-toggle') as HTMLInputElement | null;
    if (mt2) mt2.onchange = function() {
        const anno = window.__moveAnno;
        if (anno) anno.visible = mt2.checked;
    };
}
