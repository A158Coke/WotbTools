// Docker 构建上下文契约：前端源码里所有逃出 frontend/ 的构建期输入（common JSON、map-semantics glob、
// ?raw Markdown）必须在 docker/Dockerfile.frontend 的 build 阶段 COPY 到同一相对位置，且未被 .dockerignore 排除。
// 防「本地 / CI pnpm build 绿、生产 Docker build 红」（#447：Could not resolve common/tankopedia-tier7.json）。
// 不复制第二份数据进 frontend——common/ 是唯一事实源，Docker 只是把它放到与仓库相同的相对路径。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const FRONTEND = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = resolve(FRONTEND, '..')
const toPosix = p => p.split(sep).join('/')

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return ['__golden__', 'test', 'node_modules'].includes(name) ? [] : sourceFiles(full)
    return /\.(js|ts|vue|mjs)$/.test(name) && !/\.test\.|\.spec\./.test(name) ? [full] : []
  })
}

/** 生产代码引用的、位于 frontend/ 之外的仓库相对路径（glob 取其目录） */
function externalBuildInputs() {
  const inputs = new Map()
  for (const file of sourceFiles(join(FRONTEND, 'src'))) {
    const text = readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, '')
    for (const [, spec] of text.matchAll(/['"`]((?:\.\.\/)+[^'"`\s]+)['"`]/g)) {
      const clean = spec.replace(/\?.*$/, '')
      const glob = clean.indexOf('*')
      const target = resolve(dirname(file), glob >= 0 ? clean.slice(0, clean.lastIndexOf('/', glob)) : clean)
      const rel = toPosix(relative(REPO, target))
      if (rel.startsWith('frontend/') || rel.startsWith('..')) continue
      inputs.set(rel, toPosix(relative(FRONTEND, file)))
    }
  }
  return inputs
}

function buildStageCopies() {
  const docker = readFileSync(join(REPO, 'docker/Dockerfile.frontend'), 'utf8')
  const buildStage = docker.split(/^FROM /m)[1]
  return [...buildStage.matchAll(/^COPY\s+(?!--from)(.+)$/gm)].flatMap(([, args]) => {
    const parts = args.trim().split(/\s+/)
    const dest = parts.pop()
    // 多源或以 / 结尾的目标是目录：每个源落在 <dest>/<basename>
    const intoDir = parts.length > 1 || dest.endsWith('/')
    return parts.map((raw) => {
      const src = raw.replace(/\/$/, '')
      return { src, dest: intoDir ? `${dest.replace(/\/$/, '')}/${src.split('/').pop()}` : dest.replace(/\/$/, '') }
    })
  })
}

function dockerIgnored(path) {
  const rules = readFileSync(join(REPO, '.dockerignore'), 'utf8').split(/\r?\n/)
    .map(l => l.replace(/^﻿/, '').trim()).filter(l => l && !l.startsWith('#'))
  let ignored = false
  const segments = path.split('/')
  for (const rule of rules) {
    const negate = rule.startsWith('!')
    const pattern = negate ? rule.slice(1) : rule
    const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*\//g, '(?:.*/)?').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$')
    // 规则命中路径本身或其任一父目录
    if (segments.some((_, i) => re.test(segments.slice(0, i + 1).join('/')))) ignored = !negate
  }
  return ignored
}

describe('docker/Dockerfile.frontend build context contract', () => {
  const inputs = externalBuildInputs()
  const copies = buildStageCopies()

  it('discovers the replay-local common inputs (scanner self-check)', () => {
    for (const tier of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) expect(inputs.has(`common/tankopedia-tier${tier}.json`)).toBe(true)
    expect(inputs.has('common/map_names.json')).toBe(true)
    expect(inputs.has('common/map-semantics')).toBe(true)
  })

  it.each([...inputs.keys()].map(p => [p]))('%s is copied into the build stage at its repo-relative path', (path) => {
    // WORKDIR /app = frontend/，故 ../<path> 在镜像里是 /<path>
    const covered = copies.some(({ src, dest }) => dest === '/' + src && (path === src || path.startsWith(src + '/')))
    expect(covered, `${path} (imported by ${inputs.get(path)}) is not COPY'd to /${path} in docker/Dockerfile.frontend`).toBe(true)
    expect(dockerIgnored(path), `${path} is excluded by .dockerignore`).toBe(false)
  })

  // 反向护栏（2026-10-15）：DELETE 一个构建输入后，忘记同步删掉 Dockerfile 的 COPY
  // 会让 `docker build` 在 "failed to compute cache key" 处炸掉，而上面的正向断言
  //（引用了没 COPY）天然看不见这种"COPY 了不存在的源"。此断言锁死方向二。
  it('every COPY source exists in the repo (no COPY of deleted inputs)', () => {
    const docker = readFileSync(join(REPO, 'docker/Dockerfile.frontend'), 'utf8')
    const sources = [...docker.matchAll(/^COPY\s+(?!--from)(.+)$/gm)].flatMap(([, args]) => {
      const parts = args.trim().split(/\s+/)
      parts.pop() // 末位 = 目标
      return parts.map(raw => raw.replace(/\/$/, ''))
    })
    expect(sources.length).toBeGreaterThan(0)
    for (const src of sources) {
      expect(existsSync(join(REPO, src)),
        `docker/Dockerfile.frontend COPY ${src} —— 源在仓库中不存在（文件已删除/改名？同步删掉这条 COPY）`).toBe(true)
    }
  })
})
