# Broadcast region globe assets

Five static decorative SVG views for the existing server cards. `#globe` is the public fragment used by `<svg><use>`; keep that ID and the 160×160 viewBox when re-exporting. `currentColor` and two opacity levels inherit the existing semantic region colors in both UI profiles. All geometry is bundled locally; no runtime geodata, projection library, network map service or HTML injection is used.

## Provenance

- Geometry: [Natural Earth countries, 1:110m](https://github.com/nvkelso/natural-earth-vector/blob/ca96624a56bd078437bca8184e78163e5039ad19/geojson/ne_110m_admin_0_countries.geojson).
- Source SHA-256: `6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f`.
- [Natural Earth terms](https://www.naturalearthdata.com/about/terms-of-use/): public domain; modification and electronic distribution permitted. Natural Earth uses its own de facto boundary conventions. These cropped icons are regional illustrations, not authoritative borders or exact server coverage maps.
- Export tooling: d3-geo 3.1.1 orthographic projection and SVGO 4.0.0, used offline only. Neither is a frontend dependency.
- All five shipped assets use Natural Earth. The China DataV geometry explored in the temporary design preview is not included.

## View parameters

| Asset | Center longitude / latitude | Scale | Bright geometry |
|---|---|---|---|
| cn.svg | 105 / 35 | Fit to `[25,30]–[135,130]` | China-focused mainland and nearby island outlines (`CHN`, `TWN` source features) |
| asia.svg | 120 / 10 | 73 | Asia and Oceania |
| na.svg | -90 / 10 | 73 | North and South America |
| eu.svg | 18 / 55 | 131.4 | Europe, with the Russia feature kept in the context layer |
| lesta.svg | 95 / 60 | 109.5 | Russia-focused outline |

Translation is `[80,80]`; the land/graticule clipping radius is 72 and the outer ring radius is 74 with stroke width 5. The context land opacity is 0.18 and the graticule opacity is 0.14. CN framing uses the mainland/major-island extent (polygon area above 0.0001 steradians) while retaining the selected source geometry inside the circular crop. This preserves the approved focused silhouette without letting distant tiny features displace it. Export precision is 0.15 with two path decimals; final SVGO path precision is one decimal and IDs are preserved.
