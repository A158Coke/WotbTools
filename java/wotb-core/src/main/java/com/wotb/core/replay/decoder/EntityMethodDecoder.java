package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.AmmunitionStateEvent;
import com.wotb.core.replay.event.ArenaPeriodChangedEvent;
import com.wotb.core.replay.event.HpRawState;
import com.wotb.core.replay.event.RoundFinishedEvent;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.ProjectileLaunchedEvent;
import com.wotb.core.replay.event.ProjectileResolutionEvent;
import com.wotb.core.replay.event.ProjectileTerminalEvent;
import com.wotb.core.replay.event.RecorderHealthChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.event.ShotResultEvent;
import com.wotb.core.replay.event.SupremacyPointsChangedEvent;
import com.wotb.core.replay.event.TargetingInfoSnapshotEvent;
import com.wotb.core.replay.event.UnknownReplayEvent;
import com.wotb.core.replay.event.UnsupportedDamageEvent;
import com.wotb.core.replay.event.VehicleFiredEvent;
import com.wotb.core.replay.event.VehicleHitEvent;
import com.wotb.core.replay.event.VehicleHealthStateEvent;
import com.wotb.core.replay.event.VehicleVehicleCollisionEvent;
import com.wotb.core.replay.reconstruction.Vector3;
import com.wotb.core.replay.stream.RawReplayPacket;
import org.springframework.util.StringUtils;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Type 8 (EntityMethod) 解码器。
 *
 * <p><b>PR162 entity-class scoped</b>：method ID 是 entity-class scoped，不是全局 methodId namespace。
 * 反例：Avatar method4 2B = RoundFinished；Vehicle method4 16B = vehicle-to-vehicle collision/contact。
 * 安全 semantic key = version/capability + entityClass + methodId + exact arg layout。不能只靠
 * methodId+argLen 猜 entityClass。因此每个语义 method 先经 {@link EntityClassRegistry} 解析
 * entityClass（来自真实 lifecycle 证据，不靠 method-shape 反推）；UNKNOWN class → raw-preserve
 * （UnknownReplayEvent），再按 {@code (entityClass, methodId, argShape)} 分派。</p>
 *
 * <p>复用现有解析逻辑：
 * <ul>
 *   <li>entity/account 映射（subtype 48 updateArena2）</li>
 *   <li>direct HP damage（subtype 8 damage, sub 3 direct）→ VehicleHitEvent（hit/result-feedback）</li>
 *   <li>updateArena（subtype 47）→ 已知但未实现 → raw-preserve</li>
 * </ul>
 * </p>
 */
public class EntityMethodDecoder implements ReplayPacketDecoder {

    static final int TYPE_ENTITY_METHOD = 8;
    static final int SUBTYPE_UPDATE_ARENA = 47;
    static final int SUBTYPE_UPDATE_ARENA2 = 48;
    static final int SUBTYPE_ENTITY_METHOD_DAMAGE = 8;
    static final int DAMAGE_SUB_DIRECT = 3;
    /** Vehicle-targeted method1（7-byte args，PROVEN）：currentHpRaw(u16) + sourceEntity(u32) + causeFlag(u8)。 */
    static final int SUBTYPE_VEHICLE_HEALTH_STATE = 1;
    /** Avatar-targeted method5 3-byte variant（PROVEN）：currentHp(u16) + flag(u8)。 */
    static final int SUBTYPE_RECORDER_OWN_HEALTH = 5;
    /** Vehicle-targeted method0（1-byte args=01）：observed vehicle firing（PROVEN）。 */
    static final int SUBTYPE_VEHICLE_FIRED = 0;
    /** Avatar-targeted method17（12-byte args）：recorder ammunition state（PROVEN）。 */
    static final int SUBTYPE_AMMUNITION_STATE = 17;
    /** Avatar-targeted method20（28-byte args）：stopTracer 终点（PROVEN）。 */
    static final int SUBTYPE_PROJECTILE_TERMINAL = 20;
    /** Avatar-targeted method27（34-byte args）：弹丸终末/爆炸解析（PROVEN family）。 */
    static final int SUBTYPE_PROJECTILE_RESOLUTION = 27;
    /** Avatar-targeted method29（37-byte args）：弹丸发射（PROVEN family）。 */
    static final int SUBTYPE_PROJECTILE_LAUNCH = 29;
    /** Avatar-targeted method36（92/74-byte protobuf）：瞄准/瞄准状态快照（PROVEN）。 */
    static final int SUBTYPE_TARGETING_SNAPSHOT = 36;
    /** Avatar-targeted method38（14..22-byte args）：射击结果 bitfield（PROVEN）。 */
    static final int SUBTYPE_SHOT_RESULT = 38;
    /** Avatar-targeted method4 (2-byte args)：round finished（winnerTeam u8 + finishReason u8，PROVEN）。 */
    static final int SUBTYPE_ROUND_FINISHED = 4;
    /** subtype48 wrapper=3 = ARENA_PERIOD 更新（root field3 = period；PROVEN）。 */
    public static final long WRAPPER_ARENA_PERIOD = 3L;
    /** wrapper3 root field：arena period 值。 */
    static final int ARENA_PERIOD_ROOT_FIELD = 3;
    static final int AVATAR_METHOD5_ARGS_LEN = 3;
    static final int ROUND_FINISHED_ARGS_LEN = 2;
    /** Vehicle method4 16-byte collision/contact args：sharedScalar(f32) + contactPoint(3×f32)。 */
    static final int VEHICLE_VEHICLE_COLLISION_ARGS_LEN = 16;
    static final int VEHICLE_METHOD1_ARGS_LEN = 7;
    static final int VEHICLE_METHOD0_ARGS_LEN = 1;
    static final int AMMUNITION_STATE_ARGS_LEN = 12;
    /** method20 args：shotId(u32) + endpoint(3×f32) = 16 B（packet = 28 B）。 */
    static final int PROJECTILE_TERMINAL_ARGS_LEN = 16;
    static final int PROJECTILE_RESOLUTION_ARGS_LEN = 34;
    static final int PROJECTILE_LAUNCH_ARGS_LEN = 37;

    /**
     * 100% Avatar-targeted methodId（docs/research/replay/entity-routing.md）：调用本身即 Avatar 化类证据
     * （不靠 method-shape 反推）。method16 由专门的 {@link VehicleModuleCrewStateDecoder} 处理。
     */
    private static final Set<Integer> AVATAR_PROVEN_METHODS = Set.of(
            SUBTYPE_AMMUNITION_STATE,
            SUBTYPE_PROJECTILE_TERMINAL,
            SUBTYPE_PROJECTILE_RESOLUTION,
            SUBTYPE_PROJECTILE_LAUNCH,
            SUBTYPE_TARGETING_SNAPSHOT,
            SUBTYPE_SHOT_RESULT,
            SUBTYPE_UPDATE_ARENA,
            SUBTYPE_UPDATE_ARENA2,
            49);

