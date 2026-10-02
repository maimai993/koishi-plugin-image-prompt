import { Context, Schema, h, Logger, sleep, Session } from 'koishi'
import { promises as fs } from 'node:fs'
import * as nodePath from 'node:path'

export const name = 'image-prompt'

/**
 * 依赖声明：http / logger / i18n 是必需的；
 * puppeteer 是**可选**的——只有开启「文字渲染参考图」时才需要浏览器服务，
 * 没装也能正常绘图（Koishi 会在它可用时把它注入进来，并等它就绪后再启动本插件）。
 */
export const inject = {
  required: ['http', 'logger', 'i18n'],
  optional: ['puppeteer', 'assets'],
}

export const usage = `
---

此插件直接调用 OpenAI 兼容的 Chat Completions 接口生成图片

请在插件设置中填写：

- API 服务器地址（baseUrl）
- 使用的模型（model）
- API 密钥（apiKey）

【Agent 模式（默认，推荐）】

指令一触发，插件就把「用户说了什么 + 指令提示词 + 可用的参考图」全部交给**对话模型**，
由模型自己决定下一步 —— 跟 NeoBot 一个套路：

- **gallery_search**：模型自己按关键词搜参考图库（关键词由它自己拟，不用你在配置里写规则）
- **ask_user**：问题不清楚、缺参考图、开画前要确认，模型自己开口问，并等用户回话
- **draw**：把 prompt 和它挑中的参考图编号交出去，真正开始画

也就是说：**参考图选谁、要不要追问、什么时候开画，全部是模型自己决定的**，
插件不再写死「打分 → 阈值 → 不够就问用户」这套流程。
模型想搜几次图库、想和用户来回几轮都行，直到它认为可以画了。

要求：填写的对话模型必须**支持 function calling（工具调用）**。
不支持也没关系 —— 插件内置了「只用一行 JSON 调用工具」的兜底协议，模型照样能跑流程。

相关开关：
- 「启用 Agent 模式」默认开。关掉就退化成「指令提示词 + 用户附加需求直接画」，不查图库也不追问。
- 「开画前先问一句」默认开：模型画之前会先用 ask_user 把「本次参考哪几张图 + 大致画面」告诉你，你点头它才画。
- 「最多参考图数量」「单次搜索返回条数」「询问等待时间」「最多来回轮数」都在 agent 配置里调。

【参考图片组 / 图库】

1. 在「参考图片组」里注册分组：每组填「图片链接 + 描述」。**描述要写具体**（发色发型、服装、动作、画风），
   模型就是靠这句描述搜到它的。
2. 在指令配置的「引用的参考图片组名称」里填组名（可多个）；模型只会在这个范围内搜。
   留空且开启「允许搜索全部组」时，所有组都能搜到。
3. 「生成描述」指令可以让模型看图自动写描述并写回配置（需要支持图片输入的模型）。
4. 生成结果可自动入库（默认关闭），下次能被自己搜到并复用，形成闭环。

【其它】

- 「收到提示」默认开：指令触发立刻回一条「收到，正在准备...」，不让用户以为卡住。
- 「后台绘图」开启后出图不阻塞，先回「正在画」，画好主动推送。
- 「文字渲染参考图」把画面上的文字（台词/招牌）先渲染成图片一起发给绘图模型，解决中文崩字。
- 回显提示词、结果图尺寸/走 assets 等都在「消息发送」里。

Agent 指令模板可用占位符：{command} 指令名、{prompt} 指令提示词、{userInput} 用户附加需求、{imageCount} 用户随消息发的图数量、{refCount} 可检索的参考图数量

---
此项目所需的koishi服务：必需 'http', 'logger', 'i18n'；可选 'puppeteer'（仅「文字渲染参考图」需要）

---
`;

const logger = new Logger(name)

/**
 * 计算重试等待时间（毫秒）：限流类错误优先用 Retry-After，否则指数退避
 * @param status HTTP 状态码
 * @param retryAfter 响应头 Retry-After 解析出的毫秒数
 * @param baseInterval 基础间隔（毫秒）
 * @param attempt 第几次重试（从 0 开始）
 */
export function computeRetryDelay(status: any, retryAfter: number | undefined, baseInterval: number, attempt: number): number {
  const base = baseInterval > 0 ? baseInterval : 1000
  if (status === 429 || status === 503) {
    if (retryAfter && retryAfter > 0) return retryAfter
    return Math.min(base * Math.pow(2, attempt), 30000)
  }
  return base
}

/** 从任意文本里挖出第一个 JSON 对象（容忍代码块围栏和前后废话） */
export function extractJsonObject(raw: string | null | undefined): any | null {
  if (!raw) return null
  let text = String(raw).trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1].trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const value = JSON.parse(text.slice(start, end + 1))
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

// ============================================================================
// Agent 相关纯函数（便于单独测试）
// ============================================================================

/** 归一化文本用于匹配：小写 + 去空白 */
function normText(value: string): string {
  return String(value || '').toLowerCase().replace(/\s+/g, '')
}

/** 拆 2-gram，用于中文关键词的部分命中 */
function bigrams(word: string): string[] {
  const grams: string[] = []
  for (let i = 0; i < word.length - 1; i++) grams.push(word.slice(i, i + 2))
  return grams
}

/**
 * gallery_search 工具的检索实现：关键词由**模型**自己拟，这里只做文本匹配排序。
 * 多关键词空格分隔，全部命中的排最前（参考 NeoBot 的 gallery_search）。
 */
export function searchGallery(items: CandidateImage[], keyword: string, limit: number): CandidateImage[] {
  const words = String(keyword || '')
    .split(/[\s,，、;；/|]+/)
    .map(w => normText(w))
    .filter(w => w.length > 0)

  if (!words.length) return (items || []).slice(0, limit > 0 ? limit : 12)

  const scored: { item: CandidateImage, score: number }[] = []
  for (const item of items || []) {
    const haystack = normText(`${item.group} ${item.description}`)
    let score = 0
    for (const word of words) {
      if (haystack.includes(word)) score += Math.max(2, word.length) * 2
      else if (word.length > 2) {
        for (const gram of bigrams(word)) if (haystack.includes(gram)) score += 1
      }
    }
    if (score > 0) scored.push({ item, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit > 0 ? limit : 12).map(s => s.item)
}

/**
 * 把模型给的 references 解析成登记表里的编号。
 * 兼容 `ref3` / `gallery:ref3` / 裸编号 `3` / `url:https://...` / 直接写链接。
 * 认不出来的进 unknown，让模型知道它编了个不存在的 id。
 */
export function resolveReferences(
  refs: any[],
  registry: Map<string, { url: string }>
): { ids: string[], unknown: string[] } {
  const ids: string[] = []
  const unknown: string[] = []
  for (const raw of refs || []) {
    const token = String(raw ?? '').trim()
    if (!token) continue

    let candidate = token
    const prefixed = token.match(/^(?:gallery|ref|image|img|url|file|chat)\s*[:：]\s*(.+)$/i)
    if (prefixed) candidate = prefixed[1].trim()

    if (/^https?:\/\//i.test(candidate)) {
      let hit: string | undefined
      registry.forEach((entry, id) => { if (!hit && entry.url === candidate) hit = id })
      if (hit) { if (!ids.includes(hit)) ids.push(hit) }
      else unknown.push(token)
      continue
    }
    if (registry.has(candidate)) {
      if (!ids.includes(candidate)) ids.push(candidate)
      continue
    }
    const numeric = candidate.match(/^(\d+)$/)
    if (numeric) {
      const id = `ref${numeric[1]}`
      if (registry.has(id)) {
        if (!ids.includes(id)) ids.push(id)
        continue
      }
    }
    unknown.push(token)
  }
  return { ids, unknown }
}

/** agent 可用的工具名（JSON 兜底协议只对这几个名字生效，避免把正常回复当工具调用） */
export const AGENT_TOOL_NAMES = ['gallery_search', 'ask_user', 'draw']

/** OpenAI function-calling 格式的工具定义 */
export function buildAgentTools(): any[] {
  return [
    {
      type: 'function',
      function: {
        name: 'gallery_search',
        description: '按关键词搜索参考图库。多个关键词用空格分隔（如「白发 立绘」），全部命中的排在最前；关键词留空则浏览前若干张。返回的 id 写进 draw 的 references 即可作为参考图。',
        parameters: {
          type: 'object',
          properties: {
            keyword: { type: 'string', description: '搜索关键词，写图片描述里会出现的词（角色名、发色发型、服装、画风）' },
            limit: { type: 'integer', description: '最多返回多少条，不填用默认' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'ask_user',
        description: '把一句话发给用户并等待他的下一条消息（他发的图片也会一起带回来）。信息缺失、开画前确认都用它。一次只问一个最关键的问题。',
        parameters: {
          type: 'object',
          properties: {
            question: { type: 'string', description: '要问用户的话（中文，面向用户，一句话）' },
          },
          required: ['question'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'draw',
        description: '开始绘图。把最终提示词与要参考的图片编号交进来，画好会自动发到群里。涉及角色时记得把 gallery_search 找到的 id 写进 references。',
        parameters: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: '完整的绘图提示词（英文效果更稳；画面上必须出现的文字要原样写进去）' },
            references: {
              type: 'array',
              items: { type: 'string' },
              description: '参考图编号数组，如 ["ref3","ref7"]；也可以直接写图片链接',
            },
            negative_prompt: { type: 'string', description: '可选，不希望画面出现的内容' },
          },
          required: ['prompt'],
        },
      },
    },
  ]
}

/**
 * 从模型返回里取出助手消息，以及它想调用的工具。
 * 兼容：原生 tool_calls、老式 function_call、中转站把正文塞进奇怪字段。
 */
export function pickAgentMessage(response: any): {
  message: any
  content: string
  toolCalls: { id?: string, name: string, args: any }[]
} {
  const choice = response?.choices?.[0]
  const message = choice?.message || choice?.delta || {}

  let content = typeof message.content === 'string' ? message.content : ''
  if (!content && typeof message.reasoning_content === 'string') content = message.reasoning_content
  if (!content) {
    const { text } = extractResponseText(response)
    content = text || ''
  }

  const toolCalls: { id?: string, name: string, args: any }[] = []
  const raw = Array.isArray(message.tool_calls) ? message.tool_calls : []
  for (const call of raw) {
    const name = call?.function?.name || call?.name
    if (!name) continue
    let args: any = {}
    const rawArgs = call?.function?.arguments ?? call?.arguments ?? call?.input
    if (typeof rawArgs === 'string') {
      try { args = rawArgs.trim() ? JSON.parse(rawArgs) : {} } catch { args = {} }
    } else if (rawArgs && typeof rawArgs === 'object') {
      args = rawArgs
    }
    toolCalls.push({ id: call?.id, name, args })
  }

  // 老式 function_call（部分中转站只支持这种）
  if (!toolCalls.length && message.function_call?.name) {
    let args: any = {}
    try { args = JSON.parse(message.function_call.arguments || '{}') } catch { args = {} }
    toolCalls.push({ id: undefined, name: message.function_call.name, args })
  }

  return {
    message: { role: 'assistant', content, tool_calls: raw.length ? raw : undefined },
    content,
    toolCalls,
  }
}

/**
 * 「一行 JSON」兜底协议：模型所在接口不支持 function calling 时，
 * 它只要输出 {"tool":"draw","args":{...}} 我们照样能执行。
 * 只有 tool 名字命中 AGENT_TOOL_NAMES 才当工具调用，避免把正常回复误判。
 */
export function parseJsonToolCall(content: string, names: string[] = AGENT_TOOL_NAMES): { id?: string, name: string, args: any }[] {
  const data = extractJsonObject(content)
  if (!data) return []
  const name = String(data.tool ?? data.name ?? data.function ?? '').trim()
  if (!name || !names.includes(name)) return []
  const args = data.args ?? data.arguments ?? data.parameters ?? data.input
  return [{ name, args: (args && typeof args === 'object') ? args : {} }]
}

/** 渲染 agent 指令模板：把 {xxx} 占位符换成实际值 */
export function renderAgentInstructions(template: string, vars: Record<string, string | number>): string {
  return String(template || '').replace(/\{(\w+)\}/g, (_match, key) => String(vars?.[key] ?? ''))
}

/**
 * 洗一下 ask_user 的提问文案。
 * 模型偶尔会在问句后面顺带聊别的（实测出现过「能发一张参考图吗？顺便说说 XX 可以吗？」），
 * 这里压成一行、去掉 markdown 记号和包裹引号、限长，让它永远是「对用户说的一句话」。
 */
export function cleanAskMessage(raw: any, max = 200): string {
  let text = String(raw ?? '')
    .replace(/\r/g, ' ')
    .replace(/\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  if (!text) return ''

  // 模型给的可能长这样：- **问题：**"想要什么画风？"
  // 一层层剥，直到剥不动为止（markdown 记号、引号、「问题：」标签可以任意组合）
  for (let i = 0; i < 3; i++) {
    const next = text
      .replace(/^[-*>#\s]+/, '')
      .replace(/^\*{1,3}/, '')
      .replace(/^_{1,3}/, '')
      .replace(/^["'“”「」『』]+/, '')
      .replace(/^\s*(问题|提问|question)\s*[:：]\s*/i, '')
      .trim()
    if (next === text) break
    text = next
  }
  text = text.replace(/["'“”「」『』]+$/, '').replace(/\*{1,3}$/, '').trim()

  if (text.length > max) text = text.slice(0, max) + '…'
  return text
}

/**
 * 图库容量裁剪：超出容量时淘汰最旧的（按 time 升序），只保留每个组最近 capacity 条
 */
export function trimGallery(records: GalleryRecord[], capacity: number): GalleryRecord[] {
  const limit = capacity > 0 ? capacity : 50
  const byGroup = new Map<string, GalleryRecord[]>()
  for (const record of records || []) {
    const list = byGroup.get(record.group) || []
    list.push(record)
    byGroup.set(record.group, list)
  }
  const kept: GalleryRecord[] = []
  for (const list of byGroup.values()) {
    list.sort((a, b) => (a.time || 0) - (b.time || 0))
    kept.push(...list.slice(-limit))
  }
  return kept
}

/**
 * 去掉文本开头可能残留的指令名（例如从整条消息里取文本时会带出「手办化」）
 */
export function stripCommandName(text: string, commandName: string): string {
  let value = String(text || '').trim()
  if (!value || !commandName) return value
  const name = String(commandName).trim()
  if (value.startsWith(name)) value = value.slice(name.length).trim()
  return value
}

/**
 * 把用户随指令发的附加需求并入绘图提示词。
 * 自定义指令、普通指令都适用——之前只有 custom 指令会合并，
 * 导致「手办化 xxx 在偷吃白饭被发现的表情」这种用法里，需求只被用来选图、画图时被丢掉。
 */
export function mergePrompt(basePrompt: string, userInput: string, enabled: boolean): string {
  const input = String(userInput || '').trim()
  if (!input || enabled === false) return String(basePrompt || '')
  const base = String(basePrompt || '').trim()
  return base ? `${base}\n\n${input}` : input
}

/** 把长文本截断成适合做描述的一行 */
export function truncateText(text: string, maxLength: number): string {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  const limit = maxLength > 0 ? maxLength : 120
  return value.length > limit ? value.slice(0, limit) : value
}

/** OneBot 系不支持 markdown（收到 md 只会显示成一串文字） */
const ONEBOT_LIKE = /onebot|napcat|lagrange|go-?cqhttp|chronocat|mirai/i

/**
 * 哪些平台能发 markdown 元素。
 * 只认官方 QQ（`qq` / `qq-xxx` / `qqbot`）——markdown 是官方机器人能力，
 * `qqguild`（频道）走另一套编码器，md 元素会被当纯文本原样发出去，所以排除。
 */
export function supportsMarkdown(platform: string): boolean {
  const name = String(platform || '').toLowerCase()
  if (!name) return false
  if (ONEBOT_LIKE.test(name)) return false
  if (name.startsWith('qqguild')) return false
  return name === 'qq' || name.startsWith('qq-') || name.startsWith('qqbot')
}

/**
 * 把优化后的提示词按平台格式化：
 * - 支持 markdown 的平台（官方 QQ）返回 `markdown` **元素**，由适配器走 QQ 的 markdown API，
 *   直接塞 ``` 围栏的字符串是没有用的，客户端只会当成普通文本
 * - 其它平台返回纯文本
 */
export function buildPromptEcho(promptText: string, platform: string, maxLength: number = 4000): string | any {
  let text = String(promptText || '').trim()
  if (!text) return ''

  // 保留原始换行：代码块里段落结构才有意义（不压平成一行）
  const limit = maxLength > 0 ? maxLength : 0
  if (limit && text.length > limit) {
    text = text.slice(0, limit) + '\n…（提示词过长已截断，可在「回显提示词的最大长度」里调大，设为 0 不截断）'
  }

  // 围栏必须独占一行才会被识别成代码块：适配器是把 markdown 内容直接拼在已有文本后面的，
  // 前面若没有换行，``` 就落在行中，QQ 会当成普通文本渲染（末尾那个 ``` 反而会开一个空代码块）
  if (supportsMarkdown(platform)) return h('markdown', '\n```\n' + text + '\n```')
  return text
}

/**
 * 提示词块的**纯文本**版（用于和其它提示合并进同一条 markdown 消息）。
 * 围栏必须独占一行，否则 QQ 不会把它渲染成代码块。
 */
export function buildPromptBlock(promptText: string, maxLength: number = 4000): string {
  let text = String(promptText || '').trim()
  if (!text) return ''
  const limit = maxLength > 0 ? maxLength : 0
  if (limit && text.length > limit) {
    text = text.slice(0, limit) + '\n…（提示词过长已截断，可在「回显提示词的最大长度」里调大，设为 0 不截断）'
  }
  return '\n```\n' + text + '\n```'
}

/**
 * 生成结果的 markdown 图片写法。
 * QQ 官方语法是 `![#宽px #高px](url)`——**必须带尺寸，否则手机端 QQ 不渲染**。
 */
export function buildMarkdownImage(url: string, width: number = 0, height: number = 0): string {
  const link = String(url || '').trim()
  if (!link) return ''
  const w = width > 0 ? Math.round(width) : 0
  const h = height > 0 ? Math.round(height) : (w || 0)
  const size = w > 0 ? `#${w}px #${h}px` : ''
  return `![${size}](${link})`
}

/**
 * 从图片字节里读真实宽高（只看文件头，不解码整张图）。
 * 支持 PNG / JPEG / GIF / WebP。
 */
export function readImageSize(input: any): { width: number, height: number } | null {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input || [])
  if (buf.length < 24) return null

  // PNG: 89 50 4E 47, IHDR 紧跟在 8 字节签名 + 4 字节长度 + 4 字节类型之后
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  }

  // GIF: 逻辑屏幕宽高在偏移 6，小端
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
  }

  // WebP: RIFF....WEBP，再按 VP8X / VP8 / VP8L 三种块头解析
  if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16)
    if (chunk === 'VP8X') {
      return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) }
    }
    if (chunk === 'VP8 ') {
      return { width: buf.readUInt16LE(26) & 0x3FFF, height: buf.readUInt16LE(28) & 0x3FFF }
    }
    if (chunk === 'VP8L') {
      const bits = buf.readUInt32LE(21)
      return { width: (bits & 0x3FFF) + 1, height: ((bits >> 14) & 0x3FFF) + 1 }
    }
  }

  // JPEG: 逐段扫描 SOFn（C0-CF，排除 C4/C8/CC）
  if (buf[0] === 0xFF && buf[1] === 0xD8) {
    let offset = 2
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xFF) { offset++; continue }
      const marker = buf[offset + 1]
      if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { offset += 2; continue }
      if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
        return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) }
      }
      const length = buf.readUInt16BE(offset + 2)
      if (length <= 0) break
      offset += 2 + length
    }
  }

  return null
}

