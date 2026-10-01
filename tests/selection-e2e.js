/**
 * 选图端到端探针：用**假 http** 驱动真实的 Koishi 命令流程，
 * 验证打分制的两次请求内容 + 最终决策（有没有乱凑、有没有歪曲事实）。
 *
 * 不联网、不起服务，只把 ctx.http.post 换成脚本化的假实现：
 *   - 打到「选图接口」的请求按脚本依次返回；
 *   - 打到「绘图接口」的请求返回空 JSON（不消耗脚本），只用来数参考图张数。
 *
 * 运行: node tests/selection-e2e.js
 * 调试: DEBUG_E2E=1 node tests/selection-e2e.js
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

/** 把模型回复包成 OpenAI Chat Completions 的形状 */
const reply = (content) => ({ choices: [{ message: { role: 'assistant', content } }] })

/** 选图接口地址：打到这里的请求才算「选图」，其余算「绘图」 */
const SELECTOR_URL = 'http://mock.local/v1/chat/completions'

/** 记录型 logger：裸 Context 的 ctx.logger 未绑定 ctx，调用会抛错，这里顶掉并把日志收下来 */
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

/**
 * 跑一次命令。
 * @param {string[]} scripted 选图接口依次返回的模型回复
 * @param {{userText?: string, promptReturn?: string, selector?: object}} [options]
 *   userText     用户随指令附带的需求（默认「白发少女」）
 *   promptReturn session.prompt() 的返回值（用来模拟用户在追问后补发图片）
 *   selector     aiSelector 配置覆盖
 */
async function run(scripted, options = {}) {
  const calls = []
  const queue = scripted.slice()
  const sent = []

  const userText = options.userText === undefined ? '白发少女' : options.userText
  const fullMessage = `/画图/测试${userText ? ' ' + userText : ''}`

  const ctx = new Context()
  ctx.provide('i18n')
  // 注意 1：不要 provide('logger') —— 会把真 logger 覆盖成 undefined，
  //   插件调用 ctx.logger.warn 时就会炸在 @cordisjs/logger 里。裸 Context 自带 logger，
  //   但它在裸 Context 上没绑定 ctx，所以我们用 Proxy 顶掉（见下面 shim）。
  // 注意 2：假 http 必须用 ctx.set 而不是 ctx.provide —— provide 只登记「谁提供了服务」，
  //   并不会把属性装到 ctx 上；只有 set 才让 ctx.http 真的等于这个假实现。
  ctx.set('http', {
    post: async (url, data) => {
      calls.push({ url, body: data })
      // 绘图接口：不消耗脚本，直接回一张 Markdown 图片当出图成功
      if (url !== SELECTOR_URL) return reply('![result](https://img/result.png)')
      return reply(queue.shift() || '{}')
    },
    get: async () => ({}),
    file: async () => ({ data: Buffer.alloc(32) }),
  })

  const plugin = require('../lib/index.js')

  const config = {
    basename: '画图',
    loggerinfo: true,
    appendUserInput: true,
    promptOptimize: 'append',
    // 绘图接口：sendChatRequest 的 while (retryCount <= config.maxRetries) 里
    // maxRetries 不填会得到 undefined，循环一次都不进、请求根本不发。
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
      enabled: true,
      baseUrl: SELECTOR_URL,
      apiKey: 'test-key',
      model: 'mock-model',
      vision: false,
      maxSelect: 1,
      minScore: 60,
      selectionMode: 'score',
      askUser: false,          // 默认关掉追问，免得流程挂住；第 4 段单独打开
      notify: true,
      twoStageThreshold: 12,
      maxRetries: 0,
      ...options.selector,
    },
    resultGallery: { enabled: false },
    backgroundDrawing: { enabled: false },
    nested: {
      commands: [
        {
          name: '测试',
          prompt: 'draw the character on a desk, photorealistic',
          enabled: true,
          custom: false,
          maxImages: 1,
          waitTimeout: 1,
          referenceGroups: ['角色立绘'],
          defaultImageUrls: [],
        },
      ],
    },
  }

  const shim = new Proxy(ctx, {
    get(t, key) {
      if (key === 'scope') return { isActive: true, update() {} }
      if (key === 'baseDir') return KOISHI_ROOT
      // 裸 Context 的 ctx.logger 没绑定 ctx，一调用就炸；这里直接给个桩
      if (key === 'logger') return LOGGER_STUB
      const value = t[key]
      return typeof value === 'function' ? value.bind(t) : value
    },
  })

  plugin.apply(shim, config)
  await ctx.start()

  const cmd = ctx.$commander._commandList.find((item) => item.name === '测试')
  if (!cmd) throw new Error('没有找到命令 测试（注意：命令名是相对父指令存的，不是「画图/测试」）')

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
    bot: { sendMessage: async () => ['mid-1'], deleteMessage: async () => {} },
    prompt: async () => options.promptReturn,
  }

  const action = cmd._actions[cmd._actions.length - 1]
  let result
  try {
    result = await action.call(cmd, { session, options: {}, args: userText ? [userText] : [] }, userText)
  } catch (error) {
    result = '（action 抛错）' + error.message
    if (process.env.DEBUG_E2E) console.log('    [debug] 堆栈:\n' + String(error.stack).split('\n').slice(0, 8).join('\n'))
  }
  await ctx.stop()

  const selectorCalls = calls.filter(c => c.url === SELECTOR_URL)
  const drawCalls = calls.filter(c => c.url !== SELECTOR_URL)
  return { calls, selectorCalls, drawCalls, result, sent, userText }
}

