package com.wotb.core.replay.facts;

import com.fasterxml.jackson.annotation.JsonAutoDetect;
import com.fasterxml.jackson.annotation.PropertyAccessor;
import com.wotb.core.model.Battle;
import com.wotb.core.testsupport.FrozenReplayFacts;
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

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ReplayFactsCodecTest {

    private static final JsonMapper MAPPER = JsonMapper.builder()
            .changeDefaultVisibility(vc -> vc.withVisibility(
                    PropertyAccessor.FIELD, JsonAutoDetect.Visibility.ANY))
            .build();

    private static FrozenReplayFacts.Facts result;

    @BeforeAll
    static void loadFixtureOnce() {
        result = FrozenReplayFacts.load(FrozenReplayFacts.RANDOM_BATTLE);
        assertNotNull(result.battle());
        assertNotNull(result.reconstruction());
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

        assertNotNull(decoded);
        assertNotNull(decoded.streamHeader());
        assertNotNull(decoded.coverage());
        assertNotNull(decoded.finalState());
        assertEquals(source.participants().size(), decoded.participants().size());
        assertEquals(source.events().size(), decoded.events().size());
        assertEquals(source.checkpoints().size(), decoded.checkpoints().size());
        assertEquals(source.finalState().entityCount(), decoded.finalState().entityCount());

        assertEquals(source.events().getFirst().getClass(), decoded.events().getFirst().getClass());
        assertNotNull(decoded.events().getFirst().timestamp());

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
        int stateSum = 0;
        for (final ShotResultEvent.ComponentResult component : shotEvent.components()) {
            stateSum += component.state();
        }
        assertEquals(1, stateSum);
        assertEquals(31, shotEvent.components().getFirst().token());
        assertEquals(List.of(1, 2), shotEvent.modifierIds());
    }

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
