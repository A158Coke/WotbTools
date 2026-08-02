# Rewrite AiReplayAnalysisService.call(): start upstream timer/counter ONLY after checkTokenBudget passes.
path = 'java/wotb-web/src/main/java/com/wotb/web/replay/ai/AiReplayAnalysisService.java'
with open(path, 'r', encoding='utf-8', newline='') as f:
    text = f.read()
lines = text.split('\r\n')

start = None
for i, l in enumerate(lines):
    if l.strip().startswith('private String call('):
        start = i
        break
assert start is not None, 'call() not found'

# find method end: 4-space-indented brace after start
end = None
for i in range(start + 1, len(lines)):
    if lines[i] == '    }':
        end = i
        break
assert end is not None, 'method end not found'

new_call = [
    '    private String call(',
    '            final Map<String, Object> requestBody,',
    '            final String analysisMode',
    '    ) {',
    '        final String correlationId = UUID.randomUUID().toString();',
    '        final int requestChars = requestBody.toString().length();',
    '        final boolean metrics = meterRegistry != null;',
    '        // Token budget 检查必须先于任何指标统计：被拒的请求不产生 upstream request/duration/error。',
    '        checkTokenBudget(requestBody);',
    '        // 只有检查通过、准备执行上游调用时，才启动 Timer 并计数。',
    '        final Timer.Sample upstreamSample = metrics ? Timer.start(meterRegistry) : null;',
    '        if (metrics) {',
    '            meterRegistry.counter("wotb_ai_upstream_requests_total",',
    '                    "mode", analysisMode).increment();',
    '        }',
    '        String errorType = null;',
    '        try {',
    '            final ChatCompletionResponse response;',
    '            try {',
    '                response = restClient.post()',
    '                        .uri("/chat/completions")',
    '                        .header("Authorization", "Bearer " + apiKey)',
    '                        .contentType(MediaType.APPLICATION_JSON)',
    '                        .body(requestBody)',
    '                        .retrieve()',
    '                        .body(ChatCompletionResponse.class);',
    '            } finally {',
    '                // 网络成功与异常都必须停止 Timer',
    '                if (upstreamSample != null) {',
    '                    upstreamSample.stop(aiUpstreamDuration);',
    '                }',
    '            }',
    '            final String content;',
    '            try {',
    '                content = extractContent(response);',
    '            } catch (final AiUpstreamException e) {',
    '                logProviderFailure(',
    '                        null, e.code(), requestChars, analysisMode, correlationId,',
    '                        "invalid completion envelope");',
    '                errorType = e.code();',
    '                throw new AiUpstreamException(e.code(), null, correlationId);',
    '            }',
    '            if (!StringUtils.hasText(content)) {',
    '                logProviderFailure(',
    '                        null, "AI_EMPTY_RESPONSE", requestChars, analysisMode,',
    '                        correlationId, "blank completion content");',
    '                errorType = "AI_EMPTY_RESPONSE";',
    '                throw new AiUpstreamException("AI_EMPTY_RESPONSE", null, correlationId);',
    '            }',
    '',
    '            // Log actual token usage from API response',
    '            if (response.usage() != null) {',
    '                logUsage(response.usage(), analysisMode);',
    '            }',
    '',
    '            return content;',
    '        } catch (final RestClientResponseException e) {',
    '            final int status = e.getStatusCode().value();',
    '            final String code = classifyHttpError(status, e.getResponseBodyAsString());',
    '            logProviderFailure(',
    '                    status, code, requestChars, analysisMode, correlationId,',
    '                    safeProviderSummary(e.getResponseBodyAsString()));',
    '            errorType = code;',
    '            throw new AiUpstreamException(code, status, correlationId);',
    '        } catch (final ResourceAccessException e) {',
    '            final String code = isTimeout(e) ? "AI_TIMEOUT" : "AI_UPSTREAM_UNAVAILABLE";',
    '            logProviderFailure(',
    '                    null, code, requestChars, analysisMode, correlationId,',
    '                    e.getClass().getSimpleName());',
    '            errorType = code;',
    '            throw new AiUpstreamException(code, null, correlationId);',
    '        } catch (final RestClientException e) {',
    '            final String code = classifyClientFailure(e);',
    '            logProviderFailure(',
    '                    null, code, requestChars, analysisMode,',
    '                    correlationId, e.getClass().getSimpleName());',
    '            errorType = code;',
    '            throw new AiUpstreamException(code, null, correlationId);',
    '        } finally {',
    '            if (metrics && errorType != null) {',
    '                meterRegistry.counter("wotb_ai_upstream_errors_total",',
    '                        "type", errorType).increment();',
    '            }',
    '        }',
    '    }',
]

lines[start:end + 1] = new_call

with open(path, 'w', encoding='utf-8', newline='') as f:
    f.write('\r\n'.join(lines))

with open(path, 'r', encoding='utf-8', newline='') as f:
    check = f.read()
print('checkTokenBudget before Timer:', 'checkTokenBudget(requestBody);' in check)
print('requests counter:', check.count('wotb_ai_upstream_requests_total'))
print('errors counter:', check.count('wotb_ai_upstream_errors_total'))
print('old unconditional increment gone:', 'wotb_ai_upstream_requests_total",' not in check.replace('wotb_ai_upstream_requests_total",\n', ''))
