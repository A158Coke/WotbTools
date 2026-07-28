package com.wotb.web.replay.exception;

public class AiPromptBudgetExceededException extends RuntimeException {

    public AiPromptBudgetExceededException() {
        super("AI_PROMPT_MANDATORY_SECTION_TOO_LARGE");
    }
}
