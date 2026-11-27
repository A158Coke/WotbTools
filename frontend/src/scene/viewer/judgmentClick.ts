import * as THREE from 'three'
import { isClippedModuleHit } from '../armorCollisionPack.js'
import { disposeHitMarker } from './overlayStroke.js'
import { chooseResultCardPosition, type ResultCardRect } from './resultCardPosition.js'
import type { JudgmentDeps } from './judgment.js'
import type { JudgmentHit } from './judgmentHits.js'

export function createJudgmentClick(deps: JudgmentDeps, classifyHit: (hit: THREE.Intersection, rayDir?: THREE.Vector3 | null) => JudgmentHit | null,
  faceAngleAndEffective: (thickness: number, normal: THREE.Vector3, rayDir: THREE.Vector3) => { angleDeg: number | null; effective: number | null },
  doPenetrationCheck: (x: number, y: number) => void,
  invalidateJudgment?: () => void) {
  const { models, getRenderer, getCollisionMode, tc, getRaycaster, getCamera, getModuleMeshes, hm, cvs, L, getFxScene } = deps
    let lastClickNdc: { x: number; y: number } | null = null;
    let lastClickClient: { x: number; y: number } | null = null;

function onClick(event: MouseEvent): void {
            if (!models.armorModel) return;
            lastClickClient = { x: event.clientX, y: event.clientY };
            if (window.__worldPenMode) return;
            const rect = getRenderer().domElement.getBoundingClientRect();
            const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            if (getCollisionMode()) { showArmorPartInfo(event, ndcX, ndcY); return; }
            lastClickNdc = { x: ndcX, y: ndcY };
            doPenetrationCheck(ndcX, ndcY);
        }

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

function placeClickInfo(clientX: number, clientY: number): void {
    const card = document.getElementById('click-info')
    if (!card) return
    const anchor = (card.offsetParent as HTMLElement | null) ?? card.parentElement
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const gap = 14
    const pad = 8
    card.style.display = 'flex'
    const w = card.offsetWidth
    const h = card.offsetHeight
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

function showArmorPartInfo(_event: MouseEvent, ndcX: number, ndcY: number): void {
            // 厚度点击也是一次判定失效：先递增判定代数，丢弃可能仍在途的 async 响应。
            invalidateJudgment?.();
            tc.tidyTrajectory();
            // tidyTrajectory 只拥有轨迹/结果卡/HE 爆点；命中点圆点由 overlayStroke 拥有。
            // 厚度模式点击 = 放弃上一发判定，两者必须一起清，否则旧命中点会留在新读数旁。
            disposeHitMarker(getFxScene());
            lastClickNdc = null;
            getRaycaster().setFromCamera(new THREE.Vector2(ndcX, ndcY), getCamera());
            const objects = models.armorModel ? [models.armorModel, ...getModuleMeshes()] : [];
            const rayDir = getRaycaster().ray.direction.clone().normalize();
            let info = null;
            for (const hit of getRaycaster().intersectObjects(objects, true)) {
                if (isClippedModuleHit(hit.object.userData.armorSection, hit.point, hm.getGunClipPlane())) continue;
                info = classifyHit(hit, rayDir);
                if (info) break;
            }
            const card = document.getElementById('click-info');
            if (!info) { cvs.resetArmorHighlight(); if (card) card.style.display = 'none'; return; }
            if (!card) return;
            cvs.applyArmorHighlight(info.object);
            const thickness = Number(info.thickness);
            const geom = faceAngleAndEffective(thickness, info.normal, rayDir)
            writeClickInfo({
                part: L.partName ? L.partName(info.partName) : info.partName,
                armor: Number.isFinite(thickness) ? thickness : null,
                angle: geom.angleDeg,
                effective: geom.effective,
                pen: null,
                result: '—',
            })
            if (lastClickClient) placeClickInfo(lastClickClient.x, lastClickClient.y)
        }

  return { onClick, showArmorPartInfo, getLastClickNdc: () => lastClickNdc,
    setLastClickNdc: (v: { x: number; y: number } | null) => { lastClickNdc = v },
    clearLastClickNdc: () => { lastClickNdc = null } }
}
