// 从 package.json 读取版本号，写入 src/version.ts。
// 由 prebuild / version 钩子触发，保持运行时常量与 package.json 同步、避免漂移。

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = pkg.version

if (typeof version !== 'string' || version.length === 0) {
  throw new Error('package.json: version is missing or not a string')
}

const target = join(root, 'src', 'version.ts')
const content = `// 由 scripts/sync-version.mjs 自动生成。请勿手工修改。
// 运行时版本号常量，来源 package.json。

export const VERSION = '${version}'
`

writeFileSync(target, content, 'utf8')
console.log(`[sync-version] wrote ${target} (VERSION=${version})`)