/** 按真实比例算 markdown 显示尺寸（等比缩放到宽度上限） */
export function fitImageSize(
  size: { width: number, height: number } | null,
  maxWidth: number,
  fallback: { width: number, height: number }
): { width: number, height: number } {
  if (!size || !(size.width > 0) || !(size.height > 0)) return fallback
  const limit = maxWidth > 0 ? maxWidth : size.width
  if (size.width <= limit) return { width: Math.round(size.width), height: Math.round(size.height) }
  const scale = limit / size.width
  return { width: Math.round(limit), height: Math.max(1, Math.round(size.height * scale)) }
}

/**
 * 清洗模型生成的描述：去代码块围栏、去引号、压平换行、去掉「描述：」前缀、限长
 */
export function sanitizeCaption(text: string, maxLen: number = 120): string {
  let value = String(text || '').trim()
  value = value.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim()
  value = value.replace(/^[「『"'【]+/, '').replace(/[」』"'】]+$/, '').trim()
  value = value.replace(/^(描述|图片描述|图片说明|caption)[:：]\s*/i, '')
  value = value.replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim()
  if (maxLen > 0 && value.length > maxLen) value = value.slice(0, maxLen)
  return value.trim()
}

/**
 * 判断该状态码是否值得重试：429 限流 / 5xx / 网络超时重试，
 * 其它 4xx（400 参数错误、401 鉴权、404 地址错）重试无意义，直接失败
 */
export function isRetryableStatus(status: any): boolean {
  if (typeof status !== 'number') return true
  if (status === 429 || status === 503) return true
  if (status >= 500) return true
  if (status >= 400) return false
  return true
}

/**
 * 从响应体里取服务端给的具体原因（OpenAI 兼容接口一般是 {error:{message}}）
 */
export function extractServerMessage(error: any): string {
  const data = error?.response?.data ?? error?.data
  if (!data) return ''
  if (typeof data === 'string') return data.slice(0, 200)
  if (data.error?.message) return String(data.error.message).slice(0, 200)
  if (typeof data.message === 'string') return data.message.slice(0, 200)
  if (typeof data.msg === 'string') return data.msg.slice(0, 200)
  try {
    return JSON.stringify(data).slice(0, 200)
  } catch {
    return ''
  }
}

/**
 * 把请求错误整理成一句人话（带上服务端原因，方便定位模型名错/不支持识图等问题）
 */
export function describeSelectorError(status: any, serverMessage: string, rawMessage: string): string {
  const detail = serverMessage ? `：${serverMessage}` : (rawMessage ? `：${rawMessage}` : '')
  if (status === 429) return `被限流（429）${detail}`
  if (status === 401) return `鉴权失败（401），请检查 AI 选图接口密钥${detail}`
  if (status === 403) return `无权限（403），请检查密钥或模型权限${detail}`
  if (status === 404) return `接口地址不存在（404），请检查 AI 选图接口地址${detail}`
  if (status === 400) return `请求被拒绝（400）${detail}`
  if (typeof status === 'number' && status >= 500) return `服务端错误（${status}）${detail}`
  return serverMessage || rawMessage || '未知错误'
}

/**
 * 解析响应头里的 Retry-After（秒数或 HTTP 日期），返回毫秒
 */
export function parseRetryAfterHeader(headers: any): number | undefined {
  if (!headers) return undefined
  const value = typeof headers.get === 'function'
    ? headers.get('retry-after') ?? headers.get('Retry-After')
    : headers['retry-after'] ?? headers['Retry-After']
  if (!value) return undefined

  const seconds = parseFloat(String(value))
  if (!isNaN(seconds)) return Math.min(Math.max(seconds * 1000, 500), 60000)

  const date = Date.parse(String(value))
  if (!isNaN(date)) return Math.min(Math.max(date - Date.now(), 500), 60000)

  return undefined
}

/** 去掉模型输出里的思维链标签，只保留正式回答 */
export function stripThinkTags(text: string): string {
  const source = String(text || '')
  const openRe = /<\s*(think|thinking|reasoning)\s*>/i
  const closeRe = /<\s*\/\s*(think|thinking|reasoning)\s*>/i
  const open = source.search(openRe)
  if (open < 0) return source.trim()

  const rest = source.slice(open)
  const closeMatch = rest.match(closeRe)
  if (!closeMatch) {
    // 没闭合（多半是被 max_tokens 截断），正式回答还没开始
    return source.slice(0, open).trim()
  }
  const closeEnd = open + (closeMatch.index || 0) + closeMatch[0].length
  return (source.slice(0, open) + source.slice(closeEnd)).trim()
}

/** 按 'a.0.b' 这样的路径取值，取不到返回 undefined */
function getByPath(obj: any, path: string): any {
  let current = obj
  for (const key of path.split('.')) {
    if (current === null || current === undefined) return undefined
    current = current[key]
  }
  return current
}

/** 接口返回的常见正文字段（按优先级） */
const RESPONSE_TEXT_PATHS = [
  'choices.0.message.content',
  'choices.0.message.text',
  'choices.0.text',
  'choices.0.delta.content',
  'choices.0.content',
  'data.choices.0.message.content',
  'data.choices.0.text',
  'output_text',
  'output.0.content.0.text',
  'output.0.text',
  'content.0.text',
  'message.content',
  'delta.content',
  'result',
  'text',
  'response',
]

/**
 * 推理模型的思维链字段。**只能作为最后兜底**：
 * 输出被截断时 reasoning_content 里全是没想完的思考过程，拿它当答案会得出莫名其妙的结果。
 */
const REASONING_TEXT_PATHS = [
  'choices.0.message.reasoning_content',
  'choices.0.message.reasoning',
  'choices.0.message.thinking',
  'choices.0.message.thinking_content',
  'data.choices.0.message.reasoning_content',
]

/** 兜底时会尝试的字段名（只认这几个，否则会把 finish_reason 之类的值当正文） */
const TEXT_KEYS = ['content', 'text', 'output_text', 'result']

/** 兜底：在响应里找第一个非空且字段名像正文的文本 */
function deepFindText(node: any, depth: number, budget: { left: number }): string {
  if (budget.left <= 0 || depth > 5 || node === null || node === undefined) return ''
  if (typeof node !== 'object') return ''
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = deepFindText(item, depth + 1, budget)
      if (found) return found
    }
    return ''
  }
  for (const key of TEXT_KEYS) {
    const value = node[key]
    if (typeof value === 'string' && value.trim()) return value
    if (Array.isArray(value)) {
      const joined = value
        .map((part: any) => (typeof part === 'string' ? part : part?.text || ''))
        .filter(Boolean)
        .join('')
      if (joined.trim()) return joined
    }
  }
  for (const key of Object.keys(node)) {
    budget.left--
    if (budget.left <= 0) break
    const found = deepFindText(node[key], depth + 1, budget)
    if (found) return found
  }
  return ''
}

/** 把响应体裁成一小段，方便打日志定位 */
export function previewJson(value: any, maxLength: number = 400): string {
  if (value === null || value === undefined) return '（空）'
  const text = typeof value === 'string' ? value : (() => {
    try { return JSON.stringify(value) } catch { return String(value) }
  })()
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}

/**
 * 从各种「OpenAI 兼容」接口的返回里取文本。
 * 兼容：推理模型的 reasoning_content、SSE 流式响应、中转站把结构塞进 data 里、Anthropic 风格的 content 数组。
 */
export function extractResponseText(response: any): { text: string, reason: string, truncated: boolean } {
  let data = response

  // 数组：取第一个元素
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') data = data[0]

  // 字符串：可能是流式（SSE），也可能是被当成文本返回的 JSON
  if (typeof data === 'string') {
    const raw = data.trim()
    if (/^\s*data:/m.test(raw)) {
      const chunks = raw.split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim())
        .filter(line => line && line !== '[DONE]')
      const parsed: any[] = []
      for (const chunk of chunks) {
        try { parsed.push(JSON.parse(chunk)) } catch { /* 忽略坏块 */ }
      }
      if (parsed.length === 0) {
        return { text: '', reason: `接口返回的是流式（SSE）数据，但没能解析出内容：${previewJson(raw, 200)}`, truncated: false }
      }
      // 流式增量：把每一块的 delta 拼起来才是完整回答
      const delta = parsed
        .map(item => String(item?.choices?.[0]?.delta?.content ?? item?.delta?.content ?? ''))
        .join('')
      if (delta.trim()) return { text: delta, reason: '', truncated: false }
      data = parsed[parsed.length - 1]
    } else if (raw.startsWith('{') || raw.startsWith('[')) {
      try { data = JSON.parse(raw) } catch { /* 当纯文本用 */ }
    } else if (raw) {
      return { text: raw, reason: '', truncated: false }
    } else {
      return { text: '', reason: '接口返回的是空字符串', truncated: false }
    }
  }

  if (data === null || data === undefined) return { text: '', reason: '接口没有返回任何数据', truncated: false }
  if (typeof data !== 'object') {
    const text = String(data).trim()
    return text ? { text, reason: '', truncated: false } : { text: '', reason: '接口返回为空', truncated: false }
  }

  for (const path of RESPONSE_TEXT_PATHS) {
    const value = getByPath(data as any, path)
    let text = ''
    if (typeof value === 'string') text = value
    else if (Array.isArray(value)) {
      text = value
        .map((part: any) => (typeof part === 'string' ? part : part?.text || ''))
        .filter(Boolean)
        .join('')
    }
    if (text && text.trim()) {
      const stripped = stripThinkTags(text)
      return { text: (stripped || text.trim()), reason: '', truncated: false }
    }
  }

  const found = deepFindText(data, 0, { left: 300 })
  if (found) {
    const stripped = stripThinkTags(found)
    return { text: (stripped || found.trim()), reason: '', truncated: false }
  }

  const choice = (data as any).choices?.[0] ?? (data as any).data?.choices?.[0]
  const finish = choice?.finish_reason ?? choice?.finishReason

  // 截断：绝不能退而取 reasoning_content（那里是没想完的思考过程）
  if (finish === 'length') return { text: '', reason: '输出被 max_tokens 截断（finish_reason=length）：模型把额度全用在思考上，正文一个字都没生成', truncated: true }
  if (finish === 'content_filter') return { text: '', reason: '内容被安全策略拦截（finish_reason=content_filter）', truncated: false }
  if (finish === 'tool_calls') return { text: '', reason: '模型调用了工具而不是输出文本（finish_reason=tool_calls）', truncated: false }
  if (Array.isArray((data as any).choices) && (data as any).choices.length === 0) {
    return { text: '', reason: `choices 是空数组：${previewJson(data, 300)}`, truncated: false }
  }
  // 正文确实没有：有些中转/模型会把答案只放在思维链字段里，作为最后兜底
  for (const path of REASONING_TEXT_PATHS) {
    const value = getByPath(data as any, path)
    if (typeof value === 'string' && value.trim()) {
      const stripped = stripThinkTags(value)
      return { text: (stripped || value.trim()), reason: '', truncated: false }
    }
  }

  if (choice && choice.message) return { text: '', reason: `message.content 为空：${previewJson(choice, 300)}`, truncated: false }
  return { text: '', reason: `响应里没有可识别的文本字段：${previewJson(data, 300)}`, truncated: false }
}

/**
 * 判断是不是 QQ 官方机器人的「被动回复超时/超次」错误（错误码 40034128）。
 * 引用用户消息属于被动回复：有 5 分钟时效 + 次数上限，超了就必须降级为普通主动消息。
 */
export function isPassiveReplyError(error: any): boolean {
  if (!error) return false
  const code = error?.code ?? error?.response?.data?.code ?? error?.data?.code
  if (code === 40034128 || String(code) === '40034128') return true
  const text = String(error?.message || error?.response?.data?.message || error || '')
  return text.includes('40034128') || text.includes('被动回复')
}

/**
 * 决定用哪个参数名限制输出长度。
 * o1/o3/gpt-5/reasoner 这类模型只认 max_completion_tokens，传 max_tokens 会返回空内容。
 */
export function resolveTokenParam(model: string, mode?: string): string {
  if (mode === 'max_tokens' || mode === 'max_completion_tokens') return mode
  const name = String(model || '').toLowerCase()
  if (/(^|[^a-z])o[134](-|$|[^a-z])|gpt-5|reasoner|reasoning|think/.test(name)) return 'max_completion_tokens'
  return 'max_tokens'
}

/** 用指定参数名重建请求体（避免同时存在两个长度参数被接口拒绝） */
export function withTokenParam(body: any, param: string): any {
  const { max_tokens, max_completion_tokens, ...rest } = body || {}
  const value = max_tokens ?? max_completion_tokens
  const next: any = { ...rest }
  if (value !== undefined) next[param] = value
  return next
}


/** HTML 转义，避免渲染时把文字当标签吃掉 */
export function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 把要渲染的文字拼成一份 HTML（供无头浏览器截图） */
export function buildTextHtml(lines: string[], cfg: Partial<TextRenderConfig> = {}): string {
  const width = cfg.width || 1024
  const fontSize = cfg.fontSize || 96
  const lineHeight = cfg.lineHeight || 1.4
  const padding = cfg.padding || 48
  const background = cfg.background || '#ffffff'
  const color = cfg.color || '#111111'
  const fontFamily = cfg.fontFamily || 'Microsoft YaHei, PingFang SC, Noto Sans CJK SC, sans-serif'
  const align = cfg.align === 'left' ? 'left' : 'center'
  const weight = cfg.bold ? '700' : '400'
  const strokeWidth = cfg.strokeWidth || 0
  const strokeColor = cfg.strokeColor || '#ffffff'
  const stroke = strokeWidth > 0
    ? `-webkit-text-stroke: ${strokeWidth}px ${strokeColor}; paint-order: stroke fill;`
    : ''

  const body = lines.map(line => `<div class="line">${escapeHtml(line)}</div>`).join('')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { background: ${background}; }
#stage { display: inline-block; min-width: ${width}px; padding: ${padding}px; }
.line { font-family: ${fontFamily}; font-size: ${fontSize}px; line-height: ${lineHeight};
  color: ${color}; font-weight: ${weight}; text-align: ${align};
  white-space: pre-wrap; word-break: break-word; ${stroke} }
</style></head><body><div id="stage">${body}</div></body></html>`
}

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\uf900-\ufaff]/

/**
 * 从提示词/用户输入里提取「需要在画面上真实出现的文字」
 * 只提取含中日韩文字的片段——纯英文/数字一般不会因为渲染而崩字
 */
export function extractTextToRender(text: string, options: { loose?: boolean, maxChars?: number } = {}): string[] {
  const source = String(text || '')
  if (!source.trim()) return []

  const maxChars = options.maxChars && options.maxChars > 0 ? options.maxChars : 200
  const results: string[] = []
  const push = (raw: string) => {
    // 去掉两端残留的引号/括号（「台词：」这类规则会把括号一起捕获进来）
    const value = String(raw || '').trim()
      .replace(/^[\s"'`「『“《【（(\[]+/, '')
      .replace(/[\s"'`」』”》】）)\]]+$/, '')
      .replace(/\s+/g, ' ')
    if (!value) return
    if (value.length > maxChars) return
    if (!CJK_RE.test(value)) return
    if (results.includes(value)) return
    results.push(value)
  }

  const patterns: RegExp[] = [
    /「([^」\n]{1,200})」/g,
    /『([^』\n]{1,200})』/g,
    /“([^”\n]{1,200})”/g,
    /《([^》\n]{1,200})》/g,
    /【([^】\n]{1,200})】/g,
    /"([^"\n]{1,200})"/g,
    /'([^'\n]{1,200})'/g,
    /(?:台词|字幕|标语|招牌|标题|写着|写着的是|对话)\s*[:：]?\s*([^\n。；;！!？?]{1,200})/g,
  ]
  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(source))) push(match[1])
  }

  // 宽松模式：引号都没用上时，直接抓连续的中文片段（至少 4 个字，成句才像是台词）
  if (results.length === 0 && options.loose) {
    const chunks = source.match(/[\u3400-\u4dbf\u4e00-\u9fff][\u3400-\u4dbf\u4e00-\u9fff\u3001\u3002\uff0c\uff01\uff1f\uff1a\u201c\u201d\s]{3,}/g)
    for (const chunk of chunks || []) push(chunk)
  }

  return results
}

interface CommandConfig {
  basename: string
  nested: {
    commands: {
      name: string
      prompt: string
      enabled: boolean
      custom: boolean
      maxImages: number
      waitTimeout: number
      defaultImageUrls: string[]
      referenceGroups?: string[]
      /** 该指令是否走 agent（默认跟随全局 agent.enabled） */
      agent?: 'follow' | 'on' | 'off' | boolean
    }[]
  }
  defaultWaitTimeout: number
  baseUrl: string
  model: string
  maxRetries: number
  retryInterval: number
  apiKey?: string
  loggerinfo: boolean
  referenceGroups?: ReferenceGroup[]
  aiSelector?: AISelectorConfig
  agent?: AgentConfig
  showPrompt?: boolean
  promptMaxLength?: number
  appendUserInput?: boolean
  promptOptimize?: 'off' | 'merge' | 'rewrite'
  optimizePrompt?: string
  resultGallery?: ResultGalleryConfig
  backgroundDrawing?: BackgroundDrawingConfig
  textRender?: TextRenderConfig
  /** 指令一触发就立刻回一条「收到」，避免用户以为卡住 */
  ackOnStart?: boolean
  /** 结果图用 markdown 的 ![](url) 单独发一条（支持的平台） */
  markdownImage?: boolean
  /** 结果图先经 assets 服务上传再发（外链在手机端 QQ 可能拉不到） */
  imageViaAssets?: boolean
  /** 自动按图片真实比例生成 markdown 尺寸（关掉则用下面固定的宽高） */
  autoImageSize?: boolean
  /** 自动尺寸时的显示宽度上限 */
  imageMaxWidth?: number
  /** 固定宽/高（QQ 要求带尺寸，否则手机端不渲染） */
  imageWidth?: number
  imageHeight?: number
}

/** 文字渲染参考图配置（把要在画面上出现的文字先渲染成图片，避免中文崩字） */
interface TextRenderConfig {
  enabled: boolean
  /** 自动从提示词里识别需要出现在画面上的文字并渲染 */
  autoDetect: boolean
  /** 引号内没有其它线索时，也允许直接提取中文片段 */
  loose: boolean
  /** 手动渲染指令名 */
  commandName: string
  /** 手动渲染后，多少秒内的绘图指令自动带上它 */
  pendingTTL: number
  /** 渲染后先把参考图发出来给用户看 */
  sendPreview: boolean
  /** 渲染结果并入绘图参考图 */
  attachToDraw: boolean
  width: number
  fontSize: number
  lineHeight: number
  padding: number
  background: string
  color: string
  fontFamily: string
  align: 'center' | 'left'
  bold: boolean
  strokeWidth: number
  strokeColor: string
  maxChars: number
  scale: number
}

/** 生成结果入库（图库）配置 */
interface ResultGalleryConfig {
  enabled: boolean
  groupName: string
  descriptionSource: 'prompt' | 'userInput' | 'both'
  maxLength: number
  capacity: number
  commandName: string
}

/** 后台绘图配置 */
interface BackgroundDrawingConfig {
  enabled: boolean
  maxConcurrent: number
  queueNotify: boolean
}

/** 图库里的一条记录 */
interface GalleryRecord {
  group: string
  url: string
  description: string
  command: string
  time: number
}

/** 参考图片组中的一张图片（链接 + 描述） */
interface ReferenceImageItem {
  url: string
  description: string
}

/** 参考图片组 */
interface ReferenceGroup {
  name: string
  enabled: boolean
  items: ReferenceImageItem[]
}

