/**
 * Agent 纯函数回归测试（不需要 koishi 运行环境）
 * 运行: node tests/agent-tools.js
 *
 * 覆盖 agent 模式里几个「写错了就会静默跑歪」的环节：
 *   - gallery_search 的关键词检索与排序
 *   - references 的编号解析（模型写 ref3 / 3 / gallery:ref3 / 裸链接都要认）
 *   - 从模型返回里取 tool_calls（原生 / 老式 function_call / 中转站怪结构）
 *   - 「一行 JSON」兜底协议（且不能把正常回复误判成工具调用）
 *   - ask_user 提问文案的清洗（模型爱在问句后面顺带聊别的）
 */
const assert = require('node:assert')
const {
  searchGallery,
  resolveReferences,
  parseJsonToolCall,
  pickAgentMessage,
  buildAgentTools,
  renderAgentInstructions,
  cleanAskMessage,
  AGENT_TOOL_NAMES,
} = require('../lib/index.js')

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

const ITEMS = [
  { group: '角色立绘', url: 'https://img/white.png', description: '白发少女 双马尾 水手服 站立 日系厚涂' },
  { group: '角色立绘', url: 'https://img/red.png', description: '红发男性 西装 坐姿 写实风' },
  { group: '风景', url: 'https://img/sea.png', description: '黄昏海边风景 无人无角色' },
]

// ---------- searchGallery ----------
check('searchGallery 命中白发', () => {
  const hits = searchGallery(ITEMS, '白发', 10)
  assert.strictEqual(hits.length, 1)
  assert.strictEqual(hits[0].url, 'https://img/white.png')
})

check('searchGallery 多关键词：全命中的排最前', () => {
  const hits = searchGallery(ITEMS, '白发 水手服', 10)
  assert.strictEqual(hits[0].url, 'https://img/white.png')
})

check('searchGallery 关键词在不同字段（组名）也能命中', () => {
  const hits = searchGallery(ITEMS, '风景', 10)
  assert.strictEqual(hits[0].url, 'https://img/sea.png')
})

check('searchGallery 搜不到就返回空（不硬凑）', () => {
  assert.deepStrictEqual(searchGallery(ITEMS, '奥特曼', 10), [])
})

check('searchGallery 空关键词 = 浏览前 N 张', () => {
  assert.strictEqual(searchGallery(ITEMS, '', 2).length, 2)
})

check('searchGallery limit 生效', () => {
  // 「风」在「写实风」「黄昏海边风景」里都有，命中 2 张，limit=1 只回 1 张
  assert.strictEqual(searchGallery(ITEMS, '风', 1).length, 1)
  assert.strictEqual(searchGallery(ITEMS, '风', 10).length, 2)
})

// ---------- resolveReferences ----------
const REG = new Map([
  ['ref1', { url: 'https://img/white.png' }],
  ['ref2', { url: 'https://img/red.png' }],
])

check('resolveReferences 认 refN', () => {
  const r = resolveReferences(['ref1', 'ref2'], REG)
  assert.deepStrictEqual(r.ids, ['ref1', 'ref2'])
  assert.deepStrictEqual(r.unknown, [])
})

check('resolveReferences 认 gallery:refN 前缀', () => {
  assert.deepStrictEqual(resolveReferences(['gallery:ref2'], REG).ids, ['ref2'])
})

check('resolveReferences 认裸编号 2 -> ref2', () => {
  assert.deepStrictEqual(resolveReferences(['2'], REG).ids, ['ref2'])
})

check('resolveReferences 认登记过的裸链接', () => {
  assert.deepStrictEqual(resolveReferences(['https://img/red.png'], REG).ids, ['ref2'])
})

check('resolveReferences 认 url: 前缀的链接', () => {
  assert.deepStrictEqual(resolveReferences(['url:https://img/white.png'], REG).ids, ['ref1'])
})

check('★ 编造的编号进 unknown（不乱塞图）', () => {
  const r = resolveReferences(['ref99', 'gallery:xxx'], REG)
  assert.deepStrictEqual(r.ids, [])
  assert.deepStrictEqual(r.unknown, ['ref99', 'gallery:xxx'])
})

check('resolveReferences 去重且不炸空输入', () => {
  assert.deepStrictEqual(resolveReferences(['ref1', 'ref1'], REG).ids, ['ref1'])
  assert.deepStrictEqual(resolveReferences(undefined, REG).ids, [])
})

// ---------- pickAgentMessage ----------
check('pickAgentMessage 取原生 tool_calls', () => {
  const res = pickAgentMessage({
    choices: [{
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'gallery_search', arguments: '{"keyword":"白发"}' } }],
      },
    }],
  })
  assert.strictEqual(res.toolCalls.length, 1)
  assert.strictEqual(res.toolCalls[0].name, 'gallery_search')
  assert.strictEqual(res.toolCalls[0].id, 'call_1')
  assert.deepStrictEqual(res.toolCalls[0].args, { keyword: '白发' })
})

