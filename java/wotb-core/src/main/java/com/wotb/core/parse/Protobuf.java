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

    private Protobuf() {
    }

    /** 解码一段 protobuf, 返回 field -> 值列表 (重复字段保留多值)。 */
    public static Map<Integer, List<Object>> decode(final byte[] buf) {
        final Map<Integer, List<Object>> fields = new LinkedHashMap<>();
        int i = 0;
        final int n = buf.length;
        while (i < n) {
            long[] tagRes;
            try {
                tagRes = readVarint(buf, i);
            } catch (IndexOutOfBoundsException e) {
                break;
            }
            final long tag = tagRes[0];
            i = (int) tagRes[1];
            final int field = (int) (tag >>> 3);
            final int wt = (int) (tag & 7);
            if (field == 0) {
                break;
            }
            try {
                Object val;
                switch (wt) {
                    case 0: { // varint
                        final long[] r = readVarint(buf, i);
                        val = r[0];
                        i = (int) r[1];
                        break;
                    }
                    case 1: { // 64-bit
                        val = readLE(buf, i, 8);
                        i += 8;
                        break;
                    }
                    case 5: { // 32-bit
                        val = readLE(buf, i, 4);
                        i += 4;
                        break;
                    }
                    case 2: { // length-delimited
                        final long[] r = readVarint(buf, i);
                        final int len = (int) r[0];
                        i = (int) r[1];
                        final byte[] sub = new byte[len];
                        System.arraycopy(buf, i, sub, 0, len);
                        i += len;
                        val = sub;
                        break;
                    }
                    default: // 3/4 组(已废弃), 6/7 非法 -> 停止
                        return fields;
                }
                fields.computeIfAbsent(field, k -> new ArrayList<>()).add(val);
            } catch (IndexOutOfBoundsException e) {
                break;
            }
        }
        return fields;
    }

    /** 读取一个 varint, 返回 [值, 新位置]。 */
    static long[] readVarint(final byte[] buf, final int i) {
        int index = i;
        int shift = 0;
        long result = 0;
        while (true) {
            int b = buf[index] & 0xFF;
            index++;
            result |= (long) (b & 0x7F) << shift;
            if ((b & 0x80) == 0) {
                break;
            }
            shift += 7;
        }
        return new long[]{result, index};
    }

    private static long readLE(final byte[] buf, final int off, final int bytes) {
        long v = 0;
        for (int k = 0; k < bytes; k++) {
            v |= (long) (buf[off + k] & 0xFF) << (8 * k);
        }
        return v;
    }

    // ---- 取值辅助 (对应 Python 的 f1 / f_uint / as_str / as_message) ----

    /** 取字段第一个值; 不存在返回 null。 */
    public static Object first(final Map<Integer, List<Object>> fields, final int num) {
        final List<Object> v = fields.get(num);
        return (v == null || v.isEmpty()) ? null : v.get(0);
    }

    /** 取字段第一个值作为 long; 不存在返回 default。 */
    public static long firstLong(final Map<Integer, List<Object>> fields, final int num, final long def) {
        final Object o = first(fields, num);
        if (o instanceof Number) {
            return ((Number) o).longValue();
        }
        return def;
    }

    /** 取字段第一个值作为嵌套消息。 */
    public static Map<Integer, List<Object>> message(final Map<Integer, List<Object>> fields, final int num) {
        final Object o = first(fields, num);
        if (o instanceof byte[]) {
            return decode((byte[]) o);
        }
        return new LinkedHashMap<>();
    }

    /** 把 length-delimited 字段当作字符串 (UTF-8)。 */
    public static String string(final Map<Integer, List<Object>> fields, final int num) {
        final Object o = first(fields, num);
        if (o instanceof byte[]) {
            return new String((byte[]) o, StandardCharsets.UTF_8);
        }
        return o == null ? "" : o.toString();
    }
}
