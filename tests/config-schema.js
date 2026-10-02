/**
 * 配置 Schema 回归测试：确认 agent 相关开关的默认值、以及指令级覆盖真的生效。
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

check('★ Agent 默认开启，且开画前确认默认开', () => {
  const cfg = build({})
  assert.strictEqual(cfg.agent.enabled, true, 'agent 默认开')
  assert.strictEqual(cfg.agent.confirmBeforeDraw, true, '开画前确认默认开')
})

check('★ Agent 各项默认值合理', () => {
  const cfg = build({})
  assert.strictEqual(cfg.agent.maxIterations, 8)
  assert.strictEqual(cfg.agent.maxSelect, 3)
  assert.strictEqual(cfg.agent.searchLimit, 12)
  assert.strictEqual(cfg.agent.askTimeout, 120)
  assert.strictEqual(cfg.agent.timeout, 120)
  assert.strictEqual(cfg.agent.maxTokens, 8000)
  assert.strictEqual(cfg.agent.historyTurns, 6)
  assert.strictEqual(cfg.agent.debugLog, false)
})

check('★ Agent 指令模板：说了三个工具 + 带开画确认占位符', () => {
  const cfg = build({})
  const t = cfg.agent.instructions
  assert.ok(t.includes('{confirmRule}'), '应带开画确认占位符')
  assert.ok(/gallery_search/.test(t) && /ask_user/.test(t) && /draw/.test(t), '应说明三个工具')
  assert.ok(/一次只问一个/.test(t), '应要求一次只问一个问题（防模型连珠炮）')
  assert.ok(/不要编造|绝对不要编造/.test(t), '应禁止编造图片编号')
})

check('★ 画图工具定义里不再鼓吹「英文效果更稳」', () => {
  const draw = plugin.buildAgentTools().find(tool => tool.function.name === 'draw')
  const desc = JSON.stringify(draw)
  assert.ok(!/英文效果更稳/.test(desc), '不该再引导模型写英文')
  assert.ok(/中文即可|听得懂中文/.test(desc), '应说明中文就行')
  assert.ok(/不要.*几百字|简短/.test(desc), '应要求简短，别扩写')
})

check('★ Agent 提示词要求「短、说人话、别翻英文」', () => {
  const t = build({}).agent.instructions
  assert.ok(/听得懂中文/.test(t), '应点明绘图模型听得懂中文')
  assert.ok(/不要.*扩写|几百字/.test(t), '应禁止扩写成几百字')
  assert.ok(/不要替他脑补|不要.*脑补/.test(t), '应禁止替用户脑补细节')
})

check('★ 提示词默认「原话直出」，不再默认扩写', () => {
  assert.strictEqual(build({}).promptOptimize, 'passthrough')
  const modes = ['passthrough', 'merge', 'rewrite', 'off']
  for (const m of modes) {
    assert.strictEqual(build({ promptOptimize: m }).promptOptimize, m, `${m} 应可设置`)
  }
})

check('★ 融合重写模板不再要求翻英文 / 不再让补一堆细节', () => {
  const t = build({}).optimizePrompt
  assert.ok(!/英文提示词出图效果通常更稳/.test(t), '不该再引导翻英文')
  assert.ok(/语言跟着用户走/.test(t), '应让语言跟着用户')
  assert.ok(/宁短勿长/.test(t), '应强调宁短勿长')
  assert.ok(!/补足画风、构图、镜头、光线、氛围、配色与细节/.test(t), '不该再要求脑补细节')
})

check('★ 旧选图相关配置项已经彻底删掉（不再出现在解析结果里）', () => {
  const cfg = build({})
  for (const key of ['selectionMode', 'minScore', 'analyzePrompt', 'scorePrompt', 'keywordPrompt', 'twoStage', 'vision', 'maxSelect']) {
    assert.ok(!(key in cfg.aiSelector), `aiSelector 不该再有 ${key}`)
  }
  assert.ok(!('confirmBeforeDraw' in cfg) || typeof cfg.confirmBeforeDraw === 'undefined', '顶层不该再有 confirmBeforeDraw')
  assert.ok(!('confirmTimeout' in cfg), '顶层不该再有 confirmTimeout')
  assert.ok(!('mergeNotifications' in cfg), '顶层不该再有 mergeNotifications')
})

check('★ 指令级「走不走 agent」三态：默认跟随全局', () => {
  const cfg = build({})
  assert.strictEqual(cfg.nested.commands[0].agent, 'follow')
})

check('★ 指令级可以覆盖成 on / off', () => {
  const off = build({ nested: { commands: [{ name: 'x', prompt: '', agent: 'off' }] } })
  assert.strictEqual(off.nested.commands[0].agent, 'off')
  const on = build({ nested: { commands: [{ name: 'y', prompt: '', agent: 'on' }] } })
  assert.strictEqual(on.nested.commands[0].agent, 'on')
})

check('★ 老配置里残留的 aiSelect / aiMaxSelect / confirmBeforeDraw 不会把解析搞崩', () => {
  const cfg = build({
    nested: { commands: [{ name: 'z', prompt: '', aiSelect: true, aiMaxSelect: 2, aiAskUser: true, confirmBeforeDraw: 'off' }] },
  })
  assert.strictEqual(cfg.nested.commands[0].name, 'z')
  assert.strictEqual(cfg.nested.commands[0].agent, 'follow', '新字段仍走默认值')
})

check('顶层开关可以被覆盖', () => {
  const cfg = build({ agent: { enabled: false } })
  assert.strictEqual(cfg.agent.enabled, false)
})

check('默认指令列表仍然带全套字段（老配置不至于因为新字段炸掉）', () => {
  const cfg = build({})
  const first = cfg.nested.commands[0]
  for (const key of ['name', 'prompt', 'enabled', 'custom', 'maxImages', 'waitTimeout', 'defaultImageUrls']) {
    assert.ok(key in first, `缺少字段 ${key}`)
  }
})

check('★ 新开关都是布尔/数字，没混进字符串哨兵', () => {
  const cfg = build({})
  assert.strictEqual(typeof cfg.agent.enabled, 'boolean')
  assert.strictEqual(typeof cfg.agent.confirmBeforeDraw, 'boolean')
  assert.strictEqual(typeof cfg.agent.maxIterations, 'number')
  assert.strictEqual(typeof cfg.ackOnStart, 'boolean')
})

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
