/**
 * 绘图失败探针：钉住两个真实踩到的坑
 *
 *   1) 接口 500 时，koishi 的 http 错误只留一句状态文本（"Internal Server Error"），
 *      真正的原因（比如上游 ECONNREFUSED、模型负载过高）藏在响应体里被吞掉；
 *   2) 开了后台绘图时，draw 工具返回 ok 就代表「排上队了」，不是「画好了」，
 *      旧版却告诉模型「图已经发到群里了」，于是用户被提前通知「画好了」。
 *
 * 运行: node tests/draw-failure.js
 * 调试: DEBUG_E2E=1 node tests/draw-failure.js
 */
const assert = require('node:assert')
const path = require('path')
const Module = require('module')

const KOISHI_ROOT = 'E:/devkoishi'
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request === 'koishi') return origResolve.call(this, path.join(KOISHI_ROOT, 'node_modules/koishi'), ...rest)
  return origResolve.call(this, request, ...rest)
}

const lib = require('../lib/index.js')
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

const LOGS = []
const LOGGER_STUB = {
  info: (...a) => LOGS.push('INFO ' + a.join(' ')),
  warn: (...a) => LOGS.push('WARN ' + a.join(' ')),
  error: (...a) => LOGS.push('ERROR ' + a.join(' ')),
  debug: () => {},
  success: () => {},
}

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

/** 造一个像 koishi http 抛出来的错误：message 只有状态文本，病根在 response.data 里 */
function httpFailure(status, upstreamMessage) {
  const error = new Error(status === 500 ? 'Internal Server Error' : `HTTP ${status}`)
  error.response = { status, headers: {}, data: { error: { message: upstreamMessage } } }
  error.status = status
  return error
}

const AGENT_URL = 'http://mock.local/agent'
const DRAW_URL = 'http://mock.local/draw'

/**
 * @param {object} options
 *   - drawError: 绘图接口抛的错误（不传则正常返回一张图）
 *   - attempts:  记录每次绘图请求的时刻，用来验证退避
 */
