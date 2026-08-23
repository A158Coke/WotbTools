package com.wotb.web.replay.ai.gateway;

/**
 * 供应商无关的 AI 输出格式契约（docs/current-plan.md §5）。
 * <p>业务层只表达「这个调用期望什么输出形态」，由 {@link SpringAiChatGateway}
 * 映射为 provider 具体参数：{@link #JSON_OBJECT} → {@code response_format=json_object}，
 * {@link #TEXT} 不发送任何 response_format（保持最小 provider surface）。</p>
 *
 * <p>JSON_OBJECT 只保证 provider 层的 syntax（合法 JSON）；业务 schema 由 parser
 * 负责、事实一致性由 validator 负责，三层职责互不替代（§33）。</p>
 */
public enum AiResponseFormat {

    /** 默认：普通文本输出，不发送 response_format。 */
    TEXT,

    /** 结构化 JSON 对象输出：映射为 DeepSeek/OpenAI-compatible {@code response_format={"type":"json_object"}}。 */
    JSON_OBJECT
}
