/**
 * Agent 端到端探针：用**假 http** 驱动真实的 Koishi 命令流程，
 * 验证「指令触发 → 模型自己查图库 / 追问 / 开画」这条链真的跑通了。
 *
 * 不联网、不起服务，只把 ctx.http.post 换成脚本化的假实现：
 *   - body 里带 tools 的 = agent 请求，按脚本依次返回；
 *   - 不带 tools 的 = 绘图请求，直接回一张 Markdown 图片。
 *
 * 运行: node tests/agent-e2e.js
 * 调试: DEBUG_E2E=1 node tests/agent-e2e.js
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

const { Context, h } = require(path.join(KOISHI_ROOT, 'node_modules/koishi'))

let pass = 0
let fail = 0
function check(name, fn) {
  try {
    fn()
    pass++
    console.log(`  ✔ ${name}`)
  } catch (error) {
    fail++
    console.log(`  ✘ ${name} -> ${error && error.message}`)
  }
}

/** 记录型 logger：裸 Context 的 ctx.logger 没绑定 ctx，调用会炸，这里顶掉 */
const LOGS = []
const LOGGER_STUB = {
  info: (...a) => LOGS.push('INFO ' + a.join(' ')),
  warn: (...a) => LOGS.push('WARN ' + a.join(' ')),
  error: (...a) => LOGS.push('ERROR ' + a.join(' ')),
  debug: (...a) => LOGS.push('DEBUG ' + a.join(' ')),
  success: (...a) => LOGS.push('OK ' + a.join(' ')),
}

/** 一个请求体里带了几张参考图 */
const imageCount = (call) => {
  const content = call && call.body && call.body.messages && call.body.messages[0] && call.body.messages[0].content
  if (!Array.isArray(content)) return 0
  return content.filter(item => item && item.type === 'image_url').length
}

