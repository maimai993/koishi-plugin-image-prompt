/**
 * 配置 Schema 回归测试：确认新增开关的默认值、以及指令级覆盖真的生效。
 *
 * 端到端探针是直接 `plugin.apply(shim, config)` 的，**绕过了 Koishi 的 Schema 校验** ——
 * Schema 写错（例如用了 `Schema.const(undefined)` 表达「跟随」）在那里看不出来，
 * 只有控制台里才会报。所以单独用一个文件把 Schema 过一遍。
 *
 * 运行: node tests/config-schema.js
 */
const assert = require('node:assert')
const path = require('path')
const Module = require('module')

const KOISHI_ROOT = 'E:/devkoishi'
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request === 'koishi') {
    return origResolve.call(this, path.join(KOISHI_ROOT, 'node_modules/koishi'), ...rest)
  }
  return origResolve.call(this, request, ...rest)
}

const { Schema } = require(path.join(KOISHI_ROOT, 'node_modules/koishi'))
const plugin = require('../lib/index.js')

let pass = 0
let fail = 0
function check(name, fn) {
  try {
    fn()
    pass++
    console.log(`PASS ${name}`)
  } catch (error) {
    fail++
    console.log(`FAIL ${name} -> ${error && error.message}`)
  }
}

// Config 是 Schema.intersect([...])，resolve 出来是一个 Schema 数组，逐个套上去
const parts = Schema.resolve(plugin.Config)
const list = Array.isArray(parts) ? parts : [parts]
const build = (input = {}) => list.reduce((acc, part) => Object.assign(acc, part(input)), {})

check('Config 能被 Schema 解析', () => {
  assert.ok(list.length >= 1)
  assert.ok(list.every(part => typeof part === 'function'), '每段都应该是可调用的 Schema')
})

check('新开关默认值正确', () => {
  const cfg = build({})
  assert.strictEqual(cfg.ackOnStart, true, '收到提示默认开')
  assert.strictEqual(cfg.confirmBeforeDraw, true, '开画前确认默认开')
  assert.strictEqual(cfg.confirmTimeout, 60)
  assert.strictEqual(cfg.aiSelector.visionMaxImageBytes, 4)
})

check('★ 指令级「开画前确认」三态：默认跟随全局', () => {
  const cfg = build({})
  assert.strictEqual(cfg.nested.commands[0].confirmBeforeDraw, 'follow')
})

check('★ 指令级可以覆盖成 on / off', () => {
  const off = build({ nested: { commands: [{ name: 'x', prompt: '', confirmBeforeDraw: 'off' }] } })
  assert.strictEqual(off.nested.commands[0].confirmBeforeDraw, 'off')
  const on = build({ nested: { commands: [{ name: 'y', prompt: '', confirmBeforeDraw: 'on' }] } })
  assert.strictEqual(on.nested.commands[0].confirmBeforeDraw, 'on')
})

check('顶层开关可以被覆盖', () => {
  const cfg = build({ ackOnStart: false, confirmBeforeDraw: false, confirmTimeout: 30 })
  assert.strictEqual(cfg.ackOnStart, false)
  assert.strictEqual(cfg.confirmBeforeDraw, false)
  assert.strictEqual(cfg.confirmTimeout, 30)
})

check('默认指令列表仍然带全套字段（老配置不至于因为新字段炸掉）', () => {
  const cfg = build({})
  const first = cfg.nested.commands[0]
  for (const key of ['name', 'prompt', 'enabled', 'custom', 'maxImages', 'waitTimeout', 'defaultImageUrls']) {
    assert.ok(key in first, `缺少字段 ${key}`)
  }
})

check('新开关都是布尔/数字，没混进字符串哨兵', () => {
  const cfg = build({})
  assert.strictEqual(typeof cfg.ackOnStart, 'boolean')
  assert.strictEqual(typeof cfg.confirmBeforeDraw, 'boolean')
  assert.strictEqual(typeof cfg.confirmTimeout, 'number')
})

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
