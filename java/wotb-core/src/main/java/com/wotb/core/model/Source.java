package com.wotb.core.model;

/** 一个待处理的回放 (名字 + 字节)。 */
public record Source(String name, byte[] bytes) {
}
