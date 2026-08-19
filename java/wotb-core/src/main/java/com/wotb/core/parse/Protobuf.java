package com.wotb.core.parse;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 通用 protobuf 解码器 (无需 .proto)。
 * 解码为 field -> List(值): varint/定长 -> Long, length-delimited -> byte[]。
 */
public final class Protobuf {

    private static final int MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
    private static final int MAX_LENGTH_DELIMITED_BYTES = MAX_MESSAGE_BYTES;
    static final int MAX_FIELD_VALUES = 16_384;
    private static final long MAX_FIELD_NUMBER = (1L << 29) - 1;

    private Protobuf() {
    }

    /** 解码一段 protobuf, 返回 field -> 值列表 (重复字段保留多值)。 */
    public static Map<Integer, List<Object>> decode(final byte[] buffer) {
        if (buffer == null) {
            throw invalid("input is null", 0);
        }
        if (buffer.length > MAX_MESSAGE_BYTES) {
            throw invalid("message exceeds size limit", 0);
        }

        final Map<Integer, List<Object>> fields = new LinkedHashMap<>();
        int index = 0;
        int valueCount = 0;
        while (index < buffer.length) {
            final int tagOffset = index;
            final long[] tagResult = readVarint(buffer, index);
            final long tag = tagResult[0];
            index = (int) tagResult[1];

            final long rawFieldNumber = tag >>> 3;
            if (rawFieldNumber == 0 || rawFieldNumber > MAX_FIELD_NUMBER) {
                throw invalid("invalid field number", tagOffset);
            }
            final int fieldNumber = (int) rawFieldNumber;
            final int wireType = (int) (tag & 7);
            if (valueCount >= MAX_FIELD_VALUES) {
                throw invalid("field value count exceeds limit", tagOffset);
            }

            final Object value;
            switch (wireType) {
                case 0: {
                    final long[] valueResult = readVarint(buffer, index);
                    value = valueResult[0];
                    index = (int) valueResult[1];
                    break;
                }
                case 1:
                    requireRemaining(buffer, index, 8, "64-bit field");
                    value = readLittleEndian(buffer, index, 8);
                    index += 8;
                    break;
                case 2: {
                    final long[] lengthResult = readVarint(buffer, index);
                    final long rawLength = lengthResult[0];
                    index = (int) lengthResult[1];
                    final int length = checkedLength(buffer, index, rawLength);
                    final byte[] bytes = new byte[length];
                    System.arraycopy(buffer, index, bytes, 0, length);
                    index += length;
                    value = bytes;
                    break;
                }
                case 5:
                    requireRemaining(buffer, index, 4, "32-bit field");
                    value = readLittleEndian(buffer, index, 4);
                    index += 4;
                    break;
                default:
                    throw invalid("unsupported wire type " + wireType, tagOffset);
            }
            fields.computeIfAbsent(fieldNumber, ignored -> new ArrayList<>()).add(value);
            valueCount++;
        }
        return fields;
    }

    /** 读取一个 varint, 返回 [值, 新位置]。 */
    static long[] readVarint(final byte[] buffer, final int startIndex) {
        if (buffer == null) {
            throw invalid("input is null", startIndex);
        }
        if (startIndex < 0 || startIndex >= buffer.length) {
            throw invalid("truncated varint", startIndex);
        }

        int index = startIndex;
        long result = 0;
        for (int byteIndex = 0; byteIndex < 10; byteIndex++) {
            if (index >= buffer.length) {
                throw invalid("truncated varint", startIndex);
            }
            final int current = buffer[index++] & 0xFF;
            if (byteIndex == 9 && (current & 0xFE) != 0) {
                throw invalid("varint overflow", startIndex);
            }
            result |= (long) (current & 0x7F) << (7 * byteIndex);
            if ((current & 0x80) == 0) {
                return new long[]{result, index};
            }
        }
        throw invalid("varint overflow", startIndex);
    }

    private static int checkedLength(final byte[] buffer, final int index, final long rawLength) {
        if (rawLength < 0 || rawLength > Integer.MAX_VALUE) {
            throw invalid("length-delimited field exceeds integer range", index);
        }
        if (rawLength > MAX_LENGTH_DELIMITED_BYTES) {
            throw invalid("length-delimited field exceeds size limit", index);
        }
        final int length = (int) rawLength;
        requireRemaining(buffer, index, length, "length-delimited field");
        return length;
    }

    private static long readLittleEndian(final byte[] buffer, final int offset, final int bytes) {
        long value = 0;
        for (int index = 0; index < bytes; index++) {
            value |= (long) (buffer[offset + index] & 0xFF) << (8 * index);
        }
        return value;
    }

    private static void requireRemaining(
            final byte[] buffer,
            final int index,
            final int bytes,
            final String label) {
        if (index < 0 || index > buffer.length || bytes < 0 || bytes > buffer.length - index) {
            throw invalid("truncated " + label, index);
        }
    }

    private static IllegalArgumentException invalid(final String detail, final int offset) {
        return new IllegalArgumentException("Invalid protobuf at offset " + offset + ": " + detail);
    }

    // ---- 取值辅助 (对应 Python 的 f1 / f_uint / as_str / as_message) ----

    /** 取字段第一个值; 不存在返回 null。 */
    public static Object first(final Map<Integer, List<Object>> fields, final int num) {
        final List<Object> values = fields.get(num);
        return values == null || values.isEmpty() ? null : values.getFirst();
    }

    /** 取字段第一个值作为 long; 不存在返回 default。 */
    public static long firstLong(final Map<Integer, List<Object>> fields, final int num, final long defaultValue) {
        final Object value = first(fields, num);
        if (value instanceof Number number) {
            return number.longValue();
        }
        return defaultValue;
    }

    /** 取字段第一个值作为嵌套消息。 */
    public static Map<Integer, List<Object>> message(final Map<Integer, List<Object>> fields, final int num) {
        final Object value = first(fields, num);
        if (value instanceof byte[] bytes) {
            return decode(bytes);
        }
        return new LinkedHashMap<>();
    }

    /** 把 length-delimited 字段当作字符串 (UTF-8)。 */
    public static String string(final Map<Integer, List<Object>> fields, final int num) {
        final Object value = first(fields, num);
        if (value instanceof byte[] bytes) {
            return new String(bytes, StandardCharsets.UTF_8);
        }
        return value == null ? "" : value.toString();
    }
}
