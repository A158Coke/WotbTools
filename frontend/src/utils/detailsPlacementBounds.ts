
export const DETAILS_EDGE_MARGIN = 8

export interface DetailsPlacementLimitsInput {
  hostWidth: number
  hostHeight: number
  paddingLeft?: number
  paddingRight?: number
  paddingTop?: number
  panelWidth: number
  panelHeight: number
  transportTop?: number | null
}

export interface DetailsPlacementLimits {
  minLeft: number
  maxLeft: number
  minTop: number
  maxTop: number
  maxBottom: number
  maxHeight: number
}

export interface DetailsPlacementPreservedInput {
  oldTop: number
  newTop: number
  newHeight: number
  hostWidth: number
  hostHeight: number
  paddingLeft?: number
  paddingRight?: number
  paddingTop?: number
  panelWidth: number
  transportTop?: number | null
}

const px = (value: number | null | undefined): number => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export function detailsPlacementLimits({
  hostWidth,
  hostHeight,
  paddingLeft = 0,
  paddingRight = 0,
  paddingTop = 0,
  panelWidth,
  panelHeight,
  transportTop = null,
}: DetailsPlacementLimitsInput): DetailsPlacementLimits {
  const minLeft = px(paddingLeft) + DETAILS_EDGE_MARGIN
  const minTop = px(paddingTop) + DETAILS_EDGE_MARGIN
  const maxLeft = Math.max(minLeft, px(hostWidth) - px(paddingRight) - px(panelWidth) - DETAILS_EDGE_MARGIN)
  const rawTransportTop = transportTop == null ? hostHeight : Number(transportTop)
  const boundary = Number.isFinite(rawTransportTop) ? rawTransportTop : px(hostHeight)
  const maxBottom = Math.min(px(hostHeight) - DETAILS_EDGE_MARGIN, boundary - DETAILS_EDGE_MARGIN)
  const maxTop = Math.max(minTop, maxBottom - px(panelHeight))
  return {
    minLeft,
    maxLeft,
    minTop,
    maxTop,
    maxBottom,
    maxHeight: Math.max(0, maxBottom - minTop),
  }
}

export function detailsPlacementPreserved({
  oldTop,
  newTop,
  newHeight,
  hostWidth,
  hostHeight,
  paddingLeft = 0,
  paddingRight = 0,
  paddingTop = 0,
  panelWidth,
  transportTop = null,
}: DetailsPlacementPreservedInput): boolean {
  const limits = detailsPlacementLimits({
    hostWidth,
    hostHeight,
    paddingLeft,
    paddingRight,
    paddingTop,
    panelWidth,
    panelHeight: newHeight,
    transportTop,
  })
  const expectedTop = Math.min(Math.max(px(oldTop), limits.minTop), limits.maxTop)
  return Math.abs(px(newTop) - expectedTop) <= 1
    && px(newTop) >= limits.minTop - 1
    && px(newTop) + px(newHeight) <= limits.maxBottom + 1
}