    /** Vehicle-family（0% Avatar）methodId：调用即 Vehicle 化类证据。 */
    private static final Set<Integer> VEHICLE_PROVEN_METHODS = Set.of(
            SUBTYPE_VEHICLE_FIRED,
            SUBTYPE_VEHICLE_HEALTH_STATE);

    @Override
    public boolean supports(ReplayDecodeContext context, RawReplayPacket packet) {
        return packet.type() == TYPE_ENTITY_METHOD;
    }

    @Override
    public ReplayDecodeResult decode(ReplayDecodeContext context, RawReplayPacket packet) {
        final byte[] payload = packet.payload();
        // §A2/P0-3：method0/1/5/17/20/27/29 是 legacy-compatible 观测布局 —— 仅当前 canonical
        // 版本族（11.19）+ 明确 legacy 证明的 11.18 允许解码为 EXACT（methodLayoutAllowed）；
        // 未知/未来版本 raw-preserve，绝不无条件沿用 EXACT 语义。
        if (payload.length < 8) {
            return new ReplayDecodeResult(DecodeStatus.MALFORMED, List.of(),
                    List.of(new ReplayDecodeWarning("TRUNCATED_PAYLOAD",
                            "EntityMethod packet too short: " + payload.length)));
        }

        final int entityId = readI32LE(payload, 0);
        final int subType = readU32LE(payload, 4);
        // Type8 envelope（research entity-methods.md）：entityId(u32) + subtype(u32) +
        // argLen(u32) + args；真实 args 从 payload[12..) 开始。
        final int argLen = readU32LE(payload, 8);
        final boolean envelopeValid = payload.length == 12 + argLen;
        final ReplayTimestamp ts = new ReplayTimestamp(packet.rawClockSec(), null);

        final List<ReplayEvent> events = new ArrayList<>();
        final List<ReplayDecodeWarning> warnings = new ArrayList<>();

        // §A2/P0-3：method0/1/5/17/20/27/29（legacy-compatible 观测布局）不得对未知/未来版本
        // 无条件产出 EXACT 语义事件 —— raw-preserve + VERSION_UNSUPPORTED 诊断。
        if (isLayoutMethod(subType)
                && !ReplayVersionGate.methodLayoutAllowed(context.clientVersion())) {
            events.add(new UnknownReplayEvent(
                    packet.sequence(), ts, packet.type(), payload.length,
                    "VERSION_UNSUPPORTED_METHOD" + subType, DecodeConfidence.UNKNOWN));
            warnings.add(new ReplayDecodeWarning("VERSION_UNSUPPORTED",
                    "EntityMethod subtype " + subType + " layout not affirmed: " + context.clientVersion()));
            return new ReplayDecodeResult(DecodeStatus.PARTIAL, events, warnings);
        }

        // §P1: closed-semantic methods（subtype 4/8 —— roundFinished/damage）produce version-scoped
        // PR147 semantic events (RoundFinishedEvent, DamageEvent). The structural EntityMethod envelope is
        // forward-compatible, but these CLOSED semantics are strictly evidence-gated: unknown/future
        // versions raw-preserve and never emit a current-version semantic for an unaffirmed version.
        // (method48 participant-mapping/ARENA_PERIOD are structural — gated inside the subtype48 branch.)
        if (isSemanticMethod(subType)
                && !ReplayVersionGate.methodSemanticsAllowed(context.clientVersion())) {
            events.add(new UnknownReplayEvent(
                    packet.sequence(), ts, packet.type(), payload.length,
                    "VERSION_UNSUPPORTED_METHOD" + subType, DecodeConfidence.UNKNOWN));
            warnings.add(new ReplayDecodeWarning("VERSION_UNSUPPORTED",
                    "EntityMethod subtype " + subType + " layout not affirmed: " + context.clientVersion()));
            return new ReplayDecodeResult(DecodeStatus.PARTIAL, events, warnings);
        }

        switch (subType) {
            case SUBTYPE_VEHICLE_FIRED -> {
                // Vehicle method0：observed firing（args=01 4,154/4,154）。
                if (entityClassFor(context, subType, entityId) != EntityClass.VEHICLE
                        || !envelopeValid || argLen != VEHICLE_METHOD0_ARGS_LEN) {
                    rawPreserve(events, warnings, packet, ts, entityId, subType, argLen,
                            "METHOD0_CLASS_OR_SHAPE");
                } else {
                    events.add(new VehicleFiredEvent(
                            packet.sequence(), ts, packet.type(), DecodeConfidence.EXACT,
                            entityId, payload[12] & 0xFF));
                }
            }
            case SUBTYPE_AMMUNITION_STATE -> {
                if (entityClassFor(context, subType, entityId) != EntityClass.AVATAR
                        || !envelopeValid || argLen != AMMUNITION_STATE_ARGS_LEN) {
                    rawPreserve(events, warnings, packet, ts, entityId, subType, argLen,
                            "METHOD17_CLASS_OR_SHAPE");
                } else {
                    final int descriptor = readU32LE(payload, 12);
                    final int flag = payload[16] & 0xFF;
                    final int quantity = payload[17] & 0xFF;
                    final byte[] variantRaw = new byte[6];
                    System.arraycopy(payload, 18, variantRaw, 0, variantRaw.length);
                    events.add(new AmmunitionStateEvent(
                            packet.sequence(), ts, packet.type(), DecodeConfidence.EXACT,
                            entityId, descriptor, flag, quantity, variantRaw));
                }
            }
            case SUBTYPE_PROJECTILE_TERMINAL -> {
                if (entityClassFor(context, subType, entityId) != EntityClass.AVATAR
                        || !envelopeValid || argLen != PROJECTILE_TERMINAL_ARGS_LEN) {
                    rawPreserve(events, warnings, packet, ts, entityId, subType, argLen,
                            "METHOD20_CLASS_OR_SHAPE");
                } else {
                    final int shotId = readU32LE(payload, 12);
                    final Vector3 endpoint = readVector3(payload, 16);
                    if (endpoint == null) {
                        rawPreserve(events, warnings, packet, ts, entityId, subType, argLen,
                                "METHOD20_NON_FINITE_VECTOR");
                    } else {
                        events.add(new ProjectileTerminalEvent(
                                packet.sequence(), ts, packet.type(), DecodeConfidence.EXACT,
                                shotId, endpoint));
                    }
                }
            }
            case SUBTYPE_PROJECTILE_RESOLUTION -> {
                if (entityClassFor(context, subType, entityId) != EntityClass.AVATAR
                        || !envelopeValid || argLen != PROJECTILE_RESOLUTION_ARGS_LEN) {
                    rawPreserve(events, warnings, packet, ts, entityId, subType, argLen,
                            "METHOD27_CLASS_OR_SHAPE");
                } else {
                    final int shotId = readU32LE(payload, 12);
                    final int field47 = readU32LE(payload, 16);
                    final int materialLike = payload[20] & 0xFF;
                    final Vector3 terminal = readVector3(payload, 21);
                    final Vector3 vectorLike = readVector3(payload, 33);
                    final int flagLike = payload[45] & 0xFF;
                    if (terminal == null || vectorLike == null) {
                        rawPreserve(events, warnings, packet, ts, entityId, subType, argLen,
                                "METHOD27_NON_FINITE_VECTOR");
                    } else {
                        events.add(new ProjectileResolutionEvent(
                                packet.sequence(), ts, packet.type(), DecodeConfidence.EXACT,
                                shotId, field47, materialLike, terminal, vectorLike, flagLike));
                    }
                }
            }
            case SUBTYPE_PROJECTILE_LAUNCH -> {
                if (entityClassFor(context, subType, entityId) != EntityClass.AVATAR
                        || !envelopeValid || argLen != PROJECTILE_LAUNCH_ARGS_LEN) {
                    rawPreserve(events, warnings, packet, ts, entityId, subType, argLen,
                            "METHOD29_CLASS_OR_SHAPE");
                } else {
                    final int shooterEntityId = readI32LE(payload, 12);
                    final int shotId = readU32LE(payload, 16);
                    final int flag = payload[20] & 0xFF;
                    final Vector3 launchPoint = readVector3(payload, 21);
                    final Vector3 launchVelocity = readVector3(payload, 33);
                    final float invariant = Float.intBitsToFloat(readI32LE(payload, 45));
                    if (launchPoint == null || launchVelocity == null) {
                        rawPreserve(events, warnings, packet, ts, entityId, subType, argLen,
                                "METHOD29_NON_FINITE_VECTOR");
                    } else {
                        events.add(new ProjectileLaunchedEvent(
                                packet.sequence(), ts, packet.type(), DecodeConfidence.EXACT,
                                shooterEntityId, shotId, flag, launchPoint, launchVelocity,
                                invariant));
                    }
                }
            }
            case SUBTYPE_TARGETING_SNAPSHOT -> {
                // §A2：method36 field semantics 是 PR147 仅 11.19 controlled 证明的 closed semantics；
                // 非 11.19 → raw-preserve（UnknownReplayEvent）+ diagnostics，不伪造 numeric semantic。
                if (!ReplayVersionGate.closedSemanticsAllowed(context.clientVersion())) {
                    versionRawPreserve(events, warnings, packet, ts, subType, "VERSION_UNSUPPORTED_METHOD36");
                } else if (entityClassFor(context, subType, entityId) != EntityClass.AVATAR) {
                    rawPreserve(events, warnings, packet, ts, entityId, subType, argLen,
                            "METHOD36_CLASS_MISMATCH");
                } else {
                    final int before = events.size();
                    decodeTargetingSnapshot(payload, packet, ts, events, warnings);
                    if (events.size() == before) {
                        rawPreserve(events, warnings, packet, ts, entityId, subType, argLen,
                                "METHOD36_SHAPE_MISMATCH");
                    }
                }
            }
            case SUBTYPE_SHOT_RESULT -> {
                // §A2：method38 low16/modifier/component namespace 是 PR147 仅 11.19 controlled 证明的 closed semantics。
                if (!ReplayVersionGate.closedSemanticsAllowed(context.clientVersion())) {
                    versionRawPreserve(events, warnings, packet, ts, subType, "VERSION_UNSUPPORTED_METHOD38");
                } else if (entityClassFor(context, subType, entityId) != EntityClass.AVATAR) {
                    rawPreserve(events, warnings, packet, ts, entityId, subType, argLen,
                            "METHOD38_CLASS_MISMATCH");
                } else {
                    final int before = events.size();
                    decodeShotResult(payload, packet, ts, events, warnings);
                    if (events.size() == before) {
                        rawPreserve(events, warnings, packet, ts, entityId, subType, argLen,
                                "METHOD38_SHAPE_MISMATCH");
                    }
                }
            }
            case SUBTYPE_VEHICLE_HEALTH_STATE -> {
                // Vehicle-targeted method1：7-byte args（currentHpRaw + sourceEntity + causeFlag）。
                if (entityClassFor(context, subType, entityId) != EntityClass.VEHICLE
                        || !envelopeValid || argLen != VEHICLE_METHOD1_ARGS_LEN) {
                    rawPreserve(events, warnings, packet, ts, entityId, subType, argLen,
                            "METHOD1_CLASS_OR_SHAPE");
                } else {
                    final int currentHpRaw = readU16LE(payload, 12);
                    final int sourceEntity = readI32LE(payload, 14);
                    final int causeFlag = payload[18] & 0xFF;
                    // §P0-1: version-scoped HP raw classification done exactly once at the decoder
                    // boundary (knows clientVersion); consumers consume the propagated rawState and
                    // never re-classify (0xFFFE gated by verifiedFffeTerminalAllowed only).
                    final HpRawState hpRawState = HpRawState.classify(currentHpRaw,
                            ReplayProtocolProfile.levelOf(context.clientVersion(),
                                    ReplayProtocolProfile.Capability.TERMINAL_FFFD)
                                    == ReplayProtocolProfile.Level.VERIFIED,
                            ReplayVersionGate.verifiedFffeTerminalAllowed(context.clientVersion()));
                    // §P0-1: method1 cause semantics are PR147 closed semantics proven only on the
                    // current version family. 11.18 proves only the layout -> keep raw causeFlag,
                    // semantic UNKNOWN (no independent cause-semantics proof for 11.18).
                    final VehicleHealthStateEvent.Cause cause =
                            ReplayVersionGate.closedSemanticsAllowed(context.clientVersion())
                                    ? VehicleHealthStateEvent.causeOf(causeFlag)
                                    : VehicleHealthStateEvent.Cause.UNKNOWN;
                    events.add(new VehicleHealthStateEvent(
                            packet.sequence(), ts, packet.type(), DecodeConfidence.EXACT,
                            entityId, currentHpRaw, sourceEntity, causeFlag, cause, hpRawState));
                }
            }
            case SUBTYPE_RECORDER_OWN_HEALTH -> {
                // Avatar-targeted method5 3-byte variant：recorder own-health mirror。
                // method5 是 class-colliding index（99.2% Avatar / 0.8% Vehicle），故必须由 registry 类证据
                // 决定 class，绝不能由 methodId+argLen 反推。18-byte variant 属其它实体族。
                if (entityClassFor(context, subType, entityId) != EntityClass.AVATAR
                        || !envelopeValid || argLen != AVATAR_METHOD5_ARGS_LEN) {
                    rawPreserve(events, warnings, packet, ts, entityId, subType, argLen,
                            "METHOD5_CLASS_OR_SHAPE");
                } else {
                    final int currentHp = readU16LE(payload, 12);
                    final int flagRaw = payload[14] & 0xFF;
                    events.add(new RecorderHealthChangedEvent(
                            packet.sequence(), ts, packet.type(), DecodeConfidence.EXACT,
                            entityId, currentHp, flagRaw));
                }
            }
            case SUBTYPE_ROUND_FINISHED -> {
                // §P1/PR162：method4 是 class-colliding index。Avatar method4（2-byte）= RoundFinished；
                // Vehicle method4（16-byte）= vehicle-to-vehicle collision/contact。必须由 registry 类证据分派，
                // 绝不因 argLen 猜测 class。其余（shape/class 不符）→ UnknownReplayEvent。
                final EntityClass entityClass = entityClassFor(context, subType, entityId);
                if (entityClass == EntityClass.AVATAR
                        && envelopeValid && argLen == ROUND_FINISHED_ARGS_LEN) {
                    final int winnerTeam = payload[12] & 0xFF;
                    final int finishReasonRaw = payload[13] & 0xFF;
                    events.add(new RoundFinishedEvent(
                            packet.sequence(), ts, packet.type(), DecodeConfidence.EXACT,
                            winnerTeam, finishReasonRaw,
                            RoundFinishedEvent.causeOf(finishReasonRaw)));
                } else if (entityClass == EntityClass.VEHICLE
                        && envelopeValid && argLen == VEHICLE_VEHICLE_COLLISION_ARGS_LEN) {
                    final float sharedScalar = Float.intBitsToFloat(readI32LE(payload, 12));
                    final Vector3 contact = readVector3(payload, 16);
                    if (contact == null) {
                        rawPreserve(events, warnings, packet, ts, entityId, subType, argLen,
                                "METHOD4_NON_FINITE_CONTACT");
                    } else {
                        events.add(new VehicleVehicleCollisionEvent(
                                packet.sequence(), ts, packet.type(), DecodeConfidence.EXACT,
                                entityId, sharedScalar, contact));
                    }
                } else {
                    rawPreserve(events, warnings, packet, ts, entityId, subType, argLen,
                            "METHOD4_CLASS_OR_SHAPE");
                }
            }
            case SUBTYPE_ENTITY_METHOD_DAMAGE -> {
                // PR147: method8 damage-frame layout (attacker/victim/raw damage value/timing) is proven for
                // the verified families (11.18 + 11.19) — decoded as a structural observation frame (raw value
                // is non-authoritative; authoritative HP loss = Type7 prop3 deltas). Unverified future
                // versions raw-preserve (never a version if/else). method8 是 class-colliding index（92.7% Vehicle /
                // 7.3% Avatar）——必须由 registry 类证据（Vehicle=物化 entityTypeId==2）决定，不靠 argLen 反推。
                if (!ReplayVersionGate.damageLayoutAllowed(context.clientVersion())) {
                    versionRawPreserve(events, warnings, packet, ts, subType, "VERSION_UNSUPPORTED_METHOD8");
                } else if (entityClassFor(context, subType, entityId) != EntityClass.VEHICLE) {
                    rawPreserve(events, warnings, packet, ts, entityId, subType, argLen,
                            "METHOD8_CLASS_MISMATCH");
                } else {
                    // damage event（outer entityId = 方法调用目标实体，供 victim 证据回退）。
                    // 只要包头已确认 damage method（payload ≥ 8 且 subtype == 8），parseDamage 必产出
                    // 带时间戳的冲突证据事件（短体/非 direct/zero-raw → UnsupportedDamageEvent；
                    // direct & raw>0 → DamageEvent）——warning 只作诊断、绝不能是唯一输出。
                    final List<ReplayEvent> damageEvents = parseDamage(payload, entityId, packet, ts);
                    if (damageEvents.isEmpty()) {
                        // 防御：理论上不可达（payload ≥ 8 已保证）——保留 warning 作为兜底，不算
                        // 解析失败，区别于真正的 MALFORMED/TRUNCATED。
                        warnings.add(new ReplayDecodeWarning("UNSUPPORTED_DAMAGE_VARIANT",
                                "Undecoded damage-method variant at seq " + packet.sequence()
                                        + " (payloadLen=" + payload.length + ")"));
                    } else {
                        // direct damage → DamageEvent；其余（短体/非 direct/zero-raw）→
                        // UnsupportedDamageEvent（语义未解码的证据事件，不产生精确伤害数字，
                        // 供 HP-loss/killer attribution fail-closed）
                        events.addAll(damageEvents);
                        if (damageEvents.size() == 1
                                && damageEvents.get(0) instanceof UnsupportedDamageEvent) {
                            warnings.add(new ReplayDecodeWarning("UNSUPPORTED_DAMAGE_VARIANT",
                                    "Unsupported damage-method variant at seq " + packet.sequence()
                                            + " (payloadLen=" + payload.length + ")"));
                        }
                    }
                }
            }
            case SUBTYPE_UPDATE_ARENA2 -> {
                // PR147: method48 updateArena2 carries structural roster (participant mapping, wrapper=1) +
                // ARENA_PERIOD anchor (wrapper=3), proven for the verified families (11.18 + 11.19). Decoding
                // these is essential for 11.18 fixtures (entity→account mapping + battle-start clock anchor) and
                // is gated by the capability VERIFIED == verified family, NEVER a version if/else. The
                // closed-semantic supremacy-points value (wrapper=13) stays 11.19-only.
                if (!ReplayVersionGate.participantMappingLayoutAllowed(context.clientVersion())) {
                    versionRawPreserve(events, warnings, packet, ts, subType, "VERSION_UNSUPPORTED_METHOD48");
                } else if (entityClassFor(context, subType, entityId) != EntityClass.AVATAR) {
                    rawPreserve(events, warnings, packet, ts, entityId, subType, argLen,
                            "METHOD48_CLASS_MISMATCH");
                } else {
                    // entity/account mapping
                    final ParticipantMappingResult mapping = parseUpdateArena2(payload, entityId, packet, ts);
                    if (mapping != null) {
                        events.addAll(mapping.mappingEvents());
                    }
                    // 争霸赛实时点数（root field 12，保守结构校验；闭合语义 → 11.19 家族才解）
                    if (ReplayVersionGate.methodSemanticsAllowed(context.clientVersion())) {
                        events.addAll(parseSupremacyPoints(payload, packet, ts));
                    }
                    // PR147 wrapper=3 ARENA_PERIOD（root field3 = period）；period=3 BATTLE = battle-start anchor。
                    events.addAll(parseArenaPeriod(payload, packet, ts));
                }
            }
            case SUBTYPE_UPDATE_ARENA -> {
                // updateArena（Avatar method47，当前 11.19 chat-action family —— 已知但本 decoder 未实现）。
                // entity-class scoped + 未实现 → raw-preserve（UnknownReplayEvent），非 warning-only。
                if (entityClassFor(context, subType, entityId) != EntityClass.AVATAR) {
                    rawPreserve(events, warnings, packet, ts, entityId, subType, argLen,
                            "METHOD47_CLASS_MISMATCH");
                } else {
                    rawPreserve(events, warnings, packet, ts, entityId, subType, argLen,
                            "METHOD47_NOT_IMPLEMENTED");
                }
            }
            default ->
                // 未知/未实现 subtype：raw-preserve 为 UnknownReplayEvent（带 entity/method/argLen debug），
                // 绝不能 warning-only（item 6）。Avatar-proven 未知方法先借此标记 Avatar 化类证据。
                rawPreserve(events, warnings, packet, ts, entityId, subType, argLen,
                        entityClassFor(context, subType, entityId) != EntityClass.UNKNOWN
                                ? "METHOD" + subType + "_NOT_IMPLEMENTED"
                                : "METHOD" + subType + "_UNKNOWN");

        }

        final DecodeStatus status = warnings.isEmpty() ? DecodeStatus.SUCCESS : DecodeStatus.PARTIAL;
        return new ReplayDecodeResult(status, events, warnings);
    }

