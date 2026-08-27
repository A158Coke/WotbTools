# Avatar subtype 49 — synchronized client options snapshot

> Corpus: 44 replay files / 34 unique arenas, Blitz 11.19.0 China.

## Verdict

Avatar-targeted Type-8 subtype 49 is a **compressed synchronized client-options / UI-control configuration snapshot**. One message exists in every replay in the corpus.

The exact server-side RPC method name is not independently known, so the semantic family is `PROVEN` while the original method symbol remains `PARTIAL`.

## Frequency and target

- 44 / 44 replay files contain exactly one subtype-49 message.
- 44 / 44 target the recorder Avatar entity.
- message appears in the initialization phase.
- argument lengths are approximately 3.2–3.8 KiB compressed.

## Argument structure

All 44 messages have this structure:

```text
prefix       : 3 bytes, always 00 00 00 in current corpus
length       : quirky length
               FF + u16 LE + 00 in every current sample
zlib_payload : exactly `length` bytes
```

The compressed length field is exact for all 44 samples:

```text
args.length - 7 == u16LE(args[4..5])
args[3] == 0xFF
args[6] == 0x00
zlib stream starts at args[7]
```

After zlib decompression the payload is a Python pickle containing a dictionary.

## Top-level forms observed

Three form-factor families occur:

```text
__formfacindep + Phone + pd_Android + MiniTablet   : 21 files
__formfacindep + pd_iOS + Tablet + Desktop         : 14 files
__formfacindep + pd_iOS + Tablet                   : 9 files
```

This independently explains the client-specific nature of the message.

## Proven contents

Representative keys include:

### form-factor-independent options

```text
SameControlType
PushNotificationsMode
PlayerSynchronizedOptions
ChatMessagesOnlyFromFriends
DrivingDirectionIndicator
KeepAmmoBar
MinimapCommands
CustomAim
DetailedDamageResultStyle
UseNationalCrewVoices
MuteAllChats
```

### device/form-factor UI controls

Examples observed under `Tablet`, `Phone`, `MiniTablet`, `Desktop`, `pd_iOS`, `pd_Android` include:

```text
CameraInversionHorizontal
CameraInversionVertical
Accelerometer
AccelerometerSensitivity
JoypadType
JoypadSensitivity
DirectShootMode
SmartZoom
Rangefinder
ReloadTimer
DamageCounter
ShowRibbons
SkillsDisplay
leftShoot_X/Y/SizeX/SizeY
rightShoot_X/Y/SizeX/SizeY
zoomButton_X/Y/SizeX/SizeY
ConsumablesPanel_X/Y/SizeX/SizeY
BattleRibbonContainer_X/Y/SizeX/SizeY
keyboardBattleLayout
```

These are clearly client controls/UI preferences and not server battle-state physics.

## `PlayerSynchronizedOptions`

The value is itself binary structured data. In the current corpus it contains vehicle identifiers and synchronized player-option state. It is preserved as an independent nested surface; its complete protobuf schema is not yet named field-by-field in this archive.

The presence of vehicle internal identifiers such as:

```text
A178_SPHT
IS-7
Leopard1
RhB_Waffentrager
...
```

proves the field is not an arbitrary opaque checksum.

## Research consequence

Subtype 49 must not be confused with combat reconstruction data. It is valuable for:

- understanding replay client/device environment;
- reproducing recorder UI/control configuration where relevant;
- distinguishing mobile/iOS/Android/Desktop form-factor behavior;
- preserving version-specific synchronized settings.

It should not influence authoritative battle facts such as damage, HP, position, death, score, or winner.

## Security/privacy note for downstream products

This block can contain user-specific preferences and device-layout information. Protocol parsers may decode it for research, but production APIs should avoid exposing the whole dictionary by default unless there is a concrete user-facing need.

## Evidence state

| fact | verdict |
|---|---|
| subtype 49 targets recorder Avatar | PROVEN |
| one initialization message per current replay | PROVEN |
| 3-byte zero prefix + quirky compressed length | PROVEN |
| zlib compressed payload | PROVEN |
| decompressed object is Python pickle dictionary | PROVEN |
| contents are synchronized client/UI/control options | PROVEN |
| exact original RPC method symbol | PARTIAL |
| nested `PlayerSynchronizedOptions` complete schema | PARTIAL |
