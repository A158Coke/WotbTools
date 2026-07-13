package com.wotb.core.parse;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;

/**
 * 最小 Python pickle 读取器 (栈式), 仅支持 WoT Blitz battle_results.dat 用到的操作码:
 * battle_results.dat = pickle( (arenaUniqueId:int, protobuf:bytes) )。
 * 实现常见操作码以兼容不同游戏/Python 版本的编码差异。
 */
public final class PickleReader {

    private static final int MEBIBYTE = 1024 * 1024;
    private static final int MAX_INPUT_BYTES = 8 * MEBIBYTE;
    private static final int MAX_BINARY_BYTES = MAX_INPUT_BYTES;
    private static final int MAX_TEXT_BYTES = MEBIBYTE;
    private static final int MAX_LONG_BYTES = 128;
    static final int MAX_STACK_ITEMS = 4096;
    private static final int MAX_OPCODES = 100_000;

    /** MARK 与 NONE 使用独立占位符，避免 ArrayDeque 拒绝 null。 */
    private static final Object MARK = new Object();
    private static final Object NONE = new Object();

    private final byte[] data;
    private final Deque<Object> stack = new ArrayDeque<>();
    private int position;

    private PickleReader(final byte[] data) {
        this.data = data;
    }

    /** 解析整个 pickle, 返回顶层对象。 */
    public static Object loads(final byte[] data) {
        if (data == null) {
            throw invalid("input is null", 0);
        }
        if (data.length > MAX_INPUT_BYTES) {
            throw invalid("input exceeds size limit", 0);
        }
        return new PickleReader(data).run();
    }

    private Object run() {
        int opcodeCount = 0;
        while (position < data.length) {
            opcodeCount++;
            if (opcodeCount > MAX_OPCODES) {
                throw invalid("opcode count exceeds limit", position);
            }

            final int opcodeOffset = position;
            final int opcode = readUnsignedByte("opcode");
            switch (opcode) {
                case 0x80:
                    readUnsignedByte("PROTO version");
                    break;
                case 0x95:
                    readFrameLength();
                    break;
                case '(':
                    pushRaw(MARK);
                    break;
                case 'N':
                    pushRaw(NONE);
                    break;
                case 0x88:
                    pushRaw(Boolean.TRUE);
                    break;
                case 0x89:
                    pushRaw(Boolean.FALSE);
                    break;
                case 'K':
                    pushRaw((long) readUnsignedByte("BININT1"));
                    break;
                case 'M':
                    pushRaw(readLittleEndian(2, "BININT2"));
                    break;
                case 'J':
                    pushRaw((long) (int) readLittleEndian(4, "BININT"));
                    break;
                case 0x8a:
                    pushRaw(readLong1());
                    break;
                case 0x8b:
                    pushRaw(readLong4());
                    break;
                case 'T':
                    pushRaw(readBytes(readLittleEndian(4, "BINSTRING length"),
                            MAX_BINARY_BYTES, "BINSTRING"));
                    break;
                case 'U':
                    pushRaw(readBytes(readUnsignedByte("SHORT_BINSTRING length"),
                            MAX_BINARY_BYTES, "SHORT_BINSTRING"));
                    break;
                case 'B':
                    pushRaw(readBytes(readLittleEndian(4, "BINBYTES length"),
                            MAX_BINARY_BYTES, "BINBYTES"));
                    break;
                case 'C':
                    pushRaw(readBytes(readUnsignedByte("SHORT_BINBYTES length"),
                            MAX_BINARY_BYTES, "SHORT_BINBYTES"));
                    break;
                case 0x8e:
                    pushRaw(readBytes(readLittleEndian(8, "BINBYTES8 length"),
                            MAX_BINARY_BYTES, "BINBYTES8"));
                    break;
                case 'X':
                    pushRaw(readString(readLittleEndian(4, "BINUNICODE length"), "BINUNICODE"));
                    break;
                case 0x8c:
                    pushRaw(readString(readUnsignedByte("SHORT_BINUNICODE length"),
                            "SHORT_BINUNICODE"));
                    break;
                case 0x8d:
                    pushRaw(readString(readLittleEndian(8, "BINUNICODE8 length"), "BINUNICODE8"));
                    break;
                case ')':
                    pushRaw(new Object[0]);
                    break;
                case 0x85:
                    tuple(1);
                    break;
                case 0x86:
                    tuple(2);
                    break;
                case 0x87:
                    tuple(3);
                    break;
                case 't':
                    tupleMark();
                    break;
                case ']':
                    pushRaw(new ArrayList<>());
                    break;
                case '}':
                    pushRaw(new LinkedHashMap<>());
                    break;
                case 'q':
                    skip(1, "BINPUT index");
                    break;
                case 'r':
                    skip(4, "LONG_BINPUT index");
                    break;
                case 0x94:
                    break;
                case 'h':
                    skip(1, "BINGET index");
                    break;
                case 'j':
                    skip(4, "LONG_BINGET index");
                    break;
                case '.':
                    return result(opcodeOffset);
                default:
                    throw invalid("unsupported opcode 0x" + Integer.toHexString(opcode), opcodeOffset);
            }
        }
        throw invalid("pickle ended before STOP", position);
    }