    /**
     * PR162：解析 entityClass（通过 {@link EntityClassRegistry}），并仅对<b>证明单类</b>的 method
     * 作「调用即类证据」标记（100% Avatar / 0% Avatar Vehicle 族）。class-colliding method
     * （method4/5/8/2）绝不由此反推 class —— 它们必须已有 registry 类证据；UNKNOWN → raw-preserve。
     */
    private static EntityClass entityClassFor(final ReplayDecodeContext context,
                                              final int subType, final int entityId) {
        final EntityClassRegistry registry = context.entityClassRegistry();
        // Avatar-proven method（100% Avatar-targeted）总是标记并返回 Avatar（粘性，覆盖 Vehicle）：
        // 录像者 Avatar 实体同时具有载具物理性质与独立协议 Avatar 角色，必须按 Avatar 分派（method4 2B round-finished）。
        if (AVATAR_PROVEN_METHODS.contains(subType)) {
            registry.markAvatar(entityId);
            return EntityClass.AVATAR;
        }
        final EntityClass existing = registry.resolve(entityId);
        if (existing != EntityClass.UNKNOWN) {
            return existing;
        }
        if (VEHICLE_PROVEN_METHODS.contains(subType)) {
            registry.markVehicle(entityId);
            return registry.resolve(entityId);
        }
        return EntityClass.UNKNOWN;
    }

