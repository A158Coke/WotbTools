# Remove misleading wotb_replay_results_total from ReplayUsageMetrics
# (DefaultReplayProcessingFacade returns status=FAILED instead of throwing; exception-based
#  success/failure is unreliable -> drop the metric entirely, keep requests/files/duration/in-flight)
path = 'java/wotb-web/src/main/java/com/wotb/web/replay/metrics/ReplayUsageMetrics.java'
with open(path, 'r', encoding='utf-8', newline='') as f:
    text = f.read()

# 1) javadoc: remove results_total line
old_doc = ' *   <li>{@code wotb_replay_results_total{operation,result=success|failure}} — 成功/失败</li>\n'
new_doc = ''
assert old_doc in text, 'javadoc line not found'
text = text.replace(old_doc, new_doc)

# 2) timed(): remove result tracking + results counter, keep timer + in-flight
old_timed = '''    public <T> T timed(final String operation, final int fileCount, final Callable<T> body) throws Exception {
        if (meterRegistry == null) {
            return body.call();
        }
        inFlight.incrementAndGet();
        counter("wotb_replay_requests_total", operation).increment();
        if (fileCount > 0) {
            counter("wotb_replay_files_total", operation).increment(fileCount);
        }
        final Timer.Sample sample = Timer.start(meterRegistry);
        String result = "success";
        try {
            return body.call();
        } catch (final Exception e) {
            result = "failure";
            throw e;
        } finally {
            sample.stop(timer("wotb_replay_parse_duration_seconds", operation));
            counter("wotb_replay_results_total", operation, "result", result).increment();
            inFlight.decrementAndGet();
        }
    }'''
new_timed = '''    public <T> T timed(final String operation, final int fileCount, final Callable<T> body) throws Exception {
        if (meterRegistry == null) {
            return body.call();
        }
        inFlight.incrementAndGet();
        counter("wotb_replay_requests_total", operation).increment();
        if (fileCount > 0) {
            counter("wotb_replay_files_total", operation).increment(fileCount);
        }
        final Timer.Sample sample = Timer.start(meterRegistry);
        try {
            return body.call();
        } finally {
            // 成功与异常路径都结束 Timer 并递减 in-flight
            sample.stop(timer("wotb_replay_parse_duration_seconds", operation));
            inFlight.decrementAndGet();
        }
    }'''
assert old_timed in text, 'timed() not found'
text = text.replace(old_timed, new_timed)

# 3) remove the unused 3-arg counter overload
old_counter = '''    private Counter counter(final String name, final String operation, final String tagKey, final String tagValue) {
        return meterRegistry.counter(name, "operation", operation, tagKey, tagValue);
    }

'''
assert old_counter in text, '3-arg counter not found'
text = text.replace(old_counter, '')

# 4) javadoc of timed(): drop success/failure mention
old_timed_doc = '''    /**
     * 执行并统计一次回放解析：请求量+1、文件数累计、成功/失败、耗时。
     * 成功与异常路径都会正确结束 Timer 与 in-flight 计数。
     */'''
new_timed_doc = '''    /**
     * 执行并统计一次回放解析：请求量+1、文件数累计、耗时。
     * 成功与异常路径都会正确结束 Timer 与 in-flight 计数。
     * 注意：不统计 success/failure——解析失败以 ReplayProcessingResult.status=FAILED 返回而非抛异常，
     * 异常判定不可靠，见 docs/observability.md。
     */'''
assert old_timed_doc in text, 'timed javadoc not found'
text = text.replace(old_timed_doc, new_timed_doc)

with open(path, 'w', encoding='utf-8', newline='') as f:
    f.write(text)

with open(path, 'r', encoding='utf-8') as f:
    check = f.read()
print('results_total refs:', check.count('wotb_replay_results_total'))
print('result = refs:', check.count('result ='))
print('requests_total:', check.count('wotb_replay_requests_total'))
print('duration timer:', check.count('wotb_replay_parse_duration_seconds'))
print('in_flight:', check.count('wotb_replay_in_flight'))
