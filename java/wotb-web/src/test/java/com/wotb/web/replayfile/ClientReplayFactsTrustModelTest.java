package com.wotb.web.replayfile;

import com.wotb.core.model.Battle;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ClientReplayFactsTrustModelTest {

    private static final String WELL_FORMED = """
            {"arenaId":"123456789","recorder":"someone","arenaBonusType":1,"mapName":"rift",
             "players":[
              {"accountId":1001,"nickname":"someone","team":1,"tankId":20817,"damageDealt":99999,"survived":true},
              {"accountId":1002,"nickname":"other","team":2,"tankId":6753,"damageDealt":0,"survived":false}]}
            """;

    @Test
    void structurallyValidButFabricatedFactsAreAcceptedBecauseAuthenticityIsNotTheServersJob() {
        final Battle battle = ClientReplayFacts.read(WELL_FORMED);
        assertEquals("123456789", battle.arenaId);
        assertEquals(99999, battle.players.getFirst().damageDealt);
    }

    @Test
    void theFactsReaderNeverSeesReplayBytes() {
        final List<Method> api = Arrays.stream(ClientReplayFacts.class.getDeclaredMethods())
                .filter(m -> Modifier.isPublic(m.getModifiers()))
                .toList();
        for (final Method m : api) {
            for (final Class<?> p : m.getParameterTypes()) {
                assertFalse(p == byte[].class || p.getName().contains("MultipartFile") || p.getName().contains("InputStream"),
                        m + " must not accept replay content");
            }
        }
    }

    @Test
    void structureViolationsAreRejected() {
        for (final String bad : List.of(
                "",
                "[]",
                WELL_FORMED.replace("\"arenaId\":\"123456789\",", ""),
                WELL_FORMED.replace("\"team\":2", "\"team\":3"),
                WELL_FORMED.replace("\"accountId\":1002", "\"accountId\":1001"),
                WELL_FORMED.replace("\"tankId\":6753", "\"tankId\":0"),
                WELL_FORMED.replace("\"recorder\":\"someone\"", "\"recorder\":\"nobody\""))) {
            assertThrows(IllegalArgumentException.class, () -> ClientReplayFacts.read(bad), bad);
        }
        assertThrows(IllegalArgumentException.class,
                () -> ClientReplayFacts.read("{\"x\":\"" + "a".repeat(ClientReplayFacts.MAX_JSON_CHARS) + "\"}"));
    }
}
