# Locate all mojibake lines - ASCII-only output
path = 'java/wotb-web/src/main/java/com/wotb/web/replay/ai/AiReplayAnalysisService.java'
with open(path, 'r', encoding='utf-8', newline='') as f:
    lines = f.readlines()

markers = ('\u00e5', '\u00e4', '\u00ef', '\u00e8', '\u00e6', '\u00e0', '\u00f6', '\u00b8', '\u00a7', '\u00a3', '\u00a1')
for i, l in enumerate(lines):
    if any(c in l for c in markers):
        # report line number + count of marker chars + first bytes as hex
        n = sum(l.count(c) for c in markers)
        print(f'L{i+1}: marker_count={n} hex={l.encode("utf-8")[:40].hex()}')