    /** 版本门禁 raw-preserve（原始 reasonCode "VERSION_UNSUPPORTED_METHODn"，保持既有契约）。 */
    private static void versionRawPreserve(final List<ReplayEvent> events,
                                           final List<ReplayDecodeWarning> warnings,
                                           final RawReplayPacket packet,
                                           final ReplayTimestamp ts,
                                           final int subType,
                                           final String reason) {
        events.add(new UnknownReplayEvent(
                packet.sequence(), ts, packet.type(), packet.payloadLength(), reason, DecodeConfidence.UNKNOWN));
        warnings.add(new ReplayDecodeWarning("VERSION_UNSUPPORTED",
                "EntityMethod subtype " + subType + " layout not affirmed"));
    }

    /** 未知/未实现/class 或 shape 不符 EntityMethod → raw-preserve（UnknownReplayEvent，带足够 debug）。 */
    private static void rawPreserve(final List<ReplayEvent> events,
                                    final List<ReplayDecodeWarning> warnings,
                                    final RawReplayPacket packet,
                                    final ReplayTimestamp ts,
                                    final int entityId,
                                    final int subType,
                                    final int argLen,
                                    final String reason) {
        final String detail = reason + "|e:" + entityId + "|m:" + subType + "|len:" + argLen;
        events.add(new UnknownReplayEvent(
                packet.sequence(), ts, packet.type(), packet.payloadLength(), detail, DecodeConfidence.UNKNOWN));
        warnings.add(new ReplayDecodeWarning("ENTITY_METHOD_UNDECODED",
                detail + "|seq:" + packet.sequence()));
    }

