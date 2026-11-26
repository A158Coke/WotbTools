package com.wotb.core.replay.processing;

public class AiNotConfiguredException extends RuntimeException {
    public AiNotConfiguredException() { super("AI_NOT_CONFIGURED"); }
    public AiNotConfiguredException(String message) { super(message); }
}
