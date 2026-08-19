<script setup>
import { useTheme } from './composables/useTheme.js'
import ExtendedPage from './components/ExtendedPage.vue'

const { theme, handleTheme } = useTheme()

function onLangChange(e) { localStorage.setItem('wotb-lang', e.target.value) }
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

  <ExtendedPage />
</template>

<style>
.topbar { min-height: 56px; display: flex; align-items: center; gap: 14px; padding: 10px 20px; background: color-mix(in srgb, var(--bg-card) 92%, transparent); border-bottom: 1px solid var(--border-header); position: sticky; top: 0; z-index: 5; box-shadow: 0 10px 24px rgba(18, 22, 18, .08); backdrop-filter: blur(14px); }
.brand img { height: 34px; display: block; }
.spacer { flex: 1; }
.lang { border: 1px solid var(--border-ghost); border-radius: 7px; background: var(--bg-card2); color: var(--text); padding: 6px 8px; }
.themebar { display: flex; gap: 6px; }
.themebar button { border: 1px solid var(--border-ghost); background: var(--bg-card2); color: var(--text); border-radius: 7px; padding: 7px 12px; cursor: pointer; }
.themebar button.active { background: var(--accent); color: var(--accent-text); border-color: var(--accent); font-weight: 700; }
.themebar button:hover { background: var(--bg-card-hover); }
@media (max-width: 760px) { .topbar { height: auto; align-items: flex-start; padding: 10px; flex-wrap: wrap; } .spacer { display: none; } }
</style>
