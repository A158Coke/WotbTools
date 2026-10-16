package com.wotb.core.replay.projection;

import com.wotb.core.replay.event.HpRawState;
import com.wotb.core.replay.facts.ReplayFactsCodec;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.zip.GZIPInputStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 客户端投影读取边界的 {@code hpState} 契约（{@code .agents/AGENTS.md} §5a「旧 artifact 兼容只放
 * 读取边界」）：**有效枚举值 = 权威分类**；**字段缺省 = legacy 现算**；**显式 {@code null} = 边界拒绝**；
 * **未登记 wire 值 = 校验拒绝**。additive 字段的兼容不靠"忽略未知字段"获得（{@code
 * PROJECTION_MAPPER} 保持 {@code FAIL_ON_UNKNOWN_PROPERTIES}），而是靠 DTO/契约显式登记。
 *
 * <p>载荷用真实夹具 {@code common/fixtures/ai-projection/random-battle-example.json.gz} 同源的
 * {@code {battle, projection}} 结构（客户端生成器的产物形态），只改写待测条目的 {@code hpRaw} /
 * {@code hpState} 两个字段；其余结构保持生产形状，因此 {@code validate} 的通过与否只由被测字段决定。</p>
 */
class ClientAiProjectionReaderTest {

    /** 两份携带 HP 的载荷（method1 / prop3），契约与 DTO 同步登记了可选 {@code hpState}。 */
    private static final String[] LISTS = {"prop3Health", "healthEvents"};

    /** 夹具解压后的原始字节；每个用例重新解析，避免用例之间共享可变对象。 */
    private static byte[] fixtureBytes;

    @BeforeAll
    static void loadFixture() throws Exception {
        final Path file = Path.of(System.getProperty("user.dir"), "..", "..", "common", "fixtures",
                "ai-projection", "random-battle-example.json.gz").normalize();
        try (InputStream in = new GZIPInputStream(Files.newInputStream(file))) {
            fixtureBytes = in.readAllBytes();
        }
        final JsonNode projection = freshProjection().get("projection");
        assertNotNull(projection, "夹具必须含 projection 子树");
        for (final String list : LISTS) {
            assertTrue(projection.get(list).isArray() && !projection.get(list).isEmpty(),
                    "夹具 " + list + " 必须非空（否则用例无意义）");
        }
    }

    /** 每个用例一份全新解析的 {@code {battle, projection}} 根节点。 */
    private static ObjectNode freshProjection() throws Exception {
        return (ObjectNode) JsonMapper.builder().build().readTree(new ByteArrayInputStream(fixtureBytes));
    }

    /** 深拷贝不可靠 ⇒ 重新解析后取列表首条，按用例改写（生产载荷形状不变）。 */
    private static ObjectNode firstEntry(final String list, final EntryMutation mutation) throws Exception {
        final ObjectNode root = freshProjection();
        final ObjectNode entry = (ObjectNode) root.get("projection").get(list).get(0);
        mutation.apply(entry);
        return (ObjectNode) root.get("projection");
    }

    private interface EntryMutation {
        void apply(ObjectNode entry);
    }

    private static String hpStateOf(final ClientAiProjection decoded, final String list) {
        return list.equals("prop3Health")
                ? decoded.prop3Health().getFirst().hpState()
                : decoded.healthEvents().getFirst().hpState();
    }

    private static int hpRawOf(final ClientAiProjection decoded, final String list) {
        return list.equals("prop3Health")
                ? decoded.prop3Health().getFirst().hpRaw()
                : decoded.healthEvents().getFirst().hpRaw();
    }

    @Test
    void validWireValueIsAuthoritativeForTheWholeTerminalFamily() throws Exception {
        for (final String list : LISTS) {
            final ClientAiProjection decoded = ReplayFactsCodec.projectionFromJson(
                    firstEntry(list, entry -> {
                        entry.put("hpRaw", 0xFFFE);
                        entry.put("hpState", "terminal");
                    }));
            assertEquals("terminal", hpStateOf(decoded, list), list + "：字段必须原样解出");
            assertEquals(0xFFFE, hpRawOf(decoded, list));
            assertEquals(HpRawState.DEATH_TERMINAL, HpRawState.fromProjection(hpStateOf(decoded, list), 0xFFFE),
                    list + "：字段在场 = 权威（0xFFFE 档按上游分类判终态，不经 legacy 现算）");
            // 合法值必须通过读取边界校验（否则生产请求会被 400）。
            ClientAiProjectionAdapter.validate(decoded);
        }
    }

    @Test
    void omittedFieldKeepsLegacyClassification() throws Exception {
        for (final String list : LISTS) {
            final ClientAiProjection decoded = ReplayFactsCodec.projectionFromJson(
                    firstEntry(list, entry -> {
                        entry.put("hpRaw", 0xFFFE);
                        entry.remove("hpState");
                    }));
            assertNull(hpStateOf(decoded, list), list + "：字段缺省 = Java null（legacy 口径）");
            assertEquals(HpRawState.UNKNOWN_OTHER, HpRawState.fromProjection(hpStateOf(decoded, list), 0xFFFE),
                    list + "：缺省不放大——0xFFFE 仍是未证明哨兵，不是死亡证据");
            ClientAiProjectionAdapter.validate(decoded);
        }
    }

    @Test
    void explicitNullIsRejectedAtTheReadBoundary() throws Exception {
        for (final String list : LISTS) {
            final ObjectNode projection = firstEntry(list, entry -> entry.putNull("hpState"));
            final IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                    () -> ReplayFactsCodec.projectionFromJson(projection),
                    list + "：显式 null 与「字段缺省」必须区分，前者按契约（type: string）非法");
            assertTrue(error.getMessage().contains("hpState"), error.getMessage());
        }
    }

    @Test
    void unknownWireValueIsRejectedByBoundaryValidation() throws Exception {
        assertNull(HpRawState.fromWireName("dead"), "未登记 wire 值不得映射到任何状态");
        for (final String list : LISTS) {
            final ClientAiProjection decoded = ReplayFactsCodec.projectionFromJson(
                    firstEntry(list, entry -> entry.put("hpState", "dead")));
            assertEquals("dead", hpStateOf(decoded, list), "字符串本身可解出，但不得被当作已知分类");
            final ClientAiProjectionAdapter.InvalidProjectionException error = assertThrows(
                    ClientAiProjectionAdapter.InvalidProjectionException.class,
                    () -> ClientAiProjectionAdapter.validate(decoded),
                    list + "：未登记枚举值必须 fail-closed（不得静默回退 hp_raw）");
            assertTrue(error.getMessage().contains("invalid"), error.getMessage());
        }
    }
}
