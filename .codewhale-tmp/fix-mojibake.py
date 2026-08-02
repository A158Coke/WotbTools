# Fix mojibake javadoc in AiReplayAnalysisService.initMetrics
path = 'java/wotb-web/src/main/java/com/wotb/web/replay/ai/AiReplayAnalysisService.java'
with open(path, 'r', encoding='utf-8', newline='') as f:
    lines = f.readlines()

fixed = 0
out = []
for i, l in enumerate(lines):
    stripped = l.strip()
    # mojibake line: contains the garbled UTF-8-as-Latin1 text
    if stripped.startswith('*') and 'MeterRegistry' in l and 'å' in l:
        out.append('     * 初始化可观测性指标（仅当 MeterRegistry 可用时；单元测试中为 null 则跳过）。\n')
        fixed += 1
    else:
        out.append(l)

with open(path, 'w', encoding='utf-8', newline='') as f:
    f.writelines(out)
print('fixed mojibake lines:', fixed)

# verify
with open(path, 'r', encoding='utf-8') as f:
    check = f.read()
import re
m = re.search(r'/\*\*\n(.*?)\*/\n    @PostConstruct\n    void initMetrics', check, re.S)
print('javadoc now:', m.group(1).strip() if m else 'NOT FOUND')
