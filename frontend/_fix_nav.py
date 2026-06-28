path = r'frontend\src\App.vue'
with open(path, encoding='utf-8') as f:
    content = f.read()

# Find the leaderboard button line and add boost button after it
lines = content.split('\n')
for i, line in enumerate(lines):
    if 'leaderboard.btn' in line and '</nav>' in lines[i+1].strip():
        indent = line[:len(line) - len(line.lstrip())]
        boost_btn = f'{indent}<button :class="{{ active: activeTool === \'boost\' }}" @click="navigate(\'boost\')">陪练</button>'
        lines.insert(i+1, boost_btn)
        break

with open(path, 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))

print('OK')
