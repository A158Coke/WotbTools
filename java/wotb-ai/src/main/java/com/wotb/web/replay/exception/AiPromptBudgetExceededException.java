package com.wotb.web.replay.exception;

public class AiPromptBudgetExceededException extends RuntimeException {

    public AiPromptBudgetExceededException() {
        super("AI_PROMPT_MANDATORY_SECTION_TOO_LARGE");
    }

    public AiPromptBudgetExceededException(String message) {
        super(message);
    }

    public AiPromptBudgetExceededException(int estimated, int limit) {
        super("AI_PROMPT_BUDGET_EXCEEDED: estimatedInputTokens=" + estimated + " > limit=" + limit);
    }
}
