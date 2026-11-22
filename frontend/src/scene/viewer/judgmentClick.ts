import * as THREE from 'three'
import { isClippedModuleHit } from '../armorCollisionPack.js'
import { chooseResultCardPosition, type ResultCardRect } from './resultCardPosition.js'
import type { JudgmentDeps } from './judgment.js'
import type { JudgmentHit } from './judgmentHits.js'

export function createJudgmentClick(deps: JudgmentDeps, classifyHit: (hit: THREE.Intersection, rayDir?: THREE.Vector3 | null) => JudgmentHit | null,
  faceAngleAndEffective: (thickness: number, normal: THREE.Vector3, rayDir: THREE.Vector3) => { angleDeg: number | null; effective: number | null },
  doPenetrationCheck: (x: number, y: number) => void) {
  const { models, getRenderer, getCollisionMode, tc, getRaycaster, getCamera, getModuleMeshes, hm, cvs, L } = deps
    // 普通检视最后一次点击的 NDC：切弹种时重跑判定，避免球/热力图用新弹参数
    // 而结果卡仍是旧弹（评审 P2 切 HE 弹种场景）。
    let lastClickNdc: { x: number; y: number } | null = null;
    // 最近一次点击的视口坐标：点选卡跟随点击位置（判定完成后再定位，用点击时的坐标而非结果到达时的鼠标位置）
    let lastClickClient: { x: number; y: number } | null = null;

function onClick(event: MouseEvent): void {
            if (!models.armorModel) return;
            lastClickClient = { x: event.clientX, y: event.clientY };
            // 世界模式(射击复现)：判定结果锁定——初始判定射线已切换为 DecodeShotSegment
            // 基准（P1 位置 + P1→P2 弹向），点击不重跑判定，始终显示该初始结果
            if (window.__worldPenMode) return;
            const rect = getRenderer().domElement.getBoundingClientRect();
            const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            // 装甲厚度（碰撞）模式（2026-10-28 用户裁定）：不做击穿判定，只显示点击位置
            // 命中的装甲/模块信息（BlitzKit armor inspector 同语义）。
            if (getCollisionMode()) { showArmorPartInfo(event, ndcX, ndcY); return; }
            lastClickNdc = { x: ndcX, y: ndcY };
            doPenetrationCheck(ndcX, ndcY);
        }

/** 点选卡（#click-info）写入：五行读数。数值语义按调用方定：
 *  - 厚度模式：基础装甲/入射角/等效装甲是**几何量**（不含转正），穿深/结果保持 '—'
 *    ——该模式不做击穿判定，不猜；
 *  - 判定模式：全部取判定首层（含转正后的等效与剩余穿深），与判定卡同源。 */
function writeClickInfo(fields: {
    part: string
    armor: number | null
    angle: number | null
    effective: number | null
    pen: number | null
    result: string
    resultClass?: string
}): void {
    const set = (id: string, text: string): void => {
        const el = document.getElementById(id)
        if (el) el.textContent = text
    }
    const mm = (v: number | null): string => (v != null && Number.isFinite(v) ? `${Math.round(v * 100) / 100} mm` : '—')
    const deg = (v: number | null): string => (v != null && Number.isFinite(v) ? `${Math.round(v * 10) / 10}°` : '—')
    set('click-part', fields.part)
    set('click-armor', mm(fields.armor))
    set('click-angle', deg(fields.angle))
    set('click-effective', mm(fields.effective))
    set('click-pen', mm(fields.pen))
    set('click-result', fields.result)
    const result = document.getElementById('click-result')
    if (result) result.className = fields.resultClass ?? ''
}

/** 厚度模式点选卡定位：跟随点击位置（相对场景容器），并**避让固定 HUD 面板**。
 *
 *  小视口（手机横屏 600×320 等）下四角都被面板占着：左上胶囊（返回/信息/参数）、
 *  右下射击卡（#corner-tr）、左下姿态卡（#turret-controls）。候选位与排序由共享纯函数
 *  `chooseResultCardPosition` 决定（判定结果卡 #traj-info 用同一套几何语义）。
 *  判定模式不再写这张五行卡（2026-11-15 用户裁示：单结果窗口 = 逐层结果卡）。 */
function placeClickInfo(clientX: number, clientY: number): void {
    const card = document.getElementById('click-info')
    if (!card) return
    // 参考系必须与 CSS 定位祖先一致：卡片是 absolute，left/top 相对 offsetParent；
    // 用 offsetParent 的 rect 换算，避免 canvas 容器的 padding/偏移带入误差。
    const anchor = (card.offsetParent as HTMLElement | null) ?? card.parentElement
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const gap = 14
    const pad = 8
    card.style.display = 'flex'
    const w = card.offsetWidth
    const h = card.offsetHeight
    // 固定 HUD 面板（与 browser-armor-mobile 的门禁口径一致）：
    // #corner-tl = 左上信息胶囊（车名/参数入口），.armor-back = 返回键，
    // #corner-tr = 右下射击卡，#turret-controls = 左下姿态卡。漏掉 #corner-tl 会让
    // 靠近左上的点击把点选卡压到车名与参数入口上（评审 P2 反例：600×320 点击 (100,5)）。
    const panels: ResultCardRect[] = []
    for (const selector of ['#corner-tl', '#corner-tr', '#turret-controls', '.armor-back']) {
        const el = document.querySelector(selector) as HTMLElement | null
        if (!el) continue
        const style = getComputedStyle(el)
        if (style.display === 'none' || style.visibility === 'hidden') continue
        const r = el.getBoundingClientRect()
        if (r.width <= 0 || r.height <= 0) continue
        panels.push({ left: r.left - rect.left, top: r.top - rect.top, right: r.right - rect.left, bottom: r.bottom - rect.top })
    }
    const chosen = chooseResultCardPosition({
        clickX: clientX - rect.left,
        clickY: clientY - rect.top,
        width: w,
        height: h,
        viewportWidth: rect.width,
        viewportHeight: rect.height,
        panels,
        gap,
        pad,
    })
    card.style.left = `${chosen.left}px`
    card.style.top = `${chosen.top}px`
}

// 第一个参数保留调用签名（onClick 统一传 event），停靠后不再按点击坐标摆位
function showArmorPartInfo(_event: MouseEvent, ndcX: number, ndcY: number): void {
            tc.tidyTrajectory();
            getRaycaster().setFromCamera(new THREE.Vector2(ndcX, ndcY), getCamera());
            const objects = models.armorModel ? [models.armorModel, ...getModuleMeshes()] : [];
            const rayDir = getRaycaster().ray.direction.clone().normalize();
            let info = null;
            for (const hit of getRaycaster().intersectObjects(objects, true)) {
                // 材质裁切不会删除几何命中：炮根在 hm.getGunClipPlane() 负侧被裁掉后，点击
                // 其后可见的装甲板仍可能先命中不可见炮根。与 collectJudgmentHits 同口径
                // 复用 isClippedModuleHit，厚度点选也不会选中被裁掉的炮管段。
                if (isClippedModuleHit(hit.object.userData.armorSection, hit.point, hm.getGunClipPlane())) continue;
                info = classifyHit(hit, rayDir);
                if (info) break;
            }
            const card = document.getElementById('click-info');
            if (!info) { cvs.resetArmorHighlight(); if (card) card.style.display = 'none'; return; }
            if (!card) return;
            cvs.applyArmorHighlight(info.object);
            const thickness = Number(info.thickness);
            // 几何入射角/等效：只做确定性几何换算，不含转正/口径规则——本模式不做
            // 击穿判定，穿深与结果保持 '—'，不猜（fail-closed）。
            const geom = faceAngleAndEffective(thickness, info.normal, rayDir)
            writeClickInfo({
                part: L.partName ? L.partName(info.partName) : info.partName,
                armor: Number.isFinite(thickness) ? thickness : null,
                angle: geom.angleDeg,
                effective: geom.effective,
                pen: null,
                result: '—',
            })
            // 跟随点击位置（厚度模式是同步判定，直接用本次点击坐标）
            if (lastClickClient) placeClickInfo(lastClickClient.x, lastClickClient.y)
        }

  return { onClick, showArmorPartInfo, getLastClickNdc: () => lastClickNdc,
    setLastClickNdc: (v: { x: number; y: number } | null) => { lastClickNdc = v },
    clearLastClickNdc: () => { lastClickNdc = null } }
}