/** AI 对话模型接口配置（agent 循环、提示词优化、生成描述都用它） */
interface AISelectorConfig {
  baseUrl: string
  apiKey?: string
  model: string
  temperature: number
  timeout: number
  maxRetries: number
  retryInterval: number
  retryMaxWait: number
  includeAllGroups: boolean
  includeCommandDefaults: boolean
  captionModel: string
  captionPrompt: string
  captionBatch: number
  captionCommand: string
  /** 提示词优化（融合/扩写）用的采样温度，默认 0.7，比选图更有创造性 */
  optimizeTemperature?: number
  /** 输出长度参数名：auto / max_tokens / max_completion_tokens */
  maxTokensParam?: 'auto' | 'max_tokens' | 'max_completion_tokens'
  /** 提示词优化（融合/扩写）的输出长度上限 */
  optimizeMaxTokens?: number
  /** 输出被截断时自动加大，最多加到这个值 */
  maxTokensCeiling?: number
  /** 诊断指令名：发一次模型请求并回显原始返回 */
  debugCommand?: string
}

/** Agent 配置：把「要不要查图库 / 要不要追问 / 什么时候开画」全部交给模型自己决定 */
interface AgentConfig {
  /** 是否启用 agent 模式；关掉就退化成「指令提示词 + 用户附加需求直接画」 */
  enabled: boolean
  /** agent 用的模型，留空则用 aiSelector.model */
  model: string
  baseUrl?: string
  apiKey?: string
  /** 驱动 agent 行为的系统提示词（可参考 NeoBot 的 skill instructions 写法） */
  instructions?: string
  /** 最多来回几轮（每轮 = 一次模型请求 + 它要调的工具） */
  maxIterations: number
  /** 一次绘图最多用几张参考图 */
  maxSelect: number
  /** gallery_search 单次最多返回多少条 */
  searchLimit: number
  /** ask_user 等待用户回复的秒数 */
  askTimeout: number
  /** 开画前是否要求模型先问一句（写进提示词，由模型执行） */
  confirmBeforeDraw: boolean
  /** 单次模型请求的超时（秒） */
  timeout: number
  temperature: number
  /** 单次回复的输出长度上限。推理模型会把额度耗在思考上，太小会一个字都生成不出来 */
  maxTokens: number
  /** 记住当前频道最近几轮对话（0 = 不记忆） */
  historyTurns: number
  /** 把每一轮的工具调用打到日志里，方便排查 */
  debugLog: boolean
}

/** agent 参考图登记表里的一条 */
export interface RefEntry {
  id: string
  url: string
  description: string
  group: string
  source: 'gallery' | 'user' | 'cmd'
}

/** 交给 AI 挑选的候选图片 */
interface CandidateImage {
  group: string
  url: string
  description: string
}

/** 把用户附加需求融合进原始提示词（而不是贴在最末尾） */
const DEFAULT_OPTIMIZE_PROMPT = `你是绘图提示词优化助手。下面是「绘图指令的原始提示词」和「用户本次的需求」。

请输出一份完整、可直接用于绘图模型的提示词。规则：

1. 原始提示词不为空时：把用户需求自然地融合进原始提示词，并**保留原始提示词中的全部场景、构图、风格、材质、光线等细节**，不得删减或简化。
2. 原始提示词为空时（例如自定义指令）：根据用户需求**扩写**成完整的绘图提示词，补足画风、构图、镜头、光线、氛围、配色与细节，但不要改变用户的原意。
3. 把用户需求写到它该去的位置（表情/动作/神态/服装/场景/互动等），不要原样贴在末尾。
4. 语言：原始提示词是英文就输出英文；原始提示词为空时也用英文（英文提示词出图效果通常更稳）。
5. 只输出优化后的提示词正文，不要解释、不要标题、不要 Markdown 代码块、不要引号。

原始提示词：
{prompt}

用户本次的需求：
{userInput}`

/** 让模型看图自动生成「便于检索」的描述 */
const DEFAULT_CAPTION_PROMPT = `请用一句中文描述这张图片的关键视觉特征，这句话将用于以后按关键词检索这张参考图。

必须尽量包含：主体（人物/物件）、发型发色、服装、姿态或动作、画风或场景。
用词要具体，例如写「红发双马尾」「白色水手服」「站立」「日系厚涂」，而不是「一个女孩」。

只输出这一句描述，不要解释、不要换行、不要 Markdown、不要加引号。`

/**
 * 驱动 agent 行为的系统提示词（参考 NeoBot 的 skill.instructions 写法）。
 *
 * 关键区别：**这里不写「怎么选图」的规则链，只写「有哪些工具 + 什么时候该用」**。
 * 选谁、问不问、什么时候开画，全交给模型自己判断。
 */
const DEFAULT_AGENT_INSTRUCTIONS = `你是 QQ 群里的绘图助手。用户发一条绘图指令，你要在**尽量少的来回**里把图交出去。

可用工具：
- gallery_search：按关键词搜索参考图库。**涉及具体角色/立绘时必须先搜一次**。
  多个关键词用空格分隔（如「白发 立绘」），全部命中的排在最前；搜不到就换个词再搜。
- ask_user：把问题发给用户**并等他回复**（他发的图也会一起带回来）。
- draw：真正开始画。把 prompt 和挑中的参考图编号交进去，画好会自动发到群里。

工作规则：
1. 【角色立绘参考规则（强制）】涉及任何角色（群友 OC、动画角色、甚至你自己）的绘图请求：
   - 先用 gallery_search 搜该角色名/特征，看图库里有没有立绘；
   - 有合适的 → 把它的 id 写进 draw 的 references；
   - 没有 → 如实告诉用户「图库里没有这个角色的立绘，将按描述创作」，然后正常画；
   - 用户明确表示「不用参考 / 随意画 / 自由发挥」时，跳过搜索，一次都别搜。
2. 信息不够才开口问，而且**一次只问一个最关键的问题**（缺谁？缺什么场景？缺什么画风？）。
   不要把几个不相关的问题塞进一句话，不要顺带聊别的，不要复述用户已经说过的话。
3. 开画确认：{confirmRule}
4. 画面上要出现文字（台词、标题、招牌、字幕）时，把文字原样写进 prompt，并说明「这些字必须原样出现，不能变形或自创字形」。
5. draw 返回 ok=false 时，看 error 决定：能改的（提示词问题）就换个写法重试，改不了的（限流/配额）就如实告诉用户。
6. 流程结束后用中文回一句简短的结果说明（不要复述 prompt，不要写小作文，不要再问「还要我做什么」）。
7. 图片编号：gallery_search 结果里的 id、用户发的图（user1、user2…）、指令默认图（cmd1…）都可以直接写进 draw 的 references。
   只填你确认存在的编号，**绝对不要编造 id**。

如果你所在的接口不支持函数调用，就**只输出一行 JSON** 来调用工具，例如：
{"tool":"gallery_search","args":{"keyword":"白发 立绘"}}
{"tool":"ask_user","args":{"question":"想要什么画风？"}}
{"tool":"draw","args":{"prompt":"...","references":["ref1","user1"]}}
不想调用工具时，正常输出给用户看的中文即可。`

/** 「开画前先问一句」的两种提示词分支 */
const AGENT_CONFIRM_RULE_ON = `**必须先 ask_user**：用一句话告诉用户「这次会参考哪几张图 + 大致画成什么样」，用户点头后才能调用 draw。
用户回复了否定或提出修改意见，就按他说的改，再确认一次或直接画（他说「直接画」就不用再问）。`
const AGENT_CONFIRM_RULE_OFF = `用户需求已经明确的，直接调用 draw，不用多问一句。只有真的缺关键信息才 ask_user。`

/** 模型所在接口不支持 function calling 时，追加这条规则，改用「一行 JSON」调工具 */
const AGENT_JSON_FALLBACK_RULE = `（注意：当前接口不支持函数调用）请你**只用一行 JSON** 来调用工具，不要输出别的内容：
{"tool":"gallery_search","args":{"keyword":"白发 立绘"}}
{"tool":"ask_user","args":{"question":"想要什么画风？"}}
{"tool":"draw","args":{"prompt":"...","references":["ref1","ref2"]}}
不需要调用工具时，正常输出给用户看的中文即可。`

