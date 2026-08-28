package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.AmmunitionStateEvent;
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
import com.wotb.core.replay.event.VehicleHealthStateEvent;
import com.wotb.core.replay.reconstruction.Vector3;
import com.wotb.core.replay.stream.RawReplayPacket;
import org.springframework.util.StringUtils;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Type 8 (EntityMethod) 解码器。
 * <p>
 * 复用现有解析逻辑：
 * <ul>
 *   <li>entity/account 映射（subtype 48 updateArena2）</li>
 *   <li>direct HP damage（subtype 8 damage, sub 3 direct）</li>
 *   <li>updateArena（subtype 47）</li>
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
    static final int AVATAR_METHOD5_ARGS_LEN = 3;
    static final int VEHICLE_METHOD1_ARGS_LEN = 7;
    static final int VEHICLE_METHOD0_ARGS_LEN = 1;
    static final int AMMUNITION_STATE_ARGS_LEN = 12;
    /** method20 args：shotId(u32) + endpoint(3×f32) = 16 B（packet = 28 B）。 */
    static final int PROJECTILE_TERMINAL_ARGS_LEN = 16;
    static final int PROJECTILE_RESOLUTION_ARGS_LEN = 34;
    static final int PROJECTILE_LAUNCH_ARGS_LEN = 37;

    @Override
    public boolean supports(ReplayDecodeContext context, RawReplayPacket packet) {
        return packet.type() == TYPE_ENTITY_METHOD;
    }

    @Override
    public ReplayDecodeResult decode(ReplayDecodeContext context, RawReplayPacket packet) {
        final byte[] payload = packet.payload();
        // §A2：method0/1/5/17/20/27/29 等观测布局 11.18/11.19 稳定（legacy-compatible），不限版本族；
        // method38 low16/modifier/component 与 method36 field semantics 是 PR147 仅 11.19 controlled
        // 证明的 closed semantics（见下方 switch 内 per-subtype 门禁）。
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

        switch (subType) {
            case SUBTYPE_VEHICLE_FIRED -> {
                // Vehicle method0：observed firing（args=01 4,154/4,154）。
                if (envelopeValid && argLen == VEHICLE_METHOD0_ARGS_LEN) {
                    events.add(new VehicleFiredEvent(
                            packet.sequence(), ts, packet.type(), DecodeConfidence.EXACT,
                            entityId, payload[12] & 0xFF));
                } else {
                    warnings.add(new ReplayDecodeWarning("UNKNOWN_SUBTYPE_VARIANT",
                            "Vehicle method0 variant argLen=" + argLen
                                    + " not decoded (expected " + VEHICLE_METHOD0_ARGS_LEN + ")"));
                }
            }
            case SUBTYPE_AMMUNITION_STATE -> {
                if (envelopeValid && argLen == AMMUNITION_STATE_ARGS_LEN) {
                    final int descriptor = readU32LE(payload, 12);
                    final int flag = payload[16] & 0xFF;
                    final int quantity = payload[17] & 0xFF;
                    final byte[] variantRaw = new byte[6];
                    System.arraycopy(payload, 18, variantRaw, 0, variantRaw.length);
                    events.add(new AmmunitionStateEvent(
                            packet.sequence(), ts, packet.type(), DecodeConfidence.EXACT,
                            entityId, descriptor, flag, quantity, variantRaw));
                } else {
                    warnings.add(new ReplayDecodeWarning("UNKNOWN_SUBTYPE_VARIANT",
                            "Avatar method17 variant argLen=" + argLen
                                    + " not decoded (expected " + AMMUNITION_STATE_ARGS_LEN + ")"));
                }
            }
            case SUBTYPE_PROJECTILE_TERMINAL -> {
                if (envelopeValid && argLen == PROJECTILE_TERMINAL_ARGS_LEN) {
                    final int shotId = readU32LE(payload, 12);
                    final Vector3 endpoint = readVector3(payload, 16);
                    if (endpoint == null) {
                        warnings.add(new ReplayDecodeWarning("NON_FINITE_VECTOR",
                                "method20 endpoint non-finite at shot " + shotId));
                    } else {
                        events.add(new ProjectileTerminalEvent(
                                packet.sequence(), ts, packet.type(), DecodeConfidence.EXACT,
                                shotId, endpoint));
                    }
                } else {
                    warnings.add(new ReplayDecodeWarning("UNKNOWN_SUBTYPE_VARIANT",
                            "Avatar method20 variant argLen=" + argLen
                                    + " not decoded (expected " + PROJECTILE_TERMINAL_ARGS_LEN + ")"));
                }
            }
            case SUBTYPE_PROJECTILE_RESOLUTION -> {
                if (envelopeValid && argLen == PROJECTILE_RESOLUTION_ARGS_LEN) {
                    final int shotId = readU32LE(payload, 12);
                    final int field47 = readU32LE(payload, 16);
                    final int materialLike = payload[20] & 0xFF;
                    final Vector3 terminal = readVector3(payload, 21);
                    final Vector3 vectorLike = readVector3(payload, 33);
                    final int flagLike = payload[45] & 0xFF;
                    if (terminal == null || vectorLike == null) {
                        warnings.add(new ReplayDecodeWarning("NON_FINITE_VECTOR",
                                "method27 non-finite vector at shot " + shotId));
                    } else {
                        events.add(new ProjectileResolutionEvent(
                                packet.sequence(), ts, packet.type(), DecodeConfidence.EXACT,
                                shotId, field47, materialLike, terminal, vectorLike, flagLike));
                    }
                } else {
                    warnings.add(new ReplayDecodeWarning("UNKNOWN_SUBTYPE_VARIANT",
                            "Avatar method27 variant argLen=" + argLen
                                    + " not decoded (expected " + PROJECTILE_RESOLUTION_ARGS_LEN + ")"));
                }
            }
            case SUBTYPE_PROJECTILE_LAUNCH -> {
                if (envelopeValid && argLen == PROJECTILE_LAUNCH_ARGS_LEN) {
                    final int shooterEntityId = readI32LE(payload, 12);
                    final int shotId = readU32LE(payload, 16);
                    final int flag = payload[20] & 0xFF;
                    final Vector3 launchPoint = readVector3(payload, 21);
                    final Vector3 launchVelocity = readVector3(payload, 33);
                    final float invariant = Float.intBitsToFloat(readI32LE(payload, 45));
                    if (launchPoint == null || launchVelocity == null) {
                        warnings.add(new ReplayDecodeWarning("NON_FINITE_VECTOR",
                                "method29 non-finite vector at shot " + shotId));
                    } else {
                        events.add(new ProjectileLaunchedEvent(
                                packet.sequence(), ts, packet.type(), DecodeConfidence.EXACT,
                                shooterEntityId, shotId, flag, launchPoint, launchVelocity,
                                invariant));
                    }
                } else {
                    warnings.add(new ReplayDecodeWarning("UNKNOWN_SUBTYPE_VARIANT",
                            "Avatar method29 variant argLen=" + argLen
                                    + " not decoded (expected " + PROJECTILE_LAUNCH_ARGS_LEN + ")"));
                }
            }
            case SUBTYPE_TARGETING_SNAPSHOT -> {
                // §A2：method36 field semantics 是 PR147 仅 11.19 controlled 证明的 closed semantics；
                // 非 11.19 → raw-preserve（UnknownReplayEvent）+ diagnostics，不伪造 numeric semantic。
                if (ReplayVersionGate.closedSemanticsAllowed(context.clientVersion())) {
                    decodeTargetingSnapshot(payload, packet, ts, events, warnings);
                } else {
                    events.add(new UnknownReplayEvent(
                            packet.sequence(), ts, packet.type(), payload.length,
                            "VERSION_UNSUPPORTED_METHOD36", DecodeConfidence.UNKNOWN));
                    warnings.add(new ReplayDecodeWarning("VERSION_UNSUPPORTED",
                            "method36 closed semantics not affirmed: " + context.clientVersion()));
                }
            }
            case SUBTYPE_SHOT_RESULT -> {
                // §A2：method38 low16/modifier/component namespace 是 PR147 仅 11.19 controlled 证明的 closed semantics。
                if (ReplayVersionGate.closedSemanticsAllowed(context.clientVersion())) {
                    decodeShotResult(payload, packet, ts, events, warnings);
                } else {
                    events.add(new UnknownReplayEvent(
                            packet.sequence(), ts, packet.type(), payload.length,
                            "VERSION_UNSUPPORTED_METHOD38", DecodeConfidence.UNKNOWN));
                    warnings.add(new ReplayDecodeWarning("VERSION_UNSUPPORTED",
                            "method38 closed semantics not affirmed: " + context.clientVersion()));
                }
            }
            case SUBTYPE_VEHICLE_HEALTH_STATE -> {
                // Vehicle-targeted method1：7-byte args（currentHpRaw + sourceEntity + causeFlag）。
                // 当前 corpus 3,471/3,471 currentHpRaw 与同刻 prop3 raw16 一致；causeFlag
                // 0/1/2/3/5 PROVEN（含 drowning 控制样本）。非 7-byte 变体 → 不臆测，保留 raw。
                if (envelopeValid && argLen == VEHICLE_METHOD1_ARGS_LEN) {
                    final int currentHpRaw = readU16LE(payload, 12);
                    final int sourceEntity = readI32LE(payload, 14);
                    final int causeFlag = payload[18] & 0xFF;
                    events.add(new VehicleHealthStateEvent(
                            packet.sequence(), ts, packet.type(), DecodeConfidence.EXACT,
                            entityId, currentHpRaw, sourceEntity, causeFlag,
                            VehicleHealthStateEvent.causeOf(causeFlag)));
                } else {
                    warnings.add(new ReplayDecodeWarning("UNKNOWN_SUBTYPE_VARIANT",
                            "Vehicle method1 variant argLen=" + argLen
                                    + " not decoded (expected " + VEHICLE_METHOD1_ARGS_LEN + ")"));
                }
            }
            case SUBTYPE_RECORDER_OWN_HEALTH -> {
                // Avatar-targeted method5 3-byte variant：recorder own-health mirror。
                // 18-byte variant 属其它实体族，不得按 u16+flag 解码（entity-class routing）。
                if (envelopeValid && argLen == AVATAR_METHOD5_ARGS_LEN) {
                    final int currentHp = readU16LE(payload, 12);
                    final int flagRaw = payload[14] & 0xFF;
                    events.add(new RecorderHealthChangedEvent(
                            packet.sequence(), ts, packet.type(), DecodeConfidence.EXACT,
                            entityId, currentHp, flagRaw));
                } else {
                    warnings.add(new ReplayDecodeWarning("UNKNOWN_SUBTYPE_VARIANT",
                            "Avatar method5 variant argsLen=" + (payload.length - 8)
                                    + " not decoded (expected " + AVATAR_METHOD5_ARGS_LEN + ")"));
                }
            }
            case SUBTYPE_ENTITY_METHOD_DAMAGE -> {
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
            case SUBTYPE_UPDATE_ARENA2 -> {
                // entity/account mapping
                final ParticipantMappingResult mapping = parseUpdateArena2(payload, entityId, packet, ts);
                if (mapping != null) {
                    events.addAll(mapping.mappingEvents());
                }
                // 争霸赛实时点数（root field 12，保守结构校验；结构不合法/数值非法 → 跳过）
                events.addAll(parseSupremacyPoints(payload, packet, ts));
            }
            case SUBTYPE_UPDATE_ARENA -> {
                // updateArena - 暂时不做实体映射，现有功能已覆盖
                // 后续可以解析 arena snapshot
            }
            default ->
                // 未知 subtype，记录 unknown 事件
                    warnings.add(new ReplayDecodeWarning("UNKNOWN_SUBTYPE",
                            "Unknown EntityMethod subtype: " + subType));

        }

        final DecodeStatus status = warnings.isEmpty() ? DecodeStatus.SUCCESS : DecodeStatus.PARTIAL;
        return new ReplayDecodeResult(status, events, warnings);
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

        final int damage = (body[14] & 0xFF) << 8 | (body[15] & 0xFF);
        if (damage <= 0) {
            // direct 变体但 raw == 0：raw 数值不是权威 HP delta（protocol.md），不得仅凭 raw=0
            // 判定「无伤害」→ 作为 unsupported/conflict 证据保留（身份可解析则填写，victim 缺失
            // 回退 outer entityId）——否则该通知会被当作「无冲突」，窗口内另一条 direct DAMAGE
            // 可能被错判为攻击者/击杀者。
            final int effectiveVictim = victimEid > 0 ? victimEid : outerEntityId;
            return List.of(new UnsupportedDamageEvent(
                    packet.sequence(), ts, packet.type(), DecodeConfidence.PARTIAL,
                    attackerEid, effectiveVictim, null, null, "ZERO_RAW_DAMAGE"));
        }
        if (victimEid <= 0) {
            // direct raw>0 但 body 内 victim eid 缺失/无效：不能保证完整 direct identity——
            // 降级为 UnsupportedDamageEvent（PARTIAL，victim 用可靠 outer entityId），
            // 绝不产出 victim=0 的 EXACT DamageEvent（否则 PlaybackCombatReconstruction 无法
            // 映射 victim 会静默 continue，窗口被当作「无冲突」→ 错误归属/错误 killer）。
            return List.of(new UnsupportedDamageEvent(
                    packet.sequence(), ts, packet.type(), DecodeConfidence.PARTIAL,
                    attackerEid, outerEntityId, null, null, "DIRECT_VICTIM_UNKNOWN"));
        }

        return List.of(new DamageEvent(
                packet.sequence(), ts, packet.type(), DecodeConfidence.EXACT,
                attackerEid, victimEid, null, null, damage, false));
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
