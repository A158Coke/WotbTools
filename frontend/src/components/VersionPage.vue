<script setup>
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
defineEmits(['back'])
</script>

<template>
  <div class="vp-wrap">
    <header>
      <div class="brand">
        <span class="logo">W</span>
        <div class="brandtext">
          <h1>{{ $t('app.title') }}</h1>
          <p class="subtitle">{{ $t('app.subtitle') }}</p>
        </div>
      </div>
      <button class="ghost" @click="$emit('back')">← {{ $t('version.back') }}</button>
    </header>

    <div class="vp-content">
      <section>
        <h2 class="vp-major">v1.4.0 — 2026-06-25</h2>
        <div class="vp-cat">
          <span class="vp-tag fix">{{ $t('version.fixed') }}</span>
          <ul>
            <li>存活时间推算更准确：解决部分玩家被误判阵亡或观战期间不停止的问题</li>
          </ul>
        </div>
      </section>

      <section>
        <h2 class="vp-major">v1.3.0 — 2026-06-24</h2>
        <div class="vp-cat">
          <span class="vp-tag add">{{ $t('version.added') }}</span>
          <ul>
            <li>存活时间列：每位玩家的阵亡时刻与存活时长</li>
            <li>i18n 三语支持（简体中文 / English / Русский），页面显示语言可选</li>
            <li>评分系统：类似 WN8 的表现评分，按车型基准归一化</li>
            <li>地图名中文化：Excel 导出与前端显示中文地图名</li>
            <li>前端全新数据网格皮肤：浅色主题、队伍行底色、评分徽章</li>
            <li>列选择器重做为下拉面板：分组浏览、拖拽排序</li>
            <li>上传区交互重做：分状态卡片设计，反馈更清晰</li>
            <li>便携构建：零宿主机依赖，一键打包离线 exe</li>
            <li>Docker 化部署：多阶段构建 + CI/CD 自动发布</li>
          </ul>
        </div>
        <div class="vp-cat">
          <span class="vp-tag chg">{{ $t('version.changed') }}</span>
          <ul>
            <li>API 返回纯英文 key，显示名由前端 / 导出层各自转换</li>
          </ul>
        </div>
        <div class="vp-cat">
          <span class="vp-tag rem">{{ $t('version.removed') }}</span>
          <ul>
            <li>删除旧版 Python 离线 exe</li>
          </ul>
        </div>
      </section>

      <section>
        <h2 class="vp-major">v1.0.0 — 2026-06-23</h2>
        <div class="vp-cat">
          <span class="vp-tag add">{{ $t('version.added') }}</span>
          <ul>
            <li>回放解析引擎：解析 .wotbreplay 文件提取战斗数据</li>
            <li>Web API：预览、导出 Excel、列配置查询</li>
            <li>前端页面：上传回放、预览数据、排序筛选、自定义列、导出下载</li>
            <li>导出 Excel：单场战斗明细 + 多场聚合汇总</li>
            <li>离线 exe：无需搭建环境，开箱即用</li>
          </ul>
        </div>
      </section>

      <section>
        <h2 class="vp-major">v0.1.0 — 2026-06-22</h2>
        <div class="vp-cat">
          <span class="vp-tag add">{{ $t('version.added') }}</span>
          <ul>
            <li>项目初始化</li>
          </ul>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.vp-wrap { max-width: 800px; margin: 0 auto; padding: 16px 20px; }
.vp-content { margin-top: 20px; }
section { margin-bottom: 28px; }
.vp-major { font-size: 17px; font-weight: 600; color: #28313f; margin: 0 0 12px; }
.vp-cat { margin: 8px 0; }
.vp-tag { display: inline-block; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 4px; margin-bottom: 6px; }
.vp-tag.add { background: #eaf3de; color: #27500a; }
.vp-tag.fix { background: #fcebeb; color: #791f1f; }
.vp-tag.chg { background: #e6f1fb; color: #0c447c; }
.vp-tag.rem { background: #f1f0f0; color: #555; }
.vp-cat ul { margin: 0; padding-left: 20px; }
.vp-cat li { font-size: 14px; line-height: 1.7; color: #333; }
</style>