const defaultCommands: any[] = [
  {
    name: '手办化',
    prompt: 'Your task is to create a photorealistic, masterpiece-quality image of a 1/7 scale commercialized figurine based on the user\'s character. The final image must be in a realistic style and environment.\n\n**Crucial Instruction on Face & Likeness:** The figurine\'s face is the most critical element. It must be a perfect, high-fidelity 3D translation of the character from the source image. The sculpt must be sharp, clean, and intricately detailed, accurately capturing the original artwork\'s facial structure, eye style, expression, and hair. The final result must be immediately recognizable as the same character, elevated to a premium physical product standard. Do NOT generate a generic or abstract face.\n\n**Scene Composition (Strictly follow these details):**\n1. **Figurine & Base:** Place the figure on a computer desk. It must stand on a simple, circular, transparent acrylic base WITHOUT any text or markings.\n2. **Computer Monitor:** In the background, a computer monitor must display 3D modeling software (like ZBrush or Blender) with the digital sculpt of the very same figurine visible on the screen.\n3. **Artwork Display:** Next to the computer screen, include a transparent acrylic board with a wooden base. This board holds a print of the original 2D artwork that the figurine is based on.\n4. **Environment:** The overall setting is a desk, with elements like a keyboard to enhance realism. The lighting should be natural and well-lit, as if in a room.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '手办化2',
    prompt: 'Use the nano-banana model to create a 1/7 scale commercialized figure of thecharacter in the illustration, in a realistic styie and environment.Place the figure on a computer desk, using a circular transparent acrylic basewithout any text.On the computer screen, display the ZBrush modeling process of the figure.Next to the computer screen, place a BANDAl-style toy packaging box printedwith the original artwork.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '手办化3',
    prompt: 'Your primary mission is to accurately convert the subject from the user\'s photo into a photorealistic, masterpiece quality, 1/7 scale PVC figurine, presented in its commercial packaging.\n\n**Crucial First Step: Analyze the image to identify the subject\'s key attributes (e.g., human male, human female, animal, specific creature) and defining features (hair style, clothing, expression). The generated figurine must strictly adhere to these identified attributes.** This is a mandatory instruction to avoid generating a generic female figure.\n\n**Top Priority - Character Likeness:** The figurine\'s face MUST maintain a strong likeness to the original character. Your task is to translate the 2D facial features into a 3D sculpt, preserving the identity, expression, and core characteristics. If the source is blurry, interpret the features to create a sharp, well-defined version that is clearly recognizable as the same character.\n\n**Scene Details:**\n1. **Figurine:** The figure version of the photo I gave you, with a clear representation of PVC material, placed on a round plastic base.\n2. **Packaging:** Behind the figure, there should be a partially transparent plastic and paper box, with the character from the photo printed on it.\n3. **Environment:** The entire scene should be in an indoor setting with good lighting.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: 'coser化',
    prompt: 'Create a realistic cosplay photograph of the character in the image. The cosplayer should be wearing a high-quality costume that accurately replicates the character\'s outfit. Include appropriate props and background setting that matches the character\'s universe. Focus on accurate representation of costume details and realistic materials. Draw the picture for me with the background of a comic convention. East-asian face.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: 'mc化',
    prompt: 'Transform the image into a Minecraft-style character. Create a blocky, pixelated version of the character using Minecraft\'s visual style. Include appropriate Minecraft environment and elements in the background. The generated entities must be Minecraft-style entities or blocks/structures.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '线稿化',
    prompt: '手绘线稿，精细的铅笔素描风格，纸上绘画效果，清晰的线条勾勒，适度的细节刻画。画面中包含绘画工具（如铅笔、橡皮、卷笔刀、素描本）自然散落在旁，呈现创作中的氛围。线条黑白灰调性，无色彩，突出纸张纹理和手绘质感，专注于形体结构和轮廓表现',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '爱上我了',
    prompt: '生成一张三格漫画，画面上方三分之一处的左半部分是第一格，右半部分是第二格，画面下方占总画面三分之二的位置是第三格。要求人物长相服装与参考图完全一致。第一格为人物的面部特写，眼睛睁大，眼神中带着一丝惊讶，嘴巴被一只手轻轻捂住，旁边配有一个 “！” 的符号，整体神态呈现出意外、略带羞怯的感觉，动作上是单手掩口，姿态显得较为娇俏。第二格也是人物的面部特写，眼睛眯起，呈现出笑意，嘴巴微张，那只捂住嘴的手还保持着动作，同时有 “噗～” 的拟声词，神态是开心、俏皮的，仿佛是忍不住要笑出声，动作上延续了掩口的姿态，却多了几分活泼的情绪。第三格背景是有云朵的天空，画面只出现了人物的上半身，人物画风与参考图完全一致。人物的发丝被风吹起，眼睛弯弯，面带柔和的笑容，脸颊还有淡淡的红晕。她姿态放松，身体略向前倾，双手背在身后，整体神态是自信且温柔，呈现出一种大方又迷人的状态。第三格左边有圆形对话框，写着“你觉得我漂亮”。右侧下方有圆形对话框，写着 那是因为你已经爱上我了，笨蛋',
    enabled: true,
    custom: true,
    maxImages: 1,
    waitTimeout: 60,
    defaultImageUrls: []
  },
  {
    name: '合并图片',
    prompt: '将两张图片合并为一张',
    enabled: true,
    custom: true,
    maxImages: 2,
    waitTimeout: 60,
    defaultImageUrls: []
  },
  {
    name: '修图',
    prompt: '修复图片中的缺陷',
    enabled: true,
    custom: true,
    maxImages: 1,
    waitTimeout: 60,
    defaultImageUrls: []
  },
  {
    name: '手办化4',
    prompt: 'Please accurately transform the subject in this photo into a realistic, masterpiece-worthy 1/7 scale PVC figurine. This figurine must possess 3D dimensionality, and the PVC texture must be clearly represented. The figurine is placed in a figurine display cabinet made of multi-layered glass; appropriate space should be left between the top of the figurine and the upper shelf, and the figurine must be paired with a transparent base. The indoor scene must be visible through the glass. Different figurines can be placed on other shelves, but they should exhibit a natural depth of field and blurred effect to further enhance the sense of spatial depth and highlight the main figurine. The scene requires a bright main light source, and the display cabinet should be embedded with dim LED strip lights; the overall light and reflections must blend naturally with the scene. The frame angle does not need to be fixed in a specific orientation.\nDetail Specifications: Every part of the figurine must be 3D dimensional, and flat or two-dimensional effects are prohibited; under no circumstances shall contour lines or outlines appear; when repairing missing parts of the figurine, no low-quality content shall appear; if repairing a human figure, it is necessary to ensure normal limb shape, coordinated movements, and reasonable proportions of all parts; if the original photo is not a full-body shot, try to supplement the figurine into a full-body form as much as possible; the expression, movements, and angle of the human figurine must be completely consistent with the original photo, but it must be 3D dimensional; the head of the human figurine must not be too large, the legs must not be too short, and the overall figure must not look short; for chibi cartoon subjects, their original proportions shall be retained, but they must be 3D dimensional; if the subject is an animal, its fur should be simplified to make it more like a figurine product; attention must be paid to following the perspective principle of objects appearing larger when closer and smaller when farther away.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '手办化5',
    prompt: 'Realistic PVC figure based on the game screenshot character, exact pose replication highly detailed textures PVC material with subtle sheen and smooth paint finish, placed on an indoor wooden computer desk (with subtle desk items like a figure box/mouse), illuminated by soft indoor light (mix of desk lamp and natural window light) for realistic shadows and highlights, macro photography style,high resolution,sharp focus on the figure,shallow depth of field (desk background slightly blurred but visible), no stylization,true-to-reference color and design, 1:1scale.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '手办化6',
    prompt: 'Create a premium, collectible 1/7 scale standalone figurine based on the image, meticulously replicating the character, made from smooth PVC and ABS plastic with a professional matte finish. It stands on a minimalist transparent acrylic base. Next to it is its retail packaging box displaying the price and brand information, with the figure wrapped in plastic inside the slightly larger box. They are naturally arranged on a clean wooden table surrounded by reference books, with a bookshelf in the background and soft afternoon sunlight streaming through the window. Photo-realistic, DSLR effect, depth of field, bokeh background.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: 'Q版化',
    prompt: '((chibi style)), ((super-deformed)), ((head-to-body ratio 1:2)), ((huge head, tiny body)), ((smooth rounded limbs)), ((soft balloon-like hands and feet)), ((plump cheeks)), ((childlike big eyes)), ((simplified facial features)), ((smooth matte skin, no pores)), ((soft pastel color palette)), ((gentle ambient lighting, natural shadows)), ((same facial expression, same pose, same background scene)), ((seamless integration with original environment, correct perspective and scale)), ((no outline or thin soft outline)), ((high resolution, sharp focus, 8k, ultra-detailed)), avoid: realistic proportions, long limbs, sharp edges, harsh lighting, wrinkles, blemishes, thick black outlines, low resolution, blurry, extra limbs, distorted face',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: 'cos化',
    prompt: 'Generate a highly detailed photo of a real-life girl cosplaying this illustration, at Comiket. Exactly replicate the same pose, body posture, hand gestures, facial expression, and camera framing as in the original illustration. Keep the same angle, perspective, and composition, without any deviation.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: 'cos自拍',
    prompt: 'Generate a first-person perspective (POV) snapshot of a cosplayer in a cluttered bedroom. The cosplayer\'s hairstyle and anime costume must exactly match the subject in the reference image. She holds a phone in front of her face with both hands, completely covering her face. The phone screen is the focal point of the image, displaying the uploaded picture. The background is a room filled with posters on the walls and a slightly messy bed. The image should have a casual, informal snapshot quality with a slightly low-resolution and grainy texture, lit by natural indoor lighting.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '痛屋化',
    prompt: '[ABSOLUTE PRIORITY AND NON-NEGOTIABLE DIRECTIVE] Based on the provided reference image, generate a hyper-detailed photograph of a maximalist otaku shrine with a strict, uncompromising requirement: all character-related elements—including figures, posters, bedding patterns, and the PC wallpaper—must be a 90%+ faithful, pixel-perfect replication of the character in the reference image. Strictly maintain the precise facial features, hairstyle, outfit, and expression with zero artistic reinterpretation or stylistic variation. With this core rule, create the scene at a 16:9 aspect ratio. The room is densely packed from floor to ceiling with merchandise that is an exact reproduction of this source character. The entire space is bathed in a moody, immersive ambient glow dominated by the reference character\'s primary color scheme (e.g., deep purple), which is sharply contrasted by a focused, brighter white light from a monitor screen bar lamp, creating dramatic visual layers. The walls are a collage made of posters and prints that are direct, unaltered copies of the reference image itself; the glass cabinets are cluttered with high-poly figures that are perfect 1:1 replicas of the reference character model; and the ultrawide monitor clearly displays the original reference image as its wallpaper. The final image must be a photorealistic, lived-in sanctuary, defined by its obsessive and flawless fidelity to the source character.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '痛屋化2',
    prompt: 'Transform the uploaded indoor photo into a Japanese-style ita-room with the following specific requirements: Walls: Generate multi-size posters/scrolls (A2/A3/banner mixed arrangement) in an orderly matrix; no watermarks or garbled text. Curtains and bedding: Fully replace with themed patterns while retaining fabric folds and textures; pillowcases and life-sized cushions use the same character design. Display: Add glass display cabinets and open shelves, densely displaying themed figurines, acrylic stands, badge boards, and boxed peripherals of the same theme; arrange them in groups by height and color system. Desk: Keep the original equipment and light and shadow, only replace the screensaver/wallpaper with themed images; organize the wires neatly. Lighting: Add soft RGB light strips (along the ceiling and desk edges), coordinated with the main color, avoiding overexposure and color overflow. Texture: Realistic materials for PVC figurines, spray-painted paper, acrylic, and cotton fabrics; natural glass reflections without ghosting. Consistency: The face, hair color, and clothing details of the character on all carriers (posters/cushions/stands/box art) must maintain the same character and art style. Constraints (negative): No brand logos, watermarks, typos, distorted faces, perspective errors, repeated textures, over-sharpening, or noise.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '痛车化',
    prompt: 'A Xiaomi SU7 electric sedan with a professional \'itasha\' wrap, parked on a rain-slicked, neon-lit city street at dusk. Accurately depict the Xiaomi SU7 body shape, grille-less front fascia, slim headlights, taillights, wheel design, and logo placements. The entire car is covered in a vibrant, high-resolution decal featuring multiple dynamic poses and expressions of ONLY the provided anime character. The glossy finish reflects colorful city lights, making the character artwork pop.Seamless full-body wrap integrating hood, doors, and rear quarter panels. Dynamic three-quarter front view showcasing the hood and side artwork.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '孤独的我',
    prompt: 'Generate a hyper-realistic photograph with RAW photo quality, captured by a top-tier camera. The image must exhibit realistic skin textures, rich lighting layers, and a natural depth of field. Absolutely no anime, cartoon, CG, or painted elements are allowed—the result must be a 100% authentic photographic representation. The scene is set in a restaurant, captured from a first-person perspective. I am sitting alone, holding chopsticks in one hand and a phone in the other, displaying a photo of a beautiful cosplayer. In the background, the same cosplayer (dressed as the anime character) is dining with her boyfriend, feeding him a bite of food. The composition should evoke a sense of loneliness and contrast between the observer and the observed.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '第一视角',
    prompt: 'At the venue of Japan\'s Comic Market Doujinshi Sales Event commonly known as Comiket a real Chinese boy or girl of the same gender as the character in the original image is sitting directly opposite you wearing a costume consistent with the one in the original image. A double meal set including hamburgers and French fries is placed on your table with crumpled tissues and some food scraps scattered beside it creating a strong sense of realism. Your Android phone is casually laid on the table and its screen displays an unedited original image of the character. The person is engaging in intimate interaction with you gazing gently into your eyes leaning slightly towards you and placing one hand softly on your arm.You are holding a hamburger or a few French fries.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '第三视角',
    prompt: 'A scene in a bright, modern McDonald’s or KFC restaurant at night, consistent with the visual style of the provided original image (no AI-generated imagery). In front of you (the viewer), there are foods like a hamburger and a small serving of French fries (with a visibly small portion) on the table, along with a crumpled used tissue, a few food crumbs (adding a sense of realism), and an Android phone (with a character displayed on the screen)—you are holding a hamburger or a French fry in your hand. At a very nearby separate table (not a shared table)—so close that it’s within easy sight—two Chinese people are sitting and engaging in intimate interactions (e.g., gentle eye contact, leaning slightly towards each other, or one resting a hand lightly on the other’s arm). One of them is a coser dressed exactly as the character on your Android phone, with the coser’s gender strictly corresponding to the character’s gender (male coser remains male, female coser remains female, no gender reversal) and matching that of the character in the provided original image; the other is a man. On their table, there is a two-person set meal, and both figures are slightly blurred (not overly so). The overall atmosphere blends a relaxed dining vibe with character-related elements, featuring natural lighting, and adheres to the visual style of the original image.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '鬼图',
    prompt: 'Convert the Input Image into a Convincing, Found-Footage Style Cryptid Sighting Photograph 1. The image should depict a [insert creature name or description - e.g., slender, pale humanoid; multi-limbed, insect-like entity; shadowy, canine-like beast], and the creature’s appearance must be highly similar to that in the original image. The creature should be spotted in a hyperrealistic and eerily desolate location, such as [e.g., an abandoned industrial complex at night, a remote, snow-covered mountain pass, the murky depths of a forgotten urban canal, a desolate rural road in the dead of winter]. 2. The shot must appear accidental, amateurish, and raw, as if captured spontaneously by a low-fidelity device like a [e.g., degraded VHS camcorder, grainy security camera, old disposable camera with flash, an infrared trail cam that\'s seen better days]. 3. To maximize the unsettling authenticity, the image quality should be significantly imperfect: featuring extreme [e.g., heavy digital noise, pronounced film grain, severe motion blur making details indistinct, a strong, disorienting lens flare, being significantly out of focus, or displaying visible static and tracking lines]. The creature should be partially obscured and difficult to clearly discern, perhaps hidden by [e.g., dense, skeletal tree branches; thick, unnatural fog; distorted reflections on murky water; the jagged silhouette of derelict machinery; or existing within deep, oppressive shadows]. 4. The lighting is critically dim and unsettling, possibly at [e.g., the darkest hour before dawn, a moonless midnight, or starkly illuminated by a harsh, direct, and slightly malfunctioning camera flash that overexposes parts of the scene].5. The overall feeling should evoke profound unease, dread, and a sense of witnessing something truly inexplicable and horrifying. Emphasize an atmosphere of isolation, decay, and the uncanny. 6. Keywords: cryptozoology, urban legend, paranormal, faked sighting, unsettling, horror, cryptid, grotesque, eerie, found footage, degraded quality, creature feature.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '贴纸化',
    prompt: 'Generate A creative collage artwork based on the provided input image. The artwork should be created using a variety of materials such as paper, fabric, and found objects to achieve a textured, layered look. The composition should capture the essence of the original subject while incorporating collage techniques such as cutting, layering, and mixed media. The final piece should have a dynamic',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '玉足',
    prompt: 'Use the attached image as the exact protagonist (identity lock), maintaining exact facial features, hairstyle, and distinctive characteristics from the reference image. 1/7 scale commercial figurine, nano-banana model, hyper-detailed PVC figure. A character sitting on the ground with body positioned on the left side of the frame. From the character\'s perspective: RIGHT LEG fully extended straight forward, while LEFT LEG bent at the knee with foot flat on the ground. From viewer\'s perspective: The extended RIGHT LEG of the character appears on the LEFT SIDE of the frame, creating strong forced perspective with LOW ANGLE SHOT (foot size 2x larger than head). The character\'s extended right foot (viewer\'s left side) must be in sharp focus with soft milky-white skin tone, subtle pink undertones, and sole facing viewer at 45°, showing exactly 5 distinct toes with natural nail beds and delicate skin texture. Smooth, soft skin with a healthy, supple appearance. Arms crossed on chest, realistic hand-painted details, translucent PVC material effect. No background elements - focus entirely on the figurine\'s pose and foot details.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '玩偶化',
    prompt: 'Reshape the character in the picture into a top-tier collectible *fumo*, with a fully soft and dynamic pose, and place it on the character theme fur pad. High-precision material, hand-stitched, the texture of the plush fabric and the clothing is truly distinct.\nIts eyes are the signature large embroidered semi-oval ones, without pupils, presenting a flat, sleepy or listless expression.\nThe main light source is soft diffused light, highlighting the fluffy feeling and soft texture, without overexposure. Powerful fill light eliminates dead black, and details are fully visible. The background is a blurred depth of field by the window, and the product packaging box is faintly visible on the side and rear. The sticker on the packaging box should be the original uploaded image.\nMuseum-level photography quality, every detail of the body is intact, and the embroidered facial features are exquisite and accurate.\nProhibited: Any 2D elements or direct copying of the original image, plastic feel, hard texture, blurred face, misaligned facial features, and loss of details.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: 'cos相遇',
    prompt: 'A lively comic convention scene with a bustling real-world environment, featuring the original manga-style character from the input image, retaining her exact colorful design, unique art style, and distinct features (including her specific hair color, outfit, and expression). The character remains a vibrant, non-realistic manga-style figure, not a 2D flat plane but preserving her original artistic depth and color palette. She stands in a crowded convention hall with colorful cosplay booths and attendees. Facing her is a cosplayer dressed in an identical outfit, mimicking her pose, both positioned at a 45-degree angle toward the viewer. The background is a detailed, realistic comic convention with vivid colors, dynamic crowd, and cosplay elements, creating a surreal blend of the manga character’s vibrant, non-realistic style with a real-world setting. Emphasize the magical encounter between the manga character and her cosplayer counterpart.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '三视图',
    prompt: 'a 3-view orthographic drawing of a young woman from a photo, showing front, right side, and back views. Realistic rendering, professional character sheet style, on a white background',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '穿搭拆解',
    prompt: 'A professional e-commerce fashion showcase featuring the clothing worn by the character from the input image, presented in a clean, studio-style setting. The outfit is decomposed into individual pieces (e.g., top, bottom, jacket, shoes, accessories), each clearly displayed and arranged in an organized, visually appealing layout. Each clothing item retains the exact design, color, texture, and details from the original image, showcased with crisp lighting and high-definition clarity. The background is minimalistic, white or neutral, to emphasize the clothing details, suitable for an online retail platform. The presentation includes subtle annotations or labels for each item, ensuring a polished, catalog-style look for wear and styling inspiration.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '拆解图',
    prompt: 'Convert the people in the photos to the style of a model kit box, rendered in isometric perspective. Label the box with the title“Zhogue”. Inside the box, a gouda-styled robotic version of the person in the photo is displayed, along with its essentials (such as cosmetics, bags, or other items) redesigned as a futuristic mechanical accessory. The box should resemble a real Gunpla box, with technical illustrations, manual-style details, and sci-fi fonts. Next to the box, the actual gouda-style robot itself is also displayed, rendered in a realistic and lifelike style on the outside of the packaging, similar to the official Bandai propaganda renderings.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '角色界面',
    prompt: 'Transform the input person image into a game character selection interface. Display the character on the right side as a full-body portrait, standing upright at a 45-degree angle facing both the screen and the left-side selection module, mimicking a selected state in a video game. Retain the person image\'s facial features, expression, and hairstyle, but adapt the clothing to a game-inspired style (e.g., fantasy armor, sci-fi suit, or RPG adventurer outfit) with intricate details, vibrant textures, and thematic accessories, while preserving the original clothing\'s color scheme and general aesthetic. If the input is a half-body image, seamlessly complete the lower body, matching the game-style clothing and proportions. On the left side, present a sleek interface with selectable options including game-style clothing variations (e.g., different armor sets, robes, tactical gear), martial stats (e.g., strength, agility), equipment (e.g., swords, gadgets, shields), and health points, styled as interactive game UI elements with clear labels and modern design. Arrange the layout to mimic a video game character selection screen, with a smooth, unified background gradient (e.g., dark blue to soft gray) for a cohesive, natural transition across the image. Use consistent, cinematic lighting and subtle glow effects to enhance the game-like atmosphere while maintaining the character\'s real-world facial essence.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '角色设定',
    prompt: '为我生成人物的角色设定（Character Design）,比例设定（不同身高对比、头身比等）,三视图（正面、侧面、背面）,表情设定（Expression Sheet） → 就是你发的那种图,动作设定（Pose Sheet） → 各种常见姿势,服装设定（Costume Design）',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '3D打印',
    prompt: 'Please transform the object in the uploaded image into a collectible figurine.Behind it, place a figurine box printed with the object\'s image and its name. Next to it, add a high-end 3D printer that is currently printing the figurine. In front of the figurine box, add a round plastic base for the figurine to stand on.The PVC material of the base should have a crystal-clear, translucent texture, and set the entire scene indoors.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '微型化',
    prompt: 'A high-resolution advertising photograph of a realistic, miniature [PRODUCT] held delicately between a person\'s thumb and index finger. clean and white background, studio lighting, soft shadows. The hand is well-groomed, natural skin tone, and positioned to highlight the product\'s shape and details. The product appears extremely small but hyper-detailed and brand-accurate, centered in the frame with a shallow depth of field. Emulates luxury product photography and minimalist commercial style.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '挂件化',
    prompt: 'Turn this photo into a cute charm / a flat acrylic keychain / a flat rubber keychain to hang on an LV bag / the bag in photo 2.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '姿势表',
    prompt: '请为这幅插图创建一个姿势表，摆出各种姿势',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '高清修复',
    prompt: 'Enhance this image to high resolution',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '人物转身',
    prompt: 'show me this scene from behind the subjects. keep the details and the lighting identical',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '绘画四宫格',
    prompt: 'Step 1: line drawing. Step 2: tile colors. Step 3: Add Shadows. Step 4: Refine and shape. No words',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '发型九宫格',
    prompt: 'A professional hairstyle showcase based on the input image of a person\'s upper body and face, displaying the character with nine distinct hairstyles arranged in a clean, grid-like layout (3x3 grid) on a single image. Each hairstyle replaces the original hair while preserving the person\'s facial features, skin tone, and clothing details from the input image. The hairstyles include a variety of styles: short pixie cut, long wavy hair, sleek bob, voluminous curls, high ponytail, messy bun, side-swept bangs, braided updo, and straight layered cut, each rendered with realistic textures and natural lighting. The background is a consistent, neutral color (pure white or light gray) to emphasize the hairstyles and maintain a polished, professional look suitable for hairstyle selection. Subtle labels beneath each hairstyle indicate the style name for clarity.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '头像九宫格',
    prompt: 'Id photos of the person in the picture with 9 different hairstyles, showing close-ups of the person with each hairstyle (Japanese, Korean, n) , keeping the features and clothes, and integration of the output for a nine grid picture',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '表情九宫格',
    prompt: 'Transform the input person image (half-body portrait) into a 3x3 grid of nine distinct images, each showcasing a different facial expression with the corresponding text label below the face, while retaining the original character\'s facial features, hairstyle, and clothing details. Arrange the expressions as follows: top row (happy with raised corners and squinted eyes labeled \'Happy\', sad with downturned mouth and raised inner brows labeled \'Sad\', angry with furrowed brows and narrowed eyes labeled \'Angry\'); middle row (surprised with wide eyes and open mouth labeled \'Surprised\', fearful with wide eyes and tense brows labeled \'Fearful\', disgusted with wrinkled nose and pursed lips labeled \'Disgusted\'); bottom row (confused with uneven brows and asymmetrical mouth labeled \'Confused\', proud with lifted chin and firm gaze labeled \'Proud\', embarrassed with tense smile and downward gaze labeled \'Embarrassed\'). Ensure each cell reflects the described expression naturally, with seamless completion of the lower body to match the original clothing style. Use a soft, unified background (e.g., light gray) and consistent lighting across all grids to maintain coherence and focus on the expressions.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '多机位',
    prompt: '生成这张图片的正脸特写、侧身照、远景、背影的四种多机位镜头，然后整合输出到一张照片里，保持人物高度的一致性，适合生成连续剧情感镜头',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '电影分镜',
    prompt: '用这图里的角色创作一个令人上瘾的12部分故事，包含12张图像，讲述经典的黑色电影侦探故事。故事关于他们寻找线索并最终发现的失落的宝藏。整个故事充满刺激，有情感的高潮和低谷，以精彩的转折和高潮结尾。不要在图像中包含任何文字或文本，纯粹通过图像本身讲述故事',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '动漫分镜',
    prompt: 'According to the content of the picture to generate nine frames of comics, with pictures and lenses to tell a story.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '真人化',
    prompt: 'in Studio, pure white background, a cosplayer dressed in an identical outfit, as the girl in the reference image, mimicking her pose and outfit. enhanced with film grain for a gritty, authentic particle effect reminiscent of 35mm film stock; 8K ultra-HD, sharp and believable, no abstraction.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '真人化2',
    prompt: 'Generate a highly detailed photo of a girl cosplaying this illustration, at Comiket. Exactly replicate the same pose, body posture, hand gestures, facial expression, and camera framing as in the original illustration. Keep the same angle, perspective, and composition, without any deviation',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '半真人',
    prompt: 'Take the image of the woman in [Input Photo]. Apply a creative split-style effect. Keep the lower half of her body (legs and boots) as the original photograph. Transform the upper half of her body (torso, arms, head) into a vibrant, 2D anime style with bold outlines and flat colors, similar to the anime \'Cyberpunk: Edgerunners\'. The transition between the two styles should be a clean, slightly curved line.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: '半融合',
    prompt: 'A striking, high-definition frontal portrait of the character from the input photo, with the face perfectly centered. The image blends two styles seamlessly: the left half retains the character\'s original realistic appearance, including detailed skin textures, natural lighting, and exact facial features from the input image, while the right half transitions into a vibrant manga-style version, featuring bold outlines, expressive eyes, and stylized features typical of high-quality anime art, while preserving recognizable traits (e.g., hair shape, facial structure). The transition between the realistic and manga halves is smooth and gradual, with no visible dividing line, ensuring a natural, cohesive fusion at the center of the face. The blending emphasizes the contrast between realistic and manga aesthetics while maintaining a unified appearance. The background is a neutral, solid color (e.g., soft gray or white) to highlight the fusion effect, with consistent lighting to enhance the artistic impact and no harsh separation.',
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  }
]

