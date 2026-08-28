package com.wotb.core.replay.reconstruction;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.parse.ReplayArchiveReader;
import com.wotb.core.replay.decoder.ReplayDecodeContext;
import com.wotb.core.replay.decoder.ReplayDecodeResult;
import com.wotb.core.replay.decoder.ReplayPacketDecoderRegistry;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.ArenaPeriodChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.stream.PacketTypeDiagnostics;
import com.wotb.core.replay.stream.RawReplayPacket;
import com.wotb.core.replay.stream.ReplayPacketStreamReader;
import com.wotb.core.replay.stream.ReplayStreamDiagnostics;
import org.springframework.util.StringUtils;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 回放重建服务 —— 协调完整重建流程的主入口。
 */
public class ReplayReconstructionService {

    private static final ObjectMapper MAPPER = JsonMapper.builder().build();

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
        final var entries = unzip(replayBytes);

        // 1. 读取元数据
        final JsonNode meta = parseMeta(entries);
        final ReplayMetadata metadata = buildMetadata(meta);

        // 2. 读取 data.wotreplay 原始流
        final byte[] eventData = entries.get("data.wotreplay");
        if (eventData == null || eventData.length == 0) {
            throw new IOException("Replay is missing data.wotreplay");
        }

        final ReplayPacketStreamReader.ReplayStreamResult streamResult;
        try {
            streamResult = ReplayPacketStreamReader.read(eventData);
        } catch (Exception e) {
            throw new IOException("Failed to read data.wotreplay stream: " + e.getMessage(), e);
        }

        // 3. 检查 450 秒限制
        final float lastClock = streamResult.diagnostics().lastClockSec();
        final float allowedMax = maxClockSec + clockToleranceSec;
        if (lastClock > allowedMax && !Float.isNaN(lastClock)) {
            throw new IllegalArgumentException("REPLAY_DURATION_EXCEEDED: lastClock="
                    + lastClock + " exceeds allowed max=" + allowedMax);
        }

        // 4. 解码所有包：版本门禁使用 data.wotreplay 流头内的权威 clientVersion
        //    （meta.json#clientVersionFromExe 经常为空；与 ReplayParser.battle.clientVersion 同源）。
        final ReplayDecodeContext decodeContext =
                new ReplayDecodeContext(streamResult.header().clientVersion());
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

        // PR147: subtype48 wrapper3 ARENA_PERIOD.BATTLE is the client-observed battle-start anchor.
        // Use its rawClock when present as the authority for battle-relative time (the stream heuristic
        // below only fills diagnostics; the anchor is the canonical source of battlesStartRawClockSec).
        final Float battleStartAnchorRawClock = battleStartRawClockFromArenaPeriod(allEvents);

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

        // 9. 组装结果
        final float replayDuration;
        if (!Float.isNaN(lastClock) && lastClock > 0) {
            replayDuration = lastClock;
        } else if (metadata.battleDurationSec() != null && metadata.battleDurationSec() > 0) {
            replayDuration = metadata.battleDurationSec().floatValue();
        } else {
            replayDuration = 0f;
        }

        return new ReplayReconstruction(
                metadata,
                streamResult.header(),
                replayDuration,
                battleStartAnchorRawClock != null
                        ? battleStartAnchorRawClock
                        : streamResult.diagnostics().battleStartRawClockSec(),
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
     * Returns null when no BATTLE period transition is decoded (caller falls back to diagnostics).
     */
    /** Public for direct unit-testing of the battle-start anchor logic. */
    public static Float battleStartRawClockFromArenaPeriod(final List<ReplayEvent> events) {
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

    private static JsonNode parseMeta(Map<String, byte[]> entries) throws IOException {
        if (entries.containsKey("meta.json")) {
            final JsonNode parsed = MAPPER.readTree(entries.get("meta.json"));
            if (parsed == null || !parsed.isObject()) {
                throw new IOException("Invalid meta.json: expected a JSON object");
            }
            return parsed;
        }
        return MAPPER.createObjectNode();
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
                diagnostics.streamComplete(),
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
                        pt.firstClockSec(), pt.lastClockSec()));
            } else {
                updatedTypes.put(pt.type(), pt);
            }
        }

        return new ReplayStreamDiagnostics(
                diagnostics.sourceSize(), diagnostics.scannedBytes(),
                diagnostics.packetCount(), diagnostics.normalPacketCount(),
                diagnostics.recoveredPacketCount(), diagnostics.resyncCount(),
                diagnostics.skippedByteCount(), diagnostics.trailingByteCount(),
                diagnostics.firstClockSec(), diagnostics.lastClockSec(),
                diagnostics.clockRegressionCount(),
                updatedTypes,
                diagnostics.battleStartIdentified(),
                diagnostics.battleStartRawClockSec(),
                diagnostics.reachedPhysicalEnd()
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

    private static Map<String, byte[]> unzip(byte[] data) throws IOException {
        return ReplayArchiveReader.read(data);
    }

    private static final class TypeDecodeStats {
        int total;
        int decoded;
        int partial;
        int unknown;
        int failed;
    }
}
