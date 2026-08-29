package com.wotb.core.parse;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedList;
import java.util.List;
import java.util.Map;

/**
 * Minimal Python pickle decoder for the protocol-2 blobs embedded in WoT Blitz replay
 * entity-create packets (e.g. the arena-info dict in {@code basePlayerCreate}).
 *
 * <p>Supports the opcode subset actually produced by the game (verified with
 * {@code pickletools} on a real replay): PROTO / MARK / STOP / NONE / NEWTRUE /
 * NEWFALSE / INT / BININT / BININT1 / BININT2 / LONG1 / FLOAT / BINFLOAT /
 * SHORT_BINSTRING / SHORT_BINUNICODE / EMPTY_LIST / APPEND / APPENDS /
 * EMPTY_DICT / SETITEM / SETITEMS / TUPLE / EMPTY_TUPLE / TUPLE1-3 /
 * BINPUT / LONG_BINPUT / BINGET / LONG_BINGET. Unknown opcodes throw
 * {@link IllegalArgumentException} (fail-fast; do not guess).</p>
 */
public final class PickleDecoder {

    private PickleDecoder() {
    }

    private static final int MARK = 0x28;      // (
    private static final int EMPTY_TUPLE = 0x29;
    private static final int STOP = 0x2E;      // .
    private static final int NONE = 0x4E;      // N
    private static final int BININT = 0x4A;    // J
    private static final int BININT1 = 0x4B;   // K
    private static final int BINGET = 0x68;    // h
    private static final int LONG_BINGET = 0x6A; // j
    private static final int BINPUT = 0x71;    // q
    private static final int LONG_BINPUT = 0x72; // r
    private static final int EMPTY_LIST = 0x5D;  // ]
    private static final int APPEND = 0x61;    // a
    private static final int APPENDS = 0x65;   // e
    private static final int SETITEM = 0x73;   // s
    private static final int SETITEMS = 0x75;  // u
    private static final int EMPTY_DICT = 0x7D; // }
    private static final int TUPLE = 0x74;     // t
    private static final int PROTO = 0x80;
    private static final int NEWTRUE = 0x88;
    private static final int NEWFALSE = 0x89;
    private static final int LONG1 = 0x8A;
    private static final int TUPLE1 = 0x85;
    private static final int TUPLE2 = 0x86;
    private static final int TUPLE3 = 0x87;
    private static final int FLOAT = 0x46;     // F
    private static final int BINFLOAT = 0x47;  // G
    private static final int INT = 0x49;       // I
    private static final int BININT2 = 0x4D;   // M
    private static final int SHORT_BINSTRING = 0x54; // T (protocol < 3: bytes; game uses it for str)
    private static final int SHORT_BINUNICODE = 0x55; // U
    private static final int BINSTRING = 0x52; // R
    private static final int BINUNICODE = 0x56; // V

    // LinkedList allows null elements (pickle NONE); ArrayDeque would NPE on push(null)
    private final Deque<Object> stack = new LinkedList<>();
    private final Map<Integer, Object> memo = new HashMap<>();

    public static Object decode(final byte[] data) {
        return new PickleDecoder().run(data);
    }

