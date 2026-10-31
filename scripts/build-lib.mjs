#!/usr/bin/env node
/**
 * dsh-token-usage 构建脚本（本地可复现）
 *
 * 这个仓库对外分发的是 lib/ 构建产物，但本插件脱离 DSH 仓库后没有 tsc/tsdown
 * 工具链可用。这里用 Node 24 内置的 `module.stripTypeScriptTypes` 做“只擦除类型”
 * 的等价编译：
 *  - src/index.ts + src/aggregate.ts + src/types.ts  -> lib/types/*.js
 *  - src/client/index.ts -> lib/client.js（套上 DSH 浏览器插件的
 *    `window.__ModuleLoader__.load` 工厂壳，源码里只有 react 一个运行时依赖）
 *
 * typert.host.js / typert.remote-client.js 是 Typert 生成器产物，这里不重新生成，
 * 由维护者按 wire 类型手工同步（构建后会检查它们包含所需 schema 字段）。
 *
 * 用法：node scripts/build-lib.mjs [--check]
 *   --check 只校验生成结果，不写文件。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripTypeScriptTypes } from 'node:module'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const checkOnly = process.argv.includes('--check')

/** 去掉 legacy 装饰器行（lib 产物不需要：Remote 的运行时 marker 只有资源读取者会用到）。 */
function stripDecorators(source) {
  return source.replace(/^[ \t]*@Remote\([^)]*\)[ \t]*\r?\n/gm, '')
}

/** Node 的类型擦除（只支持可擦除语法：不要 enum / namespace / 参数属性 / 装饰器）。 */
function stripTypes(source, file) {
  try {
    return stripTypeScriptTypes(source, { mode: 'strip', sourceUrl: file })
  } catch (error) {
    throw new Error(`type stripping failed for ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** 类型擦除会在原位留下空格；清掉行尾空白和纯空白行，保持产物可读、diff 干净。 */
function cleanGenerated(source) {
  return source
    .replace(/[ \t\u00a0\u3000]+$/gm, '')
    .replace(/^[ \t\u00a0\u3000]+$/gm, '')
}

/** 把 TS 的 .ts 相对导入改写成运行时的 .js。 */
function rewriteRelativeImports(source) {
  return source.replace(/(from\s+['"])(\.{1,2}\/[^'"]+)\.ts(['"])/g, '$1$2.js$3')
    .replace(/^(\s*import\s+['"])(\.{1,2}\/[^'"]+)\.ts(['"])/gm, '$1$2.js$3')
}

async function readSource(rel) {
  return readFile(join(root, rel), 'utf8')
}

function banner(source, from) {
  return `/* Built from ${from} by scripts/build-lib.mjs — do not edit directly. */\n${source}`
}

async function buildHost() {
  const raw = await readSource('src/index.ts')
  const stripped = stripTypes(stripDecorators(raw), 'src/index.ts')
  const js = banner(rewriteRelativeImports(cleanGenerated(stripped)), 'src/index.ts')
  if (/^\s*@Remote\(/m.test(js)) throw new Error('host bundle still contains decorator syntax')
  return js
}

async function buildAggregate() {
  const raw = await readSource('src/aggregate.ts')
  const js = banner(rewriteRelativeImports(cleanGenerated(stripTypes(raw, 'src/aggregate.ts'))), 'src/aggregate.ts')
  return js
}

async function buildHistory() {
  const raw = await readSource('src/history.ts')
  return banner(rewriteRelativeImports(cleanGenerated(stripTypes(raw, 'src/history.ts'))), 'src/history.ts')
}

async function buildTypes() {
  const raw = await readSource('src/types.ts')
  let js = cleanGenerated(stripTypes(raw, 'src/types.ts'))
  // 纯类型模块：没有任何值导出，补一个 export {} 让它保持 ESM 模块语义。
  if (!/\bexport\b/.test(js.replace(/\/\*[\s\S]*?\*\//g, ''))) js += '\nexport {};\n'
  return banner(js, 'src/types.ts')
}

async function buildClient() {
  const raw = await readSource('src/client/index.ts')
  let body = cleanGenerated(stripTypes(raw, 'src/client/index.ts'))
  body = body.replace(/^[ \t]*import \* as React from ['"]react['"]\s*;?[ \t]*\r?\n/m, '')
  body = body.replace(/^[ \t]*export const inject\b/m, 'const inject')
  body = body.replace(/^[ \t]*export function apply\b/m, 'function apply')
  if (/^\s*export\b/m.test(body)) throw new Error('client bundle still contains an export declaration after stripping')
  if (/^\s*import\b/m.test(body)) throw new Error('client bundle still contains a runtime import after stripping')
  const wrapper = [
    'window.__ModuleLoader__.load({',
    '  id: "dsh-token-usage",',
    '  factory: (require) => {',
    '    var module = { exports: {} };',
    '    var exports = module.exports;',
    '    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
    '    const __reactModule = require("react");',
    '    const React = (__reactModule && __reactModule.createElement)',
    '      ? __reactModule',
    '      : (__reactModule && __reactModule.default ? __reactModule.default : __reactModule);',
    '',
    body.replace(/^/gm, '    ').trimEnd(),
    '',
    '    exports.apply = apply;',
    '    exports.inject = inject;',
    '    return module.exports;',
    '  }',
    '});',
    '',
  ].join('\n')
  // 缩进后纯缩进行也会变成行尾空白，统一再清一次。
  return cleanGenerated(`/* Built from src/client/index.ts by scripts/build-lib.mjs — do not edit directly. */\n${wrapper}`)
}

const outputs = [
  ['lib/types/index.js', await buildHost()],
  ['lib/types/aggregate.js', await buildAggregate()],
  ['lib/types/history.js', await buildHistory()],
  ['lib/types/types.js', await buildTypes()],
  ['lib/client.js', await buildClient()],
]

for (const [rel, content] of outputs) {
  const path = join(root, rel)
  if (checkOnly) {
    const current = await readFile(path, 'utf8').catch(() => '')
    if (current !== content) {
      console.error(`[build-lib] ${rel} is out of date`)
      process.exitCode = 1
    }
    continue
  }
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, 'utf8')
  console.log(`[build-lib] wrote ${rel} (${content.length} bytes)`)
}

// typert 清单是手工同步的生成物：确认 wire schema 覆盖新字段。
for (const rel of ['lib/typert.host.js', 'lib/typert.remote-client.js']) {
  const content = await readFile(join(root, rel), 'utf8')
  for (const field of ["'backfill'", "'phase'", "'coldReads'"]) {
    if (!content.includes(field)) throw new Error(`${rel} is missing wire schema field ${field}`)
  }
}
console.log('[build-lib] typert manifests contain backfill schema')
