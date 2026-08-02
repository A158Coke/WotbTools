# Verify mojibake fix - ASCII-only output
import re
check = open('java/wotb-web/src/main/java/com/wotb/web/replay/ai/AiReplayAnalysisService.java', encoding='utf-8').read()
m = re.search(r'/\*\*\n(.*?)\*/\n    @PostConstruct\n    void initMetrics', check, re.S)
if m:
    text = m.group(1).strip()
    # report codepoints instead of raw text (console is cp1252)
    cps = [hex(ord(c)) for c in text]
    print('javadoc len:', len(text))
    print('javadoc codepoints:', ' '.join(cps[:20]))
    print('has CJK:', any('\u4e00' <= c <= '\u9fff' for c in text))
    print('is mojibake (latin1 range):', all(ord(c) < 0x2500 for c in text))
else:
    print('javadoc: NOT FOUND')
print('mojibake count:', check.count('\u00e5'))
