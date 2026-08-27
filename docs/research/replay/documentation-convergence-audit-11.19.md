# Blitz 11.19 replay documentation convergence audit

> Purpose: final PR147 contradiction audit after controlled-probe closure.
>
> Scope: authoritative/current documentation only. Historical research notes may retain old hypotheses only when explicitly marked `SUPERSEDED` / `REJECTED` or clearly presented as historical research context.

## Authoritative/current documents audited

1. `WOTB_REPLAY_PROTOCOL_11_19_COMPLETE_REFERENCE.md`
2. `inventory.md`
3. `research-completion-audit-11.19.md`
4. `README.md`
5. `method38-current-hit-flag-reconstruction.md`
6. `precision-fire-method38-extension.md`
7. `avatar-method36-targeting-info.md`
8. `method36-vertical-gun-speed-controlled-closure.md`
9. `fuel-tank-observation-device-closure.md`
10. PR147 body

## Audit terms

```text
0x0008
0x0040
0x0080
0x1000
0x2000
0x8000
extension
variantTail
Precision Fire
Tungsten
Type4 == death
Tankopedia base HP
causeFlag=5
deathReason=5
modifierCount
modifierId
```

## Converged current facts

### method38 flags

```text
0x0008 ricochet                                                         PROVEN controlled
0x0020 projectile non-penetration/material stop                         PROVEN controlled
0x0040 zero-DF/spaced armor pierced by projectile                       PROVEN controlled
0x0080 zero-DF/spaced armor not pierced                                 PROVEN controlled
0x1000 positive-DF material explosion branch                            PROVEN controlled
0x2000 zero-DF/spaced armor explosion branch                            PROVEN controlled sample / low-N
0x4000 internal component/device explosion involvement                  PROVEN controlled
0x8000 internal component/device damaged by explosion                   PROVEN controlled
```

Only `0x0200` remains without a current positive sample.

### method38 modifier structure

Current authoritative model:

```text
modifierCount u8
repeat modifierCount:
    modifierId u32 LE
```

```text
modifierId=1 -> Precision Fire   PROVEN controlled
modifierId=2 -> Tungsten Shells  PROVEN controlled
```

Combined controlled sample:

```text
[2]
[2]
[2]
[1,2]
```

Therefore any authoritative reference to a current single nullable extension is invalid.

Allowed historical wording:

```text
optional single extension model -> SUPERSEDED
variantTail opaque-tail model   -> SUPERSEDED
extension IDs mutually exclusive -> REJECTED
combined proc == modifier3       -> REJECTED current controlled sample
```

### Death / HP

Current facts:

```text
Type4 = leaves recorder-observed AoI                 PROVEN
Type4 == death                                       REJECTED
Tankopedia base HP == replay actual HP               REJECTED as primary source
causeFlag=5 = DROWNING                               PROVEN controlled
deathReason=5 = DROWNING                             PROVEN controlled
positive-HP terminal death exists                    PROVEN controlled
```

### method36

Current facts:

```text
root.field1 = turret/gun relative yaw                PROVEN
root.field2 = gun pitch                              PROVEN
root.field3 = max horizontal angular speed, rad/s    PROVEN controlled
root.field4 = max vertical angular speed, rad/s      PROVEN controlled
```

Old wording that all remaining seven scalars are unmapped is `SUPERSEDED`.

## Documentation fixes performed in convergence pass

- `inventory.md` rewritten as synchronized current fact ledger.
- `research-completion-audit-11.19.md` rewritten to remove already-completed probes from remaining work.
- `avatar-method36-targeting-info.md` updated for field3/field4 controlled closures.
- PR147 body rewritten against the final complete-reference state.
- `precision-fire-method38-extension.md` already contains the current modifier-list model and `[1,2]` coexistence closure.
- `README.md` and `WOTB_REPLAY_PROTOCOL_11_19_COMPLETE_REFERENCE.md` already use the converged current model.
- `method38-current-hit-flag-reconstruction.md` already contains the controlled 0x0008/0x0040/0x0080/0x1000/0x2000/0x4000/0x8000 mapping.

## Final contradiction verdict

No known authoritative/current document should describe any of the following as a current production fact:

```text
0x0008 is only a ricochet candidate
0x0040 exact role unknown
0x0080 unobserved
0x1000 only HE-family candidate
0x2000 only unclosed candidate
0x8000 unobserved
method38 has one optional extension
extension=1 is only near-PROVEN
extension=2 is only n=1 candidate
Precision Fire and Tungsten are mutually exclusive
Type4 means death
Tankopedia base HP is authoritative actual battle HP
method36 root.field3/root.field4 are both unmapped
```

If those statements remain in early historical notes, they must be read as historical research state and not as authoritative current facts.

```text
AUTHORITATIVE DOCUMENT CONTRADICTION BLOCKERS: 0
DOCUMENTATION CONVERGENCE STATUS: PASS
```
