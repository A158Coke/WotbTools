// 设计语言守护规则：docs/frontend/design-language.md §12。
// 新文件立即严格检查；迁移前的旧文件列在 stylelint.legacy.json（基线），迁完一个删一个。
import { readFileSync } from 'node:fs'

const legacy = JSON.parse(readFileSync(new URL('./stylelint.legacy.json', import.meta.url), 'utf8'))

const KEYWORDS = ['transparent', 'currentColor', 'currentcolor', 'inherit', 'initial', 'unset', 'revert', 'none', '0', 'auto']

/** @type {import('stylelint').Config} */
export default {
  plugins: ['stylelint-declaration-strict-value'],
  ignoreFiles: legacy.files,
  rules: {
    'declaration-no-important': true,
    // 颜色、层级、字号、圆角、阴影只能引用 token（§3–§5）
    'scale-unlimited/declaration-strict-value': [
      ['/color$/', 'fill', 'stroke', 'z-index', 'font-size', 'border-radius', 'box-shadow'],
      { ignoreValues: KEYWORDS, disableFix: true },
    ],
    'color-no-hex': true,
    'color-named': 'never',
    'function-disallowed-list': ['rgb', 'rgba', 'hsl', 'hsla'],
    // 断点只有三档，且必须用 range 语法（§6）
    'media-feature-range-notation': 'context',
    'media-feature-name-value-allowed-list': { width: ['768px', '1200px'] },
    'media-feature-name-disallowed-list': ['min-width', 'max-width', 'device-width'],
    // 视口单位：高度用 dvh / svh，宽度用 %（§6）
    'declaration-property-unit-disallowed-list': {
      '/^(height|min-height|max-height|inset|top|bottom)$/': ['vh'],
      '/^(width|min-width|max-width|inline-size)$/': ['vw'],
    },
  },
  overrides: [
    { files: ['**/*.vue'], customSyntax: 'postcss-html' },
    {
      // token 源文件是唯一允许出现原始色值的地方
      files: ['src/styles/tokens/**/*.css'],
      rules: {
        'color-no-hex': null,
        'function-disallowed-list': null,
      },
    },
  ],
}
