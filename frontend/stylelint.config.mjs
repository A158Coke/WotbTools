// 设计语言守护规则：docs/frontend/design-language.md §12。
// 新文件立即严格检查；迁移前的旧文件列在 stylelint.legacy.json（基线），迁完一个删一个。
import { readFileSync } from 'node:fs'

const legacy = JSON.parse(readFileSync(new URL('./stylelint.legacy.json', import.meta.url), 'utf8'))

// 可以代替 token 直接书写的值。插件区分大小写，所以 currentColor 的两种写法都要列出。
// 0 / none：无圆角、无阴影、字号 0 的隐藏技巧；auto：z-index 不建立层叠；normal：line-height 默认值。
const TOKEN_EXEMPT_VALUES = [
  'transparent', 'currentColor', 'currentcolor',
  'inherit', 'initial', 'unset', 'revert',
  'none', '0', 'auto', 'normal',
]

/** @type {import('stylelint').Config} */
export default {
  plugins: ['stylelint-declaration-strict-value'],
  ignoreFiles: legacy.files,
  rules: {
    'declaration-no-important': true,
    // 颜色、层级、字号、行高、圆角、阴影只能引用 token（§3–§5）；font 简写只能是 var(--type-*)
    'scale-unlimited/declaration-strict-value': [
      ['/color$/', 'fill', 'stroke', 'z-index', 'font', 'font-size', 'line-height', 'border-radius', 'box-shadow'],
      { ignoreValues: TOKEN_EXEMPT_VALUES, disableFix: true },
    ],
    'color-no-hex': true,
    'color-named': 'never',
    'function-disallowed-list': ['rgb', 'rgba', 'hsl', 'hsla'],
    // 断点只有三档，且必须用 range 语法（§6）
    'media-feature-range-notation': 'context',
    'media-feature-name-value-allowed-list': { width: ['768px', '1200px'] },
    // device-width 已废弃且与布局视口无关，一并禁止
    'media-feature-name-disallowed-list': ['min-width', 'max-width', 'device-width'],
    // 视口单位：块方向尺寸用 dvh / svh，行方向尺寸用 %（§6）；物理与逻辑属性都覆盖
    'declaration-property-unit-disallowed-list': {
      '/^(height|min-height|max-height|block-size|min-block-size|max-block-size|top|bottom|inset|inset-block|inset-block-start|inset-block-end)$/': ['vh'],
      '/^(width|min-width|max-width|inline-size|min-inline-size|max-inline-size)$/': ['vw'],
      // 每个属性只能落在一个 key 里（第一个匹配的 key 生效），flex-basis 方向不定，两者都禁
      'flex-basis': ['vh', 'vw'],
    },
  },
  overrides: [
    { files: ['**/*.vue'], customSyntax: 'postcss-html' },
    {
      // token 源文件是唯一允许出现原始色值和原始尺寸的地方
      files: ['src/styles/tokens/**/*.css'],
      rules: {
        'color-no-hex': null,
        'function-disallowed-list': null,
      },
    },
  ],
}
