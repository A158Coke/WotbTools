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

/**
 * 名人堂 / 百场 / 三环信任模型（产品决策，docs/features/hall-of-fame.md「信任模型」）：
 * <b>client facts are intentionally untrusted; server validates structure, not authenticity.</b>
 *
 * <p>服务器没有 parser：不重新解析回放、不比对回放与 facts、不做密码学证明或抽样解析。原始回放只作存档 /
 * 人工审核材料，防伪造靠管理员审核。本测试锁住这条边界，防止以后被「修复」成服务端验真。</p>
 */
class ClientReplayFactsTrustModelTest {

    private static final String WELL_FORMED = """
            {"arenaId":"123456789","recorder":"someone","arenaBonusType":1,"mapName":"rift",
             "players":[
              {"accountId":1001,"nickname":"someone","team":1,"tankId":20817,"damageDealt":99999,"survived":true},
              {"accountId":1002,"nickname":"other","team":2,"tankId":6753,"damageDealt":0,"survived":false}]}
            """;

    @Test
    void structurallyValidButFabricatedFactsAreAcceptedBecauseAuthenticityIsNotTheServersJob() {
        // 99999 伤害在真实对局里不可能出现：服务端照样接受——真伪由管理员对照回放附件审核
        final Battle battle = ClientReplayFacts.read(WELL_FORMED);
        assertEquals("123456789", battle.arenaId);
        assertEquals(99999, battle.players.getFirst().damageDealt);
    }

    @Test
    void theFactsReaderNeverSeesReplayBytes() {
        // 结构校验的唯一输入是 facts JSON：没有任何接受回放字节 / 文件的入口（服务器不读、不比对回放）
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