async function run(scripts, options = {}) {
  const calls = []
  const queue = scripts.flat()
  const sent = []
  const drawTimes = []

  ctx_http_impl = async (url, data) => {
    calls.push({ url, body: JSON.parse(JSON.stringify(data)), at: Date.now(), isAgent: url === AGENT_URL })
    if (url === AGENT_URL) {
      const step = queue.shift()
      if (step === undefined) return { choices: [{ message: { role: 'assistant', content: '（脚本用完了）' } }] }
      return { choices: [{ message: toMessage(step) }] }
    }
    drawTimes.push(Date.now())
    if (options.drawError) throw options.drawError
    return { choices: [{ message: { role: 'assistant', content: '![result](https://img/result.png)' } }] }
  }

  const ctx = new Context()
  ctx.provide('i18n')
  ctx.set('http', {
    post: (url, data) => ctx_http_impl(url, data),
    get: async () => ({}),
    file: async () => ({ data: Buffer.alloc(32), mime: 'image/png' }),
  })

  const config = {
    basename: '画图',
    loggerinfo: true,
    appendUserInput: false,
    promptOptimize: 'off',
    baseUrl: DRAW_URL,
    maxRetries: options.maxRetries === undefined ? 2 : options.maxRetries,
    retryInterval: options.retryInterval === undefined ? 20 : options.retryInterval,
    loggerinfoDetail: true,
    referenceGroups: [
      {
        name: '角色立绘',
        enabled: true,
        items: [{ url: 'https://img/white-hair.png', description: '白发少女 双马尾 水手服' }],
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
    // 这个探针测的是「绘图失败怎么处理」，开画前的兜底询问会挡住第一次 draw，关掉
    agent: {
      enabled: true, maxIterations: 6, maxSelect: 3, askTimeout: 2,
      confirmBeforeDraw: false, historyTurns: 0, debugLog: false,
      askIfNoReference: false, askBeforePolish: false,
    },
    resultGallery: { enabled: false },
    backgroundDrawing: { enabled: !!options.background },
    nested: {
      commands: [{
        name: '测试',
        prompt: 'draw it',
        enabled: true,
        custom: false,
        maxImages: 0,
        waitTimeout: 1,
        referenceGroups: ['角色立绘'],
        defaultImageUrls: ['https://img/default.png'],
      }],
    },
    ...(options.top || {}),
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

  lib.apply(shim, config)
  await ctx.start()

  const cmd = ctx.$commander._commandList.find(item => item.name === '测试')
  if (!cmd) throw new Error('没有找到命令 测试')
  const action = cmd._actions[cmd._actions.length - 1]

  const fullMessage = '/画图/测试 白发少女'
  const session = {
    selfId: 'bot-1', userId: 'user-1', platform: 'qq', channelId: 'channel-1',
    guildId: undefined, messageId: 'msg-1', content: fullMessage,
    event: { message: { content: [h.text(fullMessage)] } },
    stripped: { content: [h.text(fullMessage)] },
    app: { koishi: { config: {} } },
    text: (key, params) => key + (params ? ' :: ' + params.join(' | ') : ''),
    send: async (content) => { sent.push(content); return ['mid-1'] },
    bot: { sendMessage: async (_c, content) => { sent.push(['[主动]', content]); return ['mid-1'] }, deleteMessage: async () => {} },
    prompt: async () => 'ok',
  }

  let result
  try {
    result = await action.call(cmd, { session, options: {}, args: ['白发少女'] }, '白发少女')
  } catch (error) {
    result = '（action 抛错）' + error.message
  }
  // 等后台任务跑完
  if (options.background) await new Promise(r => setTimeout(r, 300))

  await ctx.stop()
  return {
    calls, sent, result, drawTimes,
    drawCalls: calls.filter(c => !c.isAgent),
    agentCalls: calls.filter(c => c.isAgent),
    text: JSON.stringify(sent) + JSON.stringify(result),
  }
}

/**
 * 插件的 ctx.logger 是 koishi 自己造的，输出直接打到 stdout，
 * 想断言日志格式就得拦一道 process.stdout.write。
 */
async function runCapturingStdout(fn) {
  const captured = []
  const original = process.stdout.write.bind(process.stdout)
  process.stdout.write = (chunk, ...rest) => {
    captured.push(String(chunk))
    return true
  }
  try {
    return { plan: await fn(), captured: captured.join('') }
  } finally {
    process.stdout.write = original
  }
}

let ctx_http_impl

async function main() {
  console.log('1) httpErrorText：把响应体里的真实原因捞出来')
  {
    check('★ 5xx 只留状态文本时，拼上接口返回的原因', () => {
      const text = lib.httpErrorText(httpFailure(500, 'connect ECONNREFUSED 192.168.0.85:20000'))
      assert.ok(/Internal Server Error/.test(text), text)
      assert.ok(/ECONNREFUSED 192\.168\.0\.85:20000/.test(text), `应带上真原因，实际: ${text}`)
    })
    check('1752 这种「模型负载高」也能透出来', () => {
      const text = lib.httpErrorText(httpFailure(529, '当前模型负载较高，请稍候重试，或者切换其他模型'))
      assert.ok(/负载较高/.test(text), text)
    })
    check('response.data 直接是字符串也能认', () => {
      const err = new Error('Internal Server Error')
      err.response = { status: 500, data: 'upstream boom' }
      assert.ok(/upstream boom/.test(lib.httpErrorText(err)), lib.httpErrorText(err))
    })
    check('普通 Error 不炸', () => {
      assert.strictEqual(lib.httpErrorText(new Error('boom')), 'boom')
      assert.strictEqual(lib.httpErrorText(undefined), '未知原因')
    })
    check('重复信息不会被拼两遍', () => {
      const err = new Error('模型忙')
      err.response = { status: 529, data: { error: { message: '模型忙' } } }
      assert.strictEqual(lib.httpErrorText(err), '模型忙')
    })
  }

  console.log('2) computeRetryDelay：服务端错误要退避，不能固定间隔猛打')
  {
    const { computeRetryDelay } = lib
    check('★ 500 走指数退避', () => {
      assert.strictEqual(computeRetryDelay(500, undefined, 1000, 0), 1000)
      assert.strictEqual(computeRetryDelay(500, undefined, 1000, 2), 4000)
    })
    check('★ 网络层断了（status=0）也退避', () =>
      assert.strictEqual(computeRetryDelay(0, undefined, 1000, 1), 2000))
    check('429 优先听 Retry-After', () =>
      assert.strictEqual(computeRetryDelay(429, 7500, 1000, 3), 7500))
    check('客户端错误（400）不重试退避，按基础间隔', () =>
      assert.strictEqual(computeRetryDelay(400, undefined, 1000, 3), 1000))
    check('退避有上限 30s', () =>
      assert.strictEqual(computeRetryDelay(500, undefined, 10000, 10), 30000))
  }

  console.log('3) 绘图接口 500：用户能看到真实原因，而不是干巴巴一句失败')
  {
    const { plan: r, captured } = await runCapturingStdout(() => run([[
      { toolCalls: [{ name: 'draw', args: { prompt: 'a white-hair girl' } }] },
      '（模型收尾）这次没画出来',
    ]], { drawError: httpFailure(500, 'connect ECONNREFUSED 192.168.0.85:20000'), retryInterval: 5 }))

    if (process.env.DEBUG_E2E) {
      console.log('    [debug] 发给用户的:', r.text.slice(0, 600))
      console.log(captured.split('\n').filter(l => /次尝试|请求失败|仍失败/.test(l)).map(l => '        ' + l.slice(0, 160)).join('\n'))
    }

    check('★ 重试了 maxRetries+1 次（2 -> 3 次）', () =>
      assert.strictEqual(r.drawCalls.length, 3, `实际请求 ${r.drawCalls.length} 次`))

    check('★ 日志里不再出现「第 4/3 次」这种越界计数', () => {
      const counts = captured.match(/第 \d+\/\d+ 次尝试/g) || []
      assert.ok(counts.length >= 3, `应记录每次尝试，实际: ${counts.join(',')}`)
      for (const c of counts) {
        const [, now, max] = c.match(/第 (\d+)\/(\d+)/)
        assert.ok(Number(now) <= Number(max), `${c} 越界了`)
      }
      assert.ok(counts.includes('第 3/3 次尝试'), `最后一次应写成第 3/3 次，实际: ${counts.join(',')}`)
    })

    check('★ 日志里写明了接口返回的真实原因', () =>
      assert.ok(/ECONNREFUSED 192\.168\.0\.85:20000/.test(captured), `日志应带真原因`))

    check('★ draw 工具把真实原因告诉了模型（由模型转述给用户）', () => {
      const last = r.agentCalls[r.agentCalls.length - 1]
      const toolsMsgs = last.body.messages.filter(m => m.role === 'tool')
      const payload = JSON.parse(toolsMsgs[0].content)
      assert.strictEqual(payload.ok, false, '应标记失败')
      assert.ok(/ECONNREFUSED/.test(payload.error), `应带上真原因，实际: ${payload.error}`)
      assert.ok(/不要说已经画好了/.test(payload.note), '应提醒模型别谎报成功')
    })
  }

  console.log('3b) 关掉 agent（直连模式）：失败原因直接进用户看到的那句话')
  {
    const { plan: r } = await runCapturingStdout(() => run([[]], {
      drawError: httpFailure(500, 'connect ECONNREFUSED 192.168.0.85:20000'),
      retryInterval: 5,
      maxRetries: 0,
      top: { agent: { enabled: false } },
    }))

    if (process.env.DEBUG_E2E) console.log('    [debug] 发给用户的:', r.text.slice(0, 500))

    check('★ 用户看到的失败文案里带上了 ECONNREFUSED', () =>
      assert.ok(/ECONNREFUSED 192\.168\.0\.85:20000/.test(r.text), `实际: ${r.text.slice(0, 400)}`))
    check('★ 仍然沿用了原本的「图片生成失败」文案（只是补了原因）', () =>
      assert.ok(/image-prompt\.messages\.failed/.test(r.text), `实际: ${r.text.slice(0, 400)}`))
  }

  console.log('4) 后台绘图：工具结果要说「排上队了」，不能说「图已经发到群里了」')
  {
    const r = await run([[
      { toolCalls: [{ name: 'draw', args: { prompt: 'bg queued test' } }] },
      '（模型收尾）已经排上队了',
    ]], { background: true })

    const last = r.agentCalls[r.agentCalls.length - 1]
    const toolMsgs = last.body.messages.filter(m => m.role === 'tool')
    const payload = JSON.parse(toolMsgs[0].content)

    if (process.env.DEBUG_E2E) console.log('    [debug] draw 工具返回:', JSON.stringify(payload))

    check('★ ok 为 true，但标记了 queued', () => {
      assert.strictEqual(payload.ok, true)
      assert.strictEqual(payload.queued, true, '应标记还在排队')
    })
    check('★ 不再谎称「图已经发到群里了」', () =>
      assert.ok(!/图已经发到群里了/.test(payload.note || ''), `note 不该说发完了，实际: ${payload.note}`))
    check('★ 明确告诉模型「还没有画完」', () =>
      assert.ok(/还没有画完/.test(payload.note || '') && /排上队/.test(payload.note || ''), `实际: ${payload.note}`))
  }

  console.log('5) 后台绘图失败时，失败通知里也要带原因')
  {
    const r = await run([[
      { toolCalls: [{ name: 'draw', args: { prompt: 'bg fail test' } }] },
      '（模型收尾）',
    ]], { background: true, drawError: httpFailure(500, 'upstream node down'), retryInterval: 5, maxRetries: 0 })

    if (process.env.DEBUG_E2E) console.log('    [debug] 发给用户的:', r.text.slice(0, 500))

    check('★ 后台失败通知带上了原因', () =>
      assert.ok(/upstream node down/.test(r.text), `实际: ${r.text.slice(0, 400)}`))
    check('★ 全程没有冒出过「画好了」', () =>
      assert.ok(!/画好了/.test(r.text), `不该提前报成功，实际: ${r.text.slice(0, 400)}`))
  }

  console.log('6) 前台成功时，note 仍然说「图已经发到群里了」')
  {
    const r = await run([[
      { toolCalls: [{ name: 'draw', args: { prompt: 'fg ok test' } }] },
      '（模型收尾）',
    ]])

    const last = r.agentCalls[r.agentCalls.length - 1]
    const payload = JSON.parse(last.body.messages.filter(m => m.role === 'tool')[0].content)
    check('★ 同步出图确实发完了', () => {
      assert.strictEqual(payload.ok, true)
      assert.strictEqual(payload.sent, true)
      assert.ok(/图已经发到群里了/.test(payload.note), `实际: ${payload.note}`)
    })
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
  process.exit(fail ? 1 : 0)
}

main().catch((error) => {
  console.error('探针本身出错:', error)
  process.exit(1)
})
