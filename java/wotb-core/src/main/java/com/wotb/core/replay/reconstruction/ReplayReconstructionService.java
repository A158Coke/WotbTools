package com.wotb.core.replay.reconstruction;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.parse.ParsedReplay;
import com.wotb.core.parse.SettlementFacts;
import com.wotb.core.replay.decoder.EntityClass;
import com.wotb.core.replay.decoder.EntityClassRegistry;
import com.wotb.core.replay.decoder.EntityMethodDecoder;
import com.wotb.core.replay.decoder.MaterializationDecoder;
import com.wotb.core.replay.decoder.ReplayDecodeContext;
import com.wotb.core.replay.decoder.ReplayDecodeResult;
import com.wotb.core.replay.decoder.ReplayPacketDecoderRegistry;
import com.wotb.core.replay.decoder.ReplayProtocolProfile;
import com.wotb.core.replay.decoder.ReplayVersionGate;
import com.wotb.core.replay.event.ArenaPeriodChangedEvent;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.RoundFinishedEvent;
import com.wotb.core.replay.stream.PacketTypeDiagnostics;
import com.wotb.core.replay.stream.RawReplayPacket;
import com.wotb.core.replay.stream.ReplayPacketStreamReader;
import com.wotb.core.replay.stream.ReplayStreamDiagnostics;
import org.springframework.util.StringUtils;
import tools.jackson.databind.JsonNode;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 回放重建服务 —— 协调完整重建流程的主入口。
 */
public class ReplayReconstructionService {

    private final float maxClockSec;
    private final float clockToleranceSec;
    private final ReplayPacketDecoderRegistry decoderRegistry;

    public ReplayReconstructionService() {
        this(450f, 5f);
    }

    public ReplayReconstructionService(float maxClockSec, float clockToleranceSec) {
        this.maxClockSec = maxClockSec;
        this.clockToleranceSec = clockToleranceSec;
        this.decoderRegistry = ReplayPacketDecoderRegistry.createDefault();
    }

    /**
     * 无上下文重建（仅基于事件流，不影响参与者映射）。
     */
    public ReplayReconstruction reconstruct(byte[] replayBytes) throws IOException {
        return reconstruct(replayBytes, ReplayReconstructionContext.empty());
    }

    /**
     * 带上下文重建 —— 使用 roster 丰富参与者映射。
     */
    public ReplayReconstruction reconstruct(byte[] replayBytes, ReplayReconstructionContext context) throws IOException {
        return reconstruct(ParsedReplay.read(replayBytes), context);
    }

