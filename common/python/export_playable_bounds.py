#!/usr/bin/env python3
"""从 map-semantics 语料导出「可玩边界」表（供前端 3D 绘制地图边界带）。

边界 = 游戏内实际战场范围（`playableBoundsMeters`），比真实地图 `coordinateBounds`
（世界坐标 ±300）小。与上游 Agent 的 `frontend/src/scene/playableBounds.json` 同义，
区别只在键：本仓 3D 用 mapCode，故按 `mapCodes` 展开。

用法：python common/python/export_playable_bounds.py
产物：frontend/src/data/playableBounds.js（GENERATED，勿手改）
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / 'common' / 'map-semantics'
OUT = ROOT / 'frontend' / 'src' / 'data' / 'playableBounds.js'


def main() -> None:
    entries: dict[str, dict] = {}
    for path in sorted(SRC.glob('*.semantic.json')):
        doc = json.loads(path.read_text(encoding='utf-8'))
        bounds = doc.get('playableBoundsMeters')
        if not bounds:
            continue
        # 单键校验：缺任一维度即跳过（宁缺勿错，前端会回退 worldBounds）
        if not all(isinstance(bounds.get(k), (int, float))
                   for k in ('xMin', 'yMin', 'xMax', 'yMax')):
            continue
        for code in doc.get('mapCodes') or []:
            entries[code] = {k: round(float(bounds[k]), 1)
                             for k in ('xMin', 'yMin', 'xMax', 'yMax')}

    lines = [
        '// GENERATED FILE — do not edit by hand.',
        '// Regenerate: python common/python/export_playable_bounds.py',
        '//',
        '// 可玩边界（游戏内实际战场范围，米）：来源 common/map-semantics/*.semantic.json 的',
        '// `playableBoundsMeters`，按 `mapCodes` 展开成 mapCode → bounds。比真实地图',
        '// coordinateBounds（±300）小——3D 边界带用它，与上游 Agent 同义（上游按数字 map_id，',
        '// 本仓 3D 用 mapCode）。坐标系与回放一致：x = 回放 x、y = 回放 z。',
        '',
        'export const playableBounds = {',
    ]
    for code in sorted(entries):
        b = entries[code]
        lines.append(
            f'  {code}: {{ xMin: {b["xMin"]}, yMin: {b["yMin"]}, '
            f'xMax: {b["xMax"]}, yMax: {b["yMax"]} }},')
    lines.append('}')
    lines.append('')
    OUT.write_text('\n'.join(lines), encoding='utf-8')
    print(f'已导出 {len(entries)} 张图的边界 → {OUT.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
