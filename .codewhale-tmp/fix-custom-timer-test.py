# Update CustomTimerPrometheusTest: remove wotb_replay_results_total assertions (metric removed)
path = 'java/wotb-web/src/test/java/com/wotb/web/replay/metrics/CustomTimerPrometheusTest.java'
with open(path, 'r', encoding='utf-8', newline='') as f:
    text = f.read()

# 1) success assertions: drop results_total line
old_succ = '''        // 请求量与文件数计数
        assertTrue(scrape.contains("wotb_replay_requests_total{operation=\\"preview\\"} 1"));
        assertTrue(scrape.contains("wotb_replay_files_total{operation=\\"preview\\"} 2"));
        assertTrue(scrape.contains("wotb_replay_results_total{operation=\\"preview\\",result=\\"success\\"} 1"));'''
new_succ = '''        // 请求量与文件数计数
        assertTrue(scrape.contains("wotb_replay_requests_total{operation=\\"preview\\"} 1"));
        assertTrue(scrape.contains("wotb_replay_files_total{operation=\\"preview\\"} 2"));'''
assert old_succ in text, 'success block not found'
text = text.replace(old_succ, new_succ)

# 2) failure test: replace results_total assertion with timer-stop verification
old_fail = '''        assertTrue(thrown);
        final String scrape = registry.scrape();
        assertTrue(scrape.contains("wotb_replay_results_total{operation=\\"rating\\",result=\\"failure\\"} 1"),
                "failure result must be recorded: " + scrape);
        // in-flight gauge 在异常后归零
        assertTrue(scrape.contains("wotb_replay_in_flight 0"),
                "in-flight must return to 0 after failure: " + scrape);'''
new_fail = '''        assertTrue(thrown);
        final String scrape = registry.scrape();
        // 异常路径也结束 Timer（duration count=1）且 in-flight 归零
        assertTrue(scrape.contains("wotb_replay_parse_duration_seconds_count{operation=\\"rating\\"} 1"),
                "timer must stop on failure: " + scrape);
        assertTrue(scrape.contains("wotb_replay_in_flight 0"),
                "in-flight must return to 0 after failure: " + scrape);'''
assert old_fail in text, 'failure block not found'
text = text.replace(old_fail, new_fail)

with open(path, 'w', encoding='utf-8', newline='') as f:
    f.write(text)

with open(path, 'r', encoding='utf-8') as f:
    check = f.read()
print('results_total refs:', check.count('wotb_replay_results_total'))
print('duration count ref:', check.count('wotb_replay_parse_duration_seconds_count'))
print('in-flight ref:', check.count('wotb_replay_in_flight 0'))