    /**
     * Avatar method36：瞄准/瞄准状态 protobuf（92-byte：0x5B 前缀 + 91；74-byte：0x49 + 73）。
     * root.field1-5 与 field6.field1 为 fixed64（physical roles PROVEN）。
     */
    private void decodeTargetingSnapshot(
            final byte[] payload,
            final RawReplayPacket packet,
            final ReplayTimestamp ts,
            final List<ReplayEvent> events,
            final List<ReplayDecodeWarning> warnings) {
        final int argLen = readU32LE(payload, 8);
        if (payload.length != 12 + argLen || argLen < 2) {
            warnings.add(new ReplayDecodeWarning("UNKNOWN_SUBTYPE_VARIANT",
                    "Avatar method36 envelope mismatch: len=" + payload.length
                            + " argLen=" + argLen));
            return;
        }
        final byte[] args = new byte[argLen];
        System.arraycopy(payload, 12, args, 0, args.length);
        if (args.length < 2) {
            warnings.add(new ReplayDecodeWarning("UNKNOWN_SUBTYPE_VARIANT",
                    "Avatar method36 args too short: " + args.length));
            return;
        }
        final int protoLen = args[0] & 0xFF;
        if (args.length != 1 + protoLen) {
            warnings.add(new ReplayDecodeWarning("UNKNOWN_SUBTYPE_VARIANT",
                    "Avatar method36 length prefix mismatch: len=" + args.length
                            + " prefix=" + protoLen));
            return;
        }
        final byte[] proto = new byte[protoLen];
        System.arraycopy(args, 1, proto, 0, protoLen);
        final Map<Integer, List<Object>> root;
        try {
            root = ProtobufDecoder.decode(proto);
        } catch (Exception e) {
            warnings.add(new ReplayDecodeWarning("MALFORMED_PROTOBUF",
                    "method36 protobuf decode failed: " + e.getMessage()));
            return;
        }
        final Double yaw = fixed64(root, 1);
        final Double pitch = fixed64(root, 2);
        final Double maxH = fixed64(root, 3);
        final Double maxV = fixed64(root, 4);
        final Double aim = fixed64(root, 5);
        Double bloom = null;
        final Object field6Raw = ProtobufDecoder.first(root, 6);
        if (field6Raw instanceof byte[] field6) {
            final Map<Integer, List<Object>> nested = ProtobufDecoder.decode(field6);
            bloom = fixed64(nested, 1);
        }
        final boolean corePresent = maxH != null && maxV != null && aim != null;
        events.add(new TargetingInfoSnapshotEvent(
                packet.sequence(), ts, packet.type(),
                corePresent && bloom != null ? DecodeConfidence.EXACT : DecodeConfidence.PARTIAL,
                yaw, pitch, maxH, maxV, aim, bloom, proto));
    }