/** 把脚本里的一步包成 assistant 消息 */
function toMessage(step) {
  if (typeof step === 'string') return { role: 'assistant', content: step }
  if (step && step.toolCalls) {
    return {
      role: 'assistant',
      content: step.content || null,
      tool_calls: step.toolCalls.map((call, i) => ({
        id: `call_${i}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.args || {}) },
      })),
    }
  }
  return { role: 'assistant', content: String((step && step.content) || '') }
}

/**
 * 跑一次（或多次）命令。
 * @param {any[][]} scripts 每次调用对应的脚本；多段则在同一 ctx 上跑多次命令（测记忆）
 * @param {{userText?: string, answers?: string[], agent?: object, top?: object,
 *          rejectTools?: boolean, defaultImageUrls?: string[], maxImages?: number}} [options]
 */
async function run(scripts, options = {}) {
  const calls = []
  const queue = (Array.isArray(scripts[0]) ? scripts : [scripts]).flat()
  const answers = (options.answers || []).slice()
  const sent = []

  // 用 URL 区分 agent 与绘图：兜底协议下 agent 请求不带 tools，靠 tools 判断会认错
  const AGENT_URL = 'http://mock.local/agent'
  const DRAW_URL = 'http://mock.local/draw'

  const userTexts = options.userTexts || [(options.userText === undefined ? '白发少女' : options.userText)]

  const ctx = new Context()
  ctx.provide('i18n')
  // 假 http 必须用 ctx.set 而不是 ctx.provide —— provide 只登记「谁提供了服务」，
  // 只有 set 才让 ctx.http 真的等于这个假实现。
  ctx.set('http', {
    post: async (url, data) => {
      // 必须深拷贝：messages 数组会被插件继续 push，不拷贝的话
      // 记录下来的每次调用最后都会指向同一个（已膨胀的）数组
      calls.push({ url, body: JSON.parse(JSON.stringify(data)), isAgent: url === AGENT_URL })
      if (url === AGENT_URL) {
        // 只拒「带 tools 的请求」：不带 tools 的请求要能正常返回，
        // 否则插件根本没有机会改用 JSON 协议
        if (options.rejectTools && data.tools) {
          const error = new Error('Unknown parameter: tools')
          error.response = { status: 400, headers: {}, data: { error: { message: 'Unknown parameter: tools' } } }
          error.status = 400
          throw error
        }
        const step = queue.shift()
        if (step === undefined) return { choices: [{ message: { role: 'assistant', content: '（脚本用完了）' } }] }
        return { choices: [{ message: toMessage(step) }] }
      }
      // 绘图接口
      return { choices: [{ message: { role: 'assistant', content: '![result](https://img/result.png)' } }] }
    },
    get: async () => ({}),
    file: async () => ({ data: Buffer.alloc(32) }),
  })

  const plugin = require('../lib/index.js')

    // 被动回复用满 3 次后插件会改用 bot.sendMessage（真·主动消息），
  // 探针里也要记下来，否则「哪些话真的发出去了」会漏。
  const config = {
    basename: '画图',
    loggerinfo: true,
    appendUserInput: true,
    promptOptimize: 'off',
    baseUrl: DRAW_URL,
    // 绘图接口 sendChatRequest 的 while (retryCount <= config.maxRetries)
    // 里 maxRetries 不填会得到 undefined，循环一次都不进、请求根本不发。
    maxRetries: 0,
    retryInterval: 1,
    referenceGroups: [
      {
        name: '角色立绘',
        enabled: true,
        items: [
          { url: 'https://img/white-hair.png', description: '白发少女 双马尾 水手服 站立 日系厚涂' },
          { url: 'https://img/red-hair.png', description: '红发男性 西装 坐姿 写实风' },
          { url: 'https://img/landscape.png', description: '黄昏海边风景 无人无角色' },
        ],
      },
    ],
    aiSelector: {
      baseUrl: AGENT_URL,
      apiKey: 'test-key',
      model: 'mock-model',
      maxRetries: 0,
      timeout: 5,
      includeAllGroups: true,
    },
    agent: {
      enabled: true,
      maxIterations: 6,
      maxSelect: 3,
      searchLimit: 12,
      askTimeout: 3,
      confirmBeforeDraw: true,
      historyTurns: 6,
      debugLog: false,
      ...options.agent,
    },
    resultGallery: { enabled: false },
    backgroundDrawing: { enabled: false },
    ...(options.top || {}),
    nested: {
      commands: [
        {
          name: '测试',
          prompt: 'draw the character on a desk, photorealistic',
          enabled: true,
          custom: false,
          maxImages: options.maxImages === undefined ? 1 : options.maxImages,
          waitTimeout: 1,
          referenceGroups: ['角色立绘'],
          defaultImageUrls: options.defaultImageUrls || [],
        },
      ],
    },
  }

  const shim = new Proxy(ctx, {
    get(t, key) {
      if (key === 'scope') return { isActive: true, update() {} }
      if (key === 'baseDir') return KOISHI_ROOT
      if (key === 'logger') return LOGGER_STUB
      const value = t[key]
      return typeof value === 'function' ? value.bind(t) : value
    },
  })

  plugin.apply(shim, config)
  await ctx.start()

  const cmd = ctx.$commander._commandList.find((item) => item.name === '测试')
  if (!cmd) throw new Error('没有找到命令 测试（命令名是相对父指令存的，不是「画图/测试」）')
  const action = cmd._actions[cmd._actions.length - 1]

  const results = []
  for (const userText of userTexts) {
    const fullMessage = `/画图/测试${userText ? ' ' + userText : ''}`
    const session = {
      selfId: 'bot-1',
      userId: 'user-1',
      platform: 'qq',
      channelId: 'channel-1',
      guildId: undefined,
      messageId: 'msg-1',
      content: fullMessage,
      event: { message: { content: [h.text(fullMessage)] } },
      stripped: { content: [h.text(fullMessage)] },
      app: { koishi: { config: {} } },
      text: (key, params) => key + (params ? ' :: ' + params.join(' | ') : ''),
      send: async (content) => { sent.push(content); return ['mid-1'] },
      bot: {
        sendMessage: async (_channelId, content) => { sent.push(['[主动]', content]); return ['mid-1'] },
        deleteMessage: async () => {},
      },
      prompt: async () => answers.shift(),
    }
    let result
    try {
      result = await action.call(cmd, { session, options: {}, args: userText ? [userText] : [] }, userText)
    } catch (error) {
      result = '（action 抛错）' + error.message
      if (process.env.DEBUG_E2E) console.log('    [debug] ' + String(error.stack).split('\n').slice(0, 6).join('\n'))
    }
    results.push(result)
    if (options.top?.backgroundDrawing?.enabled) await new Promise(r => setTimeout(r, 80))
  }

  await ctx.stop()

  const agentCalls = calls.filter(c => c.isAgent)
  const drawCalls = calls.filter(c => !c.isAgent)
  return { calls, agentCalls, drawCalls, result: results, sent, userTexts }
}

/** 把发出去的消息 + 返回值拍平成一段文本 */
const allTextOf = (r) => JSON.stringify(r.sent) + JSON.stringify(r.result)

/** 把某次 agent 请求里的 messages 拍平 */
const messagesOf = (call) => JSON.stringify(call.body.messages)

async function main() {
  console.log('1) 主链路：搜图库 → 开画前问一句 → 用户确认 → 开画')
  {
    const r = await run([[
      { toolCalls: [{ name: 'gallery_search', args: { keyword: '白发 水手服' } }] },
      { toolCalls: [{ name: 'ask_user', args: { question: '这次参考 ref1（白发少女 水手服），画成桌上摆件可以吗？' } }] },
      { toolCalls: [{ name: 'draw', args: { prompt: 'a white-hair girl figure on a desk', references: ['ref1'] } }] },
      '画好啦，白发水手服那张做参考～',
    ]], { answers: ['确认'] })

    if (process.env.DEBUG_E2E) {
      console.log('    [debug] agent 请求:', r.agentCalls.length, ' 绘图请求:', r.drawCalls.length)
      console.log('    [debug] 绘图参考图:', r.drawCalls.map(imageCount).join(','))
      console.log('    [debug] 发出去的消息:', JSON.stringify(r.sent).slice(0, 500))
      r.agentCalls.forEach((c, i) => console.log(`    [debug] agent#${i} roles:`, c.body.messages.map(m => m.role).join(',')))
      LOGS.forEach(l => console.log('        ' + l.slice(0, 160)))
    }

    check('★ 一共 4 次 agent 请求（搜图 / 提问 / 开画 / 收尾）', () =>
      assert.strictEqual(r.agentCalls.length, 4, `实际 ${r.agentCalls.length} 次`))

    check('★ 第一次请求带上了 3 个工具定义', () => {
      const tools = r.agentCalls[0].body.tools
      assert.ok(Array.isArray(tools), '应该带 tools')
      assert.deepStrictEqual(tools.map(t => t.function.name), ['gallery_search', 'ask_user', 'draw'])
    })

    check('★ 系统提示词里写了「先搜图库 + 开画前确认」', () => {
      const sys = r.agentCalls[0].body.messages[0].content
      assert.ok(/gallery_search/.test(sys), '应说明 gallery_search')
      assert.ok(/必须先 ask_user/.test(sys), '开画前确认应写进提示词')
    })

    check('★ 搜图结果以 role:tool 回灌，并被模型拿到 id', () => {
      const toolsMsgs = r.agentCalls[1].body.messages.filter(m => m.role === 'tool')
      assert.strictEqual(toolsMsgs.length, 1, '应有 1 条工具结果')
      const payload = JSON.parse(toolsMsgs[0].content)
      assert.strictEqual(payload.matched, 1)
      assert.strictEqual(payload.items[0].id, 'ref1')
      assert.ok(/白发少女/.test(payload.items[0].description))
    })

    check('★ 提问原文发给了用户（不是套话）', () => {
      assert.ok(allTextOf(r).includes('画成桌上摆件可以吗'), `应把模型的问题发给用户，实际: ${allTextOf(r).slice(0, 300)}`)
    })

    check('★ 用户回复「确认」之后才真的开画', () => {
      assert.strictEqual(r.drawCalls.length, 1, `应发起 1 次绘图请求，实际 ${r.drawCalls.length}`)
      assert.strictEqual(imageCount(r.drawCalls[0]), 1, '参考图应只有 ref1 那一张')
    })

    check('★ 提示词只出现 1 次（不重复发）', () => {
      const times = allTextOf(r).split('a white-hair girl figure on a desk').length - 1
      assert.strictEqual(times, 1, `提示词出现了 ${times} 次`)
    })

    check('★ 一触发就先回「收到」', () => {
      assert.ok(allTextOf(r).includes('image-prompt.messages.ack'), '应先回一条收到提示')
    })

    check('模型最后一句话发给了用户', () => {
      assert.ok(allTextOf(r).includes('画好啦'), '应把收尾说明发给用户')
    })
  }

  console.log('2) 用户不点头 -> 模型自己决定不画')
  {
    const r = await run([[
      { toolCalls: [{ name: 'ask_user', args: { question: '画成手办可以吗？' } }] },
      '好的，那这次先不画了',
    ]], { answers: ['算了，我再想想'] })

    check('★ 没有发起绘图（不浪费额度）', () =>
      assert.strictEqual(r.drawCalls.length, 0, `不该有绘图请求，实际 ${r.drawCalls.length}`))
    check('用户的回复被当成工具结果回灌给模型', () => {
      const toolMsgs = r.agentCalls[1].body.messages.filter(m => m.role === 'tool')
      assert.strictEqual(toolMsgs.length, 1)
      assert.ok(/算了/.test(toolMsgs[0].content), `应带上用户原话，实际: ${toolMsgs[0].content}`)
    })
  }

  console.log('3) 提问超时 -> 告诉模型「用户没回」，不卡死')
  {
    const r = await run([[
      { toolCalls: [{ name: 'ask_user', args: { question: '画风要哪种？' } }] },
      { toolCalls: [{ name: 'draw', args: { prompt: 'default style' } }] },
      '按默认画风画了',
    ]], { answers: [] })

    check('超时结果里有 timeout 标记', () => {
      const toolMsgs = r.agentCalls[1].body.messages.filter(m => m.role === 'tool')
      assert.strictEqual(toolMsgs.length, 1)
      const payload = JSON.parse(toolMsgs[0].content)
      assert.strictEqual(payload.timeout, true)
    })
    check('模型可以选择继续画（超时不等于取消）', () =>
      assert.strictEqual(r.drawCalls.length, 1))
  }

  console.log('4) 接口不认 tools -> 自动改用「一行 JSON」协议')
  {
    const r = await run([[
      { content: '{"tool":"gallery_search","args":{"keyword":"白发"}}' },
      { content: '{"tool":"draw","args":{"prompt":"a white-hair girl","references":["ref1"]}}' },
      '画好了',
    ]], { rejectTools: true })

    if (process.env.DEBUG_E2E) {
      console.log('    [debug] agent 请求:', r.agentCalls.length, ' 绘图:', r.drawCalls.length)
      LOGS.filter(l => /WARN/.test(l)).forEach(l => console.log('        ' + l.slice(0, 160)))
    }

    check('★ 被拒后不再带 tools 重试', () => {
      assert.ok(r.agentCalls.length >= 2, `至少请求 2 次，实际 ${r.agentCalls.length}`)
      assert.ok(r.agentCalls[0].body.tools, '第一次带 tools')
      assert.ok(!r.agentCalls[1].body.tools, '第二次不该带 tools')
    })

    check('★ 一行 JSON 也能真的调到工具并开画', () => {
      assert.strictEqual(r.drawCalls.length, 1, `应发起 1 次绘图，实际 ${r.drawCalls.length}`)
      assert.strictEqual(imageCount(r.drawCalls[0]), 1)
    })

    check('兜底规则回灌进了提示词', () => {
      const sys = r.agentCalls[1].body.messages.find(m => m.role === 'system' && /JSON/.test(m.content))
      assert.ok(sys, '应追加一条 JSON 协议说明')
    })
  }

  console.log('5) 模型编造 id -> 不塞不存在的参考图')
  {
    const r = await run([[
      { toolCalls: [{ name: 'draw', args: { prompt: 'a cat', references: ['ref99'] } }] },
      '好了',
    ]])

    check('★ 编造的编号被丢掉，绘图不带任何参考图', () => {
      assert.strictEqual(r.drawCalls.length, 1)
      assert.strictEqual(imageCount(r.drawCalls[0]), 0, '不应硬塞一张图')
    })
    check('工具结果里告诉模型这个 id 不存在', () => {
      const toolMsgs = r.agentCalls[1].body.messages.filter(m => m.role === 'tool')
      const payload = JSON.parse(toolMsgs[0].content)
      assert.deepStrictEqual(payload.unknown, ['ref99'])
    })
  }

  console.log('6) 关掉 agent -> 退化成直连，一次模型请求都不发')
  {
    const r = await run([[]], {
      agent: { enabled: false },
      defaultImageUrls: ['https://img/default.png'],
      maxImages: 0,
    })

    check('★ 一个 agent 请求都没有', () =>
      assert.strictEqual(r.agentCalls.length, 0, `实际 ${r.agentCalls.length} 次`))
    check('仍然正常出图（默认图当参考）', () => {
      assert.strictEqual(r.drawCalls.length, 1)
      assert.strictEqual(imageCount(r.drawCalls[0]), 1)
    })
  }

  console.log('7) 同一频道记住上一轮（「再画一张」能接上）')
  {
    const r = await run([
      [{ toolCalls: [{ name: 'draw', args: { prompt: 'first one' } }] }, '第一张好了'],
      ['再画一张'],
    ], { userTexts: ['白发少女', '再画一张'], maxImages: 0, defaultImageUrls: ['https://img/default.png'] })

    check('★ 第二次请求带上了上一轮的对话', () => {
      const calls = r.agentCalls
      assert.ok(calls.length >= 2, `至少 2 次 agent 请求，实际 ${calls.length}`)
      const second = calls[calls.length - 1]
      const all = messagesOf(second)
      assert.ok(all.includes('白发少女'), '应记得上一轮用户说的话')
      assert.ok(all.includes('第一张好了'), '应记得上一轮助手说的话')
      assert.ok(all.includes('再画一张'), '应带上这一轮的输入')
    })
  }

  console.log('8) 后台绘图：提示词仍然只发一次')
  {
    const r = await run([[
      { toolCalls: [{ name: 'draw', args: { prompt: 'bg style test' } }] },
      '开始画了',
    ]], { top: { backgroundDrawing: { enabled: true } } })

    check('★ 提示词只出现 1 次', () => {
      const times = allTextOf(r).split('bg style test').length - 1
      assert.strictEqual(times, 1, `提示词出现了 ${times} 次`)
    })
    check('后台绘图提示仍在', () => {
      assert.ok(allTextOf(r).includes('image-prompt.messages.bgstart'), '应提示已开始后台绘图')
    })
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
  process.exit(fail ? 1 : 0)
}

main().catch((error) => {
  console.error('探针本身出错:', error)
  process.exit(1)
})
