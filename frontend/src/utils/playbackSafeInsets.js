export function playbackSafeInsetOwnership({
  isFullscreen,
  formFactor,
  sideSlots,
  controlsInRail,
}) {
  if (!isFullscreen) return { reserveTop: false, reserveBottom: false }

  // Battle state is always a top HUD in fullscreen. side-slots may relocate
  // non-mobile controls, but it no longer owns HUD placement.
  const reserveTop = true

  // Mobile fullscreen keeps PR #245's bottom transient controller. Reserving
  // its rendered content height prevents the tactical map from sitting under
  // controls when they appear. PC/tablet only reserve bottom space when their
  // controls are actually in the bottom overlay; side-slot/rail controls do not.
  const reserveBottom = formFactor === 'mobile'
    || (!controlsInRail && !sideSlots)

  return { reserveTop, reserveBottom }
}
