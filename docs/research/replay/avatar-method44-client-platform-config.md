# Avatar method44 — client platform/build initialization config

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.

## Wire shape

Avatar method44 appears exactly once per replay and always uses 16 bytes.

Canonical payloads have only two variants:

```text
00 00 80 3f 00 00 80 3f 00 06 80 02 7d 71 01 2e   // 23 arenas
00 00 00 40 00 00 80 3f 00 06 80 02 7d 71 01 2e   // 11 arenas
```

Interpreting the first two fields as float32 gives:

```text
variant A: first=1.0, second=1.0
variant B: first=2.0, second=1.0
```

The remaining 8 bytes are constant in the current corpus.

## Exact client-build split

The replay header itself independently exposes the client build string.

Current corpus:

```text
header contains `11.19.0_china_apple`
  -> method44 first float = 1.0
  -> 23 / 23 exact

header contains `11.19.0_china`
  -> method44 first float = 2.0
  -> 11 / 11 exact
```

There are no counterexamples.

Verdict:

> Avatar method44 = **client platform/build initialization configuration family — PROVEN cross-surface relationship / PARTIAL exact field names**.

The first float is a platform/build discriminator for the two current client families; the exact symbolic enum labels are not recovered.

## Consumer guidance

This method has no demonstrated battle-semantic value. Production combat reconstruction may preserve it as raw initialization metadata or ignore it after recognizing the current version/platform family.

Do not use it as battle state, player input, damage, visibility or gameplay evidence.
