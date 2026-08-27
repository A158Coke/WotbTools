# Type 8 subtype 47 — `CHAT_ACTION_DATA`

> Corpus: 44 replay files / 34 unique arenas, Blitz 11.19.0 China.
>
> This document supersedes the previous assumption that current 11.19 subtype 47 is an arena-roster protobuf.

## Verdict

**Current 11.19 Type 8 subtype 47 is a chat/action delivery structure compatible with Wargaming `CHAT_ACTION_DATA` and `ClientChat.onChatAction`, not the current arena-update protobuf container.**

This conclusion is `PROVEN` by three independent layers:

1. all 1,845 current subtype-47 records parse losslessly using the `CHAT_ACTION_DATA` field sequence;
2. the tail is a length-delimited Python pickle exactly where the Wargaming alias schema declares the `data: PYTHON` member;
3. independent Wargaming client code exposes `ClientChat.onChatAction(chatActionData)` and consumes the same keys (`actionResponse`, `action`, `channel`, etc.).

Historical Blitz parsers that labelled subtype47 as `UpdateArena` describe a different protocol/version mapping and must be version-gated.

## Binary structure

After the normal Type-8 envelope:

```text
entityId u32
subtype  u32 = 47
argLen   u32
```

`args` decode as:

```text
requestID           i64
 action              u8
 actionResponse      u8
 time                f64
 sentTime            f64
 channel             i32 / OBJECT_ID
 originator          i64 / DB_ID
 originatorNickLen   u8
 originatorNickName  UTF-8 bytes
 group               u8
 dataLength          quirky-length
 data                Python pickle bytes
 flags               u8
```

The “quirky length” format is:

```text
if first != 0xFF:
    length = first
else:
    0xFF + u16LE(length) + 0x00
```

This same length scheme is independently documented in an older Blitz replay parser.

### Corpus validation

All **1,845 / 1,845** subtype-47 packets satisfy the structure above with no trailing or missing bytes.

Observed invariants:

```text
actionResponse = 0 : 1845/1845
group          = 0 : 1845/1845
flags          = 0 : 1845/1845
```

`requestID` is commonly `-1` for delivered actions.

The two f64 timestamps are Unix/server-style times and closely track one another; they are not the packet `rawClockSec` domain.

## Observed actions

The current corpus contains action indices:

| action | Count | Wargaming `CHAT_ACTIONS` name |
|---:|---:|---|
| 0 | 556 | `enter` |
| 1 | 2 | `broadcast` |
| 2 | 695 | `leave` |
| 4 | 14 | `channelDestroyed` |
| 6 | 44 | `requestChannels` |
| 7 | 88 | `selfEnter` |
| 8 | 4 | `selfLeave` |
| 20 | 362 | `userChatCommand` |
| 22 | 80 | `personalSysMessage` |

The distribution itself is not used to infer the names; the names come from the independent Wargaming `CHAT_ACTIONS` enumeration and the packet binary layout independently matches `CHAT_ACTION_DATA`.

## Examples of `data` pickle payloads

The tail is real Python-pickle application data rather than opaque random bytes.

Observed classes include:

- channel dictionaries for common/team battle channels;
- originator nicknames;
- small tuples/lists used by chat commands;
- personal/system action payloads.

One large initialization action contains dictionaries with keys such as:

```text
isReadonly
dbID
notifyFlags
isSecured
greeting
flags
ownerName
owner
channelName
id
```

and channel names of the form:

```text
#chat:channels/battle/common
#chat:channels/battle/team
```

This closes the chat semantic independently of subtype numbering.

## Identity fields

The `originator` i64 corresponds to account/database identity where applicable and `originatorNickName` is the delivered sender/player name.

Do not confuse the 32-bit `channel` OBJECT_ID with vehicle/entity IDs from the arena roster. They inhabit different protocol semantics even though both are integer IDs.

## Timing

Subtype47 includes three time concepts:

```text
packet.rawClockSec  replay/network timeline
CHAT_ACTION.time    server/application timestamp
CHAT_ACTION.sentTime server/application timestamp
```

The latter two are absolute Unix-like values in this corpus. They are useful as a cross-clock research source but must not be substituted directly for battle-relative time.

## Security note for tooling

`data` is Python pickle. Research tooling should parse or disassemble it with a restricted/safe pickle reader. It must not use unrestricted `pickle.loads()` on arbitrary user-uploaded replay bytes in production.

## Version drift

Historical open-source code maps subtype47 to an arena-update protobuf. Current 11.19 evidence proves a different meaning for this subtype number.

Therefore:

```text
subtype number alone is NOT a cross-version semantic identifier
```

Version/hash gating is mandatory when formal decoders are implemented.
