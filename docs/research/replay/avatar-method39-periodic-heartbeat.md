# Avatar method39 — periodic ~10-second control/heartbeat tick

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> Numeric Type8 method IDs are entity-class and client-version scoped.

## Wire shape

Avatar-targeted method39 is fixed 2 bytes:

```text
payload = 00 00
```

Canonical corpus:

```text
records                  : 887
payload 0000              : 887 / 887
records per replay        : 16 .. 41
```

## Cadence

Within each replay, consecutive method39 events form an extremely stable approximately 10-second sequence:

```text
median interval : ~9.9995 s
min             : ~9.9328 s
max             : ~10.0588 s
p1              : ~9.9666 s
p99             : ~10.0326 s
```

The first event normally occurs near rawClock 9.4–9.9 s, followed by one event every ~10 s until the stream ends.

This cadence is independent of the irregular timing of firing, damage, kills, capture events and consumable activations. Same-clock overlaps with combat RPCs occur only incidentally.

Verdict:

> Avatar method39 = **periodic recorder/avatar ~10-second control/heartbeat tick — PROVEN cadence/role family, UNKNOWN exact symbolic name**.

The all-zero two-byte payload does not provide evidence for a user-facing gameplay statistic or state value.

## Consumer guidance

- preserve only if complete protocol fidelity or diagnostics need it;
- do not use it as battle clock, damage, visibility, capture or firing evidence;
- production battle reconstruction may safely ignore it after version-gated recognition;
- do not transplant a historical PC callback name without current Blitz producer evidence.
