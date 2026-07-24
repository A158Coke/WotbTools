package com.wotb.core.processing;

/** 无法识别的战斗类型。 */
public class UnsupportedBattleCategoryException extends RuntimeException {
    public UnsupportedBattleCategoryException(String message) { super(message); }
}
