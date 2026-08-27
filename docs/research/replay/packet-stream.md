# `data.wotreplay` packet stream

> Corpus: 44 replay files / 34 unique arenas, Blitz 11.19.0 China (`11.19.0_china` and `11.19.0_china_apple`).
>
> Evidence rule: this document distinguishes framing facts from packet semantics. A structurally valid packet may remain semantically `UNKNOWN`.

## Header

The stream begins with:

```text
magic            u32 LE = 0x12345678
unknown          8 bytes
clientHashLen    u8
clientHash       clientHashLen bytes UTF-8
clientVersionLen u8
clientVersion    clientVersionLen bytes UTF-8
padding          u8
```

After the header, packets are contiguous and use:

```text
payloadLen   u32 LE
packetType   u32 LE
rawClockSec  f32 LE
payload      payloadLen bytes
```

The terminal record is a normal framed packet with `packetType = 0xFFFFFFFF`, `payloadLen = 16`, `rawClockSec = 0`.

## Critical framing correction: zero-length payloads are legal

`payloadLen == 0` is **not malformed**.

The current 44-file corpus contains exactly one Type 17 packet per replay:

```text
payloadLen = 0
packetType = 17
payload    = empty
```

All 44 Type 17 records are followed immediately by Type 23.

When zero-length packets are accepted, every one of the 44 files parses contiguously from the header to the `0xFFFFFFFF` terminator with **zero byte-wise resynchronization**.

This disproves the current `ReplayPacketStreamReader` assumption that `payloadLen <= 0` is invalid. Rejecting Type 17 shifts the scanner into the following payload bytes and creates false packet headers with nonsensical huge type IDs and clock regressions. Such records are parser artifacts, not replay protocol packet types.

### Consequence for research

All protocol inventories in this archive use strict contiguous framing with `payloadLen >= 0`. Any inventory produced by the old `payloadLen <= 0` resync rule is superseded.

## Observed packet-type inventory

Counts below are across all 44 replay files.

| Type | Count | Payload length(s) | Current semantic verdict |
|---:|---:|---|---|
| 0 | 44 | variable, roughly 810–895 B | `PROVEN/PARTIAL` base player creation + arena pickle |
| 1 | 44 | 118 or 122 B | `PARTIAL` recorder/avatar entity creation data |
| 2 | 44 | 5 B | `PARTIAL` paired recorder/avatar lifecycle/create data |
| 4 | 687 | 4 B | `PROVEN` EntityLeave/entity removal; not equal to death |
| 5 | 4,869 | variable (mostly 51 B, many larger variants) | `PARTIAL` enter-world/entity creation lifecycle |
| 7 | 1,203,229 | 13–16 B | `PROVEN` EntityProperty envelope; property semantics vary |
| 8 | 69,515 | 13 B to ~7 KB | `PROVEN` EntityMethod envelope; subtype semantics vary |
| 10 | 1,701,157 | 49 B | `PROVEN` position/orientation packet |
| 11 | 88 | 20 B or ~94–102 B | `PARTIAL` space/map setup information |
| 13 | 40 | ~9.4–17.0 KB | `PROVEN` in-stream settlement dump; byte path corresponds to battle results |
| 14 | 44 | 1 B, always `00` | `PROVEN structure / PARTIAL semantic`; final packet immediately before terminator |
| 17 | 44 | **0 B** | `PROVEN structure / UNKNOWN semantic`; mandatory framing edge case in this corpus |
| 23 | 1,802 | 4 B | `PROVEN` recorder projectile/shot lifecycle toggle in validated samples |
| 26 | 846 | 4 B | `PROVEN` incoming hostile shell warning/event for recorder in validated samples |
| 28 | 460 | 4 B, values 0/1/2 | `PROVEN structure / UNKNOWN semantic` |
| 29 | 176 | 1 B, always `01` | `PROVEN structure / PARTIAL lifecycle semantic` |
| 31 | 183,147 | 4 B float | `PROVEN` recorder dispersion/aim-circle decay stream in validated samples |
| 32 | 22,066 | 11–27 B | `PROVEN envelope / UNKNOWN body semantics`; entity-scoped length-prefixed auxiliary blob |
| 33 | 4,869 | 12 B | `PROVEN structure` entity enter-world confirmation |
| 35 | 118,416 | 1 B | `PROVEN structure / PARTIAL semantic` ~10 Hz incrementing counter |
| 36 | 44 | 4 B | `PROVEN structure / UNKNOWN semantic`; one near stream initialization per replay |
| 39 | 1,262,479 | 28 B | `PARTIAL` recorder camera/aim state stream |
| `0xFFFFFFFF` | 44 | 16 B | `PROVEN` physical stream terminator |

No other real packet type was observed after strict framing was applied.

## Low-frequency packet facts

### Type 14

- exactly 44/44 files;
- payload always `00`;
- always the last ordinary packet;
- always followed directly by the `0xFFFFFFFF` terminator;
- raw clock is the final ordinary replay clock.

Therefore its **position as an end-of-recording marker is PROVEN**. Its exact client method/event name remains unknown.

### Type 17

- exactly 44/44 files;
- payload length exactly zero;
- occurs early in the replay (`~1.7–7.3 s` raw clock in this corpus);
- always immediately followed by Type 23 with payload `01 00 00 00`.

The structural relationship is `PROVEN`; semantic naming remains `UNKNOWN` until an independent schema or controlled probe identifies it.

### Type 29

- 176 records = exactly four per replay;
- payload always `01`;
- two records occur at/near initialization and two later in the early pre-battle/setup phase;
- not an end-of-battle marker in this corpus.

Older notes grouping Type 29 with end markers are therefore **SUPERSEDED**.

### Type 36

- exactly one per replay;
- payload length 4 B;
- appears at initialization (`0–0.233 s` raw clock here);
- follows Type 35 and precedes Type 1 in all 44 files.

Its exact semantic remains `UNKNOWN`.

## Clock domain

`rawClockSec` starts before active battle time. It is a replay/network timeline, not directly `battle-relative seconds`.

Type 8 subtype 48 arena-period messages provide an independent `BATTLE` transition marker where present. Settlement `lifeTime` provides server battle-relative integer time. The relationship is documented in `death-and-battle-clock.md`.

## Reader requirements derived from the corpus

A correct structural reader for this version family must:

1. accept `payloadLen == 0`;
2. preserve the packet sequence exactly;
3. stop at the framed `0xFFFFFFFF` terminator;
4. not invent packets through byte-by-byte resync when the contiguous framing is already valid;
5. treat resynchronization as corruption recovery only, never as ordinary framing;
6. preserve raw payload bytes for unknown types.

These are framing requirements, not yet an implementation change in this documentation PR.
