#!/usr/bin/env python
"""Developer-only 辅助：WEBP → raw RGBA（PIL，确定性解码）。
用法: python decode-webp.py <in.webp> <out.rgba>
输出 RGBA 文件前附加 8 字节头: <W u32le><H u32le>，之后为 W*H*4 字节。
"""
import struct
import sys
from PIL import Image

def main():
    if len(sys.argv) < 3:
        print('usage: decode-webp.py <in.webp> <out.rgba>', file=sys.stderr)
        sys.exit(2)
    src, dst = sys.argv[1], sys.argv[2]
    im = Image.open(src).convert('RGBA')
    w, h = im.size
    data = im.tobytes()
    with open(dst, 'wb') as f:
        f.write(struct.pack('<II', w, h))
        f.write(data)
    print(f'{src}: {w}x{h} -> {dst} ({len(data)} bytes)')

if __name__ == '__main__':
    main()