export const Config: Schema = Schema.intersect([
  Schema.object({
    basename: Schema.string().default(name).description('父级指令名称'),
    nested: Schema.object({
      commands: Schema.array(
        Schema.object({
          name: Schema.string().required().description('指令名称'),
          prompt: Schema.string().role('textarea', { rows: [6, 4] }).description('该指令对应的提示词（自定义指令可留空）'),
          enabled: Schema.boolean().default(true).description('是否启用该指令'),
          custom: Schema.boolean().default(false).description('是否为自定义指令（允许用户输入提示词）'),
          maxImages: Schema.number().default(1).min(0).max(5).description('需要用户提供的最大图片数量（不包括默认图片）'),
          waitTimeout: Schema.number().default(30).max(120).min(10).step(1).description("等待输入图片的最大时间（秒）"),
          defaultImageUrls: Schema.array(Schema.string().role('link')).description('默认图片URL列表（不计入用户图片数量）').default([]),
          referenceGroups: Schema.array(Schema.string()).description('引用的参考图片组名称（agent 只能在这些组里搜图，留空则由「AI 模型接口」的「允许搜索全部组」决定）').default([]),
          agent: Schema.union([
            Schema.const('follow').description('跟随全局设置'),
            Schema.const('on').description('走 agent 模式（交给 AI 自己查图/追问/开画）'),
            Schema.const('off').description('不走 agent（指令提示词 + 用户附加需求直接画）'),
          ]).default('follow').description('该指令是否走 agent 模式'),
        })).description('指令配置').default(defaultCommands),
    }).collapse().description('指令配置项太长啦，这样折叠起来更方便哦~'),


    defaultWaitTimeout: Schema.number().default(50).max(120).min(10).step(1).description("默认等待输入图片的最大时间（秒）"),
  }).description('基础配置'),

  Schema.object({
    referenceGroups: Schema.array(
      Schema.object({
        name: Schema.string().required().description('组名称（在指令配置中通过此名称引用）'),
        enabled: Schema.boolean().default(true).description('是否启用该组'),
        items: Schema.array(
          Schema.object({
            url: Schema.string().role('link').required().description('图片链接'),
            description: Schema.string().role('textarea', { rows: [2, 2] }).description('图片描述（AI 依据该描述判断是否需要选用此图）')
          })
        ).description('组内参考图片').default([])
      })
    ).description('参考图片组（填写链接 + 描述，注册为一组）').default([]),
  }).description('参考图片组'),

  Schema.object({
    baseUrl: Schema.string().default('https://api.gptgod.online/v1/chat/completions').role('link').description('API 服务器地址（OpenAI 兼容 Chat Completions 接口）'),
    model: Schema.string().default('gpt-image-2.5').description('使用的模型名称'),
    apiKey: Schema.string().role('secret').description('API 密钥'),
    maxRetries: Schema.number().default(3).description('最大重试次数'),
    retryInterval: Schema.number().default(1000).description('重试间隔(毫秒)'),
  }).description('API 设置'),

  Schema.object({
    resultGallery: Schema.object({
      enabled: Schema.boolean().default(false).description('把生成结果自动存入图库，下次能被检索到（形成闭环）'),
      groupName: Schema.string().default('生成结果').description('存入哪个参考图片组（不存在会自动创建；指令需引用该组或开启「使用全部组」才能被检索到）'),
      descriptionSource: Schema.union([
        Schema.const('prompt').description('用完整提示词'),
        Schema.const('userInput').description('用用户附加需求'),
        Schema.const('both').description('两者拼接')
      ]).default('prompt').description('用什么当入库图片的描述'),
      maxLength: Schema.number().default(120).min(20).max(2000).step(10).description('描述截断长度（提示词通常很长）'),
      capacity: Schema.number().default(50).min(1).max(500).step(1).description('图库容量上限，超出后淘汰最旧的'),
      commandName: Schema.string().default('图库').description('查看/清空图库的指令名'),
    }).description('生成结果入库配置（图库）'),
  }).description('生成结果入库'),

  Schema.object({
    backgroundDrawing: Schema.object({
      enabled: Schema.boolean().default(false).description('后台绘图：先回「正在画」，完成后主动推送结果，不再让消息阻塞等待'),
      maxConcurrent: Schema.number().default(3).min(1).max(10).step(1).description('同时进行的后台绘图任务上限，超出的排队'),
      queueNotify: Schema.boolean().default(true).description('任务进入排队时提示前面还有几个'),
    }).description('后台绘图配置'),
  }).description('后台绘图'),

  Schema.object({
    aiSelector: Schema.object({
      baseUrl: Schema.string().role('link').description('AI 对话接口地址（OpenAI 兼容 Chat Completions，留空则复用绘图接口地址）'),
      apiKey: Schema.string().role('secret').description('AI 对话接口密钥（留空则复用绘图 API 密钥）'),
      model: Schema.string().default('Qwen/Qwen2.5-7B-Instruct').description('对话模型（agent 循环、提示词优化、生成描述都用它）'),
      temperature: Schema.number().default(0.3).min(0).max(2).step(0.1).description('采样温度（越低越稳定）'),
      timeout: Schema.number().default(60).min(10).max(300).step(5).description('请求超时时间（秒）'),
      maxRetries: Schema.number().default(2).min(0).max(5).step(1).description('请求失败重试次数（0 表示不重试）'),
      retryInterval: Schema.number().default(3000).min(500).max(30000).step(500).description('重试基础间隔（毫秒）；遇到 429/限流会在此基础上指数退避，并优先遵循响应头的 Retry-After'),
      retryMaxWait: Schema.number().default(20).min(0).max(120).step(5).description('单次重试最长等待时间（秒），超过则不再重试（0 表示不限）'),
      includeAllGroups: Schema.boolean().default(true).description('指令未指定组时，允许 agent 搜索全部参考图片组'),
      includeCommandDefaults: Schema.boolean().default(false).description('把指令的「默认图片URL列表」也纳入可搜索的参考图'),
      captionCommand: Schema.string().default('生成描述').description('自动生成描述的指令名（挂在指令根下；直接发图则只识别并返回描述）'),
      captionModel: Schema.string().description('生成描述用的模型（留空则用上面的对话模型；必须是支持图片输入的模型）'),
      captionPrompt: Schema.string().role('textarea', { rows: [8, 4] }).default(DEFAULT_CAPTION_PROMPT).description('生成描述的提示词（要求模型写出便于检索的关键词）'),
      captionBatch: Schema.number().default(8).min(1).max(50).step(1).description('一次指令最多为多少张参考图生成描述（避免请求过多被限流）'),
      optimizeTemperature: Schema.number().default(0.7).min(0).max(2).step(0.1).description('提示词优化（融合/扩写）用的采样温度，比选图高一些更有创造性'),
      maxTokensParam: Schema.union([
        Schema.const('auto').description('自动（o1/o3/gpt-5/reasoner 等推理模型用 max_completion_tokens）'),
        Schema.const('max_tokens').description('始终用 max_tokens'),
        Schema.const('max_completion_tokens').description('始终用 max_completion_tokens（新模型不支持 max_tokens 时会返回空内容）'),
      ]).default('auto').description('输出长度参数名。模型不支持 max_tokens 时会返回空内容，导致「响应中没有文本内容」'),
      debugCommand: Schema.string().default('测试选图').description('诊断指令名（挂在指令根下）：发一次模型请求并回显原始返回，用于排查「没有文本内容」'),
      optimizeMaxTokens: Schema.number().default(8000).min(0).max(64000).step(500).description('提示词优化（融合/扩写）的输出长度上限（0 = 不限制）'),
      maxTokensCeiling: Schema.number().default(32000).min(1000).max(128000).step(1000).description('输出被截断时自动加大上限，最多加到这个值'),
    }).collapse().description('AI 对话模型接口（提示词较长，已折叠）'),
  }).description('AI 模型接口'),

  Schema.object({
    agent: Schema.object({
      enabled: Schema.boolean().default(true).description('启用 Agent 模式：把「查不查图库 / 要不要追问 / 什么时候开画」全部交给对话模型自己决定（关掉就退化成「指令提示词 + 用户附加需求直接画」）'),
      confirmBeforeDraw: Schema.boolean().default(true).description('开画前先让 AI 问一句：把「这次参考哪几张图 + 大致画成什么样」发给用户，用户点头才画（这条是写进提示词的，由模型执行）'),
      maxIterations: Schema.number().default(8).min(1).max(30).step(1).description('最多来回几轮（每轮 = 一次模型请求 + 它要调的工具）。防死循环的天花板'),
      maxSelect: Schema.number().default(3).min(1).max(10).step(1).description('一次绘图最多使用几张参考图（模型给多了会被截断到这个数）'),
      searchLimit: Schema.number().default(12).min(1).max(50).step(1).description('gallery_search 单次最多返回多少条结果'),
      askTimeout: Schema.number().default(120).min(10).max(600).step(10).description('ask_user 等待用户回复的时间（秒），超时会告诉模型「用户没回」'),
      timeout: Schema.number().default(120).min(10).max(600).step(10).description('单次模型请求超时（秒）'),
      temperature: Schema.number().default(0.3).min(0).max(2).step(0.1).description('agent 循环用的采样温度'),
      maxTokens: Schema.number().default(8000).min(0).max(64000).step(500).description('agent 单次回复的输出长度上限。**推理模型会把额度耗在思考上**，太小会一个字都生成不出来。0 = 不限制'),
      historyTurns: Schema.number().default(6).min(0).max(30).step(1).description('记住当前频道最近几轮对话（让「再画一张」「换个风格」能接上），0 = 不记忆'),
      debugLog: Schema.boolean().default(false).description('把 agent 每一轮的模型输出与工具调用写进日志，排查用'),
      model: Schema.string().description('agent 专用的模型（留空则用「AI 模型接口」里的模型）。**需要支持 function calling**；不支持时插件会自动改用「一行 JSON」协议'),
      baseUrl: Schema.string().role('link').description('agent 专用接口地址（留空则复用「AI 模型接口」的地址）'),
      apiKey: Schema.string().role('secret').description('agent 专用密钥（留空则复用「AI 模型接口」的密钥）'),
      instructions: Schema.string().role('textarea', { rows: [16, 8] }).default(DEFAULT_AGENT_INSTRUCTIONS).description('驱动 agent 行为的系统提示词（只写「有哪些工具 + 什么时候用」，别写死流程）。可用占位符：{confirmRule} 开画确认规则、{command} 指令名、{prompt} 指令提示词、{userInput} 用户附加需求、{imageCount} 用户随消息发的图数量、{refCount} 可检索的参考图数量。指令名/提示词等上下文会自动附在提示词末尾，不用自己引用'),
    }).collapse().description('Agent 配置（指令较长，已折叠）'),
  }).description('Agent 模式'),

  Schema.object({
    appendUserInput: Schema.boolean().default(true).description('把用户随指令发的附加需求并入绘图提示词（例如「手办化 xxx 在偷吃白饭被发现的表情」）'),
    promptOptimize: Schema.union([
      Schema.const('rewrite').description('融合重写（推荐）：让模型把需求写进提示词对应位置'),
      Schema.const('merge').description('直接追加：把需求贴在原始提示词末尾'),
      Schema.const('off').description('不处理：只用指令自身的提示词')
    ]).default('rewrite').description('用户附加需求如何并入提示词'),
    optimizePrompt: Schema.string().role('textarea', { rows: [10, 6] }).default(DEFAULT_OPTIMIZE_PROMPT).description('融合重写用的提示词模板，占位符：{prompt} 原始提示词、{userInput} 用户附加需求'),
    showPrompt: Schema.boolean().default(true).description('发送优化后的提示词（QQ / QQ 频道用代码块包裹，其它平台发纯文本）'),
    promptMaxLength: Schema.number().default(4000).min(0).max(20000).step(100).description('回显提示词的最大字符数，超出部分截断并标注；设为 0 表示不截断（QQ markdown 有长度上限，太长可能被拒收）'),
  }).description('提示词设置'),

  Schema.object({
    textRender: Schema.object({
      enabled: Schema.boolean().default(false).description('开启「文字渲染参考图」：把要在画面上出现的文字（台词/标题/标语）先用浏览器渲染成图片，一起发给绘图模型，解决中文崩字问题（需要安装并启用 koishi-plugin-puppeteer）'),
      autoDetect: Schema.boolean().default(true).description('自动识别提示词里需要出现在画面上的中文文字并渲染（识别「」“”《》【】以及「台词：」等）'),
      loose: Schema.boolean().default(false).description('宽松模式：引号都没用上时，也直接提取连续的中文片段（可能误判）'),
      commandName: Schema.string().default('渲染文字').description('手动渲染指令名（挂在主指令根下），用法：渲染文字 要画的文字'),
      pendingTTL: Schema.number().default(600).min(0).max(86400).step(30).description('手动渲染后，多少秒内的绘图指令自动带上这张参考图（0 表示只在下一次生效前一直有效）'),
      sendPreview: Schema.boolean().default(true).description('渲染后先把参考图发出来给你看'),
      attachToDraw: Schema.boolean().default(true).description('把渲染结果并入绘图参考图一起发给绘图模型'),
      width: Schema.number().default(1024).min(256).max(4096).step(64).description('画布最小宽度（像素）'),
      fontSize: Schema.number().default(96).min(12).max(400).step(4).description('字号'),
      lineHeight: Schema.number().default(1.4).min(1).max(3).step(0.1).description('行高'),
      padding: Schema.number().default(48).min(0).max(400).step(4).description('内边距'),
      background: Schema.string().default('#ffffff').description('背景色（填 transparent 可输出透明底，适合贴在画面上的字幕）'),
      color: Schema.string().default('#111111').description('文字颜色'),
      fontFamily: Schema.string().default('Microsoft YaHei, PingFang SC, Noto Sans CJK SC, sans-serif').description('字体（按先后顺序回退）'),
      align: Schema.union([
        Schema.const('center').description('居中'),
        Schema.const('left').description('左对齐'),
      ]).default('center').description('对齐方式'),
      bold: Schema.boolean().default(false).description('加粗'),
      strokeWidth: Schema.number().default(0).min(0).max(40).step(1).description('描边宽度（0 不描边；字幕建议 6-10）'),
      strokeColor: Schema.string().default('#ffffff').description('描边颜色'),
      maxChars: Schema.number().default(200).min(10).max(2000).step(10).description('单条文字最大字符数，超过则不渲染'),
      scale: Schema.number().default(2).min(1).max(4).step(1).description('截图缩放倍数（越大越清晰，文件也越大）'),
    }).collapse().description('文字渲染配置项'),
  }).description('文字渲染参考图（防崩字）'),

  Schema.object({
    ackOnStart: Schema.boolean().default(true).description('指令一触发就立刻回一条「收到，正在准备...」。后面的「优化提示词 + agent 思考」是两轮模型请求、可能要几十秒，不发这条用户会以为机器人卡住了'),
    markdownImage: Schema.boolean().default(true).description('生成结果用 markdown 的 ![](图片链接) 单独发一条；不支持 markdown 的平台自动退回普通图片消息'),
    imageViaAssets: Schema.boolean().default(true).description('结果图先经 assets 服务上传再发。外链在手机端 QQ 常常拉不到，装上 koishi-plugin-assets-qqbot-part-file 之类的 assets 插件后由它转成平台可访问的地址；上传失败会自动用原链接'),
    autoImageSize: Schema.boolean().default(true).description('自动按**图片真实比例**生成 markdown 尺寸（填死宽高会把非方形图拉伸变形）'),
    imageMaxWidth: Schema.number().default(400).min(64).max(2000).step(16).description('自动尺寸时的显示宽度上限，高度按真实比例算'),
    imageWidth: Schema.number().default(0).min(0).max(4096).step(32).description('固定宽度（仅在关闭自动尺寸时生效；0 表示不带尺寸）'),
    imageHeight: Schema.number().default(0).min(0).max(4096).step(32).description('固定高度（仅在关闭自动尺寸时生效）'),
  }).description('消息发送'),

  Schema.object({
    loggerinfo: Schema.boolean().default(false).description("日志调试模式"),
  }).description('调试设置'),
])


