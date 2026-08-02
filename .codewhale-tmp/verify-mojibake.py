# Verify mojibake fix in AiReplayAnalysisService
import re
check = open('java/wotb-web/src/main/java/com/wotb/web/replay/ai/AiReplayAnalysisService.java', encoding='utf-8').read()
m = re.search(r'/\*\*\n(.*?)\*/\n    @PostConstruct\n    void initMetrics', check, re.S)
print('javadoc:', repr(m.group(1).strip()) if m else 'NOT FOUND')
print('mojibake refs:', check.count('å'))
