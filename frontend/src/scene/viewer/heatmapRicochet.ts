import * as THREE from 'three'
import { RC, buildPack, snapshotPackPose, packPoseChanged, buildRicochetGrid, createGridTextures,
  type CollisionPack, type PackEntry, type RicochetGrid } from '../armorCollisionPack.js'
import { hasGunMask, shellTypeOf } from './armorPlateModel.js'
import type { createArmorShaderContext } from './armorShaders.js'
import type { HeatmapDeps } from './heatmap.js'
import type { ShellSpec } from './viewerContracts.js'

type RicochetGridTextured = RicochetGrid & { textures?: ReturnType<typeof createGridTextures> }

export function createHeatmapRicochet(deps: HeatmapDeps, rcUniforms: ReturnType<typeof createArmorShaderContext>['rcUniforms']) {
  const { models, getActiveGunNumber, getCurrentConfig, getModuleMeshes, getCamera, getSelectedShell, getShooterShells } = deps
  let ricochetPack: CollisionPack | null = null
  let ricochetGrid: RicochetGridTextured | null = null
  let ricochetPoseDirty = true
  let ricochetPoseSnapshot: number[][] | null = null
  let ricochetFailedPose: number[][] | null = null
  let ricochetGridGeneration = 0
  let ricochetPackReason = ''
  let ricochetGridRetries = 0
  const RC_GRID_RETRY_MAX = 240
function collectRicochetEntries() {
            const list: PackEntry[] = [];
            if (!models.armorModel) return list;
            models.armorModel.traverse(function(node) {
                const mesh = node as THREE.Mesh;
                if (!mesh.isMesh) return;
                const sec = node.userData.armorSection;
                if (sec !== 'hull' && sec !== 'turret' && sec !== 'gun' && sec !== 'spaced') return;
                if (node.userData.configHidden) return;
                if (node.parent && node.parent.visible === false) return;
                const t = node.userData.armorThickness;
                if (typeof t !== 'number') return;
                list.push({ mesh: mesh, section: sec, thickness: t, variant: null });
            });
            const act = getActiveGunNumber();
            const cfg = getCurrentConfig();
            const hasMask = hasGunMask(cfg);
            getModuleMeshes().forEach(function(node) {
                const mesh = node as THREE.Mesh;
                if (!mesh.isMesh) return;
                if (node.userData.gunConfig != null && act != null && node.userData.gunConfig !== act) return;
                if (node.userData.gunMaskPart && !hasMask) return;
                if (node.parent && node.parent.visible === false) return;
                const t = node.userData.armorThickness;
                if (typeof t !== 'number') return;
                const sec = node.userData.armorSection;
                if (sec !== 'chassis' && sec !== 'gunBarrel') return;
                list.push({ mesh: mesh, section: sec, thickness: t, variant: sec === 'chassis' ? 'track' : 'gun' });
            });
            return list;
        }

function rebuildRicochetPack() {
            disposeRicochetGrid();
            ricochetPack = null;
            ricochetPoseSnapshot = null;
            ricochetFailedPose = null;
            ricochetPackReason = '';
            rcUniforms.rcEnabled.value = false;
            rcUniforms.rcMode.value = 0;
            updateCollisionWorldMatrices();
            const entries = collectRicochetEntries();
            const pack = buildPack(entries);
            if (!pack.ok) {
                ricochetPackReason = pack.reason + ' (entries=' + entries.length + ')';
                console.warn('[armor-ricochet] continuation disabled:', ricochetPackReason);
                return;
            }
            ricochetPack = pack;
            ricochetGridRetries = 0;
            rebuildRicochetGrid();
            const sh = getSelectedShell() || (getShooterShells()[0]) || null;
            if (sh) syncRicochetEnabled(sh);
        }

function rebuildRicochetGrid() {
            if (!ricochetPack) return false;
            const grid = buildRicochetGrid(ricochetPack);
            if (!grid.ok) {
                disposeRicochetGrid();
                rcUniforms.rcEnabled.value = false;
                rcUniforms.rcMode.value = 0;
                ricochetPackReason = grid.reason;
                ricochetGridRetries++;
                if (ricochetGridRetries >= RC_GRID_RETRY_MAX) {
                    rcUniforms.rcEnabled.value = false;
                    ricochetPoseDirty = false;
                    ricochetFailedPose = snapshotPackPose(ricochetPack);
                    console.warn('[armor-ricochet] grid disabled after retries:', grid.reason);
                    return false;
                }
                ricochetPoseDirty = true;
                return false;
            }
            ricochetGridRetries = 0;
            disposeRicochetGrid();
            const tex = createGridTextures(grid);
            (grid as RicochetGridTextured).textures = tex;
            ricochetGrid = grid;
            rcUniforms.rcWorldTris.value = tex.worldTrisTex;
            rcUniforms.rcTriRows.value = grid.triRows;
            rcUniforms.rcGridCells.value = tex.cellsTex;
            rcUniforms.rcGridEntries.value = tex.entriesTex;
            (rcUniforms.rcGridMin.value as THREE.Vector3).set(grid.gridMin[0], grid.gridMin[1], grid.gridMin[2]);
            rcUniforms.rcCell.value = grid.cellSize;
            (rcUniforms.rcGridDimsF.value as THREE.Vector3).set(grid.dims[0], grid.dims[1], grid.dims[2]);
            rcUniforms.rcCellRows.value = Math.ceil(grid.cellTotal / RC.CELL_ROW);
            rcUniforms.rcEntryRows.value = Math.ceil(grid.entryTotal / RC.ENTRY_ROW);
            rcUniforms.rcEntryTotal.value = grid.entryTotal;
            ricochetPoseSnapshot = snapshotPackPose(ricochetPack);
            ricochetFailedPose = null;
            ricochetPackReason = '';
            ricochetGridGeneration++;
            ricochetPoseDirty = false;
            return true;
        }

function disposeRicochetGrid() {
            if (ricochetGrid?.textures) {
                for (const texture of Object.values(ricochetGrid.textures)) texture.dispose();
            }
            ricochetGrid = null;
            ricochetPoseSnapshot = null;
            rcUniforms.rcWorldTris.value = null;
            rcUniforms.rcGridCells.value = null;
            rcUniforms.rcGridEntries.value = null;
        }

function updateCollisionWorldMatrices() {
            models.armorModel?.updateWorldMatrix(true, true);
            models.tankModel?.updateWorldMatrix(true, true);
            getCamera().updateWorldMatrix(true, false);
        }

function prepareRicochetFrame() {
            if (ricochetPack) {
                updateCollisionWorldMatrices();
                const changed = packPoseChanged(ricochetPack, ricochetPoseSnapshot);
                const retryStopped = ricochetFailedPose && !packPoseChanged(ricochetPack, ricochetFailedPose);
                if (ricochetPoseDirty || (changed && !retryStopped)) {
                    if (ricochetFailedPose) {
                        ricochetGridRetries = 0;
                        ricochetFailedPose = null;
                    }
                    rebuildRicochetGrid();
                }
            }
            const sh = getSelectedShell() || getShooterShells()[0];
            if (sh) syncRicochetEnabled(sh);
        }

function syncRicochetEnabled(sh: ShellSpec) {
            const t = shellTypeOf(sh);
            const on = !!ricochetPack && !!ricochetGrid && (t === 'ap' || t === 'apcr');
            rcUniforms.rcEnabled.value = on;
            rcUniforms.rcMode.value = on ? 1 : 0;
        }

  function reset() {
    disposeRicochetGrid()
    ricochetPack = null; ricochetGrid = null; ricochetPoseSnapshot = null; ricochetFailedPose = null; ricochetPoseDirty = true
    rcUniforms.rcWorldTris.value = null; rcUniforms.rcGridCells.value = null; rcUniforms.rcGridEntries.value = null
    rcUniforms.rcEnabled.value = false; rcUniforms.rcMode.value = 0
  }
  function buildSplashGeometry() {
    const pack = (!ricochetPoseDirty && ricochetPack) ? ricochetPack : buildPack(collectRicochetEntries())
    const grid = (pack === ricochetPack && ricochetGrid) ? ricochetGrid : buildRicochetGrid(pack)
    return { pack, grid }
  }
  return { reset, buildSplashGeometry, collectRicochetEntries, rebuildRicochetPack, prepareRicochetFrame, updateCollisionWorldMatrices, syncRicochetEnabled,
    getRicochetPack: () => ricochetPack, getRicochetGrid: () => ricochetGrid, isRicochetPoseDirty: () => ricochetPoseDirty,
    getRicochetGridGeneration: () => ricochetGridGeneration, getRicochetPackReason: () => ricochetPackReason,
    getRicochetPoseSnapshot: () => ricochetPoseSnapshot, invalidateRicochetPose: () => { ricochetPoseDirty = true } }
}