/** 把发出去的消息 + 返回值拍平成一段文本，方便做「有没有出现 XX」的断言 */
const allTextOf = (...runs) => runs
  .map(r => JSON.stringify(r.sent) + JSON.stringify(r.result))
  .join('\n')

/** 需求分析阶段的固定回复（needTypes 直接对用户说话，符合新版提示词契约） */
const ANALYSIS = JSON.stringify({
  subject: '白发的少女',
  must: ['白发', '水手服'],
  nice: ['站立'],
  avoid: [],
  text: '',
  skipReference: false,
  needTypes: '能发一张白发水手服的立绘吗？',
})

async function main() {
  console.log('1) 打分制：有图达标')
  {
    const scores = JSON.stringify({
      scores: [
        { index: 1, score: 92, why: '命中白发+水手服' },
        { index: 2, score: 15, why: '发色性别都不符' },
        { index: 3, score: 0, why: '风景无人' },
      ],
    })
    const r = await run([ANALYSIS, scores])
    if (process.env.DEBUG_E2E) {
      console.log('    [debug] 选图请求:', r.selectorCalls.length, ' 绘图请求:', r.drawCalls.length)
      console.log('    [debug] 绘图参考图张数:', r.drawCalls.map(imageCount).join(','))
      console.log('    [debug] action 返回:', JSON.stringify(r.result))
      console.log('    [debug] 发出去的消息:', JSON.stringify(r.sent).slice(0, 400))
      console.log('    [debug] 插件日志:')
      LOGS.forEach(l => console.log('        ' + l.slice(0, 200)))
    }

    check('★ 一共只发 2 次选图请求（分析 + 打分）', () =>
      assert.strictEqual(r.selectorCalls.length, 2, `实际 ${r.selectorCalls.length} 次`))
    if (r.selectorCalls.length < 2) return

    const analyzeBody = r.selectorCalls[0].body.messages[1].content
    check('★ 第一步请求里没有任何候选图描述（模型没有「挑」的机会）', () => {
      assert.ok(!analyzeBody.includes('白发少女 双马尾'), '分析阶段不该出现候选描述')
      assert.ok(!analyzeBody.includes('红发男性'), '分析阶段不该出现候选描述')
      assert.ok(analyzeBody.includes('白发少女'), '应该带上用户需求')
    })

    const scoreBody = r.selectorCalls[1].body.messages[1].content
    check('第二步请求里带了候选列表与需求要素', () => {
      assert.ok(scoreBody.includes('白发少女 双马尾'), '打分段应带候选描述')
      assert.ok(scoreBody.includes('白发') && scoreBody.includes('水手服'), '应带硬性要素')
    })
    check('打分请求要求逐图打分（系统提示是打分助手）', () => {
      assert.ok(/打分/.test(r.selectorCalls[1].body.messages[0].content), '系统提示应说明是打分')
    })
    check('★ 达标的图被当成参考图送进绘图（且只有 1 张，不多塞）', () => {
      assert.strictEqual(r.drawCalls.length, 1, '应该发起 1 次绘图请求')
      assert.strictEqual(imageCount(r.drawCalls[0]), 1, `绘图参考图应只有 1 张`)
    })
  }

  console.log('2) 打分制：全部不达标 -> 不该硬凑')
  {
    const scores = JSON.stringify({
      scores: [
        { index: 1, score: 20, why: '不相关' },
        { index: 2, score: 10, why: '不相关' },
        { index: 3, score: 0, why: '风景' },
      ],
    })
    const r = await run([ANALYSIS, scores])
    check('仍然只发 2 次选图请求', () => assert.strictEqual(r.selectorCalls.length, 2))
    check('★ 一张都没达标 -> 完全不发起绘图（没图就不硬塞候选）', () =>
      assert.strictEqual(r.drawCalls.length, 0, `不该有绘图请求，实际 ${r.drawCalls.length} 次`))
    check('★ 没有把候选全量当参考图（不乱凑）', () => {
      const allText = allTextOf(r)
      assert.ok(!allText.includes('https://img/landscape.png'), '风景图不该被当成参考')
      assert.ok(!allText.includes('https://img/red-hair.png'), '红发图不该被当成参考')
    })
    check('★ 如实告知用户没有合适的参考图', () => {
      const allText = allTextOf(r)
      assert.ok(allText.includes('nomatch') || allText.includes('没有合适'), `应提示没有合适图，实际: ${allText.slice(0, 300)}`)
    })
    check('★ 中止时也带上原因（不是干巴巴一句「请提供至少一张图片」）', () => {
      const allText = allTextOf(r)
      assert.ok(allText.includes('needimages'), '仍是需要图片的提示')
      assert.ok(/60 ?分|最高/.test(allText), `应带上打分原因，实际: ${allText.slice(0, 300)}`)
    })
  }

  console.log('3) 用户说「随意画」-> 跳过选图，一次选图请求都不发')
  {
    const r = await run([], { userText: '随意画' })
    check('★ 跳过选图：一次选图请求都没有发（连需求分析都不发）', () =>
      assert.strictEqual(r.selectorCalls.length, 0, `实际 ${r.selectorCalls.length} 次`))
    check('也没有发起绘图（没图可参考）', () => assert.strictEqual(r.drawCalls.length, 0))
  }

  console.log('4) 图库没匹配 -> 追问用户补图，用户补的图被当成参考')
  {
    const scores = JSON.stringify({
      scores: [
        { index: 1, score: 18, why: '不相关' },
        { index: 2, score: 12, why: '不相关' },
        { index: 3, score: 0, why: '风景' },
      ],
    })
    const r = await run([ANALYSIS, scores], {
      selector: { askUser: true, askTimeout: 3 },
      promptReturn: '<img src="https://user/photo.png"/>',
    })
    if (process.env.DEBUG_E2E) {
      console.log('    [debug] 发出去的消息:', JSON.stringify(r.sent).slice(0, 500))
      console.log('    [debug] 绘图参考图张数:', r.drawCalls.map(imageCount).join(','))
    }
    check('★ 追问文案用的是需求分析给的 needTypes（而不是套话）', () => {
      const allText = allTextOf(r)
      assert.ok(allText.includes('能发一张白发水手服的立绘吗？'), `应把 needTypes 问给用户，实际: ${allText.slice(0, 400)}`)
    })
    check('★ 用户补发的图成了唯一参考图（不混进候选池里的图）', () => {
      assert.strictEqual(r.drawCalls.length, 1, '应该发起 1 次绘图请求')
      assert.strictEqual(imageCount(r.drawCalls[0]), 1, '参考图应只有用户补发的那张')
    })
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
  process.exit(fail ? 1 : 0)
}

main().catch((error) => {
  console.error('探针本身出错:', error)
  process.exit(1)
})
