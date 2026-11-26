import type { DirectionalLight, Scene } from 'three'
import { shadowQualityEligible } from './quality.js'
import { createTankContactShadows } from './tankContactShadows.js'
import type { TankContactShadows } from './tankContactShadows.js'

export interface ContactShadowControlDeps {
  store: { contactShadows: boolean }
  qualityKey(): string
  getScene(): Scene | null
  getSunLight(): DirectionalLight | null
  surfaceHeightAt(x: number, z: number): number
  stencilAssembled(): boolean
}

export interface ContactShadowControl {
  setEnabled(on: boolean): void
  wantsStencil(): boolean
  setup(): void
  dispose(): void
  handle(): TankContactShadows | null
  count(): number | null
}

export function createContactShadowControl(deps: ContactShadowControlDeps): ContactShadowControl {
  let enabled = false;
  let handle: TankContactShadows | null = null;
  const eligible = () => shadowQualityEligible(deps.qualityKey());
  return {
    setEnabled(on) {
      enabled = !!on && eligible();
      deps.store.contactShadows = enabled;
    },
    wantsStencil: () => enabled && eligible(),
    setup() {
      handle?.dispose();
      handle = null;
      const scene = deps.getScene(), sunLight = deps.getSunLight();
      if (enabled && eligible() && scene && sunLight) {
        handle = createTankContactShadows({
          scene, sunLight,
          heightAt: deps.surfaceHeightAt, silhouettes: deps.stencilAssembled(),
        });
      }
    },
    dispose() {
      handle?.dispose();
      handle = null;
    },
    handle: () => handle,
    count: () => (handle ? handle.count() : null),
  };
}
