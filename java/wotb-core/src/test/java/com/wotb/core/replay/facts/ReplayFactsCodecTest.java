package com.wotb.core.replay.facts;

import com.wotb.core.model.Source;
import com.wotb.core.replay.processing.DefaultReplayProcessingFacade;
import com.wotb.core.replay.processing.ReplayProcessingOptions;
import com.wotb.core.replay.processing.ReplayProcessingResult;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;

/** Phase 5：AiReplayFacts 真实 fixture 全量往返 parity（plan §19–§20/§86）。 */
class ReplayFactsCodecTest {

    @Test
    void roundTripsFullReconstructionFromRealFixture() throws Exception {
        final Path dir = Path.of(System.getProperty("user.dir"), "..", "..", "common", "fixtures", "replays");
        final List<Path> files;
        try (var stream = Files.list(dir)) {
            files = stream.filter(p -> p.toString().toLowerCase().endsWith(".wotbreplay")).toList();
        }
        assertFalse(files.isEmpty(), "common/fixtures/replays 必须存在（CI 无条件执行）");
        final Path fixture = files.getFirst();

        final ReplayProcessingResult result = new DefaultReplayProcessingFacade().process(
                new Source(fixture.getFileName().toString(), Files.readAllBytes(fixture)),
                ReplayProcessingOptions.full());
        assertNotNull(result.battle());
        assertNotNull(result.reconstruction(), "full() 必须产生 reconstruction");

        final AiReplayFacts facts = AiReplayFacts.fromResult(result);
        final byte[] json = ReplayFactsCodec.toBytes(facts);
        final AiReplayFacts restored = ReplayFactsCodec.fromBytes(json);
        final ReplayProcessingResult round = restored.toResult();

        // 全量 parity：facts JSON 必须确定性且往返无损（统一走 write→parse 规范路径，
        // byte[] 组件以 base64 深度比较；数值按值比较）
        final JsonMapper mapper = JsonMapper.builder().build();
        assertDeepEqual(mapper.readTree(ReplayFactsCodec.toBytes(facts)),
                mapper.readTree(ReplayFactsCodec.toBytes(restored)), "$");

        // 结果级
        assertEquals(result.status(), round.status());
        assertEquals(result.capabilities(), round.capabilities());
        assertEquals(result.diagnostics(), round.diagnostics());
        assertEquals(result.fileName(), round.fileName());

        // Battle（无 equals，逐字段关键比对）
        assertEquals(result.battle().arenaId, round.battle().arenaId);
        assertEquals(result.battle().mapName, round.battle().mapName);
        assertEquals(result.battle().recorder, round.battle().recorder);
        assertEquals(result.battle().durationS, round.battle().durationS);
        assertEquals(result.battle().players.size(), round.battle().players.size());
        assertEquals(result.battle().players.getFirst().nickname, round.battle().players.getFirst().nickname);

        // Reconstruction 全量 parity（events/participants/coverage/diagnostics 均为 record equals）
        assertEquals(result.reconstruction().events().size(), round.reconstruction().events().size());
        assertEquals(result.reconstruction().participants(), round.reconstruction().participants());
        assertEquals(result.reconstruction().coverage(), round.reconstruction().coverage());
        assertEquals(result.reconstruction().diagnostics(), round.reconstruction().diagnostics());
        assertEquals(result.reconstruction().checkpoints().size(), round.reconstruction().checkpoints().size());
        assertEquals(result.reconstruction().replayDurationSec(), round.reconstruction().replayDurationSec());
        assertEquals(result.reconstruction().battleStartRawClockSec(), round.reconstruction().battleStartRawClockSec());
        assertEquals(result.reconstruction().metadata(), round.reconstruction().metadata());
        assertEquals(result.reconstruction().streamHeader().clientVersion(),
                round.reconstruction().streamHeader().clientVersion());
        assertEquals(result.reconstruction().finalState().entityCount(),
                round.reconstruction().finalState().entityCount());
    }

    /** 递归定位第一个 JSON 差异路径（用于快速修复，避免巨型 diff）。 */
    private static void assertDeepEqual(final JsonNode expected, final JsonNode actual, final String path) {
        if (expected.equals(actual)) {
            return;
        }
        if (expected.isObject() && actual.isObject()) {
            for (final var entry : expected.properties()) {
                final String name = entry.getKey();
                if (!actual.has(name)) {
                    throw new AssertionError("缺失字段: " + path + "." + name);
                }
                assertDeepEqual(entry.getValue(), actual.get(name), path + "." + name);
            }
            return;
        }
        if (expected.isArray() && actual.isArray() && expected.size() == actual.size()) {
            for (int i = 0; i < expected.size(); i++) {
                assertDeepEqual(expected.get(i), actual.get(i), path + "[" + i + "]");
            }
            return;
        }
        // 数值按值比较（IntNode vs LongNode 类型差异属良性：Object 反序列化默认类型）
        if (expected.isNumber() && actual.isNumber()) {
            if (expected.isIntegralNumber() && actual.isIntegralNumber()) {
                if (expected.asLong() == actual.asLong()) {
                    return;
                }
            } else if (expected.asDouble() == actual.asDouble()) {
                return;
            }
        }
        throw new AssertionError("分歧: " + path
                + "\n expectedType=" + expected.getNodeType() + " expected=" + expected
                + "\n actualType=" + actual.getNodeType() + " actual=" + actual);
    }
}