    private void readFrameLength() {
        final long rawLength = readLittleEndian(8, "FRAME length");
        checkedLength(rawLength, MAX_INPUT_BYTES, "FRAME");
    }

    private void tuple(final int size) {
        if (stack.size() < size) {
            throw invalid("tuple stack underflow", position);
        }
        final Object[] tuple = new Object[size];
        for (int index = size - 1; index >= 0; index--) {
            tuple[index] = popValue("tuple");
        }
        pushRaw(tuple);
    }

    private void tupleMark() {
        if (!stack.contains(MARK)) {
            throw invalid("TUPLE is missing MARK", position);
        }
        final List<Object> items = new ArrayList<>();
        while (stack.peek() != MARK) {
            items.add(popValue("TUPLE"));
        }
        stack.pop();
        Collections.reverse(items);
        pushRaw(items.toArray());
    }

    private byte[] readBytes(final long rawLength, final int limit, final String label) {
        final int length = checkedLength(rawLength, limit, label);
        final byte[] result = new byte[length];
        System.arraycopy(data, position, result, 0, length);
        position += length;
        return result;
    }

    private String readString(final long rawLength, final String label) {
        final int length = checkedLength(rawLength, MAX_TEXT_BYTES, label);
        final String result = new String(data, position, length, StandardCharsets.UTF_8);
        position += length;
        return result;
    }

    private long readLittleEndian(final int bytes, final String label) {
        requireRemaining(bytes, label);
        long value = 0;
        for (int index = 0; index < bytes; index++) {
            value |= (long) (data[position + index] & 0xFF) << (8 * index);
        }
        position += bytes;
        return value;
    }

    /** LONG1: 1 字节长度 + 小端二进制补码大整数。 */
    private Object readLong1() {
        return readLong(readUnsignedByte("LONG1 length"), "LONG1");
    }

    private Object readLong4() {
        return readLong(readLittleEndian(4, "LONG4 length"), "LONG4");
    }

    private Object readLong(final long rawLength, final String label) {
        final byte[] littleEndian = readBytes(rawLength, MAX_LONG_BYTES, label);
        if (littleEndian.length == 0) {
            return 0L;
        }
        final byte[] bigEndian = new byte[littleEndian.length];
        for (int index = 0; index < littleEndian.length; index++) {
            bigEndian[index] = littleEndian[littleEndian.length - 1 - index];
        }
        final BigInteger value = new BigInteger(bigEndian);
        return value.bitLength() < 63 ? value.longValue() : value;
    }

    private int readUnsignedByte(final String label) {
        requireRemaining(1, label);
        return data[position++] & 0xFF;
    }

    private void skip(final int bytes, final String label) {
        requireRemaining(bytes, label);
        position += bytes;
    }

    private int checkedLength(final long rawLength, final int limit, final String label) {
        if (rawLength < 0 || rawLength > Integer.MAX_VALUE) {
            throw invalid(label + " length exceeds integer range", position);
        }
        if (rawLength > limit) {
            throw invalid(label + " length exceeds limit", position);
        }
        final int length = (int) rawLength;
        requireRemaining(length, label);
        return length;
    }

    private void requireRemaining(final int bytes, final String label) {
        if (bytes < 0 || bytes > data.length - position) {
            throw invalid("truncated " + label, position);
        }
    }

    private void pushRaw(final Object value) {
        if (stack.size() >= MAX_STACK_ITEMS) {
            throw invalid("stack size exceeds limit", position);
        }
        stack.push(value);
    }

    private Object popValue(final String label) {
        if (stack.isEmpty()) {
            throw invalid(label + " stack underflow", position);
        }
        final Object value = stack.pop();
        if (value == MARK) {
            throw invalid(label + " encountered MARK", position);
        }
        return value == NONE ? null : value;
    }

    private Object result(final int opcodeOffset) {
        if (stack.isEmpty() || stack.peek() == MARK) {
            throw invalid("STOP has no result", opcodeOffset);
        }
        final Object value = stack.peek();
        return value == NONE ? null : value;
    }

    private static IllegalArgumentException invalid(final String detail, final int offset) {
        return new IllegalArgumentException("Invalid pickle at offset " + offset + ": " + detail);
    }
}
