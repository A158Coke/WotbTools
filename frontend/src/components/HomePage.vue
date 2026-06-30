<script setup>
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth.js'
import versions from '../data/versions.json'
const { locale } = useI18n()
const { initPromise, tokenParsed } = useAuth()
const isAdmin = ref(false)
onMounted(async () => {
  await initPromise
  const tp = tokenParsed.value
  isAdmin.value = tp?.realm_access?.roles?.includes('wotbtools-admin') || false
})
const tagLabel = { add: { zh: '新增', en: 'Added', ru: 'Добавлено' }, fix: { zh: '修复', en: 'Fixed', ru: 'Исправлено' } }
</script>

<template>
  <div class="homepage">
    <header>
      <img class="header-logo" src="/wotbtoolslogo.png" alt="WoTBTools">
      <h1>{{ locale === 'zh' ? 'WoTBTools' : 'WoTBTools' }}</h1>
      <p class="subtitle">{{ locale === 'zh' ? '《坦克世界闪击战》工具集' : locale === 'ru' ? 'Инструменты World of Tanks Blitz' : 'World of Tanks Blitz Tool Suite' }}</p>
    </header>

    <div class="tools">
      <a class="card" href="/?view=replay">
        <h2>{{ locale === 'zh' ? '回放提取器' : locale === 'ru' ? 'Анализатор реплеев' : 'Replay Extractor' }}</h2>
        <p>{{ locale === 'zh' ? '上传 .wotbreplay 回放文件，提取战斗数据并导出 Excel。' : locale === 'ru' ? 'Загружайте .wotbreplay файлы и экспортируйте данные в Excel.' : 'Upload .wotbreplay files, extract battle data and export to Excel.' }}</p>
        <span class="tag avail">{{ locale === 'zh' ? '可用' : locale === 'ru' ? 'Доступно' : 'Available' }}</span>
      </a>

      <a class="card" href="/?view=leaderboard">
        <h2>{{ locale === 'zh' ? '排行榜' : locale === 'ru' ? 'Рейтинг' : 'Leaderboard' }}</h2>
        <p>{{ locale === 'zh' ? '随机战斗的单场伤害排行 — 上传回放即可上榜。' : locale === 'ru' ? 'Рейтинг урона за случайные бои.' : 'Damage leaderboard for random battles.' }}</p>
        <span class="tag avail">{{ locale === 'zh' ? '可用' : locale === 'ru' ? 'Доступно' : 'Available' }}</span>
      </a>

      <a v-if="isAdmin" class="card" href="/?view=admin-users">
        <h2>{{ $t('admin.cardTitle') }}</h2>
        <p>{{ $t('admin.cardDesc') }}</p>
        <span class="tag avail">Admin</span>
      </a>

      <div class="coming-soon">
        <div class="card">
          <h2>{{ locale === 'zh' ? '战绩卡片' : locale === 'ru' ? 'Карточка статистики' : 'Stats Card' }}</h2>
          <p>{{ locale === 'zh' ? '生成实时战绩卡片。' : locale === 'ru' ? 'Карточка статистики.' : 'Generate live stats card.' }}</p>
          <span class="tag planned">{{ locale === 'zh' ? '规划中' : locale === 'ru' ? 'Планируется' : 'Planned' }}</span>
        </div>
      </div>

      <div class="coming-soon">
        <div class="card">
          <h2>{{ locale === 'zh' ? '开发者 API' : locale === 'ru' ? 'API для разработчиков' : 'Developer API' }}</h2>
          <p>{{ locale === 'zh' ? '开放 API 查询参考数据。' : locale === 'ru' ? 'Открытый API для справочных данных.' : 'Open API for reference data.' }}</p>
          <span class="tag planned">{{ locale === 'zh' ? '规划中' : locale === 'ru' ? 'Планируется' : 'Planned' }}</span>
        </div>
      </div>

      <a class="card" href="/sponsor.html">
        <h2>{{ locale === 'zh' ? '支持项目' : locale === 'ru' ? 'Поддержать' : 'Sponsor' }}</h2>
        <p>{{ locale === 'zh' ? '自愿赞助，用于服务器和维护成本。' : locale === 'ru' ? 'Добровольная поддержка сервера.' : 'Voluntary sponsorship for server costs.' }}</p>
        <span class="tag support">{{ locale === 'zh' ? '赞助' : locale === 'ru' ? 'Донат' : 'Support' }}</span>
      </a>
    </div>

    <section class="version">
      <h2 class="version-title">{{ locale === 'zh' ? '版本历史' : locale === 'ru' ? 'История версий' : 'Version History' }}</h2>
      <div class="ver" v-for="(ver, i) in versions" :key="i">
        <span class="ver-num">v{{ ver.v }}</span>
        <span class="ver-date">{{ ver.date }}</span>
        <span class="ver-tag" :class="ver.tag">{{ tagLabel[ver.tag]?.[locale] || tagLabel[ver.tag]?.zh }}</span>
        <p>{{ ver[locale] || ver.zh }}</p>
      </div>
    </section>

    <footer>{{ locale === 'zh' ? 'WoTBTools — 社区工具，非 Wargaming 官方产品' : 'WoTBTools — Community tool, not a Wargaming product' }}</footer>
  </div>
</template>

<style scoped>
.homepage { max-width: 640px; margin: 0 auto; padding: 0 24px 48px; }
header { text-align: center; padding: 32px 0 24px; }
.header-logo { width: 72px; height: 72px; border-radius: 16px; }
header h1 { font-size: 2rem; font-weight: 700; color: var(--text-heading); margin: 12px 0 4px; }
.subtitle { color: var(--text-muted); font-size: 1rem; }
.tools { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; margin-top: 16px; }
.card {
  background: var(--bg-card); border: 1px solid var(--border);
  border-radius: 12px; padding: 24px 20px; text-decoration: none; color: inherit; display: block;
  transition: border-color .2s, box-shadow .2s;
}
.card:hover { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-shadow); }
.card h2 { font-size: 1.15rem; margin: 0 0 6px; color: var(--text-heading); }
.card p { font-size: .85rem; color: var(--text-muted); line-height: 1.4; }
.tag { display: inline-block; margin-top: 10px; padding: 2px 10px; border-radius: 10px; font-size: .75rem; font-weight: 600; }
.avail { background: var(--tag-bg); color: var(--accent); }
.planned { opacity: .5; background: var(--tag-bg); color: var(--text-muted); }
.support { background: var(--warn-bg); color: var(--warn-text); }
.coming-soon .card { opacity: .45; cursor: default; pointer-events: none; }
.coming-soon .card:hover { border-color: var(--border); box-shadow: none; }
.version { margin-top: 32px; }
.version-title { font-size: 1rem; color: var(--text-heading); margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px solid var(--border); }
.ver { margin-bottom: 10px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; }
.ver-num { font-size: .8rem; font-weight: 600; color: var(--accent); min-width: 50px; }
.ver-date { font-size: .75rem; color: var(--text-muted); }
.ver-tag { font-size: .7rem; font-weight: 600; padding: 1px 6px; border-radius: 4px; }
.ver-tag.add { background: var(--tag-bg); color: var(--accent); }
.ver-tag.fix { background: #fcebeb33; color: #f85149; }
.ver p { font-size: .8rem; color: var(--text-muted); margin: 2px 0 0; flex-basis: 100%; }
footer { margin-top: 32px; text-align: center; font-size: .75rem; color: var(--text-muted); }
@media (max-width: 560px) {
  .header-logo { width: 56px; height: 56px; }
  header h1 { font-size: 1.6rem; }
  .tools { grid-template-columns: 1fr; gap: 12px; }
}
</style>
