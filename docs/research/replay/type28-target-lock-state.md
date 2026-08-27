# Type28 — recorder target-lock / auto-aim feedback state

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> Numeric packet type is version-scoped. The semantic promotion below is based on current replay behavior plus an independent Wargaming replay/client callback chain.

## Wire shape

Current Type28 is structurally trivial:

```text
payload : u32 LE state
```

Canonical 34-arena counts:

```text
arenas with Type28 : 33 / 34
records            : 320

state 0 : 156
state 1 : 136
state 2 :  28
```

No other value occurs.

## State-transition behavior

Type28 forms an explicit small state machine rather than an arbitrary counter.

Observed adjacent transitions:

```text
1 -> 0 : 130
0 -> 1 : 104
2 -> 0 :  25
0 -> 2 :  21
1 -> 2 :   3
2 -> 1 :   3
0 -> 0 :   1
```

Most non-zero episodes terminate at zero. The common active-window durations are on the order of seconds, although some lock windows can persist much longer.

This is consistent with a user-facing target-lock state rather than a shot, damage, reload or one-shot configuration packet.

## Independent Wargaming replay callback chain

Historical/current-lineage Wargaming client code exposes the exact replay path:

```text
BattleReplay.ReplayManager.lockTargetCallback
    -> BattleReplay.onLockTarget(state, playVoiceNotifications)

recording path:
PlayerAvatar.onLockTarget(state, playVoiceNotifications)
    -> ReplayManager.onLockTarget(state, playVoiceNotifications)
```

The state itself is independently enumerated by `AimSound`:

```text
TARGET_UNLOCKED = 0
TARGET_LOCKED   = 1
TARGET_LOST     = 2
```

These are exactly the only three integer values observed in current Blitz Type28.

This is substantially stronger than a generic payload-size or timing match: the current replay contains precisely the same state domain, and its transition behavior matches the replay callback's target-lock role.

## Current semantic mapping

Safe current mapping:

```text
Type28 state 0 -> target unlocked
Type28 state 1 -> target locked
Type28 state 2 -> target lost
```

Verdict:

> Type28 = **recorder target-lock / auto-aim feedback state — PROVEN behavioral identity for current corpus**.

The exact low-level Blitz C++ ReplayManager packet symbol is not available in the corpus, so the packet-number-to-C++-symbol spelling remains version-scoped.

## Relationship to auto-aim

The client `PlayerAvatar.autoAim(...)` path sets `AIMING_MODE.TARGET_LOCK` when a vehicle is locked and produces target lock feedback. The replay callback therefore belongs to the same player target-lock/auto-aim UX family.

However Type28 itself carries the **feedback state**, not the target vehicle entity ID. Its four-byte body contains only `0/1/2` in the current corpus.

Do not invent a target ID from Type28. Target identity, when needed, requires a separate target-selection/aim/visibility source.

## Shot relationship

Type28 is not a shot packet. Recorder shots can occur both while state=0 and inside state=1/2 windows.

The non-zero windows nevertheless overlap many firing sequences, which is expected for target lock usage. This supports the behavioral family but must not be used to derive hit or penetration facts.

## Production-safe event

```text
TargetLockStateChanged {
    rawClockSec
    stateRaw : u32
    state :
      UNLOCKED // 0
      LOCKED   // 1
      LOST     // 2
      UNKNOWN(raw)
}
```

Consumers may safely use this for:

- AI Review: whether the recorder was using/losing target lock around a decision window;
- Battle Playback: reconstruct the recorder's lock feedback state;
- aim analysis: join lock state to Type39 aim-ray data and projectile launch data.

Consumers must not infer:

- target entity identity from Type28 alone;
- a shot/hit from a lock transition;
- exact server-side target visibility from the feedback state;
- future enum values without version gating.