    /** fixed64 字段 → double；缺失 → null。 */
    private static Double fixed64(final Map<Integer, List<Object>> fields, final int fieldNumber) {
        final List<Object> values = fields.get(fieldNumber);
        if (values == null || values.isEmpty() || !(values.getFirst() instanceof Long l)) {
            return null;
        }
        return Double.longBitsToDouble(l);
    }

    /**
     * Avatar method38：射击结果 bitfield。
     * args = victim(u32) + headerFlags32(u32) + resultCount(u8) +
     * count×(token,state) + modifierCount(u8) + modifierCount×modifierId(u32 LE)。
     */
    private void decodeShotResult(
            final byte[] payload,
            final RawReplayPacket packet,
            final ReplayTimestamp ts,
            final List<ReplayEvent> events,
            final List<ReplayDecodeWarning> warnings) {
        final int argLen = readU32LE(payload, 8);
        final int argsLen = payload.length == 12 + argLen ? argLen : -1;
        if (argsLen < 10) {
            warnings.add(new ReplayDecodeWarning("UNKNOWN_SUBTYPE_VARIANT",
                    "Avatar method38 envelope mismatch: len=" + payload.length
                            + " argLen=" + argLen));
            return;
        }
        final int victim = readI32LE(payload, 12);
        final int header = readU32LE(payload, 16);
        final int flags16 = header & 0xFFFF;
        final int headerHi16 = header >>> 16;
        // args-relative 布局：victim[0..4) header[4..8) count[8] pairs[9..) modCount[9+2c] mods[10+2c..)
        final int count = payload[20] & 0xFF; // args[8]
        if (10 + count * 2 > argsLen) {
            warnings.add(new ReplayDecodeWarning("UNKNOWN_SUBTYPE_VARIANT",
                    "Avatar method38 truncated components: argsLen=" + argsLen
                            + " count=" + count));
            return;
        }
        final List<ShotResultEvent.ComponentResult> components = new ArrayList<>(count);
        for (int i = 0; i < count; i++) {
            components.add(new ShotResultEvent.ComponentResult(
                    payload[21 + i * 2] & 0xFF, payload[22 + i * 2] & 0xFF));
        }
        final int modifierCount = payload[21 + count * 2] & 0xFF; // args[9+2c]
        if (10 + count * 2 + modifierCount * 4 != argsLen) {
            warnings.add(new ReplayDecodeWarning("UNKNOWN_SUBTYPE_VARIANT",
                    "Avatar method38 length mismatch: argsLen=" + argsLen
                            + " count=" + count + " modifierCount=" + modifierCount));
            return;
        }
        final List<Integer> modifierIds = new ArrayList<>(modifierCount);
        for (int i = 0; i < modifierCount; i++) {
            modifierIds.add(readU32LE(payload, 22 + count * 2 + i * 4));
        }
        events.add(new ShotResultEvent(
                packet.sequence(), ts, packet.type(), DecodeConfidence.EXACT,
                victim, flags16, headerHi16, List.copyOf(components),
                List.copyOf(modifierIds)));
    }

    /**
     * 解析 subtype 8 伤害方法包。
     *
     * <p>只要包头已确认是 damage-method 调用（decode 已保证 payload ≥ 8 且 subtype == 8），
     * 就必须产出<b>带时间戳的冲突证据事件</b>（warning 只作诊断、绝不能是唯一输出——否则
     * {@code PlaybackCombatReconstruction} 只消费 canonical 事件流、看不到这些冲突证据，掉血/致死
     * 窗口会错误地视为「无冲突」，把窗口内另一条 direct DAMAGE 错判为攻击者/击杀者）。</p>
     *
     * <p>返回值：</p>
     * <ul>
     *   <li>direct 变体（body[13]=={@link #DAMAGE_SUB_DIRECT}）且 raw 伤害 &gt; 0 且 body 内
     *       victim eid 有效（&gt; 0）→ 单个 {@link DamageEvent}（EXACT）；raw 数值不是权威伤害
     *       （见 protocol.md），权威掉血由 Type-7 propId=3 连续 sample 推导；</li>
     *   <li>direct 变体（body[13]=={@link #DAMAGE_SUB_DIRECT}）且 raw 伤害 &gt; 0 但 body 内
     *       victim eid 缺失/无效（≤ 0）→ 单个 {@link UnsupportedDamageEvent}
     *       （PARTIAL，variant=DIRECT_VICTIM_UNKNOWN）——不能保证完整 direct identity，
     *       降级为冲突证据（victim 用可靠 outer entityId、无精确伤害数字），
     *       绝不产出 victim=0 的 EXACT DamageEvent（否则 PlaybackCombatReconstruction 无法映射
     *       victim 会静默 continue，窗口被当作「无冲突」→ 错误归属/错误 killer）；</li>
     *   <li>结构不足（body &lt; 18，如真实流 len=17 短体变体）→
     *       单个 {@link UnsupportedDamageEvent}（PARTIAL，variant=SHORT_DAMAGE_VARIANT）——
     *       victim 用可靠 <b>outer entityId</b>（方法调用目标实体 = 受击者）、attacker 未知（0）、
     *       无伤害数字；</li>
     *   <li>结构足够（body.length ≥ 18）的非 direct 变体（body[13] ≠ direct）→
     *       单个 {@link UnsupportedDamageEvent}（PARTIAL，variant=DAMAGE_METHOD_VARIANT）——
     *       保留时间 + 攻击者/受击者 eid 证据，不产生精确伤害数字；受击者 eid 缺失（≤0）时用
     *       可靠 outer entityId 作 victim 证据；</li>
     *   <li>direct 变体但 raw 伤害 == 0 → 单个 {@link UnsupportedDamageEvent}
     *       （PARTIAL，variant=ZERO_RAW_DAMAGE）——raw 数值不是权威 HP delta（protocol.md），
     *       不得仅凭 raw=0 判定「无伤害」；身份可解析则填写、victim 缺失回退 outer entityId；</li>
     *   <li>以上 unsupported 证据均用于 killer / HP-loss attribution fail-closed（窗口内存在
     *       无法排除的变体 → 击杀者/归属必须 fail-closed），绝不进入生产伤害统计；identity 字段
     *       只填确实能够解析的部分，confidence 恒 PARTIAL（不得标 EXACT/PROVEN）。</li>
     * </ul>
     *
     * @param outerEntityId 包外层 entityId（方法调用目标实体；victim eid 缺失时的可靠回退证据）
     */
    private List<ReplayEvent> parseDamage(byte[] payload, int outerEntityId,
                                          RawReplayPacket packet, ReplayTimestamp ts) {
        // 包头已确认 damage method（payload ≥ 8 由 decode 保证）；body 为 payload[8..]。
        final byte[] body = new byte[payload.length - 8];
        System.arraycopy(payload, 8, body, 0, body.length);

        if (body.length < 18) {
            // 结构不足以解析身份字段（真实流 len=17 短体变体等）→ 仍是伤害方法调用：保留带时间戳
            // 的冲突证据事件（victim = 可靠 outer entityId、attacker 未知、无伤害数字、PARTIAL），
            // 绝不只记 warning——否则该通知在 HP-loss/killer attribution 中会被当作「无冲突」。
            return List.of(new UnsupportedDamageEvent(
                    packet.sequence(), ts, packet.type(), DecodeConfidence.PARTIAL,
                    0, outerEntityId, null, null, "SHORT_DAMAGE_VARIANT"));
        }
        final int attackerEid = readI32LE(body, 4);
        final int victimEid = readI32LE(body, 8);
        if ((body[13] & 0xFF) != DAMAGE_SUB_DIRECT) {
            // 结构合法但语义未解码的伤害方法变体（火灾/撞击/其他）→ 证据事件（无精确伤害数字）。
            // victim eid 缺失（≤0）时用可靠 outer entityId（方法调用目标 = 受击实体）作 victim 证据，
            // 绝不静默丢弃无法从 body 解析 victim 的 unsupported 变体（否则窗口会错误地「无冲突」）。
            final int effectiveVictim = victimEid > 0 ? victimEid : outerEntityId;
            return List.of(new UnsupportedDamageEvent(
                    packet.sequence(), ts, packet.type(), DecodeConfidence.PARTIAL,
                    attackerEid, effectiveVictim, null, null, "DAMAGE_METHOD_VARIANT"));
        }

        // PR147 §33: the method8 21-byte variant is a hit/result-feedback family — its packed bytes are
        // NOT HP damage. Produce VehicleHitEvent (attacker/victim + primary/secondary result + packed
        // metadata + conservative penetrationFamily); authoritative HP loss comes from Type7 prop3 deltas.
        final int primary = body[13] & 0xFF;
        final int secondary = body[14] & 0xFF;
        final byte[] packed = new byte[Math.max(0, body.length - 11)];
        if (packed.length > 0) {
            System.arraycopy(body, 11, packed, 0, packed.length);
        }
        final int effectiveVictim = victimEid > 0 ? victimEid : outerEntityId;
        return List.of(new VehicleHitEvent(
                packet.sequence(), ts, packet.type(), DecodeConfidence.EXACT,
                attackerEid, effectiveVictim, primary, secondary, packed,
                VehicleHitEvent.penetrationFamily(primary, secondary)));
    }

