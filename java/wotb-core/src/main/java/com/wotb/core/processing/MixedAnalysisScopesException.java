package com.wotb.core.processing;

/** 同一次请求中混合了随机战斗与训练房/联赛。 */
public class MixedAnalysisScopesException extends RuntimeException {
    public MixedAnalysisScopesException(String message) { super(message); }
}
