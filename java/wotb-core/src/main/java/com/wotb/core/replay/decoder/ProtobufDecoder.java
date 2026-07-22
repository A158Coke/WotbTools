package com.wotb.core.replay.decoder;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 简化的 Protobuf 解码工具（与现有 com.wotb.core.parse.Protobuf 功能一致，
 * 为解耦 decoder 包而独立存在，避免循环依赖）。
 * <p>
 * 仅支持 decoder 所需的子集：varint、fixed64、length-delimited fields。
 * </p>
 */
public final class ProtobufDecoder {

    private ProtobufDecoder() {
    }

    /**
     * 解码 protobuf 字节数组，返回 field_number → 值列表 的映射。
     */
    public static Map<Integer, List<Object>> decode(byte[] data) {
        final Map<Integer, List<Object>> result = new HashMap<>();
        int offset = 0;
        while (offset < data.length) {
            final long[] tagRes = readVarint(data, offset);
            final long tag = tagRes[0];
            offset = (int) tagRes[1];

            final int fieldNumber = (int) (tag >>> 3);
            final int wireType = (int) (tag & 0x07);

            switch (wireType) {
                case 0: { // varint
                    final long[] valRes = readVarint(data, offset);
                    offset = (int) valRes[1];
                    result.computeIfAbsent(fieldNumber, k -> new ArrayList<>()).add(valRes[0]);
                    break;
                }
                case 1: { // fixed64
                    if (offset + 8 > data.length) return result;
                    final long val = ((long) data[offset] & 0xFF)
                            | ((long) (data[offset + 1] & 0xFF) << 8)
                            | ((long) (data[offset + 2] & 0xFF) << 16)
                            | ((long) (data[offset + 3] & 0xFF) << 24)
                            | ((long) (data[offset + 4] & 0xFF) << 32)
                            | ((long) (data[offset + 5] & 0xFF) << 40)
                            | ((long) (data[offset + 6] & 0xFF) << 48)
                            | ((long) (data[offset + 7] & 0xFF) << 56);
                    offset += 8;
                    result.computeIfAbsent(fieldNumber, k -> new ArrayList<>()).add(val);
                    break;
                }
                case 2: { // length-delimited
                    final long[] lenRes = readVarint(data, offset);
                    final int len = (int) lenRes[0];
                    offset = (int) lenRes[1];
                    if (offset + len > data.length) return result;
                    final byte[] bytes = new byte[len];
                    System.arraycopy(data, offset, bytes, 0, len);
                    offset += len;
                    result.computeIfAbsent(fieldNumber, k -> new ArrayList<>()).add(bytes);
                    break;
                }
                case 5: { // fixed32
                    if (offset + 4 > data.length) return result;
                    final int val = (data[offset] & 0xFF)
                            | ((data[offset + 1] & 0xFF) << 8)
                            | ((data[offset + 2] & 0xFF) << 16)
                            | ((data[offset + 3] & 0xFF) << 24);
                    offset += 4;
                    result.computeIfAbsent(fieldNumber, k -> new ArrayList<>()).add(val);
                    break;
                }
                default:
                    // 未知 wire type，无法继续
                    return result;
            }
        }
        return result;
    }

    /**
     * 从给定字段的值列表中取第一个 long 值。
     */
    public static long firstLong(Map<Integer, List<Object>> fields, int fieldNumber, long defaultValue) {
        final List<Object> values = fields.get(fieldNumber);
        if (values == null || values.isEmpty()) return defaultValue;
        final Object v = values.getFirst();
        if (v instanceof Number n) return n.longValue();
        return defaultValue;
    }

    /**
     * 从给定字段的值列表中取第一个值。
     */
    public static Object first(Map<Integer, List<Object>> fields, int fieldNumber) {
        final List<Object> values = fields.get(fieldNumber);
        if (values == null || values.isEmpty()) return null;
        return values.getFirst();
    }

    private static long[] readVarint(byte[] buf, int i) {
        int idx = i;
        int shift = 0;
        long result = 0;
        while (true) {
            final int b = buf[idx] & 0xFF;
            idx++;
            result |= (long) (b & 0x7F) << shift;
            if ((b & 0x80) == 0) break;
            shift += 7;
        }
        return new long[]{result, idx};
    }
}