export function apply(ctx: Context, config: CommandConfig) {
  let isActive = true

  ctx.on('dispose', () => {
    isActive = false
  })

  /** 调试日志（ready 回调里还有一个同款的，这里给外层的工具函数用） */
  function logInfo(...args: any[]) {
    if (config.loggerinfo) {
      (ctx.logger.info as (...args: any[]) => void)(...args)
    }
  }

  // ============ 安全回复（绕开 QQ 被动回复限制） ============
  // QQ 官方机器人：引用一条用户消息属于「被动回复」，有 5 分钟时效 + 次数上限，
  // 超了就报 40034128。一条绘图流程要发好几条消息，必须控制引用次数并能在被拒时降级。
  const quotedKeys = new Set<string>()

  /** 剥掉内容里的引用元素 */
  function stripQuotes(parts: any[]): any[] {
    return parts.filter(Boolean).filter(part => {
      if (part && typeof part === 'object' && part.type === 'quote') return false
      return true
    })
  }

  // 每个 messageId 已经用掉几次「被动回复」。QQ 对同一个 msg_id 有次数上限（约 5 次），
  // 留点余量，超出就走主动消息。
  const passiveUsed = new Map<string, number>()
  const MAX_PASSIVE_REPLY = 3

  /**
   * 主动消息：**不能走 session.send**。
   * adapter 内部是 `msg_id = session.messageId`——只要经过 session，就算不带引用元素，
   * 也会被当成被动回复并递增 msg_seq，照样受时效/次数限制。
   * 只有 `bot.sendMessage` 这种不带 session 的发法才是真正的主动消息。
   */
  async function sendActive(session: Session, body: any[]): Promise<string[]> {
    const result = await session.bot.sendMessage(session.channelId, body, session.guildId)
    return Array.isArray(result) ? result : (result ? [String(result)] : [])
  }

  /**
   * 发送一条消息：
   * 1. 同一条用户消息**只引用一次**（第一条带引用，之后不带）
   * 2. 被动回复用满 MAX_PASSIVE_REPLY 次后自动改走主动消息
   * 3. 被动回复被拒（超时/超次）时立刻降级为主动消息
   */
  async function reply(session: Session, parts: any[], options: { quote?: boolean } = {}): Promise<string[]> {
    const body = parts.filter(Boolean)
    const key = `${session.platform}:${session.channelId || ''}:${session.messageId || ''}`
    const used = passiveUsed.get(key) || 0

    if (session.messageId && used < MAX_PASSIVE_REPLY) {
      if (passiveUsed.size > 1000) passiveUsed.clear() // 防止无限增长
      passiveUsed.set(key, used + 1)

      const wantsQuote = options.quote !== false && !quotedKeys.has(key)
      if (wantsQuote) quotedKeys.add(key)
      try {
        return await session.send(wantsQuote ? [h.quote(session.messageId), ...body] : body)
      } catch (error) {
        if (!isPassiveReplyError(error)) throw error
        ctx.logger.warn(`第 ${used + 1} 次被动回复被拒（超时或超次），改用主动消息发送`)
      }
    }

    return sendActive(session, body)
  }

  /**
   * 结果图经 assets 服务上传一次。
   * 绘图接口给的虽然是公网链接，但手机端 QQ 经常拉不到（防盗链/域名限制），
   * 交给 assets 转成平台可访问的地址更稳；失败就用原链接，不会比现在更差。
   */
  async function resolveImageUrl(url: string, commandName: string): Promise<string> {
    if (config.imageViaAssets === false) return url
    const assets: any = (ctx as any).assets
    if (!assets || typeof assets.upload !== 'function') {
      logInfo('未检测到 assets 服务，直接用绘图接口返回的链接')
      return url
    }
    try {
      const uploaded = await assets.upload(url, `image-prompt-${commandName}-${Date.now()}.png`)
      const value = typeof uploaded === 'string' ? uploaded : String(uploaded?.url || '')
      if (/^https?:\/\//i.test(value)) {
        logInfo(`结果图已上传 assets: ${value.slice(0, 80)}`)
        return value
      }
      ctx.logger.warn(`assets 返回的地址不是公网链接，仍用原链接: ${value.slice(0, 80)}`)
    } catch (error) {
      ctx.logger.warn(`结果图上传 assets 失败，仍用原链接: ${error}`)
    }
    return url
  }

  /** 下载结果图读真实宽高（只看文件头，不解码整张图） */
  async function probeImageSize(url: string): Promise<{ width: number, height: number } | null> {
    try {
      const file = await ctx.http.file(url)
      const size = readImageSize(file?.data)
      if (size) logInfo(`结果图真实尺寸: ${size.width}x${size.height}`)
      else ctx.logger.warn('读不出结果图尺寸，将按默认比例显示')
      return size
    } catch (error) {
      ctx.logger.warn(`下载结果图取尺寸失败: ${error}`)
      return null
    }
  }

  /** 发送生成结果：markdown 图片（按真实比例带尺寸）；不支持或失败时退回普通图片消息 */
  async function sendResultImage(session: Session, url: string, commandName: string): Promise<void> {
    const finalUrl = await resolveImageUrl(url, commandName)

    if (config.markdownImage !== false && supportsMarkdown(session.platform)) {
      // QQ 要求带尺寸，但写死宽高会把非方形图拉变形 —— 默认按真实比例等比缩放
      let display = { width: config.imageWidth || 0, height: config.imageHeight || 0 }
      if (config.autoImageSize !== false) {
        const maxWidth = config.imageMaxWidth || 400
        const real = await probeImageSize(url)
        display = fitImageSize(real, maxWidth, { width: maxWidth, height: maxWidth })
        logInfo(`markdown 图片尺寸: ${display.width}x${display.height}`)
      }

      try {
        await reply(session, [h('markdown', buildMarkdownImage(finalUrl, display.width, display.height))])
        return
      } catch (error) {
        ctx.logger.warn(`markdown 图片发送失败，退回普通图片消息: ${error}`)
      }
    }
    // 退回的普通图片消息也走「下载字节再发」：把外链丢给平台，
    // 平台自己拉不到时会报 [40093007] 富媒体文件下载失败。
    await reply(session, [await buildResultImagePart(finalUrl)])
  }

  /**
   * 结果图优先用「自己下载好的字节」发。
   *
   * 给平台一个外链，是让平台服务器自己去下载它 —— 手机端 QQ 拉不到绘图接口给的链接时
   * 就报 `[40093007] 富媒体文件下载失败`。把字节交给适配器上传就没这个问题。
   * 下载失败再退回发原始链接（至少不比现在更差）。
   */
  async function buildResultImagePart(url: string): Promise<any> {
    try {
      const file = await ctx.http.file(url)
      const data = file?.data
      if (data) {
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data)
        if (buffer.length) {
          logInfo(`结果图已下载（${(buffer.length / 1024).toFixed(0)}kB），按字节发送`)
          return h.image(buffer, file?.mime || 'image/png')
        }
      }
    } catch (error) {
      ctx.logger.warn(`结果图下载失败，改发原始链接: ${error}`)
    }
    return h.image(url)
  }

  /** 后台任务用 bot 直接发消息（没有 session）：引用失败时同样降级 */
  async function sendBotMessage(
    bot: any,
    channelId: string,
    parts: any[],
    guildId: string | undefined,
    messageId?: string
  ): Promise<void> {
    const body = parts.filter(Boolean)
    if (messageId) {
      try {
        await bot.sendMessage(channelId, [h.quote(messageId), ...body], guildId)
        return
      } catch (error) {
        if (!isPassiveReplyError(error)) throw error
        ctx.logger.warn('后台通知引用回复被拒（被动回复超时），改为普通消息重发')
      }
    }
    await bot.sendMessage(channelId, body, guildId)
  }

  // 每个频道最近几轮的对话（agent 记忆，只存纯文本，重启即失效）
  const agentHistories = new Map<string, any[]>()
  /** 「agent 接口地址没单独配」这条警告只打一次，别刷屏 */
  let agentUrlWarned = false

  function agentHistoryKey(session: Session): string {
    return `${session.platform}:${session.channelId || session.userId || ''}`
  }

  ctx.on('ready', () => {

    ctx.i18n.define("zh-CN", {
      [name]: {
        description: '将图片转换为特定风格',
        messages: {
          waitprompt: '请在{0}秒内发送一张图片...',
          waitpromptmultiple: '请在{0}秒内发送{1}张图片...',
          customprompt: '请在{0}秒内输入自定义提示词...',
          invalidimage: '未检测到有效的图片，请重新发送带图片的消息',
          processing: '正在处理图片，请稍候...',
          ack: '收到，正在准备...',
          failed: '图片生成失败，请稍后重试',
          error: '处理过程中发生错误，请稍后重试',
          needprompt: '请提供自定义提示词',
          needimages: '请提供至少一张图片',
          agentfailed: '绘图助手这次没跑起来（{0}）。可以先关掉「Agent 模式」照常画图，或换一个支持工具调用的模型。',
          agentnoresult: '这次没能理出个结果来，麻烦再说一次你想画什么～',
          optimizefailed: '（提示词融合失败，已改为追加模式）',
          bgstart: '已开始后台绘图（{0} 张图），画好后会在这里通知你...',
          bgqueue: '（当前有 {0} 个任务在排队）',
          bgdone: '画好了：',
          textrenderNopp: '文字渲染需要安装并启用 koishi-plugin-puppeteer（浏览器服务）',
          textrenderEmpty: '请提供要渲染的文字，例如：{0} 你好世界',
          textrenderFailed: '文字渲染失败：{0}',
          textrenderOk: '文字参考图已渲染，{0} 秒内的绘图指令会自动带上它',
          textrenderOkForever: '文字参考图已渲染，下次绘图会自动带上它',
          textrenderAttached: '（已附上文字参考图：{0}）',
          textrenderPreview: '文字参考图：'
        },
      }
    })

    ctx.command(config.basename)

    // 注意：图库启动预热（void loadGallery()）不能放在这里 ——
    // galleryLoaded 是下面用 let 声明的，先调用会触发 TDZ
    // 「Cannot access 'galleryLoaded' before initialization」。预热挪到图库声明之后。

    for (const cmdConfig of config.nested.commands) {
      if (!cmdConfig.enabled) continue;

      ctx.command(`${config.basename}/${cmdConfig.name} [message:text]`)
        .usage(`使用 ${cmdConfig.name} 风格处理图片`)
        .action(async ({ session }, message) => {
          if (!isActive || !ctx.scope.isActive) {
            return
          }
          if (!session) return

          const cmdName = cmdConfig.name
          const defaultImageUrls = cmdConfig.defaultImageUrls || []

          // 用户随指令附带的文本
          // 必须用指令参数 message：session.stripped.content 是整条消息，会把指令名一起带进来
          let userInputText = ''
          if (message) userInputText = String(message).trim()
          if (!userInputText) {
            userInputText = stripCommandName(extractTextFromMessage(session.stripped.content), cmdConfig.name)
          }
          logInfo(`[${cmdName}] 用户附加需求: ${userInputText || '（无）'}`)

          // ============ 立刻回一条「收到」 ============
          // 后面的 agent 思考 + 绘图都要几十秒，期间一句话不发用户会以为卡死。
          if (config.ackOnStart !== false) {
            try {
              await reply(session, [session.text('image-prompt.messages.ack')])
            } catch (error) {
              ctx.logger.warn(`发送「收到」提示失败: ${error}`)
            }
          }

          // 该指令是否走 agent：指令级 'on'/'off' 覆盖全局，'follow'/未填跟随全局
          const agentMode = cmdConfig.agent
          const agentOn = agentMode === 'off' || agentMode === false
            ? false
            : agentMode === 'on' || agentMode === true
              ? true
              : config.agent?.enabled !== false

          try {
            if (agentOn) {
              const finalText = await runAgentTurn(session, cmdConfig, userInputText, defaultImageUrls)
              if (finalText) await reply(session, [finalText])
              return
            }
            return await runDirectFlow(session, cmdConfig, userInputText, defaultImageUrls)
          } catch (error) {
            ctx.logger.error(`[${cmdName}] 处理图片时发生错误:`, error)
            return session.text('image-prompt.messages.error')
          }
        })
    }

    // ==================== Agent 模式 ====================
    // 参考 NeoBot 的 runtime/agent.py：
    //   插件只负责「把工具交给模型 + 老实执行模型要调的工具」，
    //   查不查图库、要不要追问、什么时候开画，全部由模型自己决定。
    // ===================================================

    /**
     * 跑一次 agent：把「指令 + 用户说的话 + 可用工具」交给模型，让它自己决定流程。
     * @returns 模型最后想对用户说的话（空字符串表示它已经把图发出去了，不需要再补一句）
     */
    async function runAgentTurn(
      session: Session,
      cmdConfig: CommandConfig['nested']['commands'][number],
      userInputText: string,
      defaultImageUrls: string[]
    ): Promise<string> {
      const agentCfg: AgentConfig = config.agent || ({} as AgentConfig)
      const maxIterations = agentCfg.maxIterations || 8
      const askTimeout = agentCfg.askTimeout || 120
      const maxSelect = agentCfg.maxSelect || 3
      const searchLimit = agentCfg.searchLimit || 12
      const historyTurns = typeof agentCfg.historyTurns === 'number' ? agentCfg.historyTurns : 6

      // ---- 参考图登记表：模型只能用它拿到的编号去引用图片 ----
      const registry = new Map<string, RefEntry>()
      const idByUrl = new Map<string, string>()
      let seq = 0
      const register = (source: RefEntry['source'], url: string, description: string, group: string): string => {
        const existed = idByUrl.get(url)
        if (existed) return existed
        seq++
        const id = `ref${seq}`
        registry.set(id, { id, url, description, group, source })
        idByUrl.set(url, id)
        return id
      }

      const pool = collectCandidates(cmdConfig, defaultImageUrls)
      for (const item of pool) register('gallery', item.url, item.description, item.group)
      // 指令默认图 = 指令作者配的「必带参考图」，始终带上，不用模型再填
      const baseIds = (defaultImageUrls || []).filter(Boolean).map(url => register('cmd', url, '', '指令默认图'))
      const userIds = extractImagesFromSession(session).map(url => register('user', url, '', '用户发送'))

      logInfo(`[${cmdConfig.name}] agent 启动：可搜索参考图 ${pool.length} 张，默认图 ${baseIds.length} 张，用户随消息发的图 ${userIds.length} 张`)

      // ---- 历史（同一频道记住最近几轮，让「再画一张」能接上）----
      const historyKey = agentHistoryKey(session)
      const history = historyTurns > 0 ? (agentHistories.get(historyKey) || []).slice() : []
      const newHistory: any[] = []
      const remember = (msg: any) => { if (historyTurns > 0) newHistory.push(msg) }
      remember({ role: 'user', content: userInputText || '（用户没有附加说明）' })

      const messages: any[] = [
        { role: 'system', content: buildAgentSystemPrompt(cmdConfig, userInputText, userIds.length, pool.length, baseIds, agentCfg) },
        ...history,
        { role: 'user', content: userInputText ? userInputText : '（用户没有附加说明，请按指令自带的提示词来）' },
      ]
      if (history.length) logInfo(`agent 带上 ${history.length} 条历史上下文`)

      const tools = buildAgentTools()
      let toolsSupported = true
      let finalText = ''
      let drew = false
      let failed = ''

      for (let iteration = 0; iteration < maxIterations; iteration++) {
        if (!isActive || !ctx.scope.isActive) break

        const res = await requestAgentChat(messages, toolsSupported ? tools : undefined)
        if (!res.ok) {
          ctx.logger.warn(`[${cmdConfig.name}] agent 第 ${iteration + 1} 轮请求失败: ${res.error}`)
          if (toolsSupported && res.toolRejected) {
            // 接口不认 tools 参数（模型不支持 function calling）：改用「一行 JSON」协议重来
            ctx.logger.warn('接口不接受 tools 参数，改用「一行 JSON」工具协议重试')
            toolsSupported = false
            messages.push({ role: 'system', content: AGENT_JSON_FALLBACK_RULE })
            continue
          }
          failed = res.error || '未知原因'
          break
        }

        messages.push(res.message)
        if (agentCfg.debugLog) {
          ctx.logger.info(`[${cmdConfig.name}] agent 第 ${iteration + 1} 轮: ${previewJson(res.message, 600)}`)
        }

        // 优先用原生 tool_calls；没有的话再看模型是不是用「一行 JSON」在调工具
        const calls = res.toolCalls.length
          ? res.toolCalls
          : parseJsonToolCall(res.content, AGENT_TOOL_NAMES)

        if (!calls.length) {
          finalText = res.content
          break
        }

        for (const call of calls) {
          const name = String(call?.name || '').trim()
          const output = await runAgentTool(name, call?.args)
          if (name === 'draw' && /"ok"\s*:\s*true/.test(output)) drew = true
          messages.push(
            call?.id
              ? { role: 'tool', tool_call_id: call.id, content: output }
              : { role: 'user', content: `工具 ${name} 返回：\n${output}` }
          )
          if (agentCfg.debugLog) {
            ctx.logger.info(`[${cmdConfig.name}] 工具 ${name}(${previewJson(call?.args, 300)}) -> ${previewJson(output, 400)}`)
          }
        }
      }

      if (!finalText && failed) finalText = session.text('image-prompt.messages.agentfailed', [failed])
      if (!finalText && !drew) finalText = session.text('image-prompt.messages.agentnoresult')

      remember({ role: 'assistant', content: finalText || '（已经把图发出去了）' })
      if (historyTurns > 0) {
        agentHistories.set(historyKey, [...history, ...newHistory].slice(-(historyTurns * 2)))
        // 频道太多时清一下，避免无限增长
        if (agentHistories.size > 200) agentHistories.clear()
      }
      return finalText

      // ---------------- 工具实现 ----------------

      async function runAgentTool(name: string, args: any): Promise<string> {
        switch (name) {
          case 'gallery_search': return toolGallerySearch(args)
          case 'ask_user': return toolAskUser(args)
          case 'draw': return toolDraw(args)
          default: return JSON.stringify({ ok: false, error: `没有叫「${name}」的工具，可用的是 gallery_search / ask_user / draw` })
        }
      }

      /** 搜图库：关键词由模型自己拟，插件只做文本匹配排序 */
      function toolGallerySearch(args: any): string {
        const keyword = String(args?.keyword ?? args?.query ?? '').trim()
        const limit = Number(args?.limit) > 0 ? Number(args.limit) : searchLimit
        const hits = keyword ? searchGallery(pool, keyword, limit) : pool.slice(0, limit)
        if (!hits.length) {
          return JSON.stringify({
            ok: true, keyword, total: pool.length, matched: 0, items: [],
            note: '没有搜到。换个更宽的关键词再试一次；确实没有就如实告诉用户「图库里没有这个立绘」',
          })
        }
        return JSON.stringify({
          ok: true, keyword, total: pool.length, matched: hits.length,
          items: hits.map(item => ({
            id: idByUrl.get(item.url) || '',
            group: item.group,
            description: item.description || '（无描述）',
          })),
        })
      }

      /** 提问并等用户的下一条消息（图也会一起带回来） */
      async function toolAskUser(args: any): Promise<string> {
        const question = cleanAskMessage(args?.question ?? args?.text ?? args?.message)
        if (!question) return JSON.stringify({ ok: false, error: 'question 不能为空' })

        try {
          await sendNotice(session, question)
        } catch (error) {
          ctx.logger.warn(`agent 提问发送失败: ${error}`)
        }

        let answer: string | undefined
        try {
          answer = await session.prompt((askTimeout > 0 ? askTimeout : 120) * 1000)
        } catch (error) {
          ctx.logger.warn(`等待用户回复时出错: ${error}`)
        }

        remember({ role: 'assistant', content: question })
        if (answer === undefined || answer === null) {
          return JSON.stringify({
            ok: false, timeout: true,
            note: `用户 ${askTimeout} 秒内没有回复。当成「他不改了」，按现有信息继续，或者直接结束这次流程`,
          })
        }

        const text = extractTextFromMessage(answer)
        const images = extractImagesFromMessage(answer)
        const ids = images.map(url => register('user', url, '', '用户发送'))
        remember({ role: 'user', content: text || (ids.length ? `（用户发了 ${ids.length} 张图片）` : '（用户什么都没说）') })
        logInfo(`agent 提问「${question}」-> 用户回复: ${text || '（无文字）'}，图片 ${ids.length} 张`)

        return JSON.stringify({
          ok: true,
          text,
          images: ids.map((id, i) => ({ id, note: `用户这次发的第 ${i + 1} 张图` })),
        })
      }

      /** 真正开画 */
      async function toolDraw(args: any): Promise<string> {
        const prompt = String(args?.prompt ?? '').trim()
        if (!prompt) return JSON.stringify({ ok: false, error: 'prompt 不能为空' })

        const rawRefs = Array.isArray(args?.references)
          ? args.references
          : typeof args?.references === 'string'
            ? args.references.split(/[,，\s]+/)
            : (args?.reference_id ? [args.reference_id] : [])

        const { ids, unknown } = resolveReferences(rawRefs, registry)
        const wanted: string[] = []
        const pushId = (id: string) => { if (id && !wanted.includes(id)) wanted.push(id) }
        baseIds.forEach(pushId)
        ids.forEach(pushId)
        const capped = wanted.slice(0, maxSelect)
        const imageUrls = capped.map(id => registry.get(id)?.url).filter(Boolean) as string[]

        const finalPrompt = args?.negative_prompt
          ? `${prompt}\n\nNegative prompt: ${String(args.negative_prompt).trim()}`
          : prompt

        logInfo(`[${cmdConfig.name}] agent 开画：参考图 ${capped.join(', ') || '（无，纯文生图）'}`)
        const res = await drawWithFiles(session, cmdConfig, finalPrompt, imageUrls, userInputText, { requireInput: false })

        return JSON.stringify({
          ok: res.ok,
          references: capped,
          ...(unknown.length ? { unknown } : {}),
          ...(res.ok
            ? { note: '图已经发到群里了，回一句简短说明即可，不要再问「还要我做什么」' }
            : { error: res.error === 'invalidimage' ? '这些参考图一张都下载不下来，检查链接还能不能访问' : '绘图接口没有返回图片' }),
        })
      }
    }

    /** 组装 agent 的系统提示词：可配置的规则 + 本次上下文 */
    function buildAgentSystemPrompt(
      cmdConfig: CommandConfig['nested']['commands'][number],
      userInputText: string,
      imageCount: number,
      refCount: number,
      baseIds: string[],
      agentCfg: AgentConfig
    ): string {
      const instructions = renderAgentInstructions(agentCfg.instructions || DEFAULT_AGENT_INSTRUCTIONS, {
        command: cmdConfig.name || '',
        prompt: cmdConfig.prompt || '',
        userInput: userInputText || '',
        imageCount,
        refCount,
        confirmRule: agentCfg.confirmBeforeDraw !== false ? AGENT_CONFIRM_RULE_ON : AGENT_CONFIRM_RULE_OFF,
      })

      const lines = ['', '## 本次上下文',
        `- 绘图指令：${cmdConfig.name}`,
        `- 指令自带的提示词：${cmdConfig.prompt || '（空，这是自定义指令）'}`,
        `- 用户这次说的话：${userInputText || '（用户没说话）'}`,
        `- 用户随消息发的图：${imageCount} 张${imageCount ? '（编号见下方，可以直接写进 draw 的 references）' : ''}`,
        `- 图库里可以搜到的参考图：${refCount} 张`,
      ]
      if (baseIds.length) lines.push(`- 指令默认参考图（已自动带上，不用再填）：${baseIds.join('、')}`)
      if (cmdConfig.custom) lines.push('- 这是自定义指令：用户没说清楚要画什么时，先用 ask_user 问一句')

      return instructions + lines.join('\n')
    }

    /** 发一次 agent 请求，返回助手消息与它想调的工具 */
    async function requestAgentChat(
      messages: any[],
      tools: any[] | undefined
    ): Promise<{ ok: boolean, message?: any, content: string, toolCalls: any[], error?: string, toolRejected?: boolean }> {
      const agentCfg: AgentConfig = config.agent || ({} as AgentConfig)
      const selector: AISelectorConfig = config.aiSelector || ({} as AISelectorConfig)
      const model = agentCfg.model || selector.model || 'Qwen/Qwen2.5-7B-Instruct'
      const url = agentCfg.baseUrl || selector.baseUrl || config.baseUrl
      const apiKey = agentCfg.apiKey || selector.apiKey || config.apiKey
      // agent 要用的是**对话**模型。接口地址一个都没填时会落到绘图接口上，
      // 而绘图模型（gpt-image 之类）根本不会聊天/调工具，这里提前说清楚。
      if (!agentCfg.baseUrl && !selector.baseUrl && !agentUrlWarned) {
        agentUrlWarned = true
        ctx.logger.warn('Agent 用的是绘图接口地址（「AI 模型接口 → 对话接口地址」留空了）。绘图模型不会聊天也不会调工具，请在「AI 模型接口」或「Agent 配置」里单独填一个支持工具调用的对话模型地址')
      }
      const timeout = (agentCfg.timeout || selector.timeout || 60) * 1000
      const temperature = typeof agentCfg.temperature === 'number'
        ? agentCfg.temperature
        : (typeof selector.temperature === 'number' ? selector.temperature : 0.3)
      const maxTokens = typeof agentCfg.maxTokens === 'number' ? agentCfg.maxTokens : 8000
      const maxRetry = typeof selector.maxRetries === 'number' ? selector.maxRetries : 2
      const baseInterval = selector.retryInterval || 3000
      const maxWaitMs = (typeof selector.retryMaxWait === 'number' ? selector.retryMaxWait : 20) * 1000
      const param = resolveTokenParam(model, selector.maxTokensParam)

      const body: any = { model, messages, temperature, max_tokens: maxTokens }
      if (tools && tools.length) {
        body.tools = tools
        body.tool_choice = 'auto'
      }

      let lastError = '未知错误'
      for (let i = 0; i <= maxRetry; i++) {
        if (!isActive || !ctx.scope.isActive) break
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
        try {
          const response = await ctx.http.post(url, withTokenParam(body, param), { headers, timeout })
          return { ok: true, ...pickAgentMessage(response) }
        } catch (error) {
          const status = error?.response?.status ?? error?.status ?? error?.code
          const serverMessage = extractServerMessage(error)
          const raw = String(error?.message || error || '')
          lastError = describeSelectorError(status, serverMessage, raw)
          ctx.logger.warn(`agent 请求失败 (${i + 1}/${maxRetry + 1}): ${lastError}`)
          if (i >= maxRetry) break
          if (!isRetryableStatus(status)) {
            // 400/401/404 这类永久性错误重试没意义。顺便判断是不是「不认 tools」
            break
          }
          const delay = computeRetryDelay(status, parseRetryAfterHeader(error?.response?.headers), baseInterval, i)
          if (maxWaitMs > 0 && delay > maxWaitMs) break
          await sleep(delay)
        }
      }

      return {
        ok: false,
        content: '',
        toolCalls: [],
        error: lastError,
        toolRejected: !!tools && /tool|function|工具/i.test(lastError),
      }
    }

    // ---------------- 绘图（agent 与直连模式共用） ----------------

    /** 下载若干张图，失败的单张丢弃（不至于一张坏图毁掉整次请求） */
    async function downloadFiles(urls: string[]): Promise<any[]> {
      const tasks = (urls || []).map(src => ctx.http.file(src).catch(err => {
        ctx.logger.error(`下载图片失败: ${src}`, err)
        return null
      }))
      return (await Promise.all(tasks)).filter(Boolean)
    }

    /**
     * 下载 → 附文字参考图 → 回显提示词 → 出图并发出去。
     * agent 的 draw 工具和「不走 agent」的直连流程都走这里。
     */
    async function drawWithFiles(
      session: Session,
      cmdConfig: CommandConfig['nested']['commands'][number],
      promptText: string,
      imageUrls: string[],
      userInputText: string,
      options: { optimizeFailed?: boolean, requireInput?: boolean } = {}
    ): Promise<{ ok: boolean, error?: string, url?: string }> {
      const commandName = cmdConfig.name
      const requireInput = options.requireInput !== false
      const files = await downloadFiles(imageUrls)
      let text = promptText

      // 文字渲染参考图（防中文崩字）
      if (config.textRender?.enabled) {
        const textRef = await resolveTextReference(session, text, userInputText, '')
        if (textRef) {
          files.push(textRef.file)
          // 提醒绘图模型：画面上的文字以参考图为准，不要自己胡编字形
          text = `${text}\n\nText in the image must be rendered exactly as shown in the attached text-reference image; copy the glyphs precisely, never distort or invent characters.`
          logInfo('已附加文字渲染参考图')
          if (config.textRender?.sendPreview !== false) {
            await reply(session, [session.text('image-prompt.messages.textrenderPreview'), h.image(textRef.file.data, 'image/png')])
          }
        }
      }

      if (files.length === 0 && requireInput) return { ok: false, error: 'invalidimage' }

      // 回显这次用的提示词（顺便当作「我开始画了」的信号）
      if (config.showPrompt !== false) {
        const echo = buildPromptBlock(text, config.promptMaxLength || 4000)
        if (echo) {
          await sendNotice(session, options.optimizeFailed
            ? `${session.text('image-prompt.messages.optimizefailed')}\n${echo}`
            : echo)
        }
      }

      // 后台绘图：先把消息还给用户，出图在后台跑，完成后主动推送
      if (config.backgroundDrawing?.enabled) {
        const snapshot = {
          bot: session.bot,
          channelId: session.channelId,
          guildId: session.guildId,
          messageId: session.messageId,
          promptText: text,
          commandName,
          texts: {
            done: session.text('image-prompt.messages.bgdone'),
            failed: session.text('image-prompt.messages.failed'),
            error: session.text('image-prompt.messages.error'),
          },
        }
        const queued = enqueueDrawJob(snapshot, files)
        await sendNotice(session, `${session.text('image-prompt.messages.bgstart', [files.length])}${queued > 0 ? session.text('image-prompt.messages.bgqueue', [queued]) : ''}`)
        return { ok: true }
      }

      const result = await generateFigureImage(files, text)
      if (!result) return { ok: false, error: 'failed' }

      await saveToGallery(result, buildGalleryDescription(text, userInputText), commandName)
      await sendResultImage(session, result, commandName)
      return { ok: true, url: result }
    }

    /** 发一条状态说明（支持的平台用 markdown，省得长文被拆） */
    async function sendNotice(session: Session, text: any): Promise<void> {
      const value = String(text ?? '').trim()
      if (!value) return
      await reply(session, [supportsMarkdown(session.platform) ? h('markdown', value) : value])
    }

    /** 不走 agent 的直连流程：指令提示词 + 用户附加需求 + 用户/默认图片，直接画 */
    async function runDirectFlow(
      session: Session,
      cmdConfig: CommandConfig['nested']['commands'][number],
      userInputText: string,
      defaultImageUrls: string[]
    ) {
      const waitTimeout = cmdConfig.waitTimeout || config.defaultWaitTimeout
      const maxImages = cmdConfig.maxImages || 0
      let promptText = cmdConfig.prompt
      let optimizeFailed = false

      if (userInputText && config.appendUserInput !== false) {
        promptText = mergePrompt(promptText, userInputText, true)
        logInfo(`已并入用户附加需求: ${userInputText}`)
        if (config.promptOptimize === 'rewrite') {
          const optimized = await optimizePromptText(cmdConfig.prompt, userInputText)
          if (optimized) {
            promptText = optimized
            logInfo('提示词已融合重写')
          } else {
            ctx.logger.warn('提示词融合重写失败，保留追加后的提示词')
            optimizeFailed = true
          }
        }
      }

      // 自定义指令：本身没提示词、用户也没给文本 -> 要一句
      if (cmdConfig.custom && !cmdConfig.prompt && !userInputText) {
        const [msgId] = await session.send(session.text('image-prompt.messages.customprompt', [waitTimeout]))
        const userPrompt = await session.prompt(waitTimeout * 1000)
        try {
          await session.bot.deleteMessage(session.channelId, msgId)
        } catch {
          ctx.logger.warn(`在频道 ${session.channelId} 尝试撤回消息ID ${msgId} 失败。`)
        }
        if (!userPrompt) return session.text('image-prompt.messages.needprompt')
        const text = extractTextFromMessage(userPrompt) || String(userPrompt).trim()
        promptText = config.promptOptimize === 'rewrite'
          ? ((await optimizePromptText('', text)) || text)
          : mergePrompt('', text, true)
      }

      const images: string[] = [...(defaultImageUrls || []), ...extractImagesFromSession(session)]
      const remaining = Math.max(0, maxImages - images.length)
      if (remaining > 0) {
        const [msgId] = await session.send(
          session.text('image-prompt.messages.waitpromptmultiple', [waitTimeout, remaining])
        )
        try {
          for (let i = 0; i < remaining; i++) {
            const answer = await session.prompt(waitTimeout * 1000)
            if (answer === undefined || answer === null) break
            images.push(...extractImagesFromMessage(answer))
          }
        } finally {
          try {
            await session.bot.deleteMessage(session.channelId, msgId)
          } catch {
            ctx.logger.warn(`在频道 ${session.channelId} 尝试撤回消息ID ${msgId} 失败。`)
          }
        }
      }

      if (images.length === 0) return session.text('image-prompt.messages.needimages')

      const res = await drawWithFiles(session, cmdConfig, promptText, images, userInputText, { optimizeFailed })
      if (!res.ok) {
        return res.error === 'invalidimage'
          ? session.text('image-prompt.messages.invalidimage')
          : session.text('image-prompt.messages.failed')
      }
    }
    // ============ 后台绘图 ============
    let runningJobs = 0
    const pendingJobs: (() => void)[] = []

    /** 入队一个后台绘图任务，返回当前排在它前面的任务数 */
    function enqueueDrawJob(snapshot: any, files: any[]): number {
      const max = config.backgroundDrawing?.maxConcurrent || 3
      if (runningJobs >= max) {
        pendingJobs.push(() => runDrawJob(snapshot, files))
        return pendingJobs.length
      }
      runningJobs++
      void runDrawJob(snapshot, files).finally(() => {
        runningJobs--
        const next = pendingJobs.shift()
        if (next) {
          runningJobs++
          void Promise.resolve(next()).finally(() => { runningJobs-- })
        }
      })
      return 0
    }

    async function runDrawJob(snapshot: any, files: any[]): Promise<void> {
      // 后台出图往往要几分钟，早就过了 QQ 被动回复的时效，引用必须能自动降级
      const send = (parts: any[]) =>
        sendBotMessage(snapshot.bot, snapshot.channelId, parts, snapshot.guildId, snapshot.messageId)

      try {
        if (!isActive || !ctx.scope.isActive) return
        const result = await generateFigureImage(files, snapshot.promptText)
        if (!result) {
          await send([snapshot.texts.failed])
          return
        }
        await saveToGallery(result, buildGalleryDescription(snapshot.promptText, ''), snapshot.commandName)
        await send([`${snapshot.texts.done}\n`, await buildResultImagePart(result)])
      } catch (error) {
        ctx.logger.error(`[${snapshot.commandName}] 后台绘图失败:`, error)
        try {
          await send([snapshot.texts.error])
        } catch { /* 通知失败也无所谓，日志已经记了 */ }
      }
    }

    /**
     * 让模型把用户附加需求融合进原始提示词（保留原始细节，不删减）
     * @returns 优化后的提示词；失败返回 null（调用方保留追加版）
     */
    async function optimizePromptText(basePrompt: string, userInput: string): Promise<string | null> {
      const selector: AISelectorConfig = config.aiSelector || ({} as AISelectorConfig)
      const base = (basePrompt || '').trim()
      const input = (userInput || '').trim()
      if (!input) return null // 没有用户输入就没什么可优化的

      // 自定义指令没有内置提示词（base 为空）时，走「扩写」分支：让模型把用户需求写成完整绘图提示词
      const content = (config.optimizePrompt || DEFAULT_OPTIMIZE_PROMPT)
        .replace(/\{prompt\}/g, base || '（无，这是自定义指令，请直接根据用户的需求扩写）')
        .replace(/\{userInput\}/g, input)

      const { raw, error } = await callSelectorModel(
        content,
        selector.optimizeMaxTokens || 8000,
        '你是资深的绘图提示词工程师，只输出优化后的提示词正文，不要输出 JSON、解释或 Markdown 代码块。',
        typeof selector.optimizeTemperature === 'number' ? selector.optimizeTemperature : 0.7
      )
      if (!raw) {
        ctx.logger.warn(`提示词融合重写失败: ${error}`)
        return null
      }

      // 清掉可能的代码块围栏和多余说明
      let text = raw.trim()
      const fence = text.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/)
      if (fence) text = fence[1].trim()
      text = text.replace(/^(优化后的提示词|提示词|Optimized Prompt|Prompt)[:：]\s*/i, '')
      text = text.trim()

      // 模型偶尔会无视要求直接返回 JSON，这时判定为失败，保留追加版提示词
      if (/^\{[\s\S]*\}$/.test(text)) {
        ctx.logger.warn('提示词优化返回了 JSON，判定为失败，保留追加后的提示词')
        return null
      }
      return text || null
    }

    /** 用提示词/用户输入拼出入库描述 */
    function buildGalleryDescription(promptText: string, userInput: string): string {
      const gallery: ResultGalleryConfig = config.resultGallery || ({} as ResultGalleryConfig)
      const source = gallery.descriptionSource || 'prompt'
      if (source === 'userInput') return userInput || promptText
      if (source === 'both') return [userInput, promptText].filter(Boolean).join(' | ')
      return promptText
    }

    // ============ 文字渲染参考图（防崩字） ============
    // 手动渲染出来的参考图，按频道暂存，下次绘图自动带上
    const pendingTextRefs = new Map<string, { file: { data: any, mime: string }, text: string, time: number }>()

    function textRefKey(session: Session): string {
      return `${session.platform}:${session.channelId || session.userId || ''}`
    }

    function takePendingTextRef(session: Session): { file: { data: any, mime: string }, text: string } | null {
      const cfg: TextRenderConfig = config.textRender || ({} as TextRenderConfig)
      const key = textRefKey(session)
      const item = pendingTextRefs.get(key)
      if (!item) return null
      const ttl = (cfg.pendingTTL || 0) * 1000
      if (ttl > 0 && Date.now() - item.time > ttl) {
        pendingTextRefs.delete(key)
        return null
      }
      pendingTextRefs.delete(key) // 一次性：带上一次就消费掉
      return { file: item.file, text: item.text }
    }

    /** 用无头浏览器把文字渲染成 PNG（失败返回 null，不影响正常绘图） */
    async function renderTextToImage(text: string): Promise<{ data: any, mime: string } | null> {
      const cfg: TextRenderConfig = config.textRender || ({} as TextRenderConfig)
      const lines = String(text || '').split('\n').map(line => line.trim()).filter(Boolean)
      if (lines.length === 0) return null

      const puppeteer: any = (ctx as any).puppeteer
      if (!puppeteer || typeof puppeteer.page !== 'function') {
        ctx.logger.warn('文字渲染需要 koishi-plugin-puppeteer（浏览器服务），当前不可用')
        return null
      }

      const html = buildTextHtml(lines, cfg)
      let page: any
      try {
        page = await puppeteer.page()
        await page.setViewport({
          width: cfg.width || 1024,
          height: 400,
          deviceScaleFactor: cfg.scale || 2
        })
        await page.setContent(html, { waitUntil: 'load' })
        // 等字体加载完再截图，避免中文回退成方块
        await page.evaluate(() => (document as any).fonts?.ready).catch(() => { })
        const stage = await page.$('#stage')
        const clip = stage ? await stage.boundingBox() : null
        const transparent = String(cfg.background || '').toLowerCase() === 'transparent'
        const buffer = clip
          ? await page.screenshot({ clip, omitBackground: transparent })
          : await page.screenshot({ omitBackground: transparent })
        const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer as any)
        logInfo(`文字渲染完成: ${lines.length} 行, ${data.length} 字节`)
        return { data, mime: 'image/png' }
      } catch (error) {
        ctx.logger.warn(`文字渲染失败: ${error}`)
        return null
      } finally {
        try { await page?.close() } catch { }
      }
    }

    /**
     * 取一张文字参考图（只给绘图模型用）
     * 优先级：手动「渲染文字」指令暂存的 > 选图模型写出来的台词 > 从提示词里正则识别的
     */
    async function resolveTextReference(
      session: Session,
      promptText: string,
      userInput: string,
      modelText?: string
    ): Promise<{ file: { data: any, mime: string }, text: string } | null> {
      const cfg: TextRenderConfig = config.textRender || ({} as TextRenderConfig)
      if (!cfg.enabled || cfg.attachToDraw === false) return null

      // 1. 用户手动渲染过 —— 最明确，直接用
      const pending = takePendingTextRef(session)
      if (pending) return pending

      // 2. 选图模型自己写出来的台词/标题
      const fromModel = (modelText || '').trim()
      if (fromModel) {
        const file = await renderTextToImage(fromModel)
        if (file) return { file, text: fromModel }
      }

      // 3. 兜底：从提示词 / 用户输入里正则识别
      if (cfg.autoDetect === false) return null
      const found = [
        ...extractTextToRender(promptText, { loose: cfg.loose, maxChars: cfg.maxChars }),
        ...extractTextToRender(userInput, { loose: cfg.loose, maxChars: cfg.maxChars })
      ]
      const text = Array.from(new Set(found)).join('\n')
      if (!text) return null

      logInfo(`自动识别到需要渲染的文字: ${text}`)
      const file = await renderTextToImage(text)
      return file ? { file, text } : null
    }

    // 手动渲染指令
    const textCmdName = (config.textRender?.commandName || '渲染文字').trim() || '渲染文字'
    ctx.command(`${config.basename}/${textCmdName} [...text:text]`)
      .usage('把文字渲染成图片，作为绘图参考图（解决中文崩字）')
      .action(async ({ session }, ...args) => {
        if (!isActive || !ctx.scope.isActive) return
        if (!session) return

        const quote = h.quote(session.messageId)
        const cfg: TextRenderConfig = config.textRender || ({} as TextRenderConfig)
        const raw = args.filter(Boolean).join(' ').trim()
          || stripCommandName(extractTextFromMessage(session.stripped.content), textCmdName).trim()

        if (!raw) return `${quote}${session.text('image-prompt.messages.textrenderEmpty', [textCmdName])}`

        const puppeteer: any = (ctx as any).puppeteer
        if (!puppeteer || typeof puppeteer.page !== 'function') {
          return `${quote}${session.text('image-prompt.messages.textrenderNopp')}`
        }

        const file = await renderTextToImage(raw)
        if (!file) return `${quote}${session.text('image-prompt.messages.textrenderFailed', ['渲染异常'])}`

        if (cfg.attachToDraw !== false) {
          pendingTextRefs.set(textRefKey(session), { file, text: raw, time: Date.now() })
        }

        const ttl = cfg.pendingTTL || 0
        const tip = ttl > 0
          ? session.text('image-prompt.messages.textrenderOk', [ttl])
          : session.text('image-prompt.messages.textrenderOkForever')

        if (cfg.sendPreview !== false) {
          await reply(session, [h.image(file.data, 'image/png'), tip])
          return
        }
        return `${quote}${tip}`
      })

    // ============ 选图模型诊断指令 ============
    const debugCmdName = (config.aiSelector?.debugCommand || '测试选图').trim() || '测试选图'
    ctx.command(`${config.basename}/${debugCmdName}`)
      .usage('发一次选图请求并回显模型原始返回，用于排查「响应中没有文本内容」')
      .action(async ({ session }) => {
        if (!isActive || !ctx.scope.isActive) return
        if (!session) return

        const quote = h.quote(session.messageId)
        const selector: AISelectorConfig = config.aiSelector || ({} as AISelectorConfig)
        const model = selector.model || 'Qwen/Qwen2.5-7B-Instruct'
        const url = selector.baseUrl || config.baseUrl
        const param = resolveTokenParam(model, selector.maxTokensParam)

        await reply(session, [`正在测试选图模型 ${model} ...`])

        const body = {
          model,
          messages: [
            { role: 'system', content: '你是一个精准的参考图片选择助手，只输出 JSON。' },
            { role: 'user', content: '候选图片：\n[1] 所属组：测试 | 描述：红发双马尾、白色水手服、站立、日系厚涂\n\n用户需求：测试\n最多选择 1 张。只输出 JSON。' }
          ],
          temperature: typeof selector.temperature === 'number' ? selector.temperature : 0.2,
          max_tokens: 1000
        }

        const apiKey = selector.apiKey || config.apiKey
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

        try {
          const response = await ctx.http.post(url, withTokenParam(body, param), {
            headers,
            timeout: (selector.timeout || 60) * 1000
          })
          const { text, reason } = extractResponseText(response)
          const lines = [
            `接口：${url}`,
            `模型：${model}`,
            `长度参数：${param}`,
            text ? `取到内容：${previewJson(text, 400)}` : `取不到内容：${reason}`,
            text ? '' : `原始返回：${previewJson(response, 1200)}`
          ].filter(Boolean)
          return `${quote}${lines.join('\n')}`
        } catch (error) {
          const status = error?.response?.status ?? error?.status ?? error?.code
          return `${quote}请求失败：${describeSelectorError(status, extractServerMessage(error), String(error?.message || error))}`
        }
      })

    // ============ 生成结果入库（图库） ============
    let galleryRecords: GalleryRecord[] = []
    let galleryLoaded = false

    function galleryFilePath(): string {
      return nodePath.join(ctx.baseDir, 'data', name, 'gallery.json')
    }

    async function loadGallery(): Promise<void> {
      if (galleryLoaded) return
      galleryLoaded = true
      try {
        const raw = await fs.readFile(galleryFilePath(), 'utf8')
        const data = JSON.parse(raw)
        if (Array.isArray(data?.items)) galleryRecords = data.items
        logInfo(`已加载图库 ${galleryRecords.length} 条`)
      } catch (error) {
        // 文件不存在或格式损坏都当作空图库
        galleryRecords = []
      }
    }

    // 启动时把已入库的生成结果读进内存，供后续检索。
    // 必须放在 galleryLoaded / loadGallery 的声明之后，否则会踩 let 的暂时性死区
    void loadGallery()

    async function persistGallery(): Promise<void> {
      try {
        await fs.mkdir(nodePath.dirname(galleryFilePath()), { recursive: true })
        await fs.writeFile(galleryFilePath(), JSON.stringify({ items: galleryRecords }, null, 2), 'utf8')
      } catch (error) {
        ctx.logger.warn(`写入图库文件失败: ${error?.message || error}`)
      }
    }

    /** 把生成结果存入图库（不写回插件配置，避免触发插件重载） */
    async function saveToGallery(imageUrl: string, description: string, commandName: string): Promise<void> {
      const gallery: ResultGalleryConfig = config.resultGallery || ({} as ResultGalleryConfig)
      if (!gallery.enabled || !imageUrl) return

      await loadGallery()
      const groupName = (gallery.groupName || '生成结果').trim() || '生成结果'

      // 同一张图不重复入库
      if (galleryRecords.some(r => r.url === imageUrl)) return

      galleryRecords.push({
        group: groupName,
        url: imageUrl,
        description: truncateText(description, gallery.maxLength || 120),
        command: commandName,
        time: Date.now()
      })
      galleryRecords = trimGallery(galleryRecords, gallery.capacity || 50)
      await persistGallery()
      logInfo(`生成结果已入库: ${groupName} ${imageUrl}`)
    }

    const galleryCmdName = (config.resultGallery?.commandName || '图库').trim() || '图库'
    ctx.command(`${config.basename}/${galleryCmdName} [group:text]`)
      .usage('查看或清空自动入库的生成结果')
      .action(async ({ session }, groupName) => {
        if (!isActive || !ctx.scope.isActive) return
        if (!session) return

        await loadGallery()
        const quote = h.quote(session.messageId)
        const keyword = (groupName || '').trim()

        if (keyword === '清空' || keyword === 'clear') {
          const count = galleryRecords.length
          galleryRecords = []
          await persistGallery()
          return `${quote}已清空图库（${count} 条）`
        }

        const records = keyword
          ? galleryRecords.filter(r => r.group.includes(keyword) || r.description.includes(keyword))
          : galleryRecords

        if (records.length === 0) {
          return `${quote}图库是空的（生成结果入库未开启，或还没有生成过图片）`
        }

        const lines = records
          .slice(-20)
          .map((r, i) => `${i + 1}. [${r.group}] ${r.description || '（无描述）'}`)
          .join('\n')
        return `${quote}图库共 ${records.length} 条${records.length > 20 ? '（显示最近 20 条）' : ''}：\n${lines}\n\n发送「${galleryCmdName} 清空」可清空`
      })

    // ============ 自动生成参考图描述 ============
    const captionCmdName = (config.aiSelector?.captionCommand || '生成描述').trim() || '生成描述'
    ctx.command(`${config.basename}/${captionCmdName} [group:text]`)
      .usage('用 AI 识别参考图片并自动填写描述（需要支持图片输入的模型）')
      .action(async ({ session }, groupName) => {
        if (!isActive || !ctx.scope.isActive) return
        if (!session) return

        const quote = h.quote(session.messageId)
        const selector: AISelectorConfig = config.aiSelector || ({} as AISelectorConfig)
        const model = selector.captionModel || selector.model || 'Qwen/Qwen2.5-7B-Instruct'

        // 直接发图：只识别并返回描述，方便用户自己复制
        const userImages = extractImagesFromSession(session)
        if (userImages.length > 0) {
          await reply(session, [`正在识别 ${userImages.length} 张图片...`])
          const lines: string[] = []
          for (const url of userImages.slice(0, selector.captionBatch || 8)) {
            const caption = await generateCaption(url, model)
            lines.push(caption || `（识别失败）${url}`)
          }
          return `${quote}识别结果：\n${lines.join('\n')}`
        }

        // 没发图：为参考图片组里「描述为空」的图片批量生成
        const groups: ReferenceGroup[] = config.referenceGroups || []
        if (groups.length === 0) {
          return `${quote}还没有配置任何参考图片组，请先在「参考图片组」里添加图片链接。`
        }

        const keyword = (groupName || '').trim()
        const targets = keyword
          ? groups.filter(g => g.name === keyword || g.name.includes(keyword))
          : groups.filter(g => g.enabled !== false)

        if (targets.length === 0) {
          return `${quote}没有找到名为「${keyword}」的参考图片组。`
        }

        const pending: { group: ReferenceGroup, item: ReferenceImageItem }[] = []
        for (const group of targets) {
          for (const item of group.items || []) {
            if (item?.url && !(item.description || '').trim()) pending.push({ group, item })
          }
        }

        if (pending.length === 0) {
          return `${quote}这些组里的图片都已经有描述了。若要重新生成，请先清空对应图片的描述。`
        }

        const batch = pending.slice(0, selector.captionBatch || 8)
        await reply(session, [`正在为 ${batch.length} 张参考图片生成描述（共 ${pending.length} 张待处理）...`])

        const lines: string[] = []
        let success = 0
        for (const { group, item } of batch) {
          const caption = await generateCaption(item.url, model)
          if (caption) {
            item.description = caption
            success++
            lines.push(`[${group.name}] ${caption}`)
          } else {
            lines.push(`[${group.name}] 识别失败：${item.url}`)
          }
        }

        // 先把结果发给用户，再写回配置（写回会触发重载，可能打断后续发送）
        await reply(session, [`已生成 ${success} 条描述：\n${lines.join('\n')}`])

        if (success > 0) {
          try {
            ctx.scope.update(config, true)
            logInfo(`已写回 ${success} 条图片描述到插件配置`)
          } catch (error) {
            ctx.logger.warn(`写回插件配置失败: ${error?.message || error}`)
            await reply(session, ['自动写入配置失败，请手动把上面的描述填到控制台的「参考图片组」里。'])
          }
        }
      })

    /** 调用模型识别单张图片，得到一句便于检索的描述 */
    async function generateCaption(imageUrl: string, model: string): Promise<string | null> {
      const selector: AISelectorConfig = config.aiSelector || ({} as AISelectorConfig)
      const body = {
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: selector.captionPrompt || DEFAULT_CAPTION_PROMPT },
              { type: 'image_url', image_url: { url: imageUrl } }
            ]
          }
        ],
        temperature: 0.3,
        max_tokens: 300
      }

      const url = selector.baseUrl || config.baseUrl
      const apiKey = selector.apiKey || config.apiKey
      const timeout = (selector.timeout || 60) * 1000

      const { raw, error } = await requestSelectorModel(url, apiKey, body, timeout)
      if (!raw) {
        ctx.logger.warn(`生成图片描述失败: ${error}`)
        if (!selector.captionModel) {
          ctx.logger.warn('生成描述需要支持图片输入的模型：请在「AI 模型接口 → 生成描述用的模型」单独填一个多模态模型')
        }
        return null
      }
      return sanitizeCaption(raw, 120) || null
    }

    /** 汇总某条指令可选的参考图片（来自所选参考图片组） */
    function collectCandidates(cmdConfig: CommandConfig['nested']['commands'][number], defaultImageUrls: string[]): CandidateImage[] {
      const candidates: CandidateImage[] = []
      const groups: ReferenceGroup[] = config.referenceGroups || []
      const selector: AISelectorConfig = config.aiSelector || ({} as AISelectorConfig)
      const names = (cmdConfig.referenceGroups || []).filter(Boolean)

      // 指令指定了组则只用这些组，否则按配置决定是否使用全部组
      const targets = names.length > 0
        ? groups.filter(g => g.enabled !== false && names.includes(g.name))
        : (selector.includeAllGroups ? groups.filter(g => g.enabled !== false) : [])

      for (const group of targets) {
        for (const item of group.items || []) {
          if (!item || !item.url) continue
          candidates.push({
            group: group.name,
            url: item.url,
            description: (item.description || '').trim()
          })
        }
      }

      if (selector.includeCommandDefaults) {
        for (const url of defaultImageUrls) {
          if (url) candidates.push({ group: '指令默认图片', url, description: '' })
        }
      }

      // 自动入库的生成结果也参与检索（形成闭环）
      const gallery: ResultGalleryConfig = config.resultGallery || ({} as ResultGalleryConfig)
      if (gallery.enabled && galleryRecords.length > 0) {
        const wanted = names.length > 0 ? names : (selector.includeAllGroups ? null : [])
        const galleryGroup = (gallery.groupName || '生成结果').trim()
        for (const record of galleryRecords) {
          // 指令指定了组就只认这些组，否则全部组的图库记录都参与
          if (wanted && !wanted.includes(record.group) && !wanted.includes(galleryGroup)) continue
          candidates.push({
            group: record.group,
            url: record.url,
            description: record.description
          })
        }
      }

      return candidates
    }


    /**
     * 发一次对话模型请求（提示词优化、生成描述等纯文本用途）。
     * agent 循环不走这里（它要拿 tool_calls），走 requestAgentChat。
     */
    async function callSelectorModel(
      content: string | any[],
      maxTokens: number,
      systemPrompt?: string,
      temperature?: number
    ): Promise<{ raw: string | null, error: string }> {
      const selector: AISelectorConfig = config.aiSelector || ({} as AISelectorConfig)
      const sysText = systemPrompt || '你是一个精准的助手，只输出要求的内容。'
      const requestBody = {
        model: selector.model || 'Qwen/Qwen2.5-7B-Instruct',
        messages: [
          { role: 'system', content: sysText },
          { role: 'user', content }
        ],
        temperature: typeof temperature === 'number' ? temperature
          : (typeof selector.temperature === 'number' ? selector.temperature : 0.2),
        max_tokens: maxTokens
      }

      const url = selector.baseUrl || config.baseUrl
      const apiKey = selector.apiKey || config.apiKey
      const timeout = (selector.timeout || 60) * 1000

      logInfo(`对话模型请求: ${url} 模型 ${requestBody.model}`)
      return requestSelectorModel(url, apiKey, requestBody, timeout)
    }

    /** 请求对话模型接口（带退避重试），返回纯文本回复与失败原因 */
    async function requestSelectorModel(url: string, apiKey: string | undefined, body: any, timeout: number): Promise<{ raw: string | null, error: string }> {
      const selector: AISelectorConfig = config.aiSelector || ({} as AISelectorConfig)
      const maxRetry = typeof selector.maxRetries === 'number' ? selector.maxRetries : 2
      const baseInterval = selector.retryInterval || 3000
      const maxWaitMs = (typeof selector.retryMaxWait === 'number' ? selector.retryMaxWait : 20) * 1000

      let lastError = '未知错误'
      // 输出长度参数名：模型不认 max_tokens 时返回空内容，重试时自动换一个试试
      let tokenParam = resolveTokenParam(body?.model, selector.maxTokensParam)
      let tokenParamSwitched = false
      // 输出长度上限：推理模型会把额度耗在思考上，截断后自动加大
      let currentMaxTokens = body?.max_tokens ?? body?.max_completion_tokens
      const maxTokensCeiling = selector.maxTokensCeiling || 32000

      for (let i = 0; i <= maxRetry; i++) {
        if (!isActive || !ctx.scope.isActive) return { raw: null, error: '插件已停用' }
        let emptyResponse = false
        let truncated = false
        try {
          const headers: Record<string, string> = { 'Content-Type': 'application/json' }
          if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

          const payload = withTokenParam(
            typeof currentMaxTokens === 'number' ? { ...body, max_tokens: currentMaxTokens } : body,
            tokenParam
          )
          const response = await ctx.http.post(url, payload, { headers, timeout })

          // 兼容各种返回结构：推理模型把正文放在 reasoning_content、中转站塞进 data、
          // 还有的直接回 SSE 流
          const { text, reason, truncated: cut } = extractResponseText(response)
          if (text) return { raw: text, error: '' }

          emptyResponse = true
          truncated = cut
          lastError = reason
          ctx.logger.warn(`AI 选图响应里取不到文本：${reason}`)
          logInfo(`AI 选图原始返回（截断）：${previewJson(response, 800)}`)
          throw new Error(`模型没有返回文本内容（${reason}）`)
        } catch (error) {
          const status = error?.response?.status ?? error?.status ?? error?.code
          // 空响应没有 HTTP 状态码，用我们自己的诊断文案；网络/HTTP 错误走原来的解析
          lastError = emptyResponse
            ? lastError
            : describeSelectorError(status, extractServerMessage(error), String(error?.message || error || ''))
          ctx.logger.warn(`AI 选图请求失败 (${i + 1}/${maxRetry + 1}): ${lastError}`)

          if (i >= maxRetry) break

          // 1) 输出被截断：推理模型把 max_tokens 全用在思考上了，加大额度再试（最有效的解药）
          if (truncated && typeof currentMaxTokens === 'number' && currentMaxTokens < maxTokensCeiling) {
            const next = Math.min(Math.max(currentMaxTokens * 4, 4000), maxTokensCeiling)
            ctx.logger.warn(`输出被 max_tokens=${currentMaxTokens} 截断，加大到 ${next} 重试`)
            currentMaxTokens = next
            continue
          }

          // 2) 换一个输出长度参数名再试（有些「没有文本内容」是参数名不对导致的）
          if (emptyResponse && !tokenParamSwitched) {
            tokenParam = tokenParam === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens'
            tokenParamSwitched = true
            ctx.logger.warn(`下次重试改用 ${tokenParam} 参数名`)
            continue
          }

          // 400/401/404 这类永久性错误重试没有意义，直接放弃
          if (!isRetryableStatus(status)) {
            ctx.logger.warn(`AI 选图请求返回 ${status}，属于不可重试的错误，停止重试`)
            break
          }

          // 限流/服务不可用：优先遵循 Retry-After，否则指数退避
          const delay = computeRetryDelay(status, parseRetryAfterHeader(error?.response?.headers), baseInterval, i)

          // 等待时间过长则放弃重试，避免用户干等
          if (maxWaitMs > 0 && delay > maxWaitMs) {
            ctx.logger.warn(`AI 选图需要等待 ${Math.round(delay / 1000)} 秒，超过设定的 ${selector.retryMaxWait} 秒，停止重试`)
            break
          }

          logInfo(`AI 选图将在 ${delay}ms 后重试`)
          await sleep(delay)
        }
      }

      return { raw: null, error: lastError }
    }

    /** 从消息中提取纯文本 */
    function extractTextFromMessage(content: string): string {
      if (!content) return ''
      return h.select(content, 'text')
        .map(el => el.attrs.content || '')
        .join(' ')
        .trim()
    }

    function extractImagesFromSession(session: Session): string[] {
      const images: string[] = []

      // 从当前消息中提取
      const currentImages = extractImagesFromMessage(session.stripped.content)
      images.push(...currentImages)

      // 从引用消息中提取
      if (session.quote) {
        const quoteImages = extractImagesFromMessage(session.quote.content)
        images.push(...quoteImages)
      }

      return images
    }

    function extractImagesFromMessage(content: string): string[] {
      const images: string[] = []

      // 提取<img>标签中的图片
      const imgElements = h.select(content, 'img')
      for (const img of imgElements) {
        if (img.attrs.src) {
          images.push(img.attrs.src)
        }
      }

      // 提取<mface>标签中的图片
      const mfaceElements = h.select(content, 'mface')
      for (const mface of mfaceElements) {
        if (mface.attrs.url) {
          images.push(mface.attrs.url)
        }
      }

      return images
    }

    async function generateFigureImage(files: any[], prompt: string): Promise<string | null> {
      try {
        const dataUrls: string[] = []

        for (const file of files) {
          let processedImageData = file.data
          let originalMimeType = file.mime || 'image/jpeg'
          let finalMimeType = originalMimeType // 最终的MIME类型

          let base64Image: string
          if (Buffer.isBuffer(processedImageData)) {
            base64Image = processedImageData.toString('base64')
          } else if (processedImageData instanceof ArrayBuffer) {
            base64Image = Buffer.from(processedImageData).toString('base64')
          } else {
            base64Image = Buffer.from(processedImageData).toString('base64')
          }

          // 使用最终的MIME类型
          dataUrls.push(`data:${finalMimeType};base64,${base64Image}`)
        }

        // 请求体
        const contentArray: any[] = [
          {
            type: "text",
            text: prompt
          }
        ]

        // 添加所有图片
        for (const dataUrl of dataUrls) {
          contentArray.push({
            type: "image_url",
            image_url: {
              url: dataUrl
            }
          })
        }

        const requestBody = {
          model: config.model,
          messages: [
            {
              role: "user",
              content: contentArray
            }
          ],
          max_tokens: 300,
          n: 1
        }

        logInfo('请求体结构:', JSON.stringify({
          ...requestBody,
          messages: [
            {
              ...requestBody.messages[0],
              content: [
                requestBody.messages[0].content[0],
                ...requestBody.messages[0].content.slice(1).map((item: any, index: number) => {
                  const originalUrl = item.image_url.url
                  const mimeMatch = originalUrl.match(/^data:([^;]+);base64,/)
                  const mimeType = mimeMatch ? mimeMatch[1] : 'image'
                  return {
                    type: "image_url",
                    image_url: {
                      url: `data:${mimeType};base64,[${originalUrl.length} chars]`
                    }
                  }
                })
              ]
            }
          ]
        }, null, 2))

        // 直接请求 API（带鉴权头与重试）
        return await sendChatRequest(requestBody)
      } catch (error) {
        ctx.logger.error(`生成图片时发生错误: ${error}`)
        return null
      }
    }

    async function sendChatRequest(requestBody: any): Promise<string | null> {
      let retryCount = 0

      while (retryCount <= config.maxRetries) {
        // 在每次重试前检查上下文状态
        if (!isActive || !ctx.scope.isActive) {
          ctx.logger.info('插件已卸载，停止重试')
          return null
        }

        try {
          logInfo(`发送请求到 ${config.baseUrl}，第 ${retryCount + 1} 次尝试`)

          const headers: Record<string, string> = {
            'Content-Type': 'application/json'
          }
          if (config.apiKey) {
            headers['Authorization'] = `Bearer ${config.apiKey}`
          }

          const response = await ctx.http.post(config.baseUrl, requestBody, { headers })

          // 处理响应
          if (response && response.choices && response.choices[0] && response.choices[0].message) {
            const message = response.choices[0].message

            logInfo(`响应：${JSON.stringify(response)}`)
            if (message.content) {
              // 尝试匹配Markdown格式的图片链接
              const markdownMatch = message.content.match(/!\[.*?\]\((https?:\/\/[^)]+)\)/)
              if (markdownMatch && markdownMatch[1]) {
                const imageUrl = markdownMatch[1]
                logInfo(`成功获取图片URL: ${imageUrl}`)
                return imageUrl
              }
            }
          }

          const errorMsg = '响应中未找到图片URL'
          throw new Error(errorMsg)
        } catch (error) {
          retryCount++
          const errorMessage = error.message || error.toString()
          const statusCode = error.response?.status || 0

          logInfo(`请求失败 (${retryCount}/${config.maxRetries}): ${errorMessage}`)

          // 检查是否为配额不足错误
          if (errorMessage.includes('insufficient_quota') || statusCode === 429) {
            ctx.logger.error('API 配额不足，停止重试')
            return null
          }

          if (retryCount <= config.maxRetries) {
            logInfo(`等待 ${config.retryInterval}ms 后重试`)
            await sleep(config.retryInterval)
            if (!isActive || !ctx.scope.isActive) {
              ctx.logger.info('插件已卸载，停止重试')
              return null
            }
          } else {
            ctx.logger.error(`达到最大重试次数 (${config.maxRetries})，最后错误: ${errorMessage}`)
            return null
          }
        }
      }
      return null
    }

    function logInfo(...args: any[]) {
      if (config.loggerinfo) {
        (logger.info as (...args: any[]) => void)(...args);
      }
    }
  })
}