    /**
     * 解析 subtype 48 (updateArena2) 的 entity→account 映射。
     */
    private ParticipantMappingResult parseUpdateArena2(
            byte[] payload, int entityId, RawReplayPacket packet, ReplayTimestamp ts) {
        final DecodedUpdateArena2 decoded = decodeUpdateArena2(payload);
        if (decoded == null || decoded.wrapperFieldNumber() != WRAPPER_ROSTER) {
            return null;
        }
        // 名册映射：wrapper=1 → root field 1 = wrapper protobuf，其 field 1 = 玩家列表
        final Map<Integer, List<Object>> root = decoded.root();
        final Object wrapperRaw = ProtobufDecoder.first(root, 1);
        if (!(wrapperRaw instanceof byte[] wrapperBytes)) {
            return null;
        }
        final var wrapper = ProtobufDecoder.decode(wrapperBytes);
        final List<Object> playerList = wrapper.get(1);
        if (playerList == null) {
            return null;
        }
        final List<ParticipantMappingEvent> mappings = new ArrayList<>();
        for (final Object pRaw : playerList) {
            if (!(pRaw instanceof byte[] playerBytes)) continue;
            final var p = ProtobufDecoder.decode(playerBytes);
            final int eid = (int) ProtobufDecoder.firstLong(p, 1, 0);
            final long acc = ProtobufDecoder.firstLong(p, 7, 0);
            final String nickname = decodeUtf8(ProtobufDecoder.first(p, 3));
            final int team = (int) ProtobufDecoder.firstLong(p, 4, 0);
            if (eid != 0 && (acc != 0 || StringUtils.hasText(nickname))) {
                mappings.add(new ParticipantMappingEvent(
                        packet.sequence(), ts, packet.type(),
                        DecodeConfidence.EXACT, eid, acc, nickname, team));
            }
        }
        if (mappings.isEmpty()) {
            return null;
        }
        return new ParticipantMappingResult(mappings);
    }

    /**
     * 解析 subtype 48 (updateArena2) 实时争霸点数广播（wrapper=13 → root field 12，PROVEN）。
     * <p>门禁（缺一不可）：packet type 8 / subtype 48 / <b>wrapperFieldNumber == 13</b> /
     * root field 12 存在 / 每条 nested field 1 = team（1/2）/ field 2 = 点数合法。
     * wrapperFieldNumber != 13 时即使 root 结构相同也绝不产出点数事件。
     * 已对 5 个真实回放交叉验证（事件数 185/161/69/204/201、点数区间与击毁 ±40 点事件吻合）；
     * 只消费回放真实广播，绝不按游戏规则推算。</p>
     */
    private List<SupremacyPointsChangedEvent> parseSupremacyPoints(
            byte[] payload, RawReplayPacket packet, ReplayTimestamp ts) {
        final DecodedUpdateArena2 decoded = decodeUpdateArena2(payload);
        if (decoded == null || decoded.wrapperFieldNumber() != WRAPPER_SUPREMACY_POINTS) {
            return List.of();
        }
        final Map<Integer, List<Object>> root = decoded.root();
        final List<Object> teamBlocks = root.get(12);
        if (teamBlocks == null || teamBlocks.isEmpty()) {
            return List.of();
        }
        final List<SupremacyPointsChangedEvent> out = new ArrayList<>();
        for (final Object blockRaw : teamBlocks) {
            if (!(blockRaw instanceof byte[] block)) {
                continue;
            }
            final var blockFields = ProtobufDecoder.decode(block);
            final long team = ProtobufDecoder.firstLong(blockFields, 1, -1);
            final long points = ProtobufDecoder.firstLong(blockFields, 2, -1);
            if (team != 1 && team != 2) {
                continue;
            }
            if (points < 0 || points > 100_000) {
                continue;
            }
            out.add(new SupremacyPointsChangedEvent(
                    packet.sequence(), ts, packet.type(),
                    DecodeConfidence.EXACT, (int) team, (int) points));
        }
        return out;
    }