    /**
     * PR162/P0-2：消费 canonical parse context（归档解压、clientVersion、settlement 均只一次）。
     * reconstruction 不再自行 unzip / SettlementFacts.decode —— 二者已在 {@link ParsedReplay#read} 完成。
     */
    public ReplayReconstruction reconstruct(final ParsedReplay parsed, final ReplayReconstructionContext context)
            throws IOException {
        final Map<String, byte[]> entries = parsed.entries();

        // 1. 读取元数据（PR162/P1-4：meta.json 已由 ParsedReplay 一次解析，不再各自 readTree）
        final JsonNode meta = parsed.meta();
        final ReplayMetadata metadata = buildMetadata(meta);

        // 2. 读取 data.wotreplay 原始流
        final byte[] eventData = parsed.dataWotreplay();
        if (eventData == null || eventData.length == 0) {
            throw new IOException("Replay is missing data.wotreplay");
        }

        final ReplayPacketStreamReader.ReplayStreamResult streamResult;
        try {
            // PR162/P1-2：消费 ParsedReplay 已解析的 header，不再二次 parse。
            streamResult = parsed.streamHeader() != null
                    ? ReplayPacketStreamReader.read(eventData, parsed.streamHeader())
                    : ReplayPacketStreamReader.read(eventData);
        } catch (Exception e) {
            throw new IOException("Failed to read data.wotreplay stream: " + e.getMessage(), e);
        }

        // 3. 检查 450 秒限制（max observed raw clock；strict reader 只返回成功流）
        final float maxClock = streamResult.diagnostics().maxObservedRawClockSec();
        final float allowedMax = maxClockSec + clockToleranceSec;
        if (maxClock > allowedMax && !Float.isNaN(maxClock)) {
            throw new IllegalArgumentException("REPLAY_DURATION_EXCEEDED: maxClock="
                    + maxClock + " exceeds allowed max=" + allowedMax);
        }

        // 4. 解码所有包：版本门禁使用 data.wotreplay 流头内的权威 clientVersion
        //    （meta.json#clientVersionFromExe 经常为空；与 ReplayParser.battle.clientVersion 同源）。
        //    PR162/P0-1：entity class 由独立生命周期/身份证据（Type5 entityTypeId → Vehicle/Other；
        //    method48 参与映射中的 recorder 账号身份 → Avatar）在 prepass 建立，method decoder 纯消费，
        //    不再由 methodId 自证 class。
        final EntityClassRegistry entityClassRegistry =
                buildEntityClassRegistry(streamResult.packets(),
                        context.recorderAccountId(), streamResult.header().clientVersion());
        final ReplayDecodeContext decodeContext =
                new ReplayDecodeContext(streamResult.header().clientVersion(), entityClassRegistry);
        final List<ReplayEvent> allEvents = new ArrayList<>();
        final Map<Integer, TypeDecodeStats> typeDecodeStats = new HashMap<>();

        for (final RawReplayPacket rawPacket : streamResult.packets()) {
            final ReplayDecodeResult result = decoderRegistry.decode(decodeContext, rawPacket);

            typeDecodeStats.computeIfAbsent(rawPacket.type(), k -> new TypeDecodeStats());
            final TypeDecodeStats stats = typeDecodeStats.get(rawPacket.type());
            stats.total++;

            switch (result.status()) {
                case SUCCESS -> stats.decoded++;
                case PARTIAL -> stats.partial++;
                case UNSUPPORTED -> stats.unknown++;
                case FORMAT_MISMATCH, MALFORMED -> stats.failed++;
            }

            allEvents.addAll(result.events());
        }

        // PR147 resolved battle start: wrapper3 ARENA_PERIOD.BATTLE anchor, else RoundFinishedEvent
        // (method4/AFTERBATTLE) rawClock minus SETTLEMENT duration (battle_results root5), else null/UNKNOWN.
        // This single resolved value is what timeline / adapter / legacy producers agree on; it is NEVER
        // Type14 (stream-close), a raw session clock, or "stream max/last clock - settlement duration"
        // (that fabricated fallback has no PR147 authority and must not synthesize battle-start).
        // battle_results.dat 的唯一 production 解码权威（SettlementFacts）：reconstruction 不再自行
        // PickleReader.loads + Protobuf.decode；缺失/损坏时 fail-closed → null。
        // PR162/P0-2：settlement 已由 ParsedReplay 一次解码，缺失/损坏 fail-closed → null。
        final SettlementFacts settlementFacts = parsed.settlementFacts();
        final Double settledDur = settlementFacts == null ? null : settlementFacts.settlementDurationSec();
        final Float battleStartResolved = resolveBattleStartRawClock(allEvents, settledDur);

        // 5. 重建战场状态
        final BattleStateReconstructor reconstructor = new BattleStateReconstructor();
        final ReconstructionResult reconstructionResult =
                reconstructor.reconstruct(allEvents);

        // 6. 构建覆盖率
        final ReplayCoverage coverage = buildCoverage(streamResult.diagnostics(), typeDecodeStats);

        // 7. 从事件流 + context 构建参与者
        final List<BattleParticipant> participants = extractParticipants(allEvents, context);

        // 8. 更新诊断
        final ReplayStreamDiagnostics updatedDiagnostics = updateDiagnostics(
                streamResult.diagnostics(), typeDecodeStats);

        // 9. 组装结果 —— PR147 时钟域拆分：battleDurationSec 是「战斗时长」（battle-relative 跨度），
        // 绝不等于原始 session 的最大观测时钟（那是 maxObservedRawClockSec / streamMaxRawClockSec）。
        // 权威顺序：settlement root5 战斗时长 → meta.json#battleDuration → 0(UNKNOWN, fail-closed)。
        // P1-3：不再用 (max observed packet clock - battleStart) 作为未经标注的 estimate —— 包时钟不等同于
        // 战斗结束，避免把 estimate 当权威时长。
        final float battleDurationSec = resolveBattleDurationSec(settledDur, metadata);

        return new ReplayReconstruction(
                metadata,
                streamResult.header(),
                battleDurationSec,
                battleStartResolved,
                participants,
                List.copyOf(allEvents),
                reconstructionResult.checkpoints(),
                reconstructionResult.finalSnapshot(),
                coverage,
                updatedDiagnostics
        );
    }