check('pickAgentMessage 参数不是合法 JSON 时不炸', () => {
  const res = pickAgentMessage({
    choices: [{ message: { tool_calls: [{ id: 'c', function: { name: 'draw', arguments: '不是 JSON' } }] } }],
  })
  assert.strictEqual(res.toolCalls[0].name, 'draw')
  assert.deepStrictEqual(res.toolCalls[0].args, {})
})

check('pickAgentMessage 认老式 function_call', () => {
  const res = pickAgentMessage({
    choices: [{ message: { content: '', function_call: { name: 'draw', arguments: '{"prompt":"a cat"}' } } }],
  })
  assert.strictEqual(res.toolCalls[0].name, 'draw')
  assert.deepStrictEqual(res.toolCalls[0].args, { prompt: 'a cat' })
})

check('pickAgentMessage 没有工具调用时返回正文', () => {
  const res = pickAgentMessage({ choices: [{ message: { role: 'assistant', content: '画好啦～' } }] })
  assert.strictEqual(res.toolCalls.length, 0)
  assert.strictEqual(res.content, '画好啦～')
})

check('pickAgentMessage 推理模型把正文放在 reasoning_content', () => {
  const res = pickAgentMessage({ choices: [{ message: { content: null, reasoning_content: '想清楚了' } }] })
  assert.strictEqual(res.content, '想清楚了')
})

check('★ 回灌给模型的 message 保留 tool_calls（否则接口报找不到对应调用）', () => {
  const raw = [{ id: 'call_1', type: 'function', function: { name: 'draw', arguments: '{}' } }]
  const res = pickAgentMessage({ choices: [{ message: { content: '', tool_calls: raw } }] })
  assert.ok(Array.isArray(res.message.tool_calls))
  assert.strictEqual(res.message.role, 'assistant')
})

// ---------- 一行 JSON 兜底协议 ----------
check('parseJsonToolCall 认一行 JSON', () => {
  const calls = parseJsonToolCall('{"tool":"draw","args":{"prompt":"a cat"}}', AGENT_TOOL_NAMES)
  assert.strictEqual(calls.length, 1)
  assert.strictEqual(calls[0].name, 'draw')
  assert.deepStrictEqual(calls[0].args, { prompt: 'a cat' })
})

check('parseJsonToolCall 容忍代码块围栏', () => {
  const calls = parseJsonToolCall('```json\n{"tool":"ask_user","args":{"question":"画风？"}}\n```', AGENT_TOOL_NAMES)
  assert.strictEqual(calls[0].name, 'ask_user')
})

check('★ 正常中文回复不会被误判成工具调用', () => {
  assert.deepStrictEqual(parseJsonToolCall('画好啦，给你～', AGENT_TOOL_NAMES), [])
  assert.deepStrictEqual(parseJsonToolCall('我们聊聊 draw 吧', AGENT_TOOL_NAMES), [])
})

check('★ 不在工具名单里的 tool 名不认', () => {
  assert.deepStrictEqual(parseJsonToolCall('{"tool":"search","args":{}}', AGENT_TOOL_NAMES), [])
})

// ---------- buildAgentTools ----------
check('buildAgentTools 三个工具：gallery_search / ask_user / draw', () => {
  const tools = buildAgentTools()
  const names = tools.map(t => t.function.name)
  assert.deepStrictEqual(names, AGENT_TOOL_NAMES)
  for (const tool of tools) {
    assert.strictEqual(tool.type, 'function')
    assert.strictEqual(tool.function.parameters.type, 'object')
  }
  const draw = tools.find(t => t.function.name === 'draw')
  assert.ok(draw.function.parameters.required.includes('prompt'))
})

// ---------- renderAgentInstructions ----------
check('renderAgentInstructions 替换占位符', () => {
  const text = renderAgentInstructions('指令：{command} / 用户：{userInput} / {refCount} 张', {
    command: '手办化', userInput: '白发少女', refCount: 3,
  })
  assert.strictEqual(text, '指令：手办化 / 用户：白发少女 / 3 张')
})

check('renderAgentInstructions 没有对应变量时留空（不把 {xxx} 丢给模型）', () => {
  assert.strictEqual(renderAgentInstructions('A{unknown}B', {}), 'AB')
})

// ---------- cleanAskMessage ----------
check('cleanAskMessage 压成一行', () => {
  assert.strictEqual(cleanAskMessage('想要什么画风？\n顺便说说别的'), '想要什么画风？ 顺便说说别的')
})

check('cleanAskMessage 去掉 markdown 与包裹引号', () => {
  assert.strictEqual(cleanAskMessage('- **问题：**"想要什么画风？"'), '想要什么画风？')
})

check('cleanAskMessage 超长截断', () => {
  const long = '啊'.repeat(300)
  const out = cleanAskMessage(long, 10)
  assert.ok(out.length <= 12)
  assert.ok(out.endsWith('…'))
})

check('cleanAskMessage 空值返回空', () => {
  assert.strictEqual(cleanAskMessage(null), '')
  assert.strictEqual(cleanAskMessage('   '), '')
})

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
