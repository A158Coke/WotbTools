package com.wotb.core;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

/**
 * 最小 Python pickle 读取器 (栈式), 仅支持 WoT Blitz battle_results.dat 用到的操作码:
 * battle_results.dat = pickle( (arenaUniqueId:int, protobuf:bytes) )。
 * 实现常见操作码以兼容不同游戏/Python 版本的编码差异。
 */
public final class PickleReader {

    private final byte[] b;
    private int pos;
    private final Deque<Object> stack = new ArrayDeque<>();
    private final Deque<Integer> marks = new ArrayDeque<>();

    /** MARK 的占位标记。 */
    private static final Object MARK = new Object();

    private PickleReader(final byte[] data) {
        this.b = data;
    }

    /** 解析整个 pickle, 返回顶层对象。 */
    public static Object loads(final byte[] data) {
        return new PickleReader(data).run();
    }

    private Object run() {
        while (pos < b.length) {
            int op = b[pos++] & 0xFF;
            switch (op) {
                case 0x80: pos++; break;                       // PROTO: 跳过版本号
                case 0x95: pos += 8; break;                    // FRAME: 跳过 8 字节长度
                case '(': stack.push(MARK); break;             // MARK 0x28
                case 'N': stack.push(null); break;             // NONE 0x4e
                case 0x88: stack.push(Boolean.TRUE); break;    // NEWTRUE
                case 0x89: stack.push(Boolean.FALSE); break;   // NEWFALSE

                case 'K': stack.push((long) (b[pos++] & 0xFF)); break;        // BININT1
                case 'M': stack.push(readLE(2)); break;                       // BININT2
                case 'J': stack.push((long) (int) readLE(4)); break;          // BININT (signed)
                case 0x8a: stack.push(readLong1()); break;                    // LONG1
                case 0x8b: stack.push(readLong4()); break;                    // LONG4

                case 'T': stack.push(readBytes((int) readLE(4))); break;      // BINSTRING
                case 'U': stack.push(readBytes(b[pos++] & 0xFF)); break;      // SHORT_BINSTRING
                case 'B': stack.push(readBytes((int) readLE(4))); break;      // BINBYTES
                case 'C': stack.push(readBytes(b[pos++] & 0xFF)); break;      // SHORT_BINBYTES
                case 0x8e: stack.push(readBytes((int) readLE(8))); break;     // BINBYTES8
                case 'X': stack.push(readStr((int) readLE(4))); break;        // BINUNICODE
                case 0x8c: stack.push(readStr(b[pos++] & 0xFF)); break;       // SHORT_BINUNICODE
                case 0x8d: stack.push(readStr((int) readLE(8))); break;       // BINUNICODE8

                case ')': stack.push(new Object[0]); break;                   // EMPTY_TUPLE
                case 0x85: tuple(1); break;                                   // TUPLE1
                case 0x86: tuple(2); break;                                   // TUPLE2
                case 0x87: tuple(3); break;                                   // TUPLE3
                case 't': tupleMark(); break;                                 // TUPLE
                case ']': stack.push(new ArrayList<>()); break;               // EMPTY_LIST
                case '}': stack.push(new java.util.LinkedHashMap<>()); break; // EMPTY_DICT

                case 'q': pos++; break;                                       // BINPUT (1字节)
                case 'r': pos += 4; break;                                    // LONG_BINPUT
                case 0x94: break;                                             // MEMOIZE
                case 'h': pos++; break;                                       // BINGET
                case 'j': pos += 4; break;                                    // LONG_BINGET

                case '.': return stack.isEmpty() ? null : stack.peek();       // STOP
                default:
                    throw new IllegalStateException(
                            "不支持的 pickle 操作码: 0x" + Integer.toHexString(op) + " @ " + (pos - 1));
            }
        }
        return stack.peek();
    }

    private void tuple(int k) {
        Object[] t = new Object[k];
        for (int i = k - 1; i >= 0; i--) {
            t[i] = stack.pop();
        }
        stack.push(t);
    }

    private void tupleMark() {
        List<Object> items = new ArrayList<>();
        while (!stack.isEmpty() && stack.peek() != MARK) {
            items.add(0, stack.pop());
        }
        if (!stack.isEmpty()) {
            stack.pop(); // 弹出 MARK
        }
        stack.push(items.toArray());
    }

    private byte[] readBytes(final int len) {
        byte[] out = new byte[len];
        System.arraycopy(b, pos, out, 0, len);
        pos += len;
        return out;
    }

    private String readStr(final int len) {
        String s = new String(b, pos, len, StandardCharsets.UTF_8);
        pos += len;
        return s;
    }

    private long readLE(final int bytes) {
        long v = 0;
        for (int k = 0; k < bytes; k++) {
            v |= (long) (b[pos + k] & 0xFF) << (8 * k);
        }
        pos += bytes;
        return v;
    }

    /** LONG1: 1 字节长度 + 小端二进制补码大整数。 */
    private Object readLong1() {
        int len = b[pos++] & 0xFF;
        return readLong(len);
    }

    private Object readLong4() {
        int len = (int) readLE(4);
        return readLong(len);
    }

    private Object readLong(final int len) {
        if (len == 0) {
            return 0L;
        }
        byte[] le = readBytes(len);
        // 小端 -> 大端供 BigInteger 解释(二进制补码)
        byte[] be = new byte[len];
        for (int k = 0; k < len; k++) {
            be[k] = le[len - 1 - k];
        }
        BigInteger bi = new BigInteger(be);
        return (bi.bitLength() < 63) ? (Object) bi.longValue() : (Object) bi;
    }
}