    public ReplayPacketDecoderRegistry getDecoderRegistry() {
        return decoderRegistry;
    }

    // ---- 内部方法 ----

    /**
     * PR147 battle-start anchor: first wrapper3 ARENA_PERIOD.BATTLE event's rawClock.
     * Returns null when no BATTLE period transition is decoded. This is a package-private internal
     * sub-step of {@link #resolveBattleStartRawClock}, not a public testing API.
     */
    static Float battleStartRawClockFromArenaPeriod(final List<ReplayEvent> events) {
        if (events == null) {
            return null;
        }
        for (final ReplayEvent event : events) {
            if (event instanceof ArenaPeriodChangedEvent p
                    && p.period() == ArenaPeriodChangedEvent.Period.BATTLE) {
                final float raw = event.timestamp().rawClockSec();
                if (Float.isFinite(raw) && raw >= 0f) {
                    return raw;
                }
            }
        }
        return null;
    }

    /**
     * PR147 resolved battle-start raw clock: ① wrapper3 ARENA_PERIOD.BATTLE anchor; ② else the first
     * {@code RoundFinishedEvent} (method4/AFTERBATTLE) rawClock minus the SETTLEMENT duration
     * (battle_results root5); ③ else null. Never Type14/raw-session-clock. Single internal authority
     * for {@code ReplayReconstruction.battleStartRawClockSec}; not a public testing API.
     */
    private static Float resolveBattleStartRawClock(
            final List<ReplayEvent> events, final Double settlementDurationSec) {
        final Float anchor = battleStartRawClockFromArenaPeriod(events);
        if (anchor != null) {
            return anchor;
        }
        if (events == null) {
            return null;
        }
        for (final ReplayEvent event : events) {
            if (event instanceof RoundFinishedEvent rf && rf.timestamp() != null) {
                final float raw = rf.timestamp().rawClockSec();
                if (Float.isFinite(raw) && raw >= 0f && settlementDurationSec != null
                        && settlementDurationSec > 0) {
                    final double start = raw - settlementDurationSec;
                    if (Double.isFinite(start) && start >= 0) {
                        return (float) start;
                    }
                }
            }
        }
        return null;
    }

    /**
     * PR147 battle-relative duration authority chain. This is the <b>battle duration</b>, never the raw
     * session max raw clock (that is {@code diagnostics().maxObservedRawClockSec()} /
     * {@link ReplayReconstruction#streamMaxRawClockSec()}).
     * <ol>
     *   <li>settlement root5 (battle_results.dat; the authoritative battle duration);</li>
     *   <li>meta.json#battleDuration (metadata, weaker authority);</li>
     *   <li>0f (unknown → consumers needing battle-relative truth must fail closed).</li>
     * </ol>
     */
    private static float resolveBattleDurationSec(
            final Double settlementDurationSec,
            final ReplayMetadata metadata) {
        if (settlementDurationSec != null && settlementDurationSec > 0) {
            return settlementDurationSec.floatValue();
        }
        if (metadata.battleDurationSec() != null && metadata.battleDurationSec() > 0) {
            return metadata.battleDurationSec().floatValue();
        }
        return 0f;
    }

