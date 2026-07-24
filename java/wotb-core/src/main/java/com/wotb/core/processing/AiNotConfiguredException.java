package com.wotb.core.processing;

/** AI 未配置异常。消息为稳定错误码。 */
public class AiNotConfiguredException extends RuntimeException {
    public AiNotConfiguredException() { super("AI_NOT_CONFIGURED"); }
    public AiNotConfiguredException(String message) { super(message); }
}
