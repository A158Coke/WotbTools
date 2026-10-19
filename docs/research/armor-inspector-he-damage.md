# Armor Inspector HE 伤害机制探索进度（2026-10-19）

> 目标对象：`static.wotinspector.com/ai/webapp4.5.3-4/armor-inspector.wasm` +
> `armor-inspector.data`（Blitz 11.21.0）。
>
> 本文只记录探索结论与当前取舍，不代表 Armor Inspector 的 HE 伤害已经逐像素复刻。
> 当前发布版 WotbTools 仍使用 BlitzKit 的 HE 溅射公式。

## 0. 当前结论

```text
HE 在首个表面爆炸，不穿透后续层。
首面 Primary（hull/turret/gun）用名义厚度 ×1；
首面非 Primary（spaced/chassis/gunBarrel/外部模块）用名义厚度 ×3。

he_min = max(0, 0.375 × D − 1.1 × E_min)
he_avg = max(0, 0.500 × D − 1.1 × E_avg)
he_max = max(0, 0.625 × D − 1.1 × E_max)
expected = D × chance + he_avg × (1 − chance)
```

其中 `D` 是 HE 满伤，`E_min/E_avg/E_max` 是命中点附近、爆炸半径 R 内的
**首面装甲统计**；不是点击点的单一板厚，也不是 20+256 这样的层厚相加。

## 1. 已确认：首面 + 3× 规则

AI 实测的信号是 `damageHECalculated(he_min, he_max, he_avg)`。
由 `he` 值反推局部装甲 E：

```text
E_min = (0.375D − he_min) / 1.1
E_avg = (0.500D − he_avg) / 1.1
E_max = (0.625D − he_max) / 1.1
```

典型样本（AI 原始 `he` 顺序为 min / max / avg）：

| 案例 | AI he_min / he_max / he_avg | 反推 E_min / E_avg / E_max |
|---|---:|---:|
| T-34 车体 50mm | 21.59 / 69.31 / 45.45 | 48.6 / 49.6 / 50.6 |
| Pz IV G 48.6mm | 21.23 / 67.78 / 44.51 | 48.9 / 50.4 / 52.0 |
| D2 40mm | 30.92 / 78.20 / 54.56 | 40.1 / 41.3 / 42.5 |
| M3 Stuart 31.2mm | 48.67 / 96.31 / 72.49 | 23.9 / 25.0 / 26.1 |
| Vickers 6.35mm | 64.68 / 112.04 / 88.36 | 9.4 / 10.6 / 11.8 |
| T-34 履带20 + 车体50 | 14.64 / 51.07 / 32.86 | 54.9 / 61.0 / 67.2 ≈ 20×3 |
| Super Conqueror 20mm屏 + 256mm炮塔 | 129.5 / 245.8 / 187.7 | 57.8 / 63.5 / 69.2 ≈ 20×3 |

结论：

- 20mm 间隙/履带按 60mm（20×3）进入 HE 公式。
- 256mm 后续炮塔不进入装甲项。
- `he_min` 对应 E_min，`he_max` 对应 E_max；不是固定装甲值乘伤害浮动。
- M3/Vickers 的 E 与点击板厚不同，证明 E 是命中点附近的局部装甲统计。

## 2. 已确认：采样域与爆炸半径 R 相关

AI HE shader 中存在：

- `HE_DAMAGE_SAMPLER`
- `u_heCameraViewProjectionMatrix`
- `u_heCameraViewMatrix`
- `u_depthConstantsHE`
- `u_explosionRadius`
- `u_invTexSize`

`calcDamage()` 的关键逻辑：

```glsl
distance = depth * u_depthConstantsHE.y + u_depthConstantsHE.x + depthTest;
if (distance >= u_explosionRadius) return 0.0;

armor = piercingTexture.r * 768.0;
damageHE = u_damage * (1.0 - distance / u_explosionRadius)
         - armor * 1.3 * u_antifragmentationLiningFactor;
```

因此 HE 的采样域是：

```text
爆炸点附近、HE camera 可见的装甲表面
只保留到爆炸点距离 < R 的样本
每个样本只取首面装甲
```

屏幕空间固定 36 点采样是错误方向：它忽略真实深度/R 距离，斜面上会采到 R 外
或漏掉 R 内；不能用来复刻 `he_min/max/avg`。

## 3. 未完全恢复的部分

目前还没有拿到：

- HE camera 的位置/朝向（爆炸点、法线偏移、看向首面还是弹道方向）；
- 投影类型与范围（透视/正交、正交尺寸是否 2R）；
- `HE_DAMAGE_SAMPLER` 纹理分辨率；
- `he_min/max/avg` 在 HE damage texture 上的归约范围/权重（是否 PCF/邻域）；
- E_min/E_max 与伤害浮动采样的对应权重。

已尝试通过 WebGL 钩子抓 HE camera 矩阵、纹理尺寸和视口，但 AI 页面在
WebGL 矩阵/纹理拦截下会超时，尚未拿到这些参数。现有证据只能确定：
**公式 + 首面 3× + R 内局部首面装甲统计**，不能声称逐像素完全一致。

## 4. 当前发布取舍（2026-10-19）

由于 HE splash 的实验版本与 Armor Inspector 仍有可见差异，且 HE camera 采样
参数未完全恢复，决定：

- **回退 HE splash 的全部实验改动**；
- 当前发布继续使用 **BlitzKit HE 溅射公式**：

```text
0.5 × damage × (1 − d/R)
− 1.1 × (lastLayerEffective + min(totalSpacedEffective, penetration))
```

- **保留 HE 击穿概率卡**：HE 首面是 Primary 时继续使用 Armor Inspector 的
  概率链；<1% 显示等概率卡行为不变。
- 当前分支基线为 `fb9b6e611`（合入最新 main + HE 概率卡 + BlitzKit 溅射）。
- 实验版完整保留在归档分支/标签：

```text
branch: archive/he-splash-experiments-20261019
tag:    archive/he-splash-experiments-20261019
HEAD:   e03f62848
```

归档内容包含：首面/3× 规则、屏幕空间面积采样、HE 外部模块触发、
方案 A/公式卡片等实验；不作为当前发布内容。

## 5. 如果继续做完全一致

建议单独实现 HE camera，而不是继续调主相机屏幕采样：

```text
爆炸点（沿首面法线外移 ε）
→ HE camera / cubemap 或 R 限制表面采样
→ 每个样本取首面名义装甲
→ Primary ×1，非 Primary ×3
→ E_min / E_avg / E_max
→ he_min / he_avg / he_max
```

需要先解决：

1. HE camera 投影/朝向/纹理尺寸；
2. 首面/背面/遮挡与近裁剪；
3. `HE_DAMAGE_SAMPLER` 的归约权重/PCF；
4. HE 仅命中履带/炮管/外部模块（无 Primary）时的判定触发。

在这些参数确定前，不应把实验版 HE 溅射当作 Armor Inspector 的精确复刻。

## 6. 可复现资料

Armor Inspector 本地分析目录（Agent 仓 `tmp_analysis/armor-inspector`）：

- `shaders.txt`：HE shader / `calcDamage` / HE camera uniform 源码；
- `he_uniforms.log`：`u_damage`、`u_explosionRadius`、`u_depthConstantsHE` 实测；
- `he_targets.json` / `he_grid.json`：`damageHECalculated` 多目标实测；
- `he_compute_real.js` / `he_targets2.js`：`ShotResultVisitor` 与 HE 信号探针；
- `HE_MECHANISM_IMPLEMENTATION_HANDOFF.md`：早期探索交接报告。
