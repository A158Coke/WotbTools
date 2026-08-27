# Type28 — recorder-local 3-state packet

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> Important correction: a previous note promoted this packet to PC-style target-lock/auto-aim feedback by matching it to historical Wargaming `AimSound` / `BattleReplay.lockTargetCallback`. That promotion is **SUPERSEDED** because the supplied China Blitz corpus is mobile-client gameplay and does not provide evidence that the PC right-click target-lock recording path exists or is triggerable in this client/version.

## Wire shape

Current Type28 is structurally:

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

Type28 forms a small recurrent state machine rather than an arbitrary counter.

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

Most non-zero episodes terminate at zero. This proves only that Type28 is a recorder-local three-state surface with recurring active/inactive-like transitions.

## Rejected / superseded PC mapping

Historical Wargaming PC client code contains:

```text
TARGET_UNLOCKED = 0
TARGET_LOCKED   = 1
TARGET_LOST     = 2
```

and a replay `lockTargetCallback` recording path. The numeric domain matches Type28 exactly.

However, this is **not sufficient current Blitz evidence**. The canonical corpus is WoT Blitz China mobile-client gameplay; the PC right-click target-lock UX/path is not known to exist or be triggerable in that environment. Therefore numeric-domain equality is treated only as historical coincidence/candidate evidence and must not be used as the current semantic identity.

The previous claims:

```text
Type28 = target-lock / auto-aim feedback
0 = unlocked
1 = locked
2 = target lost
```

are **SUPERSEDED / NOT PROVEN**.

## Current verdict

```text
Type28 structure       = PROVEN
payload width          = PROVEN u32 LE
observed state domain  = PROVEN {0,1,2}
recurring state-family = PROVEN behavioral shape
exact semantic         = UNKNOWN/PARTIAL
```

Do not expose Type28 to AI Review or Battle Playback under a target-lock label until a Blitz 11.19 mobile-client producer path, controlled mobile replay probe, or independent current-version schema closes the meaning.

## Research rule reinforced by this correction

Historical PC Wargaming replay/client code may supply structural hypotheses, but semantic promotion for WoT Blitz requires current Blitz evidence. A matching enum domain or callback shape alone is insufficient when the gameplay/control surface is platform-specific.
