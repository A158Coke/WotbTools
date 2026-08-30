# Radar Score Display — Design QA

## Evidence

- Source: `C:\Users\Lenovo\AppData\Local\Temp\codex-clipboard-1cad8bfa-cbb8-4bb5-9fa4-4628b4f7d28a.png`（用户选择的方案 2）
- Combined source / implementation capture: `C:\Users\Lenovo\.codex\visualizations\2026\08\29\01a04dcf-c888-7b63-a4f1-fbb0f1b950b4\radar-score-desktop.png`
- Final implementation capture: `C:\Users\Lenovo\.codex\visualizations\2026\08\29\01a04dcf-c888-7b63-a4f1-fbb0f1b950b4\radar-score-implementation.png`
- Mobile capture: `C:\Users\Lenovo\.codex\visualizations\2026\08\29\01a04dcf-c888-7b63-a4f1-fbb0f1b950b4\radar-score-mobile-v2.png`
- Zero / near-zero edge capture: `C:\Users\Lenovo\.codex\visualizations\2026\08\29\01a04dcf-c888-7b63-a4f1-fbb0f1b950b4\radar-score-zero-edge.png`
- Zoom / capped-top follow-up capture: `C:\Users\Lenovo\.codex\visualizations\2026\08\29\01a04dcf-c888-7b63-a4f1-fbb0f1b950b4\radar-zoom-150-review.png`
- V5 bounded old/new comparison: `C:\Users\Lenovo\.codex\visualizations\2026\08\29\01a04dcf-c888-7b63-a4f1-fbb0f1b950b4\v5-bounded-mapping-comparison.png`
- V5 bounded mobile capture: `C:\Users\Lenovo\.codex\visualizations\2026\08\29\01a04dcf-c888-7b63-a4f1-fbb0f1b950b4\v5-bounded-mapping-mobile.png`

## Coverage

| Viewport | State | Result |
| --- | --- | --- |
| 1720 × 1080 | V2/V5 score mode, source and implementation in one view | No score/axis-label intersections; selected dark-gold badge treatment preserved |
| 820 × 1024 | Tablet layout, V5 score/raw switch | No horizontal overflow or label intersections |
| 390 × 844 | Stacked mobile V2/V5 cards | `scrollWidth == clientWidth`; all 13 score badges visible; no label intersections |
| 900 × 700 | V2 six-axis and V5 seven-axis 0 / near-0 degeneration | No badge-to-badge, badge-to-axis-label, or badge-to-scale-tick intersections |
| 1200 × 950 | 150% zoom in 527px desktop inner width and 339px mobile inner width | Desktop: 510px SVG fits without local scroll; mobile: only radar viewport scrolls to 510px; document has no horizontal overflow |
| 1200 × 950 | 150-point top axis | Badge and axis label do not intersect; measured visible vertical gap is 6.88px |
| 1200 × 950 | V5 old relative vs new average75/max150 mapping | Screenshot sample maps from `92/85/88/102/81/93/24` to `119/113/91/150/86/124/24`; both references remain regular 75 rings |
| 834 × 1112 | V5 bounded side-by-side tablet comparison | Two cards fit with no document horizontal overflow |
| 375 × 812 | V5 bounded mobile | Only the target card is shown; no badge/axis-label intersections and `scrollWidth == clientWidth` |

## Interaction checks

- Default detail mode is **Score** for both radars.
- Switching V2 to **Raw values** restored `5,841.3 / 1,514.5`, percentage values, and other existing raw/reference displays.
- Switching detail mode did not change the six V2 vertex labels (`124, 91, 125, 86, 135, 138`).
- V5 raw mode restored the seven `score / max` values and real reference values.
- Zoom accepts 50%–150%: 150% renders a 510px SVG, 50% renders 170px; details remain unchanged.
- Mobile 150% uses localized horizontal scrolling (`scrollWidth 510 > clientWidth 339`); returning to 50% removes that overflow.
- V5 bounded sample raw mode exactly restores `290/365, 90/110, 53/110, 75/75, 26/50, 148/180, 11/110` and its current averages.
- V5 bounded score mode renders `119, 113, 91, 150, 86, 124, 24`; the seven reference radii are all 60 SVG units (`75/150 × 120`).
- No browser console warnings or errors were produced.

## Iteration history

1. Initial text-only labels were upgraded to dark backplates with amber borders to match the selected mock.
2. Shared placement was adjusted so top/bottom labels use vertical breathing room while side labels move inward away from dimension names.
3. Automated bounding-box checks confirmed zero score-badge / axis-label intersections at desktop, tablet, and mobile widths.
4. A verifier-found low-score degeneration was fixed with a shared minimum safe radius and top-axis tick clearance; six-axis and seven-axis 0 / near-0 renders then passed collision checks.
5. PR review found capped top badges too close to the top axis name. Axis-label breathing room increased inside the existing viewBox, and the 149/150-point regression plus real-browser bounds now prove separation.
6. The shared radar gained 50%–150% zoom; desktop V2 space increased to 560px, while narrow screens keep overflow inside the radar viewport.
7. V5-only geometry changed from the relative log scale to the approved piecewise-linear bounded scale (`0→0 / average→75 / max→150`); V2 remained on the original relative scale.
8. The now-reachable RC=150 boundary exposed a lower-axis badge/label collision. Non-top near-vertical badges now stop just inside the data cap; unit and browser checks show zero intersections on desktop/mobile, and page/PNG share the corrected layout.

## Final result

passed