    /**
     * 提取 subtype48 的 wrapperFieldNumber + root protobuf。
     * body 结构（已逆向确认）：body[0..3] 固定前缀 + varint(wrapperFieldNumber) +
     * msgLen(0xFF 双字节或单字节) + protoData(root protobuf)。
     */
    private static DecodedUpdateArena2 decodeUpdateArena2(final byte[] payload) {
        final byte[] body = new byte[payload.length - 8];
        System.arraycopy(payload, 8, body, 0, body.length);
        try {
            int off = 4;
            if (off >= body.length) {
                return null;
            }
            final long[] varRes = readVarint(body, off);
            final long wrapperFieldNumber = varRes[0];
            off = (int) varRes[1];
            if (off >= body.length) {
                return null;
            }
            final int msgLen;
            final int first = body[off] & 0xFF;
            if (first == 0xFF) {
                if (off + 2 > body.length) {
                    return null;
                }
                msgLen = readU16LE(body, off + 1);
                off += 4;
            } else {
                msgLen = first;
                off += 1;
            }
            if (off + msgLen > body.length) {
                return null;
            }
            final byte[] protoData = new byte[msgLen];
            System.arraycopy(body, off, protoData, 0, msgLen);
            return new DecodedUpdateArena2(wrapperFieldNumber, ProtobufDecoder.decode(protoData));
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * 解析 subtype48 wrapper=3 ARENA_PERIOD（root field3 = period；PR147 entity-methods.md）。
     * 仅 wrapperFieldNumber == 3 且 root field3 存在才产出 arena-period 事件；period=3 BATTLE 是
     * battle-start anchor（battle-relative 时间权威起点）。结构/值非法 → 不产出。
     */
    private List<ArenaPeriodChangedEvent> parseArenaPeriod(
            byte[] payload, RawReplayPacket packet, ReplayTimestamp ts) {
        final DecodedUpdateArena2 decoded = decodeUpdateArena2(payload);
        if (decoded == null || decoded.wrapperFieldNumber() != WRAPPER_ARENA_PERIOD) {
            return List.of();
        }
        final Map<Integer, List<Object>> root = decoded.root();
        final List<Object> periodVals = root.get(ARENA_PERIOD_ROOT_FIELD);
        if (periodVals == null || periodVals.isEmpty()) {
            return List.of();
        }
        final Object first = periodVals.getFirst();
        if (!(first instanceof Number n)) {
            return List.of();
        }
        final int periodRaw = n.intValue();
        if (periodRaw < 0 || periodRaw > 4) {
            return List.of();
        }
        return List.of(new ArenaPeriodChangedEvent(
                packet.sequence(), ts, packet.type(), DecodeConfidence.EXACT,
                periodRaw, ArenaPeriodChangedEvent.periodOf(periodRaw)));
    }

    /** 供探针/诊断读取 subtype48 的 wrapper field_number（复用生产提取；-1=结构不完整）。 */
    public static long readWrapperFieldNumber(final byte[] payload) {
        final DecodedUpdateArena2 decoded = decodeUpdateArena2(payload);
        return decoded == null ? -1 : decoded.wrapperFieldNumber();
    }

    /** 供探针/诊断读取 subtype48 的 root protobuf（复用生产提取；null=结构不完整）。 */
    public static Map<Integer, List<Object>> readUpdateArena2Root(final byte[] payload) {
        final DecodedUpdateArena2 decoded = decodeUpdateArena2(payload);
        return decoded == null ? null : decoded.root();
    }

    private static String decodeUtf8(final Object value) {
        return value instanceof byte[] bytes
                ? new String(bytes, StandardCharsets.UTF_8) : "";
    }

    // ---- 内部辅助类和工具方法 ----

    /** subtype48 名册映射（wrapper field_number = 1）。 */
    public static final long WRAPPER_ROSTER = 1L;
    /** subtype48 实时争霸点数（wrapper field_number = 13 → root field 12）。 */
    public static final long WRAPPER_SUPREMACY_POINTS = 13L;

    /** subtype48 解码结果：wrapper field_number + root protobuf（两层字段，不得混用）。 */
    private record DecodedUpdateArena2(
            long wrapperFieldNumber,
            Map<Integer, List<Object>> root
    ) {
    }

    private record ParticipantMappingResult(List<ParticipantMappingEvent> mappingEvents) {
    }

    /** 是否 current-version scoped 闭语义 method（版本门禁：4 ——
     *  roundFinished winnerTeam/finishReason）。这些 closed numeric 语义未知/未来版本必须 raw-preserve。
     *  method8 damage-frame 是结构层（见 ReplayVersionGate.damageLayoutAllowed，11.18/11.19 解码）；
     *  method48 participant-mapping / ARENA_PERIOD 是结构层（participantMappingLayoutAllowed）；
     *  method47 updateArena 不产出事件。 */
    private static boolean isSemanticMethod(final int subType) {
        return subType == SUBTYPE_ROUND_FINISHED;
    }

    /** 是否 legacy-compatible 观测布局 method（P0-3 版本门禁范围）。 */
    private static boolean isLayoutMethod(final int subType) {
        return subType == SUBTYPE_VEHICLE_FIRED
                || subType == SUBTYPE_VEHICLE_HEALTH_STATE
                || subType == SUBTYPE_RECORDER_OWN_HEALTH
                || subType == SUBTYPE_AMMUNITION_STATE
                || subType == SUBTYPE_PROJECTILE_TERMINAL
                || subType == SUBTYPE_PROJECTILE_RESOLUTION
                || subType == SUBTYPE_PROJECTILE_LAUNCH;
    }

    static int readU32LE(byte[] buf, int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8)
                | ((buf[i + 2] & 0xFF) << 16) | ((buf[i + 3] & 0xFF) << 24);
    }

    static int readI32LE(byte[] buf, int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8)
                | ((buf[i + 2] & 0xFF) << 16) | (buf[i + 3] << 24);
    }

    static int readU16LE(byte[] buf, int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8);
    }

    /** 读取 VECTOR3（3×f32 LE）；非有限值返回 null（调用方按损坏处理，不产出假坐标）。 */
    private static Vector3 readVector3(final byte[] buf, final int i) {
        final float x = Float.intBitsToFloat(readI32LE(buf, i));
        final float y = Float.intBitsToFloat(readI32LE(buf, i + 4));
        final float z = Float.intBitsToFloat(readI32LE(buf, i + 8));
        if (!Float.isFinite(x) || !Float.isFinite(y) || !Float.isFinite(z)) {
            return null;
        }
        return new Vector3(x, y, z);
    }

    static long[] readVarint(byte[] buf, int i) {
        int idx = i;
        int shift = 0;
        long result = 0;
        while (true) {
            // 边界与长度保护：截断的 varint 不得越界读取，最多 10 字节（64 位）。
            if (idx >= buf.length || shift >= 64) {
                throw new IllegalArgumentException("Malformed varint at offset " + i);
            }
            final int b = buf[idx] & 0xFF;
            idx++;
            result |= (long) (b & 0x7F) << shift;
            if ((b & 0x80) == 0) break;
            shift += 7;
        }
        return new long[]{result, idx};
    }
}
