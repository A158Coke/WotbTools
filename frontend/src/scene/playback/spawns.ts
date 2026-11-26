import * as THREE from 'three'
import type { Scene } from 'three'
import { makeGroundedDisc, makeGroundedRing } from './bases.js'

export interface MapSpawnPoint {
  name?: string
  team?: number
  x: number
  y: number
}

interface SpawnMarkerObject {
  gx: number
  gz: number
  team: number | undefined | null
  disc: THREE.Mesh
  ring: THREE.Mesh
  reground(): void
}

const SPAWN_DISC_R = 2.2
const SPAWN_RING_R = 3.4
const SPAWN_COLOR_FALLBACK = '#858f81'
const SPAWN_TEAM1_FALLBACK = '#5cc280'
const SPAWN_TEAM2_FALLBACK = '#f2786d'
const SPAWN_RING_OUTLINE_FALLBACK = '#1c1f1d'

export function createSpawnMarkers({ getScene, groundY }: {
  getScene: () => Scene
  groundY: (x: number, z: number) => number
}): {
  build(points: readonly MapSpawnPoint[] | null | undefined): void
  clear(): void
  reground(): void
  refreshColors(): void
} {
let markers: SpawnMarkerObject[] = [];

function tokenColor(name: string, fallback: string): string {
  if (typeof getComputedStyle !== 'function' || typeof document === 'undefined') return fallback;
  const cs = getComputedStyle(document.documentElement);
  return (cs.getPropertyValue(name) || '').trim() || fallback;
}

function spawnColor(team: number | undefined | null): string {
  if (team === 1) return tokenColor('--color-team-1', SPAWN_TEAM1_FALLBACK);
  if (team === 2) return tokenColor('--color-team-2', SPAWN_TEAM2_FALLBACK);
  return tokenColor('--text-muted', SPAWN_COLOR_FALLBACK);
}

function isTeamColor(team: number | undefined | null): boolean {
  return team === 1 || team === 2;
}

function clearSpawns() {
  for (const m of markers) {
    getScene().remove(m.disc); m.disc.geometry.dispose(); (m.disc.material as THREE.Material).dispose();
    getScene().remove(m.ring); m.ring.geometry.dispose(); (m.ring.material as THREE.Material).dispose();
  }
  markers = [];
}

function addSpawnMarker(gx: number, gz: number, team: number | undefined | null): void {
  const color = spawnColor(team);
  const sx = -gx, sz = gz;
  const teamColor = isTeamColor(team);
  const disc = new THREE.Mesh(
    makeGroundedDisc(groundY, sx, sz, SPAWN_DISC_R, 4, 24),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide,
                                  transparent: !teamColor, opacity: teamColor ? 1 : 0.85,
                                  depthWrite: false, toneMapped: false,
                                  polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  getScene().add(disc);
  const ringColor = teamColor ? tokenColor('--color-on-team-neutral', SPAWN_RING_OUTLINE_FALLBACK) : color;
  const ring = new THREE.Mesh(
    makeGroundedRing(groundY, sx, sz, SPAWN_RING_R, 48),
    new THREE.MeshBasicMaterial({ color: ringColor, side: THREE.DoubleSide, transparent: true, opacity: 0.9,
                                  depthWrite: false, toneMapped: false,
                                  polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  getScene().add(ring);
  markers.push({
    gx, gz, team, disc, ring,
    reground: () => {
      disc.geometry.dispose(); disc.geometry = makeGroundedDisc(groundY, sx, sz, SPAWN_DISC_R, 4, 24);
      ring.geometry.dispose(); ring.geometry = makeGroundedRing(groundY, sx, sz, SPAWN_RING_R, 48);
    },
  });
}

function buildSpawns(points: readonly MapSpawnPoint[] | null | undefined): void {
  clearSpawns();
  if (!Array.isArray(points)) return;
  for (const p of points) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    addSpawnMarker(p.x, p.y, p.team);
  }
}

function regroundSpawns() {
  for (const m of markers) m.reground();
}

function refreshSpawnColors() {
  for (const m of markers) {
    const teamColor = isTeamColor(m.team);
    (m.disc.material as THREE.MeshBasicMaterial).color.set(spawnColor(m.team));
    (m.ring.material as THREE.MeshBasicMaterial).color.set(
      teamColor ? tokenColor('--color-on-team-neutral', SPAWN_RING_OUTLINE_FALLBACK) : spawnColor(m.team));
  }
}

  return {
    build: buildSpawns,
    clear: clearSpawns,
    reground: regroundSpawns,
    refreshColors: refreshSpawnColors,
  };
}