    private Object run(final byte[] data) {
        int i = 0;
        while (i < data.length) {
            final int op = data[i] & 0xFF;
            i++;
            switch (op) {
                case PROTO -> i++; // skip protocol version byte
                case NONE -> stack.push(null);
                case NEWTRUE -> stack.push(Boolean.TRUE);
                case NEWFALSE -> stack.push(Boolean.FALSE);
                case INT -> {
                    final int end = asciiLineEnd(data, i);
                    final String s = new String(data, i, end - i, StandardCharsets.US_ASCII).trim();
                    stack.push(parseInt(s));
                    i = end + 1;
                }
                case BININT -> {
                    stack.push(readI32LE(data, i));
                    i += 4;
                }
                case BININT1 -> {
                    stack.push(data[i] & 0xFF);
                    i += 1;
                }
                case BININT2 -> {
                    stack.push((data[i] & 0xFF) | ((data[i + 1] & 0xFF) << 8));
                    i += 2;
                }
                case LONG1 -> {
                    final int len = data[i] & 0xFF;
                    i += 1;
                    long v = 0;
                    for (int b = 0; b < len; b++) {
                        v |= (long) (data[i + b] & 0xFF) << (8 * b);
                    }
                    stack.push(v);
                    i += len;
                }
                case FLOAT -> {
                    final int end = asciiLineEnd(data, i);
                    stack.push(Double.parseDouble(
                            new String(data, i, end - i, StandardCharsets.US_ASCII).trim()));
                    i = end + 1;
                }
                case BINFLOAT -> {
                    long bits = 0;
                    for (int b = 0; b < 8; b++) {
                        bits = (bits << 8) | (data[i + b] & 0xFF);
                    }
                    stack.push(Double.longBitsToDouble(bits));
                    i += 8;
                }
                case SHORT_BINSTRING, SHORT_BINUNICODE -> {
                    final int len = data[i] & 0xFF;
                    i += 1;
                    stack.push(new String(data, i, len, StandardCharsets.UTF_8));
                    i += len;
                }
                case BINSTRING -> {
                    final int len = readI32LE(data, i);
                    i += 4;
                    stack.push(new String(data, i, len, StandardCharsets.UTF_8));
                    i += len;
                }
                case BINUNICODE -> {
                    final int len = readI32LE(data, i);
                    i += 4;
                    stack.push(new String(data, i, len, StandardCharsets.UTF_8));
                    i += len;
                }
                case MARK -> stack.push(MARK);
                case EMPTY_LIST -> stack.push(new ArrayList<>());
                case EMPTY_DICT -> stack.push(new LinkedHashMap<>());
                case EMPTY_TUPLE -> stack.push(List.of());
                case TUPLE -> {
                    final List<Object> items = popUntilMark();
                    stack.push(List.copyOf(items));
                }
                case TUPLE1 -> tupleN(1);
                case TUPLE2 -> tupleN(2);
                case TUPLE3 -> tupleN(3);
                case APPEND -> {
                    final Object v = stack.pop();
                    ((List<Object>) stack.peek()).add(v);
                }
                case APPENDS -> {
                    final List<Object> items = popUntilMark();
                    final List<Object> list = (List<Object>) stack.peek();
                    list.addAll(items);
                }
                case SETITEM -> {
                    final Object v = stack.pop();
                    final Object k = stack.pop();
                    ((Map<Object, Object>) stack.peek()).put(k, v);
                }
                case SETITEMS -> {
                    final List<Object> items = popUntilMark();
                    final Map<Object, Object> map = (Map<Object, Object>) stack.peek();
                    for (int j = 0; j + 1 < items.size(); j += 2) {
                        map.put(items.get(j), items.get(j + 1));
                    }
                }
                case BINPUT -> {
                    memo.put(data[i] & 0xFF, stack.peek());
                    i += 1;
                }
                case LONG_BINPUT -> {
                    memo.put(readI32LE(data, i), stack.peek());
                    i += 4;
                }
                case BINGET -> {
                    stack.push(memo.get(data[i] & 0xFF));
                    i += 1;
                }
                case LONG_BINGET -> {
                    stack.push(memo.get(readI32LE(data, i)));
                    i += 4;
                }
                case STOP -> {
                    if (stack.isEmpty()) {
                        return null;
                    }
                    return stack.pop();
                }
                default -> throw new IllegalArgumentException(
                        "unsupported pickle opcode 0x" + Integer.toHexString(op) + " at offset " + (i - 1));
            }
        }
        throw new IllegalArgumentException("pickle stream ended without STOP");
    }

    private void tupleN(final int n) {
        final Object[] items = new Object[n];
        for (int j = n - 1; j >= 0; j--) {
            items[j] = stack.pop();
        }
        stack.push(List.of(items));
    }

    @SuppressWarnings("unchecked")
    private List<Object> popUntilMark() {
        final List<Object> items = new ArrayList<>();
        while (!stack.isEmpty()) {
            final Object top = stack.pop();
            if (top instanceof Integer mark && mark == MARK) {
                return items;
            }
            items.add(0, top);
        }
        throw new IllegalArgumentException("pickle MARK missing");
    }

    private static int asciiLineEnd(final byte[] data, final int from) {
        for (int i = from; i < data.length; i++) {
            if (data[i] == '\n') {
                return i;
            }
        }
        throw new IllegalArgumentException("unterminated ascii pickle token");
    }

    private static Number parseInt(final String s) {
        final String clean = s.endsWith("L") || s.endsWith("l") ? s.substring(0, s.length() - 1) : s;
        try {
            return Integer.valueOf(clean);
        } catch (NumberFormatException ignored) {
            return Long.valueOf(clean);
        }
    }

    private static int readI32LE(final byte[] buf, final int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8)
                | ((buf[i + 2] & 0xFF) << 16) | (buf[i + 3] << 24);
    }
}
