package com.wotb.core.processing;

/** AI 未配置异常。 */
public class AiNotConfiguredException extends RuntimeException {
    public AiNotConfiguredException() { super("AI service is not configured"); }
    public AiNotConfiguredException(String message) { super(message); }
}
