<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTheme } from './composables/useTheme.js'
import * as api from './utils/api.js'

const { t, te } = useI18n()
const { theme, handleTheme } = useTheme()

const files = ref([])
const loading = ref(false)
const error = ref('')
const previewResp = ref(null)
const ratingResp = ref(null)
const activeBattle = ref(0)
const sortState = ref({})

const battles = computed(() => previewResp.value?.battles || [])
const currentBattle = computed(() => battles.value[activeBattle.value] || null)
const playerCols = computed(() => previewResp.value?.playerColumns || [])
const ratingCols = computed(() => ratingResp.value?.ratingColumns || [])
const duplicateRows = computed(() => [...tagRows('preview', previewResp.value?.duplicates), ...tagRows('rating', ratingResp.value?.duplicates)])
const failureRows = computed(() => [...tagRows('preview', previewResp.value?.failures), ...tagRows('rating', ratingResp.value?.failures)])

function onLangChange(e) { localStorage.setItem('wotb-lang', e.target.value) }

function tagRows(scope, rows) {
  return (rows || []).map(r => ({ scope, name: r[0], detail: r[1] }))
}

function addFiles(list) {
  const picked = Array.from(list || []).filter(f => f.name.toLowerCase().endsWith('.wotbreplay'))
  const byKey = new Map(files.value.map(f => [fileKey(f), f]))
  picked.forEach(f => byKey.set(fileKey(f), f))
  files.value = Array.from(byKey.values()).sort((a, b) => displayName(a).localeCompare(displayName(b)))
  previewResp.value = null
  ratingResp.value = null
  activeBattle.value = 0
  error.value = ''
}

function fileKey(f) {
  return `${f.webkitRelativePath || f.name}:${f.size}:${f.lastModified}`
}

function displayName(f) {
  return f.webkitRelativePath || f.name
}

function formData() {
  const fd = new FormData()
  files.value.forEach(f => fd.append('files', f, displayName(f)))
  return fd
}

function clearFiles() {
  files.value = []
  previewResp.value = null
  ratingResp.value = null
  activeBattle.value = 0
  error.value = ''
}

