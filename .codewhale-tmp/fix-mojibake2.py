# Fix L203 mojibake comment line in AiReplayAnalysisService by line number
path = 'java/wotb-web/src/main/java/com/wotb/web/replay/ai/AiReplayAnalysisService.java'
with open(path, 'r', encoding='utf-8', newline='') as f:
    lines = f.readlines()

# L203 (index 202) is the mojibake comment; verify it contains marker chars first
target = lines[202]
markers = ('\u00e5', '\u00e4', '\u00ef', '\u00e8', '\u00e6', '\u00e0', '\u00f6')
if any(c in target for c in markers):
    lines[202] = '    // ---- \u53ef\u89c2\u6d4b\u6027: AI Review \u6307\u6807 (MeterRegistry \u53ef\u9009\u6ce8\u5165, \u5355\u5143\u6d4b\u8bd5\u4e3a null \u65f6\u8df3\u8fc7) ----\n'
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.writelines(lines)
    print('FIXED L203')
else:
    print('L203 has no mojibake markers, leaving unchanged')

# verify whole file
with open(path, 'r', encoding='utf-8') as f:
    check = f.read()
import re
m = re.search(r'/\*\*\n(.*?)\*/\n    @PostConstruct\n    void initMetrics', check, re.S)
print('initMetrics javadoc codepoints:', ' '.join(hex(ord(c)) for c in m.group(1).strip()[:15]) if m else 'NOT FOUND')
print('remaining marker count:', sum(check.count(c) for c in markers))
