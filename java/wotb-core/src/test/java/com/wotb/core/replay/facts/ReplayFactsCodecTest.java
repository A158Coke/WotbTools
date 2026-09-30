package com.wotb.core.replay.facts;

import com.fasterxml.jackson.annotation.JsonAutoDetect;
import com.fasterxml.jackson.annotation.PropertyAccessor;
import com.wotb.core.model.Battle;
import com.wotb.core.model.Source;
import com.wotb.core.replay.processing.DefaultReplayProcessingFacade;
import com.wotb.core.replay.processing.ReplayProcessingOptions;
import com.wotb.core.replay.processing.ReplayProcessingResult;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ShotResultEvent;
import com.wotb.core.replay.reconstruction.BattleStateCheckpoint;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.VehicleState;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link ReplayFactsCodec} 保留的客户端投影解码契约（{@code Battle} + {@code ReplayReconstruction}）。
 *
 * <p>stored facts 的写入侧（{@code AiReplayFacts} / {@code toBytes} / {@code fromBytes}）已随
 * ai-facts artifact 移除，因此这里锁定 standalone ai-service 仍然消费的解码方向：真实 fixture 的
 * 解析结果按客户端投影 wire 形态（{@code ReplayEvent} 带 {@code {"type": <简单类名>}} 多态标记）
 * 重新编码，再经保留的 {@code battleFromJson} / {@code reconstructionFromJson} 解回。</p>
 *
 * <p>断言按「客户端投影是同一批事实的另一种表示」来写：结构完整 + 元素数量 + 代表性标量，
 * 而不是要求解码后的 Java 对象图与服务端对象图 {@code equals}（客户端数字精度、省略/显式 null、
 * 集合顺序都可能合理地不同）。</p>
 */
class ReplayFactsCodecTest {

    /**
     * 客户端投影编码器：字段可见性与 wire 契约一致（含 private field POJO，如 {@code VehicleState}），
     * 否则投影会缺字段而无法解回。
     */
    private static final JsonMapper MAPPER = JsonMapper.builder()
            .changeDefaultVisibility(vc -> vc.withVisibility(
                    PropertyAccessor.FIELD, JsonAutoDetect.Visibility.ANY))
            .build();

    private static ReplayProcessingResult result;

    @BeforeAll
    static void processFixtureOnce() throws Exception {
        final Path dir = Path.of(System.getProperty("user.dir"), "..", "..", "common", "fixtures", "replays");
        final List<Path> files;
        try (var stream = Files.list(dir)) {
            files = stream.filter(p -> p.toString().toLowerCase().endsWith(".wotbreplay")).toList();
        }
        assertFalse(files.isEmpty(), "common/fixtures/replays 必须存在（CI 无条件执行）");
        final Path fixture = files.getFirst();
        result = new DefaultReplayProcessingFacade().process(
                new Source(fixture.getFileName().toString(), Files.readAllBytes(fixture)),
                ReplayProcessingOptions.full());
        assertNotNull(result.battle());
        assertNotNull(result.reconstruction(), "full() 必须产生 reconstruction");
    }

    @Test
    void decodesBattleFromClientProjectionJson() throws Exception {
        final Battle battle = result.battle();

        final Battle decoded = ReplayFactsCodec.battleFromJson(MAPPER.valueToTree(battle));

        assertEquals(battle.arenaId, decoded.arenaId);
        assertEquals(battle.mapName, decoded.mapName);
        assertEquals(battle.recorder, decoded.recorder);
        assertEquals(battle.durationS, decoded.durationS);
        assertEquals(battle.winnerTeam, decoded.winnerTeam);
        assertEquals(battle.players.size(), decoded.players.size());
        assertEquals(battle.players.getFirst().nickname, decoded.players.getFirst().nickname);
        assertEquals(battle.players.getFirst().team, decoded.players.getFirst().team);
        assertEquals(battle.players.getFirst().damageDealt, decoded.players.getFirst().damageDealt);
    }

