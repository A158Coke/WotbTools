# Projectile / tracer lifecycle — Blitz 11.19 China

> Corpus: canonical 34 unique arenas, with loadout cross-checks from the same 11.19 population. Numeric Avatar method IDs are entity-class/version scoped.

## Current lifecycle graph

```text
Vehicle method0
  observed vehicle firing
        |
        v
Avatar method29
  projectile/tracer launch family
  shooter + shotId + launch geometry + velocity
        |
        | shotId
        +---------------------------+
        |                           |
        v                           v
Avatar method20                 Avatar method27
stopTracer endpoint             terminal/explosion-resolution family
PROVEN                          PROVEN behavioral family
        |
        +--> Avatar method28 on recorder terminal/death-view incoming projectile geometry
             PROVEN behavioral family
```

Visual projectile state is not authoritative HP damage; Vehicle method1/8 + Type7 prop3 remain the combat-damage fact surfaces.

# Avatar method20 — stopTracer endpoint

Current body:

```text
shotId   : u32
aendPoint : VECTOR3<f32>
```

(typo-resistant semantic name: the three floats are the terminal/end point.)

Corpus closure:

```text
method29 unique shot IDs       : 4,161
method29 IDs also having m20   : 4,161 / 4,161
```

Independent Wargaming replay-visible schema exposes `stopTracer(shotID, endPoint)` with the same physical role.

Verdict:

> method20 = **projectile/tracer terminal endpoint — PROVEN**.

Do not equate stopTracer with penetration or HP loss.

# Avatar method29 — projectile/tracer launch

Current body length:

```text
37 bytes
```

Current byte-level layout is now substantially closed:

```text
bytes  0..4   shooterEntityId : u32 LE
bytes  4..8   shotId          : u32 LE
byte   8      flag/raw         : u8
bytes  9..21  launchPoint      : VECTOR3<f32>
bytes 21..33  launchVelocity   : VECTOR3<f32>
bytes 33..37  invariant/raw    : f32
```

The exact symbolic name of byte8 and the final float remain `PARTIAL/UNKNOWN`, but the two vectors have strong physical closure.

## Launch direction closure

Projectile direction:

```text
cos(angle(launchVelocity, endpoint-launchPoint)) > 0.99
for ~98.8% of matched current observations
median cosine ~0.9999998
```

This proves the vector beginning at byte offset 21 is aligned with the projectile trajectory.

## Velocity-magnitude closure from Improved Gunpowder

A loadout-controlled natural experiment provides stronger evidence that the offset-21 vector magnitude is actual shell-velocity telemetry rather than an arbitrary direction vector.

VK 72.01 K Type5 loadout reconstruction independently identifies provision wire code `0x6C` as the Improved Gunpowder branch. Comparing method29 launch-vector magnitudes for corresponding shell-speed families gives:

```text
without 0x6C : 600.0
with    0x6C : 810.0
ratio         : 1.3500

without 0x6C : 552.0
with    0x6C : 745.2
ratio         : 1.3500
```

The current provision effect is shell velocity ×1.35.

This exact multiplier closure independently proves:

> method29 bytes `[21..33)` = **projectile launch velocity VECTOR3 — PROVEN physical semantic in the current 11.19 corpus**.

The magnitude is therefore safe to treat as the current replay's effective projectile launch-speed value in the simulation coordinate/time domain, subject to normal version gating.

It remains unsafe to infer penetration/damage from velocity alone.

## Launch point

The preceding vector at bytes `[9..21)` lies at/near the shooter weapon origin and combines with the velocity vector and method20 endpoint into a coherent projectile ray.

Verdict:

> method29 bytes `[9..21)` = **launch/reference point — PROVEN physical family / PARTIAL exact producer name**.

## Overall method29 verdict

> method29 = **projectile/tracer launch family — PROVEN physical family**.

Important:

> method29 is a **global observed projectile feed**, not automatically a recorder-owned shot. Consumers must use the embedded shooter identity / independently closed recorder identity before attributing a launch to the replay author.

This rule is mandatory. Earlier research mistakes that treated same-clock/global projectile events as recorder-owned are superseded.

# Packet raw clock is not exact projectile flight time

The method29→method20 direction is physically coherent, but packet clock deltas are batched/network-delivery timestamps and do not reproduce simulation flight time reliably.

Therefore:

```text
method20.rawClock - method29.rawClock
```

must not be exposed as exact shell travel time.

# Avatar method27 — projectile terminal/explosion resolution

Current body:

```text
shotId          : u32
field4_7Raw     : u32
materialLike    : u8
terminalPoint   : VECTOR3<f32>
vectorLikeRaw   : VECTOR3<f32>
flagLikeRaw     : u8
```

Current count:

```text
518
```

Field-level closure:

```text
method27 shotId has method20 partner            : 518 / 518
method27 rawClock == partner method20 rawClock  : 518 / 518
method27 terminalPoint == method20 endpoint     : 518 / 518
coordinate error                                : 0
```

This closes method27 to the projectile terminal/explosion-resolution side of the lifecycle.

Verdict:

> method27 = **projectile explosion / terminal-resolution family — PROVEN behavioral family / PARTIAL exact symbolic fields**.

The small `materialLike` domain and trailing vector/flag remain raw. The trailing VECTOR3 is **not a unit surface normal**: current norm range is broad (~0.18..218.6), so a simple `impactNormal` label is rejected.

Do not treat method27 as penetration or damage.

# Avatar method28 — recorder death/death-view incoming projectile geometry

Current body:

```text
P1 : VECTOR3<f32>
P2 : VECTOR3<f32>
B  : VECTOR3<f32>
```

Count:

```text
24
```

Strong closure:

```text
B == same-clock method20 endpoint : 24 / 24 exact
```

Current occurrence is restricted to recorder direct-projectile terminal / immediate post-mortem projectile handling in this corpus; survivor and ramming-death recorder cases do not show the family.

Important correction:

```text
P1 == P2 : 23 / 24
```

not `24/24`.

The single non-duplicate event is a complex same-clock multi-projectile terminal boundary. Therefore consumers must preserve all three vectors and must **not** normalize `P2=P1`.

Verdict:

> method28 = **incoming recorder death/death-view terminal projectile geometry — PROVEN behavioral family / PARTIAL exact symbolic RPC name**.

Do not generalize it to every incoming projectile.

# Relationship to damage/death

Safe layering:

```text
method29 / 20 / 27 / 28
  -> projectile visual/geometry lifecycle

Vehicle method8
  -> supported attacker/victim damage notification

Vehicle method1
  -> live HP + source + damage-cause family

Type7 prop3
  -> current HP / terminal state

settlement
  -> authoritative final killer/deathReason/stats
```

Never use projectile geometry alone to manufacture HP damage or a killer.

# Recorder-shot attribution rule

A projectile must be called `recorderShot` only when shooter identity is independently closed to the recorder vehicle.

Unsafe shortcut:

```text
"method29 occurred at the same clock as recorder UI feedback"
=> recorder fired
```

This is false in team combat because method29 contains many combatants' projectiles.

Safe sources include:

- embedded method29 shooter identity joined to the recorder vehicle;
- recorder-local Type23/Type28/method17 lifecycle where identity is already proven;
- other independently version-gated recorder weapon telemetry.

# Remaining work

1. recover exact current Blitz symbolic name for method29 and byte8/final-float fields;
2. close method27 `field4_7Raw`, `materialLike`, vector and flag enums without guessing;
3. determine method28 P1/P2 exact producer meanings in multi-projectile terminal cases;
4. validate projectile schemas on another Blitz client version before widening numeric method support;
5. preserve strict distinction between projectile presentation and authoritative damage.