    private static ReplayMetadata buildMetadata(JsonNode meta) {
        final Long startTime = parseLong(text(meta, "battleStartTime"));
        return new ReplayMetadata(
                text(meta, "arenaUniqueId"),
                text(meta, "mapName"),
                text(meta, "version"),
                text(meta, "clientVersionFromExe"),
                meta.hasNonNull("arenaBonusType") ? meta.get("arenaBonusType").asInt() : null,
                text(meta, "playerName"),
                text(meta, "playerVehicleName"),
                meta.hasNonNull("battleDuration") ? meta.get("battleDuration").asDouble() : null,
                startTime != null && startTime > 1388534400L ? startTime : null
        );
    }

    private static String text(JsonNode n, String key) {
        return n.hasNonNull(key) ? n.get(key).asText() : "";
    }

    private static Long parseLong(String s) {
        try {
            if (!StringUtils.hasText(s)) return null;
            return Long.parseLong(s.trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static ReplayCoverage buildCoverage(
            ReplayStreamDiagnostics diagnostics,
            Map<Integer, TypeDecodeStats> typeStats) {

        int total = 0, decoded = 0, partial = 0, unknown = 0, failed = 0;
        final Map<Integer, ReplayCoverage.PacketTypeCoverage> typeCoverage = new HashMap<>();

        for (final Map.Entry<Integer, TypeDecodeStats> entry : typeStats.entrySet()) {
            final TypeDecodeStats s = entry.getValue();
            total += s.total;
            decoded += s.decoded;
            partial += s.partial;
            unknown += s.unknown;
            failed += s.failed;

            final double ratio = s.total > 0 ? (double) s.decoded / s.total : 0;
            typeCoverage.put(entry.getKey(), new ReplayCoverage.PacketTypeCoverage(
                    entry.getKey(), s.total, s.decoded, s.partial, s.unknown, s.failed, ratio));
        }

        final double overallRatio = total > 0 ? (double) decoded / total : 0;

        return new ReplayCoverage(
                total, decoded, partial, unknown, failed,
                overallRatio,
                typeCoverage
        );
    }

    private static ReplayStreamDiagnostics updateDiagnostics(
            ReplayStreamDiagnostics diagnostics,
            Map<Integer, TypeDecodeStats> typeStats) {

        final Map<Integer, PacketTypeDiagnostics> updatedTypes = new HashMap<>();
        for (final PacketTypeDiagnostics pt : diagnostics.packetTypes().values()) {
            final TypeDecodeStats stats = typeStats.get(pt.type());
            if (stats != null) {
                updatedTypes.put(pt.type(), new PacketTypeDiagnostics(
                        pt.type(), stats.total,
                        stats.decoded, stats.partial,
                        stats.unknown, stats.failed,
                        pt.firstClockSec(), pt.maxObservedRawClockSec()));
            } else {
                updatedTypes.put(pt.type(), pt);
            }
        }

        return new ReplayStreamDiagnostics(
                diagnostics.sourceSize(),
                diagnostics.packetCount(),
                diagnostics.firstClockSec(),
                diagnostics.maxObservedRawClockSec(),
                diagnostics.clockRegressionCount(),
                updatedTypes
        );
    }

    static List<BattleParticipant> extractParticipants(
            List<ReplayEvent> events, ReplayReconstructionContext context) {

        // 从事件流中提取 entity→account 映射
        final Map<Long, Integer> entityByAccount = new HashMap<>();
        for (final ReplayEvent event : events) {
            if (event instanceof ParticipantMappingEvent pm && pm.accountId() > 0) {
                entityByAccount.put(pm.accountId(), pm.entityId());
            }
        }

        // 使用 context 中的 roster 丰富参与者信息
        final Map<Long, PlayerResult> roster = context.playersByAccountId();
        final Battle battle = context.battle();
        final String recorderNick = context.recorderNickname();

        final List<BattleParticipant> participants = new ArrayList<>();
        for (final Map.Entry<Long, Integer> entry : entityByAccount.entrySet()) {
            final long accountId = entry.getKey();
            final PlayerResult pr = roster.get(accountId);
            final String nickname = pr != null ? pr.nickname : "";
            final int team = pr != null ? pr.team : 0;
            final long tankId = pr != null ? pr.tankId : 0;
            final boolean isRecorder = accountId == (context.recorderAccountId() != null ? context.recorderAccountId() : -1L)
                    || (recorderNick != null && nickname.equals(recorderNick));

            participants.add(new BattleParticipant(
                    accountId, nickname, team, (int) tankId, "", isRecorder));
        }

        return participants;
    }

    /**
     * PR162/P0-1：由<b>独立的生命周期/身份证据</b>建立 entity class，而非由 methodId 推断（禁止 method
     * decoder 自证 semantic namespace）。
     * <ul>
     *   <li>Type5 materialization：{@code entityTypeId==2 → Vehicle}；{@code ==3 → Other}；</li>
     *   <li>Type8 subtype48 参与映射（method48 content，结构性）：其 entity 映射到录像者账号
     *       （{@code recorderAccountId}，来自 reconstruction context / meta 身份）→ Avatar。这是
     *       <b>账号身份</b>证据，非 method numeric 身份推断（不再使用 subtype-49 numeric）。</li>
     * </ul>
     * recorderAccountId 未知/为 null 时不标记 Avatar（fail-closed）→ 语义解码时 avatar 方法 raw-preserve；
     * 不证明的 entityId 保持 {@link EntityClass#UNKNOWN}。
     */
    static EntityClassRegistry buildEntityClassRegistry(final List<RawReplayPacket> packets,
                                                        final Long recorderAccountId,
                                                        final String clientVersion) {
        final EntityClassRegistry registry = new EntityClassRegistry();
        if (packets == null) {
            return registry;
        }
        for (final RawReplayPacket p : packets) {
            final byte[] payload = p.payload();
            final int type = p.type();
            if (type == 5
                    && ReplayProtocolProfile.levelOf(clientVersion,
                            ReplayProtocolProfile.Capability.ENTITY_TYPE_ID_SEMANTIC)
                            == ReplayProtocolProfile.Level.VERIFIED) {
                //PR162/P1-1：消费 Type5 结构 envelope 的<b>唯一</b>解析点（MaterializationDecoder），
                // 不在 prepass 保留第二套 readU16LE/readI32LE wire parser。
                final MaterializationDecoder.MaterializationEnvelope env =
                        MaterializationDecoder.materializationEnvelope(payload);
                if (env != null) {
                    if (env.entityTypeId() == 2) {
                        registry.markVehicle(env.entityId());
                    } else if (env.entityTypeId() == 3) {
                        registry.markOther(env.entityId());
                    }
                }
            } else if (type == 8 && payload.length >= 12 && recorderAccountId != null
                    && readU32LE(payload, 4) == 48
                    && ReplayVersionGate.participantMappingLayoutAllowed(clientVersion)) {
                //PR162/P1-4：method48 参与映射仅当 capability VERIFIED 才可作为 recorder Avatar 身份证据；
                // future/unknown version（STRUCTURALLY_COMPATIBLE）method48 numeric identity 未认证 → raw，不得 markAvatar。
                for (final ParticipantMappingEvent e : EntityMethodDecoder.participantMappingEvents(payload, p)) {
                    if (e.accountId() == recorderAccountId && e.entityId() > 0) {
                        registry.markAvatar(e.entityId());
                    }
                }
            }
        }
        return registry;
    }

    private static int readU32LE(final byte[] buf, final int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8)
                | ((buf[i + 2] & 0xFF) << 16) | (buf[i + 3] << 24);
    }

    private static final class TypeDecodeStats {
        int total;
        int decoded;
        int partial;
        int unknown;
        int failed;
    }
}