    @Test
    void decodesReconstructionFromClientProjectionJson() throws Exception {
        final ReplayReconstruction source = result.reconstruction();
        assertFalse(source.events().isEmpty(), "fixture 必须产生事件，否则覆盖不到 ReplayEvent 反序列化");

        final ReplayReconstruction decoded =
                ReplayFactsCodec.reconstructionFromJson(clientProjection(source));

        // AI 消费的 section 必须存在且结构完整（数量级一致）。
        assertNotNull(decoded);
        assertNotNull(decoded.streamHeader());
        assertNotNull(decoded.coverage());
        assertNotNull(decoded.finalState());
        assertEquals(source.participants().size(), decoded.participants().size());
        assertEquals(source.events().size(), decoded.events().size());
        assertEquals(source.checkpoints().size(), decoded.checkpoints().size());
        assertEquals(source.finalState().entityCount(), decoded.finalState().entityCount());

        // sealed ReplayEvent 的 subtype dispatch 仍然解析（{"type": ...} + canonical constructor）。
        assertEquals(source.events().getFirst().getClass(), decoded.events().getFirst().getClass());
        assertNotNull(decoded.events().getFirst().timestamp());

        // 代表性标量：时长/开战时钟 + 一个 checkpoint + 一辆车。
        assertEquals(source.battleDurationSec(), decoded.battleDurationSec());
        assertEquals(source.battleStartRawClockSec(), decoded.battleStartRawClockSec());
        final BattleStateCheckpoint expectedCheckpoint = source.checkpoints().getLast();
        final BattleStateCheckpoint decodedCheckpoint = decoded.checkpoints().getLast();
        assertEquals(expectedCheckpoint.rawClockSec(), decodedCheckpoint.rawClockSec());
        assertEquals(expectedCheckpoint.eventIndex(), decodedCheckpoint.eventIndex());
        assertFalse(expectedCheckpoint.stateSnapshot().vehiclesByEntityId().isEmpty(),
                "fixture 的最后一个 checkpoint 必须含车辆");
        final int entityId = expectedCheckpoint.stateSnapshot().vehiclesByEntityId().keySet().iterator().next();
        final VehicleState decodedVehicle = decodedCheckpoint.stateSnapshot().vehicleByEntityId(entityId);
        assertNotNull(decodedVehicle, "checkpoint 车辆必须按 entityId 解回");
        assertEquals(entityId, decodedVehicle.entityId());
        assertEquals(expectedCheckpoint.stateSnapshot().vehicleByEntityId(entityId).accountId(),
                decodedVehicle.accountId());
    }

    @Test
    void toleratesNullForPrimitiveInExternalClientProjection() throws Exception {
        final ObjectNode projection = clientProjection(result.reconstruction());
        final ArrayNode checkpoints = (ArrayNode) projection.get("checkpoints");
        final ObjectNode vehicles =
                (ObjectNode) checkpoints.get(checkpoints.size() - 1).get("stateSnapshot").get("vehiclesByEntityId");
        assertTrue(vehicles.size() > 0, "fixture 的最后一个 checkpoint 必须含车辆");
        final String entityId = vehicles.properties().iterator().next().getKey();
        ((ObjectNode) vehicles.get(entityId)).putNull("entityId");

        final ReplayReconstruction decoded = ReplayFactsCodec.reconstructionFromJson(projection);

        final VehicleState decodedVehicle = decoded.checkpoints().getLast().stateSnapshot()
                .vehicleByEntityId(Integer.parseInt(entityId));
        assertNotNull(decodedVehicle, "客户端未提供的原始类型字段不得让整个 AI 请求解码失败");
        assertEquals(0, decodedVehicle.entityId(),
                "外部客户端投影的 null 原始类型字段必须回落 primitive 默认值");
    }

    /**
     * 泛型 record 组件必须按元素类型解码：{@code ShotResultEvent.components} 是
     * {@code List<ComponentResult>}，若解码器用擦除后的 raw class，会得到
     * {@code List<LinkedHashMap>}，生产消费方（{@code PlayerEvidenceFormatter} 的
     * typed for-each）随即 {@code ClassCastException}。
     */
    @Test
    void decodesGenericRecordComponentsWithTheirElementTypes() throws Exception {
        final ObjectNode projection = MAPPER.createObjectNode();
        final ObjectNode shot = projection.putArray("events").addObject();
        shot.put("type", "ShotResultEvent");
        shot.put("sequence", 7);
        shot.put("packetType", 8);
        shot.put("victimVehicleId", 42);
        shot.put("resultFlags16", 512);
        shot.put("headerHi16Raw", 2);
        shot.putNull("timestamp");
        shot.putNull("confidence");
        shot.putArray("modifierIds").add(1).add(2);
        shot.putArray("components").addObject().put("token", 31).put("state", 1);

        final ReplayReconstruction decoded = ReplayFactsCodec.reconstructionFromJson(projection);

        final ReplayEvent event = decoded.events().getFirst();
        assertInstanceOf(ShotResultEvent.class, event, "必须解回 ShotResultEvent");
        final ShotResultEvent shotEvent = (ShotResultEvent) event;
        // 与生产消费方一致地按具体元素类型遍历；元素是 LinkedHashMap 时会在此抛 ClassCastException。
        int stateSum = 0;
        for (final ShotResultEvent.ComponentResult component : shotEvent.components()) {
            stateSum += component.state();
        }
        assertEquals(1, stateSum);
        assertEquals(31, shotEvent.components().getFirst().token());
        assertEquals(List.of(1, 2), shotEvent.modifierIds());
    }

    /**
     * 解析结果 → 客户端投影 wire JSON：{@code ReplayEvent} 加 {@code type} 多态标记，其余结构由
     * Jackson 按 record/字段原样编码。
     */
    private static ObjectNode clientProjection(final ReplayReconstruction reconstruction) {
        final ObjectNode projection = MAPPER.valueToTree(reconstruction);
        final ArrayNode events = (ArrayNode) projection.get("events");
        final var decoded = reconstruction.events();
        for (int i = 0; i < decoded.size(); i++) {
            ((ObjectNode) events.get(i)).put("type", decoded.get(i).getClass().getSimpleName());
        }
        return projection;
    }
}
