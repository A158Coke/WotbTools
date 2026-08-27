# Method16 codeB=33 / 38 — Fuel Tank and Observation Device closure

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> Final current verdict:
>
> - `codeB=33 = Fuel Tank` — **PROVEN by exhaustive current mechanical-domain closure + current critical-behavior discriminator**.
> - `codeB=38 = Observation Device` — **PROVEN by exhaustive current mechanical-domain closure + current critical-behavior discriminator**.

## Mechanical component domain

Avatar method16 uses a contiguous current mechanical component namespace:

```text
31..38
```

Independent current-version closures now establish:

```text
31 Engine              PROVEN
32 Ammo Rack           PROVEN
34 Track side A        PROVEN family / side PARTIAL
35 Track side B        PROVEN family / side PARTIAL
36 Gun                 PROVEN
37 Turret Rotator      PROVEN version-scoped
```

Only `33` and `38` remain after those independent physical closures.

Current Blitz support documentation lists the relevant damageable mechanical modules as:

```text
Engine
Gun
Ammo rack
Turret
Right track
Left track
Observation devices
Fuel tank
```

and explicitly notes that Radio is not damaged.

Thus after the six already-closed IDs, the remaining current component-name domain is exactly:

```text
{ Fuel Tank, Observation Device }
```

for numeric IDs:

```text
{ 33, 38 }
```

The pair still requires a current behavioral discriminator to determine orientation; historical numeric ordering alone is not accepted.

## codeB=38 critical sample

The canonical corpus contains one recorder-local `codeB=38` critical→clear chain:

```text
128.587601  method16 codeA=5, codeB=38, source=10470087
128.587601  Type32 nested mutation ending in component token 0x26 (= 38)

129.382904  method16 codeA=19, codeB=38, relatedEntity=0
129.382904  Multi-Purpose Restoration Pack 0x0B activation
```

Window duration:

```text
~0.795303 s
```

The same MPRP boundary also heals a previously shell-shocked Gunner (`codeB=41`), providing an internal positive control that the restoration event is being decoded correctly.

## Fuel-Tank critical behavior discriminator

Current Blitz support documentation defines the two remaining candidates differently at critical damage:

```text
Fuel Tank critical damage:
    fire begins
    fuel-tank icon remains orange

Observation Device critical damage:
    view range halved
```

Therefore a genuine `codeA=5` critical sample provides a direct discriminator: if `38` were Fuel Tank, the critical boundary should initiate the current fire family.

## No fire at the codeB=38 critical boundary

The recorder event stream around the complete `38` critical window was rescanned from raw `data.wotreplay`.

Observed at/after `128.587601` until the MPRP clear:

```text
no recorder Vehicle method1 causeFlag=1 fire HP-damage event
no proven Type32 mobile short ...04 fire-associated state
no periodic fire-DOT HP-loss sequence
```

The actual nearby HP update is earlier, at `127.778130`, and has:

```text
causeFlag=0
```

It is the direct hit that also shell-shocks the Gunner, not a fire-DOT tick.

Thus the real current `codeB=38, codeA=5` critical event does **not** exhibit the mandatory Fuel-Tank-critical `fire begins` signature.

Verdict:

> `codeB=38 = Fuel Tank` — **REJECTED by current critical-behavior evidence**.

Given the exhaustive two-name remaining domain:

> `codeB=38 = Observation Device` — **PROVEN current 11.19 identity**.

## codeB=33 pair closure

Once `38` is independently oriented as Observation Device, the sole remaining current mechanical identity is Fuel Tank:

> `codeB=33 = Fuel Tank` — **PROVEN by exhaustive current domain closure**.

This assignment is also behaviorally compatible with the recorder-local `33` population.

Current recorder-local observations:

```text
codeA=4 onset : 6
codeA=19 clear: 6
```

No recorder-local `codeA=5` Fuel Tank critical sample exists in the current 34-arena corpus, so the expected direct ignition closure cannot be observed for `33` itself.

That absence is why `33` previously remained STRONG PARTIAL. The identity becomes PROVEN only after the independent `38` critical negative control closes the final two-member domain.

## codeB=33 targeting negative control

`33` does not show the gun-specific targeting signature that independently closed `36 = Gun`.

One `33` onset occurs exactly at a normal recorder shot clock. Method36 there shows the ordinary pre/post-shot dispersion-state change:

```text
field6.field1 pre-shot  = 0.8529762465052021
field6.field1 post-shot = 0.9171787581399614
```

There is no persistent `×2` module-state transition like the proven Gun damage sample.

Across the current `33` windows there is likewise no independent Engine/Track/Turret-Rotator physical signature.

This is a compatibility/negative control, not the primary identity proof.

## Why pair elimination is valid here

This is not historical-order inference.

The proof uses three current constraints:

1. **current observed numeric domain**: mechanical method16 IDs occupy `31..38`;
2. **independent current physical closures**: six of the eight positions are already named without relying on ordering;
3. **current gameplay critical discriminator**: the only two remaining names have different critical behavior, and the observed `38` critical sample rejects Fuel Tank.

The conclusion therefore follows by exhaustive current-domain elimination, not by assuming old PC/WoT enum positions.

## Safe current mechanical map

```text
31 Engine              PROVEN
32 Ammo Rack           PROVEN
33 Fuel Tank           PROVEN exhaustive-domain closure
34 Track side A        PROVEN family / side PARTIAL
35 Track side B        PROVEN family / side PARTIAL
36 Gun                 PROVEN
37 Turret Rotator      PROVEN version-scoped
38 Observation Device  PROVEN exhaustive-domain + critical discriminator
```

## Remaining mechanical work

The component identities are now closed for all observed `31..38` positions. Remaining work is narrower:

1. assign exact left/right ordering for `34/35`;
2. map every related Type32/prop8 mechanical token and compressed property path;
3. obtain an additional `33` critical replay to directly observe the Fuel Tank ignition boundary;
4. obtain a longer `38` critical replay to measure the predicted view-range/spotting impairment directly;
5. validate numeric stability outside Blitz 11.19 China.

Until cross-version validation exists, all numeric mappings remain explicitly version-gated.
