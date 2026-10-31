import { readFileSync } from 'node:fs'
import { mergeConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import base from './vite.config.js'
const resolved = typeof base === 'function' ? base({ command: 'serve', mode: 'test' }) : base
const readers = JSON.parse(readFileSync('reader-tests.json', 'utf8'))
export default mergeConfig(await resolved, { test: { exclude: [...configDefaults.exclude, '.st/**', 'reports/**', ...readers] } })
