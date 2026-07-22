package com.wotb.core.replay.reconstruction;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;
import com.wotb.core.replay.decoder.ReplayDecodeContext;
import com.wotb.core.replay.decoder.ReplayDecodeResult;
import com.wotb.core.replay.decoder.ReplayPacketDecoderRegistry;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.stream.PacketTypeDiagnostics;
import com.wotb.core.replay.stream.RawReplayPacket;
import com.wotb.core.replay.stream.ReplayPacketStreamReader;
import com.wotb.core.replay.stream.ReplayStreamDiagnostics;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * 回放重建服务 —— 协调完整重建流程的主入口。
 * <p>
 * 职责：
 * <ol>
 *   <li>解压 .wotbreplay ZIP 存档</li>
 *   <li>读取 data.wotreplay 原始流</li>
 *   <li>解析 meta.json 和 battle_results.dat 元数据</li>
 *   <li>解码所有原始包为领域事件</li>
 *   <li>重建战场状态</li>
 *   <li>计算覆盖率和诊断信息</li>
 *   <li>输出完整 ReplayReconstruction 结果</li>
 * </ol>
 * </p>
 *
 * <p>此服务无状态，多请求并发时互不污染。</p>
 */
public class ReplayReconstructionService {

    private static final ObjectMapper MAPPER = JsonMapper.builder().build();
    private static final int MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
    private static final int MAX_META_JSON_BYTES = 1024 * 1024;
    private static final int MAX_BATTLE_RESULTS_BYTES = 8 * 1024 * 1024;
    private static final int MAX_DATA_WOTREPLAY_BYTES = 20 * 1024 * 1024;
    private static final int MAX_TOTAL_UNCOMPRESSED_BYTES = 24 * 1024 * 1024;

    /**
     * 最大允许时长（秒）
     */
    private final float maxClockSec;

    /**
     * 时钟容差（秒）
     */
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
     * 从 .wotbreplay 字节数组重建整场回放。
     *
     * @param replayBytes 完整的 .wotbreplay 文件内容
     * @return 完整重建结果
     * @throws IOException              如果存档损坏或元数据解析失败
     * @throws IllegalArgumentException 如果超出安全限制
     */
    public ReplayReconstruction reconstruct(byte[] replayBytes) throws IOException {
        return reconstruct(replayBytes, null, null);
    }

    /**
     * 从 .wotbreplay 字节数组重建整场回放。
     *
     * @param replayBytes      完整的 .wotbreplay 文件内容
     * @param tankCodeResolver Tank ID → tankCode 的解析函数（可选）
     * @param nicknameResolver 账号 → 昵称的解析函数（可选）
     * @return 完整重建结果
     */
    public ReplayReconstruction reconstruct(
            byte[] replayBytes,
            java.util.function.IntFunction<String> tankCodeResolver,
            java.util.function.LongFunction<String> nicknameResolver) throws IOException {

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

        // 4. 解码所有包
        final ReplayDecodeContext decodeContext = new ReplayDecodeContext(metadata.clientVersion());
        final List<ReplayEvent> allEvents = new ArrayList<>();
        final Map<Integer, TypeDecodeStats> typeDecodeStats = new HashMap<>();

        for (final RawReplayPacket rawPacket : streamResult.packets()) {
            final ReplayDecodeResult result = decoderRegistry.decode(decodeContext, rawPacket);

            // 初始化/更新类型统计
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

        // 5. 重建战场状态
        // 按原始顺序排列（已在 stream 中保证 sequence 顺序）
        final BattleStateReconstructor reconstructor = new BattleStateReconstructor();
        final BattleStateReconstructor.ReconstructionResult reconstructionResult =
                reconstructor.reconstruct(allEvents);

        // 6. 构建覆盖率
        final ReplayCoverage coverage = buildCoverage(
                streamResult.diagnostics(), typeDecodeStats);

        // 7. 构建参与者列表（从事件中提取）
        final List<BattleParticipant> participants = extractParticipants(allEvents, metadata);

        // 8. 更新诊断中的解码计数
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
                null, // battleStartRawClockSec — 暂未识别
                participants,
                List.copyOf(allEvents),
                reconstructionResult.checkpoints(),
                reconstructionResult.finalSnapshot(),
                coverage,
                updatedDiagnostics
        );
    }