async function runPreview() {
  if (!files.value.length) {
    error.value = t('extended.no_files')
    return
  }
  loading.value = true
  error.value = ''
  try {
    previewResp.value = await api.preview(formData())
    activeBattle.value = 0
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function runRating() {
  if (!files.value.length) {
    error.value = t('extended.no_files')
    return
  }
  loading.value = true
  error.value = ''
  try {
    ratingResp.value = await api.ratingLeaderboard(formData())
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function label(scope, key) {
  const path = `${scope}.${key}`
  return te(path) ? t(path) : key
}

function setSort(scope, key, num) {
  const prev = sortState.value[scope]
  sortState.value[scope] = prev?.key === key
    ? { key, num, reverse: !prev.reverse }
    : { key, num, reverse: false }
}

function sorted(rows, scope) {
  const state = sortState.value[scope]
  if (!state) return rows || []
  const out = [...(rows || [])]
  out.sort((a, b) => {
    const av = a.cells?.[state.key]
    const bv = b.cells?.[state.key]
    if (state.num) return (parseFloat(String(av ?? '').replace('%', '')) || 0) - (parseFloat(String(bv ?? '').replace('%', '')) || 0)
    return String(av ?? '').localeCompare(String(bv ?? ''))
  })
  return state.reverse ? out.reverse() : out
}

function arrow(scope, key) {
  const state = sortState.value[scope]
  return state?.key === key ? (state.reverse ? ' ▼' : ' ▲') : ''
}
</script>

<template>
  <div class="topbar">
    <a class="brand" href="https://wotbtools.com">
      <img src="/wotbtoolslogo.png" alt="WoTBTools">
    </a>
    <strong>{{ $t('extended.title') }}</strong>
    <div class="spacer"></div>
    <select class="lang" v-model="$i18n.locale" @change="onLangChange">
      <option value="zh">中文</option>
      <option value="en">English</option>
      <option value="ru">Русский</option>
    </select>
    <div class="themebar">
      <button :class="{ active: theme === 'auto' }" @click="handleTheme('auto')">{{ $t('theme.auto') }}</button>
      <button :class="{ active: theme === 'light' }" @click="handleTheme('light')">{{ $t('theme.light') }}</button>
      <button :class="{ active: theme === 'dark' }" @click="handleTheme('dark')">{{ $t('theme.dark') }}</button>
    </div>
  </div>

  <main class="wrap">
    <section class="toolbar">
      <label class="filebtn">
        {{ $t('upload.select_files') }}
        <input type="file" multiple accept=".wotbreplay" @change="e => { addFiles(e.target.files); e.target.value = '' }">
      </label>
      <label class="filebtn ghost">
        {{ $t('upload.select_folder') }}
        <input type="file" multiple webkitdirectory @change="e => { addFiles(e.target.files); e.target.value = '' }">
      </label>
      <button class="ghost" :disabled="loading || !files.length" @click="clearFiles">{{ $t('upload.clear') }}</button>
      <button :disabled="loading || !files.length" @click="runPreview">{{ $t('extended.preview') }}</button>
      <button :disabled="loading || !files.length" @click="runRating">{{ $t('extended.rating') }}</button>
      <span class="muted">{{ files.length ? $t('upload.files_count', { count: files.length }) : $t('extended.empty') }}</span>
      <span v-if="loading" class="muted">{{ $t('action.processing') }}</span>
    </section>

    <section v-if="files.length" class="files">
      <span v-for="f in files" :key="fileKey(f)" class="chip">{{ displayName(f) }}</span>
    </section>

    <p v-if="error" class="error">{{ error }}</p>

    <section v-if="duplicateRows.length" class="notice warn">
      <strong>{{ $t('result.duplicates', { count: duplicateRows.length }) }}</strong>
      <span v-for="(d, i) in duplicateRows" :key="`dup-${i}`">[{{ $t(`extended.scope_${d.scope}`) }}] {{ d.name }}</span>
    </section>

    <section v-if="failureRows.length" class="notice fail">
      <strong>{{ $t('result.failures', { count: failureRows.length }) }}</strong>
      <span v-for="(f, i) in failureRows" :key="`fail-${i}`">[{{ $t(`extended.scope_${f.scope}`) }}] {{ f.name }}</span>
    </section>

    <section v-if="ratingResp?.rows?.length" class="panel">
      <h2>{{ $t('extended.rating_title') }}</h2>
      <div class="tablewrap">
        <table>
          <thead><tr>
            <th v-for="c in ratingCols" :key="c.key" @click="setSort('rating', c.key, c.num)">
              {{ label('rating_labels', c.key) }}{{ arrow('rating', c.key) }}
            </th>
          </tr></thead>
          <tbody>
            <tr v-for="(row, i) in sorted(ratingResp.rows, 'rating')" :key="i">
              <td v-for="c in ratingCols" :key="c.key" :class="{ num: c.num }">{{ row.cells[c.key] }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="battles.length" class="panel">
      <h2>{{ $t('extended.fields_title') }}</h2>
      <div class="tabs">
        <button v-for="(b, i) in battles" :key="i" :class="{ active: activeBattle === i }" @click="activeBattle = i">
          {{ b.mapName || $t('team.unknown') }} #{{ i + 1 }}
        </button>
      </div>

      <template v-if="currentBattle">
        <p class="meta">
          {{ $t('metric.map') }}: {{ currentBattle.mapName || '-' }} ·
          {{ $t('leaderboard.version') }}: {{ currentBattle.version || '-' }} ·
          {{ $t('metric.winner') }}: {{ currentBattle.winnerTeam || '-' }} ·
          {{ currentBattle.sourceName }}
        </p>
        <div class="tablewrap">
          <table>
            <thead><tr>
              <th v-for="c in playerCols" :key="c.key" @click="setSort('players', c.key, c.num)">
                {{ label('player_labels', c.key) }}{{ arrow('players', c.key) }}
              </th>
            </tr></thead>
            <tbody>
              <tr v-for="(row, i) in sorted(currentBattle.players, 'players')" :key="i" :class="row.team === 1 ? 't1' : 't2'">
                <td v-for="c in playerCols" :key="c.key" :class="{ num: c.num }">{{ row.cells[c.key] }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </section>
  </main>
</template>

<style>
.topbar { min-height: 56px; display: flex; align-items: center; gap: 14px; padding: 10px 20px; background: color-mix(in srgb, var(--bg-card) 92%, transparent); border-bottom: 1px solid var(--border-header); position: sticky; top: 0; z-index: 5; box-shadow: 0 10px 24px rgba(18, 22, 18, .08); backdrop-filter: blur(14px); }
.brand img { height: 34px; display: block; }
.spacer { flex: 1; }
.lang { border: 1px solid var(--border-ghost); border-radius: 7px; background: var(--bg-card2); color: var(--text); padding: 6px 8px; }
.themebar { display: flex; gap: 6px; }
.themebar button, button, .filebtn { border: 1px solid var(--border-ghost); background: var(--bg-card2); color: var(--text); border-radius: 7px; padding: 7px 12px; cursor: pointer; }
.themebar button.active, .toolbar button:not(.ghost), .filebtn:not(.ghost) { background: var(--accent); color: var(--accent-text); border-color: var(--accent); font-weight: 700; }
.themebar button:hover, button:hover:not(:disabled), .filebtn:hover { background: var(--bg-card-hover); }
button:disabled { opacity: .55; cursor: default; }
.filebtn input { display: none; }
.wrap { max-width: 1500px; margin: 0 auto; padding: 18px 20px 32px; }
.toolbar, .files, .tabs { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.files { margin-top: 10px; }
.chip { border: 1px solid var(--border); background: var(--bg-card2); border-radius: 6px; padding: 4px 7px; font-size: 12px; }
.muted, .meta { color: var(--text-muted); font-size: 13px; }
.error { color: var(--error); }
.notice { margin-top: 10px; border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; display: flex; gap: 10px; flex-wrap: wrap; font-size: 13px; }
.warn { background: color-mix(in srgb, var(--accent) 9%, var(--bg-card)); }
.fail { color: var(--error); }
.panel { margin-top: 14px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 14px; box-shadow: var(--surface-shadow); }
h2 { font-size: 16px; margin: 0 0 10px; color: var(--text-heading); }
.tabs { margin-bottom: 8px; }
.tabs button { background: transparent; color: var(--text-sub); }
.tabs button.active { background: var(--bg-card); color: var(--accent-dark); border-color: var(--border-tab-active); font-weight: 700; }
.tablewrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-card); }
table { border-collapse: collapse; width: max-content; min-width: 100%; font-size: 13px; }
th, td { border-bottom: 1px solid var(--border-light); padding: 6px 9px; white-space: nowrap; }
th { background: var(--bg-card2); color: var(--text-heading); cursor: pointer; user-select: none; }
td.num { text-align: center; }
tr.t1 td { background: color-mix(in srgb, var(--accent) 10%, var(--bg-card)); }
tr.t2 td { background: color-mix(in srgb, var(--bg-t2) 72%, var(--bg-card)); }
@media (max-width: 760px) { .topbar { height: auto; align-items: flex-start; padding: 10px; flex-wrap: wrap; } .wrap { padding: 12px; } .spacer { display: none; } }
</style>
