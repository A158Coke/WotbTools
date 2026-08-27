# `.wotbreplay` container and metadata

> Primary corpus: 44 replay files / 34 unique arenas, Blitz 11.19.0 China.

## Archive container

Every supplied `.wotbreplay` is a ZIP archive containing exactly:

```text
meta.json
data.wotreplay
battle_results.dat
```

This 3-entry layout is `PROVEN` for the current corpus.

## Corpus composition

- replay files: **44**
- unique `arenaUniqueId`: **34**
- duplicate arena IDs are genuine additional POV recordings and are retained for protocol research
- all current samples: `arenaBonusType = 2`
- recorder identities in the corpus: 3
- maps represented: 18

Client versions:

```text
11.19.0_china_apple : 23 replays
11.19.0_china       : 21 replays
```

The protocol archive treats duplicate POVs differently from business deduplication:

- leaderboard/Rating aggregation: one arena ID is one battle;
- reverse engineering: each POV is an independent observation of the same server battle.

## `meta.json`

Every current file has exactly these keys:

```text
version
title
dbid
playerName
battleStartTime
playerVehicleName
mapName
arenaUniqueId
battleDuration
vehicleCompDescriptor
camouflageId
mapId
arenaBonusType
camouflageCustomData
```

### Reliability classification

`meta.json` is useful for archive identity and recorder-facing metadata, but it is **not automatically authoritative for canonical battle timing**.

Examples:

- `arenaUniqueId` is suitable for battle identity/deduplication;
- `version` is suitable for version gating;
- `playerName`, `dbid`, and recorder vehicle metadata identify the replay author;
- `battleDuration` is not the same time source as settlement `lifeTime`/result duration and must not be used as the sole canonical active-battle clock;
- `battleStartTime` is a Unix-style metadata timestamp but packet raw clock still requires arena-period/settlement alignment for sub-second reconstruction.

## `data.wotreplay` header — resolved structure

Current main previously documented the 8 bytes after magic as “unknown”. The 44-file corpus closes their **structural** meaning.

Observed header:

```text
0x00  u32 LE  magic = 0x12345678
0x04  u32 LE  totalLengthMinus8
0x08  u32 LE  variableHeaderLength
0x0C  u8      clientHashLength
...   bytes   clientHash UTF-8
...   u8      clientVersionLength
...   bytes   clientVersion UTF-8
...   u8      terminator/padding (0x0A in this corpus)
...            packet stream begins
```

### field at offset `0x04`

For **44/44 files**:

```text
u32@0x04 == data.wotreplay byte length - 8
```

There are zero counterexamples.

Verdict: `PROVEN` structural total-length field. The historical engine-side symbolic field name is not yet known, so documentation uses `totalLengthMinus8` rather than inventing a name.

### field at offset `0x08`

For **44/44 files**:

```text
u32@0x08 == packetStreamOffset - 12
```

Values in this corpus:

```text
48 : all 11.19.0_china files
54 : all 11.19.0_china_apple files
```

The six-byte difference is exactly explained by the longer `_apple` version string. Therefore this field is the byte length of the variable header area beginning at offset 12.

Verdict: `PROVEN` `variableHeaderLength`.

### client hash

All 44 files carry the same client hash:

```text
899DDD19108C6D65DB957234DD965756
```

This is version/build evidence for this corpus, not a universal constant.

### final header byte

The byte after the version string is `0x0A` in 44/44 samples. Its **structural role as the final variable-header byte is proven**; exact engine-side semantic/name is still `PARTIAL` and should not be called “padding” as a universal protocol rule without another version sample.

## Packet stream offset

Because `variableHeaderLength` is explicit:

```text
packetStreamOffset = 12 + u32@0x08
```

Observed:

```text
60 bytes : 11.19.0_china
66 bytes : 11.19.0_china_apple
```

This removes the need to discover packet-stream start solely by walking strings; a robust reader can validate both representations against one another.

## `battle_results.dat`

Container is:

```text
Python pickle protocol 2
→ tuple(arenaUniqueId, protobufBytes)
```

The second element is documented in `battle-results.md`.

## Version-scope rule

Every structural invariant above is proven for the supplied Blitz 11.19 China corpus. Future client versions must be validated before the parser converts these observations into unconditional cross-version assumptions.
