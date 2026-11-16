#!/bin/bash
# usage: matrix.sh <tag>  example 回放 678x298 dpr1.25；follow-mid/rec-ex × 1x/6x × 3 次；每格单独进程、失败重试、已有输出跳过
cd "$(dirname "$0")"
for r in 1 2 3; do for sc in follow-mid rec-ex; do for x in 1 6; do
  f="out/$1r${r}_example_${sc}_x${x}.json"
  for try in 1 2 3; do
    [ -f "$f" ] && break
    VW=678 VH=298 VDPR=1.25 node run.mjs $sc $x --fixture=example --secs=30 --tag=$1r${r}_ 2>&1 | grep -v "^ *at " | cut -c1-300
  done
done; done; done
echo done