    /**
     * 任意时刻状态查询（同步重建，不做缓存）。
     */
    public BattleStateSnapshot stateAt(byte[] replayBytes, float timeSec) throws IOException {
        final ReplayReconstruction reconstruction = reconstruct(replayBytes);
        return BattleStateReconstructor.stateAt(
                timeSec,
                reconstruction.events(),
                reconstruction.checkpoints());
    }

    /**
     * 获取 decoder registry（用于测试和扩展）。
     */
    public ReplayPacketDecoderRegistry getDecoderRegistry() {
        return decoderRegistry;
    }

    // ---- 内部方法 ----

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
            if (s == null || s.isBlank()) return null;
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
                diagnostics.battleStartRawClockSec()
        );
    }

    private static List<BattleParticipant> extractParticipants(
            List<ReplayEvent> events, ReplayMetadata metadata) {

        // 从 ParticipantMappingEvent 中提取
        final Map<Long, Integer> accToEntity = new HashMap<>();
        for (final ReplayEvent event : events) {
            if (event instanceof com.wotb.core.replay.event.ParticipantMappingEvent pm) {
                accToEntity.put(pm.accountId(), pm.entityId());
            }
        }

        // 由于重建阶段没有完整的 roster 信息
        // 参与者信息暂时只包含已知映射，nickname 和 tankCode 留空
        final List<BattleParticipant> participants = new ArrayList<>();
        for (final Map.Entry<Long, Integer> entry : accToEntity.entrySet()) {
            participants.add(new BattleParticipant(
                    entry.getKey(), "", 0, 0, "", false));
        }

        return participants;
    }

    private static Map<String, byte[]> unzip(byte[] data) throws IOException {
        if (data == null) throw new IOException("Replay archive is null");
        if (data.length > MAX_ARCHIVE_BYTES)
            throw new IOException("Replay archive exceeds compressed size limit");

        final Map<String, byte[]> out = new HashMap<>();
        final Map<String, Integer> ENTRY_SIZE_LIMITS = Map.of(
                "meta.json", MAX_META_JSON_BYTES,
                "battle_results.dat", MAX_BATTLE_RESULTS_BYTES,
                "data.wotreplay", MAX_DATA_WOTREPLAY_BYTES);
        final Set<String> seenEntryNames = new HashSet<>();

        try (ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(data))) {
            ZipEntry entry;
            byte[] tmp = new byte[8192];
            int entryCount = 0;
            int totalUncompressedBytes = 0;

            while ((entry = zis.getNextEntry()) != null) {
                entryCount++;
                if (entryCount > ENTRY_SIZE_LIMITS.size()) {
                    throw new IOException("Replay archive contains too many entries");
                }

                String entryName = entry.getName();
                if (entry.isDirectory() || !ENTRY_SIZE_LIMITS.containsKey(entryName)) {
                    throw new IOException("Unexpected replay entry: " + entryName);
                }
                if (!seenEntryNames.add(entryName)) {
                    throw new IOException("Duplicate replay entry: " + entryName);
                }

                int entryLimit = ENTRY_SIZE_LIMITS.get(entryName);
                long declaredSize = entry.getSize();
                if (declaredSize < -1 || declaredSize > entryLimit)
                    throw new IOException("Replay entry too large: " + entryName);

                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                int read;
                int entryBytes = 0;
                while ((read = zis.read(tmp)) != -1) {
                    if (read == 0) continue;
                    if ((long) entryBytes + read > entryLimit)
                        throw new IOException("Replay entry too large: " + entryName);
                    if ((long) totalUncompressedBytes + read > MAX_TOTAL_UNCOMPRESSED_BYTES)
                        throw new IOException("Replay uncompressed data exceeds total size limit");
                    bos.write(tmp, 0, read);
                    entryBytes += read;
                    totalUncompressedBytes += read;
                }
                out.put(entryName, bos.toByteArray());
                zis.closeEntry();
            }
        }
        return out;
    }

    private static final class TypeDecodeStats {
        int total;
        int decoded;
        int partial;
        int unknown;
        int failed;
    }
}
