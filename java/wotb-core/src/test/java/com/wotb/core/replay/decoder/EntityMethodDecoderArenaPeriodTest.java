package com.wotb.core.replay.decoder;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * PR162/P0-2+：subtype48 wrapper=3 ARENA_PERIOD 的 root field3 实为<b>嵌套消息</b>，其 field1 = period raw
 * （真实 11.19 china / china_apple 数据证据：field1 依次为 1 WAITING / 2 PREBATTLE / 3 BATTLE / 4 AFTERBATTLE）。
 * 旧 decoder 只认 Number 直接值 → 对嵌套形状误判「无 battle-start 权威」→ TIMELINE_CLOCK_UNRESOLVED。
 * 本测试固化 field3 的两种形状（Number 直接值 + 嵌套 field1）解析。
 */
class EntityMethodDecoderArenaPeriodTest {

    @Test
    void nestedField3Field1IsPeriodRaw() {
        // 手工构造 protobuf：field1(fieldNumber=1, varint) = 3 -> bytes {0x08, 0x03}。
        assertEquals(3, EntityMethodDecoder.arenaPeriodSerialValue(new byte[]{0x08, 0x03}), "nested field1 = BATTLE(3)");
        assertEquals(1, EntityMethodDecoder.arenaPeriodSerialValue(new byte[]{0x08, 0x01}), "nested field1 = WAITING(1)");
        assertEquals(4, EntityMethodDecoder.arenaPeriodSerialValue(new byte[]{0x08, 0x04}), "nested field1 = AFTERBATTLE(4)");
    }

    @Test
    void directNumberField3StillSupported() {
        assertEquals(2, EntityMethodDecoder.arenaPeriodSerialValue(2L), "Number 直接值 → PREBATTLE(2)");
        assertEquals(3, EntityMethodDecoder.arenaPeriodSerialValue(3L), "Number 直接值 → BATTLE(3)");
    }

    @Test
    void invalidOrMissingPeriodFailsClosed() {
        // arenaPeriodSerialValue 只解码 period raw；越界值由 parseArenaPeriod 的 [0,4] 范围检查拦下。
        assertEquals(-1, EntityMethodDecoder.arenaPeriodSerialValue(null), "null → -1");
        assertEquals(-1, EntityMethodDecoder.arenaPeriodSerialValue(new byte[]{0x0A, 0x00}), "无 field1 → -1");
        assertEquals(42, EntityMethodDecoder.arenaPeriodSerialValue(new byte[]{0x08, 0x2A}), "field1=42 解码为 42（上层 [0,4] 拦）");
    }
}
