"""Stable JSON-cell projection and compact LLM text rendering."""
from __future__ import annotations
from typing import Any


def round_cell_for_json(cell: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": cell["id"],
        "nineGridRegion": cell["nineGridRegion"],
        "boundsMeters": {
            "xMin": round(cell["bounds"][0], 2),
            "yMin": round(cell["bounds"][1], 2),
            "xMax": round(cell["bounds"][2], 2),
            "yMax": round(cell["bounds"][3], 2),
        },
        "meanElevationMeters": round(cell["meanElevationMeters"], 3),
        "minElevationMeters": round(cell["minElevationMeters"], 3),
        "maxElevationMeters": round(cell["maxElevationMeters"], 3),
        "meanSlopeDegrees": round(cell["meanSlopeDegrees"], 3),
        "p90SlopeDegrees": round(cell["p90SlopeDegrees"], 3),
        "featureCounts": cell["featureCounts"],
        "semanticTags": cell["semanticTags"],
        "dominantClass": cell["dominantClass"],
        "confidence": "GRID_RULE_DERIVED",
    }


def render_llm_text(document: dict[str, Any]) -> str:
    lines = [
        f"地图：{document['displayName']}（{document['mapId']}）",
        f"战斗变体：{document['battleVariant']}",
        "来源：Wot Blitz 客户端 SC2 + heightmap；未调用 LLM。",
        "",
        "【可信边界】",
        "- 坐标、高程、出生点、占领点：客户端直接数据。",
        "- 对象坐标：客户端直接数据；建筑/铁路/植被等类别由资源名规则识别。",
        "- 区域边界、favors、risks：规则推导候选，不是战术真理。",
        "- 未解析碰撞体、视线和导航前，不生成 CONTROLS 或 ENABLES_PRESSURE_AGAINST。",
        "",
        "【全图事实】",
        (
            f"- 可玩边界：x={document['playableBoundsMeters']['xMin']:.2f}.."
            f"{document['playableBoundsMeters']['xMax']:.2f} m，"
            f"y={document['playableBoundsMeters']['yMin']:.2f}.."
            f"{document['playableBoundsMeters']['yMax']:.2f} m。"
        ),
        (
            f"- 高程：{document['terrain']['playableElevationMeters']['min']:.2f}.."
            f"{document['terrain']['playableElevationMeters']['max']:.2f} m；"
            f"平均坡度 {document['terrain']['playableSlopeDegrees']['mean']:.2f}°，"
            f"P90 {document['terrain']['playableSlopeDegrees']['p90']:.2f}°。"
        ),
        (
            f"- Z 轴交叉校验：{document['terrain']['coordinateValidation']['sampleCount']} 个点，"
            f"MAE {document['terrain']['coordinateValidation']['meanAbsoluteDeltaMeters']:.4f} m，"
            f"P90 {document['terrain']['coordinateValidation']['p90AbsoluteDeltaMeters']:.4f} m。"
        ),
        "",
        "【区域语义】",
    ]
    for area_id, area in document["areas"].items():
        lines.extend(
            [
                f"{area_id}｜{area['label']}",
                f"- 网格：{', '.join(area['gridCells'])}",
                "- 九宫格：" + ", ".join(
                    f"GRID_REGION_{n}" for n in area.get("gridRegions", [])
                ) or "- 九宫格：UNKNOWN",
                f"- 类型：{', '.join(area['types'])}",
            ]
        )
        for characteristic in area["characteristics"]:
            lines.append(f"- 事实：{characteristic}")
        lines.append(
            "- favors（规则候选）：" + (", ".join(area["favors"]) if area["favors"] else "UNKNOWN")
        )
        if area["risks"]:
            for risk in area["risks"]:
                lines.append(f"- risk（规则候选）：{risk}")
        else:
            lines.append("- risks：UNKNOWN")
        counts = area["evidence"]["featureCounts"]
        count_text = ", ".join(f"{key}={value}" for key, value in counts.items()) or "none"
        lines.append(f"- 对象证据：{count_text}")
        lines.append("")

    lines.append("【区域关系】")
    for relation in document["relationships"]:
        lines.append(
            f"- {relation['from']} -> {relation['type']} -> {relation['to']}；"
            f"依据：{relation['reason']}；置信度：{relation['confidence']}"
        )
    if not document["relationships"]:
        lines.append("- UNKNOWN")

    lines.extend(("", "【出生点语义】"))
    for team, semantics in document["spawnSemantics"].items():
        if semantics["status"] == "UNKNOWN":
            lines.append(f"- {team}: UNKNOWN")
        else:
            lines.append(
                f"- {team}: {semantics['spawnCount']} 个出生点；"
                f"网格 {', '.join(semantics['gridCells'])}；"
                f"区域 {', '.join(semantics['areas'])}"
            )
    lines.extend(
        (
            "",
            "【给战术推理模型的约束】",
            "- 可以结合 Tank Tactical Profiles 从以上事实提出战术假设。",
            "- 不得把 RULE_DERIVED_CANDIDATE 当作已验证结论。",
            "- 不得仅凭本文件声称某区域必然控制另一战线、必然存在交叉火力或必然可通行。",
        )
    )
    return "\n".join(lines) + "\n"
