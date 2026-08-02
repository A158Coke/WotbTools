# Locate all mojibake lines in AiReplayAnalysisService (UTF-8-as-Latin1 garbled text)
path = 'java/wotb-web/src/main/java/com/wotb/web/replay/ai/AiReplayAnalysisService.java'
with open(path, 'r', encoding='utf-8', newline='') as f:
    lines = f.readlines()

for i, l in enumerate(lines):
    # mojibake markers: common latin-1 chars that appear in garbled CJK (å, ä, ï, etc.)
    if any(c in l for c in ('\u00e5', '\u00e4', '\u00ef', '\u00e8', '\u00e6', '\u00e0', '\u00f6')):
        # skip legit latin-1 in code (none expected in javadoc/comment lines)
        if '//' in l or '*' in l or '/*' in l:
            print(f'{i+1}: {l.rstrip()}')
