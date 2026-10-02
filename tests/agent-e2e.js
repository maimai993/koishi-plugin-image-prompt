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
const imageCount = (call) => imageUrls(call).length

/**
 * 请求体里参考图的地址。
 * 图会被下载成 base64 data url 塞进请求体，所以要把 base64 解回原文 ——
 * 探针的假 http.file 返回的就是「url 本身」，解码后正好能看出这张图是谁。
 */
const imageUrls = (call) => {
  const content = call && call.body && call.body.messages && call.body.messages[0] && call.body.messages[0].content
  if (!Array.isArray(content)) return []
  return content.filter(item => item && item.type === 'image_url').map(item => {
    const raw = String(item.image_url?.url || '')
    const m = /^data:[^;,]*;base64,(.+)$/s.exec(raw)
    return m ? Buffer.from(m[1], 'base64').toString('utf8') : raw
  })
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
    // 返回 url 本身当内容：图会被转成 base64 塞进请求体，解码后正好能看出这张图是谁
    file: async (src) => ({ data: Buffer.from(String(src)) }),
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
    avatar: { enabled: true, autoAt: true, autoSelf: false, size: 640, ...options.avatar },
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

    // 用户随消息发的图 / @ 的人：拼进原始 content。
    // 注意 stripped.content 要模拟 Koishi 的行为 —— 它会把开头连续的 <at> 剥掉，
    // 所以「/画图/测试 @某某」里 @ 只出现在 content 里，stripped 里没有。
    const parts = []
    for (const t of options.atTargets || []) parts.push(h.at(String(t.id), t.name ? { name: t.name } : {}))
    for (const u of options.images || []) parts.push(h.image(u))
    parts.push(h.text(fullMessage))
    const hasExtras = !!(options.atTargets || options.images)

    const session = {
      selfId: 'bot-1',
      userId: 'user-1',
      platform: 'qq',
      channelId: 'channel-1',
      guildId: undefined,
      messageId: 'msg-1',
      content: hasExtras ? parts.join('') : fullMessage,
      event: { message: { content: parts } },
      stripped: { content: hasExtras ? parts.filter(p => p.type !== 'at') : [h.text(fullMessage)] },
      ...(options.authorAvatar ? { author: { avatar: options.authorAvatar } } : {}),
      app: { koishi: { config: {} } },
      text: (key, params) => key + (params ? ' :: ' + params.join(' | ') : ''),
      send: async (content) => { sent.push(content); return ['mid-1'] },
      bot: {
        sendMessage: async (_channelId, content) => { sent.push(['[主动]', content]); return ['mid-1'] },
        deleteMessage: async () => {},
        // QQ 官方机器人的 appid，头像地址要用它拼
        ...(options.botConfigId ? { config: { id: options.botConfigId } } : {}),
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

    check('★ 第一次请求带上了 4 个工具定义', () => {
      const tools = r.agentCalls[0].body.tools
      assert.ok(Array.isArray(tools), '应该带 tools')
      assert.deepStrictEqual(tools.map(t => t.function.name), ['gallery_search', 'ask_user', 'get_avatar', 'draw'])
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
    ]], { rejectTools: true, agent: { askBeforePolish: false } })

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
      // 带一张真实存在的（ref1）让流程真的走到绘图，同时混一个编造的 ref99
      { toolCalls: [{ name: 'draw', args: { prompt: 'a cat', references: ['ref1', 'ref99'] } }] },
      '好了',
    ]], { agent: { askBeforePolish: false } })

    check('★ 编造的编号被丢掉，只用真实存在的那张', () => {
      assert.strictEqual(r.drawCalls.length, 1)
      assert.strictEqual(imageCount(r.drawCalls[0]), 1, '只应带 ref1 一张，不该硬塞不存在的图')
    })
    check('工具结果里告诉模型这个 id 不存在', () => {
      const toolMsgs = r.agentCalls[r.agentCalls.length - 1].body.messages.filter(m => m.role === 'tool')
      const payload = JSON.parse(toolMsgs[toolMsgs.length - 1].content)
      assert.deepStrictEqual(payload.unknown, ['ref99'])
    })
  }

  console.log('5b) 一个参考图都没有、模型也没问过 -> 插件兜底先问一句')
  {
    const r = await run([[
      { toolCalls: [{ name: 'draw', args: { prompt: '一只猫' } }] },
      { toolCalls: [{ name: 'draw', args: { prompt: '一只猫' } }] },
      '画好了',
    ]], { answers: ['直接画'] })

    check('★ 第一次 draw 没有真的开画，而是先问了用户', () => {
      assert.strictEqual(r.drawCalls.length, 1, '只应在第二次 draw 时真的画')
      assert.ok(allTextOf(r).includes('image-prompt.messages.askreference'), `应先问要不要参考图，实际: ${allTextOf(r).slice(0, 300)}`)
    })
    check('★ 用户回「直接画」后重新 draw 就真的画了，且不再追问', () => {
      const times = allTextOf(r).split('image-prompt.messages.askreference').length - 1
      assert.strictEqual(times, 1, `兜底提问只应出现 1 次，实际 ${times} 次`)
    })
    check('★ 默认不润色：工具结果里明确告诉模型 polish=false', () => {
      const toolMsgs = r.agentCalls[1].body.messages.filter(m => m.role === 'tool')
      const payload = JSON.parse(toolMsgs[toolMsgs.length - 1].content)
      assert.strictEqual(payload.asked, true)
      assert.strictEqual(payload.polish, false, '用户说「直接画」，不该润色')
    })
  }

  console.log('5c) 用户说「润色」-> 工具结果里 polish=true')
  {
    const r = await run([[
      { toolCalls: [{ name: 'draw', args: { prompt: '一只猫' } }] },
      { toolCalls: [{ name: 'draw', args: { prompt: '一只可爱的猫，柔和光线' } }] },
      '画好了',
    ]], { answers: ['帮我润色一下'] })

    check('★ polish=true 回给模型', () => {
      const toolMsgs = r.agentCalls[1].body.messages.filter(m => m.role === 'tool')
      const payload = JSON.parse(toolMsgs[toolMsgs.length - 1].content)
      assert.strictEqual(payload.polish, true, '用户说要润色，应回 true')
    })
  }

  console.log('5d) 有参考图时只问「要不要润色」，不再问参考图')
  {
    const r = await run([[
      { toolCalls: [{ name: 'draw', args: { prompt: '一只猫', references: ['ref1'] } }] },
      { toolCalls: [{ name: 'draw', args: { prompt: '一只猫', references: ['ref1'] } }] },
      '好了',
    ]], { answers: ['直接画'] })

    check('★ 问的是润色，不是参考图', () => {
      assert.ok(allTextOf(r).includes('image-prompt.messages.askpolish'), '应问要不要润色')
      assert.ok(!allTextOf(r).includes('image-prompt.messages.askreference'), '已经有参考图了，不该再问要不要参考图')
    })
    check('★ 参考图正常带上了', () => {
      assert.strictEqual(imageCount(r.drawCalls[0]), 1)
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
      { toolCalls: [{ name: 'draw', args: { prompt: 'bg style test', references: ['ref1'] } }] },
      '开始画了',
    ]], { top: { backgroundDrawing: { enabled: true } }, agent: { askBeforePolish: false } })

    check('★ 提示词只出现 1 次', () => {
      const times = allTextOf(r).split('bg style test').length - 1
      assert.strictEqual(times, 1, `提示词出现了 ${times} 次`)
    })
    check('后台绘图提示仍在', () => {
      assert.ok(allTextOf(r).includes('image-prompt.messages.bgstart'), '应提示已开始后台绘图')
    })
  }

  console.log('9) 用户首次输入就带图 -> 直接进参考图（不用模型记得填）')
  {
    const r = await run([[
      { toolCalls: [{ name: 'draw', args: { prompt: '把这张图手办化' } }] },
      '好了',
    ]], {
      images: ['https://img/user-shot.png'],
      agent: { askBeforePolish: false },
    })

    check('★ 用户发的图自动带进绘图请求', () => {
      assert.strictEqual(r.drawCalls.length, 1, `应发起 1 次绘图，实际 ${r.drawCalls.length}`)
      assert.strictEqual(imageCount(r.drawCalls[0]), 1, '应带上用户那张图')
      assert.ok(imageUrls(r.drawCalls[0]).some(u => u.includes('user-shot')), `应带用户图，实际: ${imageUrls(r.drawCalls[0])}`)
    })
    check('★ 系统提示词里列出了这张图的编号', () => {
      const sys = r.agentCalls[0].body.messages[0].content
      assert.ok(/用户随消息发的图：ref\d+（已自动带上/.test(sys), `应写明编号，实际: ${JSON.stringify(sys.slice(-300))}`)
    })
  }

  console.log('10) @ 了谁 -> 自动用那个人的头像当参考图')
  {
    const r = await run([[
      { toolCalls: [{ name: 'draw', args: { prompt: '画我和他的合照' } }] },
      '好了',
    ]], {
      atTargets: [{ id: 'user-2', name: '小明' }],
      botConfigId: '1020test',
      agent: { askBeforePolish: false },
    })

    check('★ 被 @ 的人的头像自动带进绘图请求', () => {
      assert.strictEqual(r.drawCalls.length, 1, `应发起 1 次绘图，实际 ${r.drawCalls.length}`)
      const urls = imageUrls(r.drawCalls[0])
      assert.ok(urls.some(u => u.includes('q.qlogo.cn/qqapp/1020test/user-2')), `应带小明头像，实际: ${urls}`)
    })
    check('★ 系统提示词里写清了这是谁的头像', () => {
      const sys = r.agentCalls[0].body.messages[0].content
      assert.ok(/被 @ 的人（已自动带上/.test(sys), '应列出头像编号')
      assert.ok(/小明/.test(sys), '应写清是谁的头像')
    })
    check('★ 自己没被 @，就不会自动带上自己的头像', () => {
      const urls = imageUrls(r.drawCalls[0])
      assert.ok(!urls.some(u => u.includes('user-1')), `不该带自己头像，实际: ${urls}`)
    })
  }

  console.log('11) get_avatar 取自己的头像')
  {
    const r = await run([[
      { toolCalls: [{ name: 'get_avatar', args: {} }] },
      { toolCalls: [{ name: 'draw', args: { prompt: '画我', references: ['ref4'] } }] },
      '好了',
    ]], {
      botConfigId: '1020test',
      authorAvatar: 'https://img/self-avatar.png',
      agent: { askBeforePolish: false },
    })

    check('★ get_avatar 返回了发指令者自己的头像编号', () => {
      const toolMsgs = r.agentCalls[1].body.messages.filter(m => m.role === 'tool')
      const payload = JSON.parse(toolMsgs[toolMsgs.length - 1].content)
      assert.strictEqual(payload.ok, true, `应取到头像，实际: ${JSON.stringify(payload)}`)
      assert.strictEqual(payload.id, 'ref4', '图库 3 张之后，自己的头像应是 ref4')
    })
    check('★ 这个编号真的能用在 draw 上', () => {
      const urls = imageUrls(r.drawCalls[0])
      assert.ok(urls.some(u => u.includes('self-avatar')), `应带上自己头像，实际: ${urls}`)
    })
  }

  console.log('12) 没 @ 任何人 -> 模型编的 userId 一律拒绝（不会拿到陌生人的头像）')
  {
    const r = await run([[
      { toolCalls: [{ name: 'get_avatar', args: { userId: 'stranger-999' } }] },
      { toolCalls: [{ name: 'draw', args: { prompt: '画我吃瓜' } }] },
      '好了',
    ]], {
      botConfigId: '1020test',
      authorAvatar: 'https://img/self-avatar.png',
      agent: { askBeforePolish: false },
    })

    check('★ 编造的 userId 被拒绝', () => {
      const toolMsgs = r.agentCalls[1].body.messages.filter(m => m.role === 'tool')
      const payload = JSON.parse(toolMsgs[toolMsgs.length - 1].content)
      assert.strictEqual(payload.ok, false, `应拒绝，实际: ${JSON.stringify(payload)}`)
      assert.ok(/不认识/.test(payload.error), `应说明不认识，实际: ${payload.error}`)
      const who = (payload.available || []).map(o => o.who).join('、')
      assert.ok(/自己/.test(who) && !/小明|stranger/.test(who), `白名单只该有自己，实际: ${who}`)
    })
    check('★ 拒绝之后绘图里没有出现任何陌生头像', () => {
      const urls = imageUrls(r.drawCalls[0])
      assert.ok(!urls.some(u => /stranger-999/.test(u)), `绝不该带陌生人的头像，实际: ${urls}`)
    })
    check('★ 系统提示词写明这次只能取他自己的头像', () => {
      const sys = r.agentCalls[0].body.messages[0].content
      assert.ok(/只能取发指令者自己的头像/.test(sys), `应写明，实际: ${sys.slice(-300)}`)
    })
  }

  console.log('13) @ 了人 -> 只有自己和被 @ 的人能取，其它 id 仍然拒绝')
  {
    const r = await run([[
      { toolCalls: [{ name: 'get_avatar', args: { userId: 'user-2' } }] },
      { toolCalls: [{ name: 'get_avatar', args: { userId: '小明' } }] },
      { toolCalls: [{ name: 'get_avatar', args: { userId: 'stranger-999' } }] },
      { toolCalls: [{ name: 'draw', args: { prompt: '画我和小明的合照' } }] },
      '好了',
    ]], {
      atTargets: [{ id: 'user-2', name: '小明' }],
      botConfigId: '1020test',
      agent: { askBeforePolish: false },
    })

    const payloadOf = (i) => {
      const toolMsgs = r.agentCalls[i].body.messages.filter(m => m.role === 'tool')
      return JSON.parse(toolMsgs[toolMsgs.length - 1].content)
    }

    check('★ 填被 @ 的人的 id 能取到', () => {
      const p = payloadOf(1)
      assert.strictEqual(p.ok, true, `应取到，实际: ${JSON.stringify(p)}`)
      assert.strictEqual(p.userId, 'user-2')
    })
    check('★ 填他的昵称也能取到，而且是同一个编号', () => {
      const a = payloadOf(1), b = payloadOf(2)
      assert.strictEqual(b.ok, true, `昵称应能取到，实际: ${JSON.stringify(b)}`)
      assert.strictEqual(b.id, a.id, '同一个人的头像不该重复登记')
    })
    check('★ 不在白名单里的 id 依然被拒绝', () => {
      const p = payloadOf(3)
      assert.strictEqual(p.ok, false, `应拒绝，实际: ${JSON.stringify(p)}`)
      assert.ok(/不认识/.test(p.error))
    })
    check('★ 绘图只带了被 @ 的人的头像', () => {
      const urls = imageUrls(r.drawCalls[0])
      assert.ok(urls.some(u => /q\.qlogo\.cn\/qqapp\/1020test\/user-2/.test(u)), `应带小明头像，实际: ${urls}`)
      assert.ok(!urls.some(u => /stranger-999/.test(u)), `不该有陌生人头像，实际: ${urls}`)
    })
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
  process.exit(fail ? 1 : 0)
}

main().catch((error) => {
  console.error('探针本身出错:', error)
  process.exit(1)
})
