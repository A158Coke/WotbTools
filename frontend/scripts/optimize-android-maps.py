#!/usr/bin/env python3
"""Android 2D 地图派生物生成器（2.1.0 Phase 10）。

把 canonical 的 2D 离线底图（默认 `frontend/src/assets/maps/*.webp`）派生成更小的
同比例副本，供 Android 构建打包（Web 构建继续使用 canonical 原图，**不改**）。

确定性纪律（CI 会复核）：
- 参数固定：等比缩放到 `--max-dimension` 以内（不放大）、LANCZOS 重采样、
  WebP `quality` / `method` 由参数决定、剥离元数据（exif/icc/xmp）；
- 同输入 + 同 Pillow/libwebp 版本 → **逐字节相同**输出（`--check-determinism` 会再跑一遍
  比对 sha256）；
- 输出的 manifest 记录每张图的源/派生尺寸、字节数与 sha256，供构建期不变量校验。

用法：
  python3 optimize-android-maps.py --src <dir> --out <dir> [--max-dimension 1024]
                                  [--quality 72] [--method 5] [--manifest <path>]
                                  [--check-determinism]
"""
import argparse
import hashlib
import json
import os
import sys

from PIL import Image


def sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            digest.update(chunk)
    return digest.hexdigest()


def derive(src_path: str, out_path: str, max_dimension: int, quality: int, method: int) -> dict:
    with Image.open(src_path) as image:
        src_size = image.size
        image = image.convert('RGBA')
        longest = max(src_size)
        if longest > max_dimension:
            scale = max_dimension / longest
            dst_size = (round(src_size[0] * scale), round(src_size[1] * scale))
            image = image.resize(dst_size, Image.LANCZOS)
        else:
            dst_size = src_size
        # 不写任何元数据：Pillow 默认不携带 exif/icc（除非显式传入），这里只保证不主动加。
        image.save(out_path, format='WEBP', quality=quality, method=method)
    return {
        'name': os.path.basename(src_path),
        'sourceWidth': src_size[0],
        'sourceHeight': src_size[1],
        'width': dst_size[0],
        'height': dst_size[1],
        'bytes': os.path.getsize(out_path),
        'sha256': sha256(out_path),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--src', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--max-dimension', type=int, default=1024)
    parser.add_argument('--quality', type=int, default=72)
    parser.add_argument('--method', type=int, default=5)
    parser.add_argument('--manifest')
    parser.add_argument('--check-determinism', action='store_true')
    args = parser.parse_args()

    names = sorted(n for n in os.listdir(args.src) if n.lower().endswith('.webp'))
    if not names:
        print(f'optimize-android-maps: no .webp under {args.src}', file=sys.stderr)
        return 1

    os.makedirs(args.out, exist_ok=True)
    entries = []
    for name in names:
        entries.append(derive(os.path.join(args.src, name), os.path.join(args.out, name),
                              args.max_dimension, args.quality, args.method))

    if args.check_determinism:
        # 再跑一遍到临时目录，逐字节比对：确定性是发布链路的硬要求（同参同输出）
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            for name in names:
                again = derive(os.path.join(args.src, name), os.path.join(tmp, name),
                               args.max_dimension, args.quality, args.method)
                first = next(e for e in entries if e['name'] == name)
                if again['sha256'] != first['sha256']:
                    print(f"optimize-android-maps: {name} 非确定性输出 {first['sha256'][:12]} != {again['sha256'][:12]}", file=sys.stderr)
                    return 1
        print('optimize-android-maps: determinism OK')

    manifest = {
        'maxDimension': args.max_dimension,
        'quality': args.quality,
        'method': args.method,
        'files': entries,
    }
    if args.manifest:
        with open(args.manifest, 'w', encoding='utf-8') as f:
            json.dump(manifest, f, indent=2, sort_keys=True)
    total = sum(e['bytes'] for e in entries)
    print(f"optimize-android-maps: {len(entries)} maps, {total / 1048576:.2f} MiB, max-dimension={args.max_dimension} quality={args.quality}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
