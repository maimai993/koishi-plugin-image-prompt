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

【AI 选择参考图片】

1. 在「参考图片组」中注册分组：每组填写若干张「图片链接 + 描述」（描述用于让 AI 判断该图的用途）。
   **描述一定要写具体**（发色发型、服装、动作、画风）—— 打分制下没描述的图永远选不上。
2. 在指令配置的「引用的参考图片组名称」中填入组名（可填多个），该指令执行时会把组内图片全部交给 AI 挑选。
3. 「AI 选图设置」可修改对话模型（默认 Qwen/Qwen2.5-7B-Instruct）、选择模式、提示词模板、超时与重试等；
   接口地址/密钥留空时复用绘图接口的配置。
4. 「选图模式」默认是**打分制**：先只做需求分析（**不给模型候选图**，它没有「可挑的对象」），
   再用关键词在本地召回，然后要求模型给每张候选图打 0-100 分，低于「最低分数线」的一律不要。
   一张都不达标就如实告知用户「图库里没有合适的参考图」，**不会硬凑**；
   若开启「缺少合适参考图时询问用户补充发送」，会请用户补发一张参考图（用户发的图会被直接使用）。
   想回到老行为就把「选图模式」改成「旧版」。
5. 当用户明确说「不用参考 / 随意画 / 自由发挥」时，直接跳过选图，一次选图请求都不发。
6. 指令一触发就先回一条「收到，正在准备...」（「消息发送 → 收到提示」，默认开）。
   后面的优化提示词 + 选图是两轮模型请求，可能要几十秒，不发这条用户会以为机器人卡死。
7. **开画前确认**（「消息发送 → 开画前请用户确认」，默认开）：AI 挑完参考图先不画，
   把「本次会参考哪几张图」列出来，回复「确认」才开画（超时或回别的都算取消）。
   不想多这一步就关掉，或在单个指令上设成「选好图直接开画」。
8. 「启用 AI 智能选择参考图片」默认关闭，需手动开启；「AI 选图失败时回退为使用候选池内全部图片」默认关闭，
   失败时本次不使用参考图片（开启则改用候选池内全部图片）。注意「回退」只对**请求失败**生效，
   对「打分不达标」不生效 —— 后者就该不带参考图。
9. 「旧版」模式下参考图较多时（超过 12 张）自动走两级检索：先让模型产出检索关键词、本地匹配召回，
   再对召回结果精排；识图模式下也只发送召回的这几张图片，避免每次都把整个图库发给模型。
10. 描述可以用「生成描述」指令让模型看图自动生成并写回配置（需要支持图片输入的模型）。
   若选图模型支持识别图片（多模态），可勾选「选图模型支持识别图片」，插件会把候选图片**自己下载后转 base64**
   再发给模型（直接丢链接的话，模型服务端拉不到就会整条请求 400），模型对着真实图片挑选；
   它给出的关键视觉特征还会并入绘图提示词，让出图更还原参考图。
11. 生成结果可自动入库（默认关闭），下次能被自己检索到并复用，形成闭环；
   开启「后台绘图」后出图不再阻塞，先回「正在画」，画好主动推送。

提示词模板可用占位符：{candidates} 候选图片列表、{userInput} 用户附加需求、{max} 最多选择数量、{command} 指令名、{prompt} 指令提示词

---
此项目所需的koishi服务：必需 'http', 'logger', 'i18n'；可选 'puppeteer'（仅「文字渲染参考图」需要）

---
`;

const logger = new Logger(name)

/**
 * 解析模型返回的 JSON 选择结果（纯函数，便于单独测试）
 * @param raw 模型的原始回复
 * @param candidates 候选图片列表（编号从 1 开始）
 * @param max 最多选取数量
 * @param warn 日志回调
 */
export function parseSelectionResult(
  raw: string | null,
  candidates: CandidateImage[],
  max: number,
  warn: (msg: string) => void = () => {}
): SelectionResult {
  const result: SelectionResult = { picked: [], needUserImage: false, askMessage: '', reason: '', ok: false }
  if (!raw) return result

  let text = raw.trim()
  const codeMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeMatch) text = codeMatch[1].trim()

  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return result

  let data: any
  try {
    data = JSON.parse(text.slice(start, end + 1))
  } catch (error) {
    warn(`AI 选图返回内容无法解析为 JSON: ${text.slice(0, 200)}`)
    return result
  }

  result.ok = true
  result.reason = String(data.reason || data.reasoning || '')
  result.needUserImage = data.needUserImage === true || data.need_user_image === true
  result.askMessage = String(data.askMessage || data.ask_message || '')
  result.hint = String(data.hint || data.observation || data.description || '').trim() || undefined

  // 模型认为画面上要出现的文字（台词/标题/字幕），交给浏览器渲染成参考图
  const rawText = data.text ?? data.texts ?? data.dialogue ?? data.renderText ?? data.lines ?? data.caption
  if (Array.isArray(rawText)) {
    result.renderText = rawText.map(line => String(line).trim()).filter(Boolean).join('\n')
  } else if (typeof rawText === 'string' && rawText.trim()) {
    result.renderText = rawText.trim()
  }

  const rawKeywords = data.keywords ?? data.query ?? data.queries
  if (Array.isArray(rawKeywords)) {
    result.keywords = rawKeywords.map(k => String(k).trim()).filter(Boolean)
  } else if (typeof rawKeywords === 'string' && rawKeywords.trim()) {
    result.keywords = rawKeywords.split(/[,，\n]+/).map(k => k.trim()).filter(Boolean)
  }

  // 兼容多种返回写法：数组 / 逗号分隔字符串 / 单个数字 / 0-based
  // 兼容多种写法：selected（精排）/ candidates（两级检索的粗筛）/ picked / indexes / index
  const rawSelected = data.selected ?? data.candidates ?? data.picked ?? data.indexes ?? data.index
  const indexes: number[] = []
  const pushIndex = (value: any) => {
    const num = typeof value === 'number' ? value : parseInt(String(value).replace(/[^0-9-]/g, ''), 10)
    if (!isNaN(num)) indexes.push(num)
  }
  if (Array.isArray(rawSelected)) {
    rawSelected.forEach(pushIndex)
  } else if (typeof rawSelected === 'string') {
    rawSelected.split(/[,，\s]+/).forEach(pushIndex)
  } else if (typeof rawSelected === 'number') {
    pushIndex(rawSelected)
  }

  for (const index of indexes) {
    const candidate = candidates[index - 1] || candidates[index]
    if (candidate && !result.picked.includes(candidate)) result.picked.push(candidate)
    if (result.picked.length >= max) break
  }

  return result
}

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

/**
 * 第一级检索：按关键词在候选池里做文本匹配召回（纯本地，不发请求）
 * 支持中文子串匹配 + 2-gram 部分命中，关键词可含空格/顿号（会自动拆分）
 */
export function matchCandidatesByKeywords(candidates: CandidateImage[], keywords: string[], topK: number): CandidateImage[] {
  const words = (keywords || [])
    .flatMap(k => String(k).split(/[\s,，、;；/|]+/))
    .map(w => normalizeText(w))
    .filter(w => w.length > 0)

  if (!words.length) return []

  const scored: { item: CandidateImage, score: number }[] = []
  for (const candidate of candidates) {
    const haystack = normalizeText(`${candidate.group} ${candidate.description}`)
    let score = 0
    for (const word of words) {
      if (haystack.includes(word)) {
        score += Math.max(2, word.length) * 2
      } else if (word.length > 2) {
        // 部分命中：拆成 2-gram 再看
        for (const gram of toGrams(word)) {
          if (haystack.includes(gram)) score += 1
        }
      }
    }
    if (score > 0) scored.push({ item: candidate, score })
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topK > 0 ? topK : 12).map(s => s.item)
}

function normalizeText(value: string): string {
  return String(value || '').toLowerCase().replace(/\s+/g, '')
}

function toGrams(word: string): string[] {
  const grams: string[] = []
  for (let i = 0; i < word.length - 1; i++) grams.push(word.slice(i, i + 2))
  return grams
}

/** 去重合并候选（按 url 判重） */
export function mergeCandidates(...lists: CandidateImage[][]): CandidateImage[] {
  const seen = new Set<string>()
  const result: CandidateImage[] = []
  for (const list of lists) {
    for (const item of list || []) {
      if (!item || !item.url || seen.has(item.url)) continue
      seen.add(item.url)
      result.push(item)
    }
  }
  return result
}

// ============================================================================
// AI 选图：需求抽取 → 关键词召回 → 逐图打分 → 阈值兜底
// 思路来自 NeoBot 的「先检索再引用」：模型不直接面对一堆候选去「挑」，
// 而是先把「要什么」想清楚，再对召回的少数图逐张显式打分；
// 分数不达标就如实回「图库没有合适的图」，而不是硬挑一张凑数。
// ============================================================================

/** 选图第一步的产物：先想清楚「要什么」，再去看「有什么」 */
export interface RequirementAnalysis {
  /** 画面主体（一句话） */
  subject: string
  /** 硬性要素：缺一个就不该选这张图 */
  must: string[]
  /** 加分要素：有更好，没有也能用 */
  nice: string[]
  /** 明确不要出现的 */
  avoid: string[]
  /** 画面需要出现的文字（台词/标题/招牌），交给浏览器渲染 */
  text: string
  /** 用户表示「不用参考/随意画」时跳过检索 */
  skipReference: boolean
  /** 判定需要用户补图时，用一句话说明要什么样的图 */
  needTypes: string
}

/** 单张候选图的打分结果（index 从 1 开始，对应候选列表位置） */
export interface ScoredCandidate {
  index: number
  score: number
  why: string
}

/** 用户明确表示不需要参考图（回退到纯文生图） */
const SKIP_REFERENCE_RE = new RegExp([
  '(不用|不需要|无需|不要|别)(参考|垫图|看图|找图|搜图|调图库)',
  '(参考图|垫图|图库)(不用|不需要|就别|去掉)',
  '(随意|随便|自由|任意)发挥',
  '随意画|随便画|你看着画|看着办|你决定',
].join('|'))

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

/** 把模型给的字段统一成字符串数组（支持数组 / 逗号顿号换行分隔的字符串） */
export function toStrList(value: any): string[] {
  if (Array.isArray(value)) return value.map(v => String(v ?? '').trim()).filter(Boolean)
  if (typeof value === 'string' && value.trim()) {
    return value.split(/[,，、;；\n]+/).map(s => s.trim()).filter(Boolean)
  }
  return []
}

/** 用户这句话是不是「不用参考了」 */
export function isSkipReferenceInput(userInput: string): boolean {
  const text = String(userInput || '').trim()
  if (!text) return false
  return SKIP_REFERENCE_RE.test(text)
}

/**
 * 兜住「需求分析」模型爱乱加的废话。
 *
 * 实测模型会把 needTypes 写成
 * 「能发一张你想用的自己形象的参考图吗？顺便说说 DeepSeek 画成鲸鱼可以吗？」——
 * 后半句是凭空瞎聊，用户看了莫名其妙。这里只保留第一句、去掉换行和 markdown 修饰、
 * 限制长度，把「询问补图」这件事还原成一句话。
 */
export function sanitizeAskMessage(raw: string | null | undefined, max = 40): string {
  let text = String(raw ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  // 只留第一句：句末标点（中文/英文）之后的内容全部丢掉
  const first = text.match(/^[^。！？!?；;]*[。！？!?；;]?/)
  if (first) text = first[0].trim()
  // 去掉 markdown 记号与包裹引号
  text = text.replace(/^[-*>#\s]+/, '').replace(/^["'“”「」『』]+/, '').replace(/["'“”「」『』]+$/, '').trim()
  if (text.length > max) text = text.slice(0, max) + '…'
  return text
}

/** 确认绘图的回复：只认「就是这一句」的短回复，避免把正常聊天当确认 */
const CONFIRM_RE = /^(确认|确定|可以|好的|好|行|嗯|是|是的|开始|开画|画吧|继续|ok|okay|yes|y|1|\+1)$/i

export function isConfirmInput(raw: string | null | undefined): boolean {
  const text = String(raw ?? '')
    .replace(/[\s\u3000]+/g, '')
    .replace(/[!！。.,，~～?？:：]+$/g, '')
  if (!text || text.length > 12) return false
  return CONFIRM_RE.test(text)
}

/** 解析「需求抽取」的返回 */
export function parseAnalysisResult(raw: string | null): RequirementAnalysis | null {
  const data = extractJsonObject(raw)
  if (!data) return null
  const text = data.text ?? data.texts ?? data.lines ?? data.renderText
  return {
    subject: String(data.subject ?? data.主体 ?? '').trim(),
    must: toStrList(data.must ?? data.mustHave ?? data.required ?? data.硬性要素),
    nice: toStrList(data.nice ?? data.niceToHave ?? data.optional ?? data.加分要素),
    avoid: toStrList(data.avoid ?? data.exclude ?? data.negative ?? data.不要出现),
    text: Array.isArray(text) ? toStrList(text).join('\n') : String(text ?? '').trim(),
    skipReference: data.skipReference === true || data.skip_reference === true,
    needTypes: sanitizeAskMessage(data.needTypes ?? data.need_types ?? data.需要的图 ?? ''),
  }
}

/** 把「需求要素」转成本地检索用的关键词 */
export function keywordsFromAnalysis(analysis: RequirementAnalysis | null): string[] {
  if (!analysis) return []
  const words: string[] = []
  const push = (value: string) => {
    const item = String(value || '').trim()
    if (item && !words.includes(item)) words.push(item)
  }
  if (analysis.subject) push(analysis.subject)
  analysis.must.forEach(push)
  analysis.nice.forEach(push)
  return words
}

/** 把分数归一化到 0-100（兼容 0.85 这种小数写法、以及 "85分" 这种字符串） */
export function normalizeScore(value: any): number | null {
  if (typeof value === 'number' && isFinite(value)) {
    const num = value > 0 && value <= 1 ? Math.round(value * 100) : Math.round(value)
    return Math.max(0, Math.min(100, num))
  }
  if (typeof value === 'string') {
    const matched = value.match(/-?\d+(?:\.\d+)?/)
    if (!matched) return null
    return normalizeScore(parseFloat(matched[0]))
  }
  return null
}

/** 解析「逐图打分」的返回 */
export function parseScoreResult(raw: string | null, candidates: CandidateImage[]): ScoredCandidate[] {
  const data = extractJsonObject(raw)
  if (!data) return []
  const list = data.scores ?? data.score ?? data.items ?? data.results ?? data.评分
  if (!Array.isArray(list)) return []

  const out: ScoredCandidate[] = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const rawIndex = entry.index ?? entry.id ?? entry.no ?? entry.n ?? entry.编号
    const index = rawIndex === undefined ? null : parseInt(String(rawIndex).replace(/[^0-9-]/g, ''), 10)
    const score = normalizeScore(entry.score ?? entry.points ?? entry.分数 ?? entry.value)
    if (index === null || isNaN(index) || score === null) continue
    // 兼容 0-based 写法，统一换算成从 1 开始
    const candidate = candidates[index - 1] || candidates[index]
    if (!candidate) continue
    out.push({ index: candidates.indexOf(candidate) + 1, score, why: String(entry.why ?? entry.reason ?? entry.说明 ?? '').trim() })
  }
  return out
}

/**
 * 按分数阈值筛选：只有达到 minScore 的才留下，按分数从高到低取前 max 张。
 * 一张都不达标时返回空数组 —— 这是「宁可不选也不乱选」的兜底。
 */
export function selectByScore(
  scored: ScoredCandidate[],
  candidates: CandidateImage[],
  minScore: number,
  max: number
): { picked: CandidateImage[], best: number, passed: number } {
  const threshold = minScore > 0 ? minScore : 0
  // 同一张图若被打了多次分，取最高的一次
  const best = new Map<number, ScoredCandidate>()
  for (const item of scored || []) {
    const prev = best.get(item.index)
    if (!prev || item.score > prev.score) best.set(item.index, item)
  }

  const eligible = [...best.values()]
    .filter(item => item.score >= threshold)
    .sort((a, b) => b.score - a.score)

  const limit = max > 0 ? max : 1
  const picked: CandidateImage[] = []
  for (const item of eligible) {
    if (picked.length >= limit) break
    const candidate = candidates[item.index - 1]
    if (candidate && !picked.includes(candidate)) picked.push(candidate)
  }

  return {
    picked,
    best: (scored || []).reduce((acc, item) => Math.max(acc, item.score), 0),
    passed: eligible.length,
  }
}

/**
 * 去掉重复图：链接相同的直接去掉；描述完全相同的（同一批入库的近似图）只留第一张。
 */
export function dedupeCandidates(list: CandidateImage[]): CandidateImage[] {
  const out: CandidateImage[] = []
  const seenUrl = new Set<string>()
  const seenDesc = new Set<string>()
  for (const item of list || []) {
    if (!item || !item.url || seenUrl.has(item.url)) continue
    const desc = normalizeText(item.description || '')
    // 描述太短（如「无描述」）不参与描述去重，避免误杀
    if (desc.length >= 6) {
      if (seenDesc.has(desc)) continue
      seenDesc.add(desc)
    }
    seenUrl.add(item.url)
    out.push(item)
  }
  return out
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

/**
 * 构造发给选图模型的 user 消息内容。
 * 未开启识别图片时返回纯文本；开启时按「编号文字 + 图片」交替排列，让模型把编号和图片对上。
 * @param text 提示词正文（含 {candidates} 文本列表）
 * @param candidates 候选图片
 * @param vision 是否附带图片
 * @param visionMaxImages 最多附带多少张图片
 * @param dataUrls 已经自己下载好的 base64 data URL（按 candidates 下标）。**传了它之后，
 *   没下载成功的图就不再发原始链接了** —— 上游拉不到那个链接会整条请求 400，
 *   连文字描述一起废掉；只发描述反而还能用。
 */
export function buildSelectorContent(
  text: string,
  candidates: CandidateImage[],
  vision: boolean,
  visionMaxImages: number,
  dataUrls?: (string | undefined)[]
): string | any[] {
  if (!vision) return text

  const max = visionMaxImages > 0 ? visionMaxImages : candidates.length
  const parts: any[] = []
  candidates.forEach((candidate, index) => {
    parts.push({ type: 'text', text: `[${index + 1}] 所属组：${candidate.group} | 描述：${candidate.description || '（无描述）'}` })
    if (index < max) {
      const url = dataUrls ? dataUrls[index] : candidate.url
      if (url) parts.push({ type: 'image_url', image_url: { url } })
    }
  })
  const hintRule = visionMaxImages && candidates.length > 1
    ? `并在 hint 字段中写一段「画面编排」：按选中顺序说明每个角色/元素在画面中的位置和姿态、`
      + `彼此的动作互动与视线关系、共同所处的场景与氛围，以及需要还原的各自外形特征（发型发色、服装、配色、画风）。`
      + `内容要像一段可以直接交给画师的分镜说明，而不是逐张罗列。`
    : `并在 hint 字段中用一句话概括你选中图片的关键视觉特征（如发型、发色、服装、配色、姿态、画风），供后续绘图时还原该参考图。`

  parts.push({
    type: 'text',
    text: `${text}\n\n（上方已按顺序附上候选图片，请结合图片实际内容挑选。${hintRule}仍然只输出 JSON。）`
  })
  return parts
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
      aiSelect?: boolean
      aiMaxSelect?: number
      aiAskUser?: boolean
      /** 该指令是否在开画前请用户确认：'follow' 跟随全局 / 'on' 总是确认 / 'off' 从不确认 */
      confirmBeforeDraw?: 'follow' | 'on' | 'off' | boolean
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
  showPrompt?: boolean
  promptMaxLength?: number
  appendUserInput?: boolean
  promptOptimize?: 'off' | 'merge' | 'rewrite'
  optimizePrompt?: string
  resultGallery?: ResultGalleryConfig
  backgroundDrawing?: BackgroundDrawingConfig
  textRender?: TextRenderConfig
  /** 把处理过程中的多条提示合并成一条消息发出（省被动消息额度） */
  mergeNotifications?: boolean
  /** 指令一触发就立刻回一条「收到」，避免用户以为卡住 */
  ackOnStart?: boolean
  /** AI 选好参考图后先请用户确认再开画 */
  confirmBeforeDraw?: boolean
  /** 等待用户确认的时间（秒） */
  confirmTimeout?: number
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

/** AI 选图配置 */
interface AISelectorConfig {
  enabled: boolean
  baseUrl: string
  apiKey?: string
  model: string
  prompt: string
  maxSelect: number
  temperature: number
  timeout: number
  maxRetries: number
  retryInterval: number
  retryMaxWait: number
  askUser: boolean
  askTimeout: number
  includeAllGroups: boolean
  includeCommandDefaults: boolean
  fallbackOnError: boolean
  notify: boolean
  vision: boolean
  visionMaxImages: number
  /** 识图时单张候选图的体积上限（MB），超过就只发文字描述 */
  visionMaxImageBytes?: number
  visionFallback: boolean
  appendHint: boolean
  twoStage: boolean
  twoStageThreshold: number
  retrievalTopK: number
  keywordPrompt: string
  captionModel: string
  captionPrompt: string
  captionBatch: number
  captionCommand: string
  /** 提示词优化（融合/扩写）用的采样温度，默认 0.7，比选图更有创造性 */
  optimizeTemperature?: number
  /** 输出长度参数名：auto / max_tokens / max_completion_tokens */
  maxTokensParam?: 'auto' | 'max_tokens' | 'max_completion_tokens'
  /** 选图（精排）的输出长度上限。推理模型会把额度耗在思考上，太小会导致正文一个字都生成不出来 */
  selectMaxTokens?: number
  /** 两级检索「关键词」阶段的输出长度上限 */
  keywordMaxTokens?: number
  /** 提示词优化（融合/扩写）的输出长度上限 */
  optimizeMaxTokens?: number
  /** 输出被截断时自动加大，最多加到这个值 */
  maxTokensCeiling?: number
  /** 诊断指令名：发一次选图请求并回显模型原始返回 */
  debugCommand?: string
  /** 选图模式：score = 抽需求+逐图打分（默认）；legacy = 旧的候选全量丢给模型挑 */
  selectionMode?: 'score' | 'legacy'
  /** 打分制的最低分数线（0-100），低于它的图一律不选 */
  minScore?: number
  /** 打分制第一步「需求分析」的提示词模板 */
  analyzePrompt?: string
  /** 打分制第二步「逐图打分」的提示词模板 */
  scorePrompt?: string
  /** 是否合并描述完全相同的重复参考图（默认开） */
  dedupe?: boolean
  /** 用户说「不用参考/随意画」时是否跳过选图（默认开） */
  respectSkipReference?: boolean
}

/** 交给 AI 挑选的候选图片 */
interface CandidateImage {
  group: string
  url: string
  description: string
}

/** AI 选择结果 */
interface SelectionResult {
  picked: CandidateImage[]
  needUserImage: boolean
  askMessage: string
  reason: string
  ok: boolean
  /** 失败原因（如 429 限流），供回显给用户 */
  error?: string
  /** 模型看到图片后给出的关键视觉特征描述（开启识别图片时才有），可并入绘图提示词 */
  hint?: string
  /** 第一阶段产出的检索关键词 */
  keywords?: string[]
  /** 两级检索时从多少张里召回了多少张，用于回显 */
  recalled?: number
  total?: number
  /** 模型认为「画面上需要出现的文字」（台词/标题/字幕），交给浏览器渲染成参考图 */
  renderText?: string
}

const DEFAULT_SELECTOR_PROMPT = `你是一个「参考图片选择助手」。用户正在使用 AI 绘图功能，需要从下方的候选参考图片池中挑选最符合其需求的图片作为绘图参考。

可用参考图片列表（编号 | 所属组 | 描述）：
{candidates}

当前使用的绘图指令：{command}
该指令的用途提示词：{prompt}
用户的附加需求：{userInput}

规则：
1. 仔细阅读每张图片的描述（如果同时附上了图片本身，以图片实际内容为准），挑选最贴合用户需求与指令用途的参考图片，最多选择 {max} 张。
2. 如果候选池里没有任何图片能满足用户需求（缺失关键参考图），将 needUserImage 设为 true，并在 askMessage 中用一句话告诉用户需要补充发送什么样的图片（中文，40 字以内，语气自然，直接对用户说）。
3. 判断这次的画面上**是否需要出现文字**（台词、对白、标题、招牌、字幕等）。需要的话，把要显示的所有文字写进 text 字段：
   - 每行一句，多句用 \\n 换行；只写真正要出现在画面上的字，不要写解释、不要加引号以外的装饰。
   - 一句也不要超过 30 个字，长句请拆成多行。
   - 不需要出现文字就留空字符串。
4. 只输出一个 JSON 对象，不要输出任何解释、Markdown 代码块或多余文字。

输出格式：
{"selected": [编号1,编号2], "reason": "一句话说明选择理由", "needUserImage": false, "askMessage": "", "text": ""}`

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

/** 两级检索第一阶段：让模型产出检索关键词（参考 NeoBot 的 gallery_search 思路） */
const DEFAULT_KEYWORD_PROMPT = `你是一个参考图片检索助手。用户要用 AI 绘图，需要从下面的图片索引里找出可能相关的参考图。

图片索引（编号 | 所属组 | 描述）：
{index}

绘图指令：{command}
指令用途提示词：{prompt}
用户需求：{userInput}

请输出：
1. keywords：3-6 个检索关键词（中文，提炼用户需求里的核心视觉要素，如人物特征、发型发色、服装、动作、画风、场景），
   用于在完整图库里做文本匹配检索。关键词要写得像图片描述里会出现的词。
2. candidates：你从上面索引里直接看中的编号（最多 {topK} 个，可以为空数组）。

只输出一个 JSON 对象，不要输出解释或代码块：
{"keywords":["关键词1","关键词2"],"candidates":[1,3]}`

/** 第一步：只做需求分析，不给候选图 —— 模型没有「挑」的机会，从根上避免乱选 */
const DEFAULT_ANALYZE_PROMPT = `你是绘图参考图的「需求分析助手」。**这一步只做分析，不要挑选任何图片。**

绘图指令：{command}
该指令的用途提示词：{prompt}
用户本次的需求：{userInput}

请先把「这次画面上必须有 / 最好有的视觉要素」想清楚，再输出 JSON。

规则：
1. must（硬性要素）：缺一个就不该选这张参考图。只写**能从图片上看出来的**视觉特征，
   例如角色名、发色发型、瞳色、服装款式、配饰、物种、画风。不要写抽象词（如「好看」「高级」）。
   指令用途提示词里本来就固定的风格（比如「1/7 手办」「透明亚克力底座」）不要写进 must。
2. nice（加分要素）：有更好、没有也能用，例如动作、表情、构图、场景、氛围。
3. avoid：明确不要出现的东西（用户说「不要 XX」「换成 YY」时，把被否掉的那个写这里）。
4. subject：这次画面的主体，一句话（如「白发的少女」）。
5. text：画面上需要出现的文字（台词/标题/招牌/字幕），多行用 \\n 换行；不需要就空字符串。
6. skipReference：用户明确表示「不用参考 / 随意画 / 自由发挥 / 你看着办」时为 true。
7. needTypes：图库里**没有**合适参考图时，插件要请用户补发一张。这里写一句**直接对用户说**的话
   （中文，40 字以内，语气自然，不要用「请提供图片」这种套话），例如「能发一张白发水手服的立绘吗？」。
   **只写这一句**：不要追问第二件事、不要闲聊、不要提到模型名字（如 DeepSeek）、不要写「顺便说说」之类的话。
   图库里不缺图就留空字符串。

只输出一个 JSON 对象，不要解释、不要 Markdown 代码块：
{"subject":"","must":[],"nice":[],"avoid":[],"text":"","skipReference":false,"needTypes":""}`

/** 第二步：逐图显式打分 —— 强制给每张打分 + 硬性要素缺失即判低分，杜绝"硬凑数" */
const DEFAULT_SCORE_PROMPT = `你是绘图参考图的「打分助手」。下面是已经分析好的需求，以及若干候选参考图。
**你的任务是给每一张候选图打分，而不是挑出「最像的」来凑数。**

本次需求：
主体：{subject}
硬性要素（缺一个就不合格）：{must}
加分要素：{nice}
不要出现：{avoid}

候选参考图（编号 | 所属组 | 描述）：
{candidates}

打分规则：
1. **必须给每一张候选图都打一个 0-100 的分数**，一张都不能漏。
2. 打分只看「这张图能不能当本次绘图的参考」：
   - 硬性要素命中得越多分越高；**硬性要素缺失或与需求矛盾 → 只能给 0-30 分**。
   - 描述为空、看不懂内容、无法判断的图 → **一律给 0 分**，不要靠猜。
   - 与 avoid 冲突的 → 0 分。
   - 命中加分要素、或组名/描述与需求高度吻合 → 可以给 80-100。
3. **宁可漏选，不可乱选。** 拿不准就打低分。给不相关的图打高分是最严重的错误。
4. 如果所有候选都不合适，就照实全部打低分，**不要为了凑数抬高分数**。
5. why 用不超过 15 个字说明理由，例如「命中白发+水手服」「描述为空无法判断」。
6. hint（可选）：**只有在你实际看到了图片时**才填 —— 用一句话概括选中图片里决定外观的关键视觉特征
   （发色发型/瞳色/服装/配饰/画风），便于并入绘图提示词；只给了文字描述就留空字符串。

只输出一个 JSON 对象，不要解释、不要 Markdown 代码块：
{"scores":[{"index":1,"score":85,"why":"命中白发双马尾"},{"index":2,"score":0,"why":"描述为空"}],"hint":""}`

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
          referenceGroups: Schema.array(Schema.string()).description('引用的参考图片组名称（AI 将从这些组中挑选图片，留空则由「AI 选图设置」决定是否使用全部组）').default([]),
          aiSelect: Schema.boolean().default(true).description('启用 AI 智能选择参考图片'),
          aiMaxSelect: Schema.number().default(0).min(0).max(10).step(1).description('AI 最多为该指令选择的参考图片数量（0 = 跟随「AI 选图设置」里的全局数量）'),
          aiAskUser: Schema.boolean().default(true).description('缺少合适参考图时询问用户补充发送'),
          confirmBeforeDraw: Schema.union([
            Schema.const('follow').description('跟随全局设置'),
            Schema.const('on').description('开画前请用户确认'),
            Schema.const('off').description('选好图直接开画'),
          ]).default('follow').description('该指令是否在开画前请用户确认'),
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
      enabled: Schema.boolean().default(false).description('启用 AI 智能选择参考图片（默认关闭，需要时手动开启）'),
      selectionMode: Schema.union([
        Schema.const('score').description('打分制（推荐）：先分析需求 → 关键词召回 → 逐图打分 → 分数不够就如实说「没有合适的图」'),
        Schema.const('legacy').description('旧版：把候选图全部丢给模型一次挑完（容易硬凑数，仅在需要兼容时使用）'),
      ]).default('score').description('选图模式。打分制会给模型留退路，不会在没有合适图时硬挑一张'),
      minScore: Schema.number().default(60).min(0).max(100).step(5).description('打分制的最低分数线（0-100）。低于该分数的参考图一律不选；全部不达标就判定「图库没有合适的图」并询问用户补图'),
      dedupe: Schema.boolean().default(true).description('合并重复参考图（链接相同，或描述完全相同的近似图只保留一张）'),
      respectSkipReference: Schema.boolean().default(true).description('用户说「不用参考 / 随意画 / 自由发挥」时跳过选图，一次选图请求都不发（需求分析也省掉）'),
      baseUrl: Schema.string().role('link').description('AI 选图接口地址（OpenAI 兼容 Chat Completions，留空则复用绘图接口地址）'),
      apiKey: Schema.string().role('secret').description('AI 选图接口密钥（留空则复用绘图 API 密钥）'),
      model: Schema.string().default('Qwen/Qwen2.5-7B-Instruct').description('用于选择参考图片的对话模型'),
      prompt: Schema.string().role('textarea', { rows: [12, 6] }).default(DEFAULT_SELECTOR_PROMPT).description('选择提示词模板，可用占位符：{candidates} 候选图片列表、{userInput} 用户附加需求、{max} 最多选择数量、{command} 指令名、{prompt} 指令提示词'),
      maxSelect: Schema.number().default(1).min(1).max(10).step(1).description('默认最多选择的参考图片数量（指令内可单独覆盖）'),
      temperature: Schema.number().default(0.2).min(0).max(2).step(0.1).description('采样温度（越低越稳定）'),
      timeout: Schema.number().default(60).min(10).max(300).step(5).description('请求超时时间（秒）'),
      maxRetries: Schema.number().default(2).min(0).max(5).step(1).description('请求失败重试次数（0 表示不重试）'),
      retryInterval: Schema.number().default(3000).min(500).max(30000).step(500).description('重试基础间隔（毫秒）；遇到 429/限流会在此基础上指数退避，并优先遵循响应头的 Retry-After'),
      retryMaxWait: Schema.number().default(20).min(0).max(120).step(5).description('单次重试最长等待时间（秒），超过则不再重试（0 表示不限）'),
      askUser: Schema.boolean().default(true).description('缺少合适参考图时询问用户补充发送'),
      askTimeout: Schema.number().default(60).min(10).max(120).step(5).description('等待用户补充发送图片的时间（秒）'),
      includeAllGroups: Schema.boolean().default(true).description('指令未指定组时，允许 AI 从全部参考图片组中挑选'),
      includeCommandDefaults: Schema.boolean().default(false).description('把指令的「默认图片URL列表」也纳入 AI 候选池'),
      fallbackOnError: Schema.boolean().default(false).description('AI 选图失败时回退为使用候选池内全部图片（默认关闭，失败则不使用参考图）'),
      notify: Schema.boolean().default(true).description('在处理提示中附带 AI 选图结果'),
      vision: Schema.boolean().default(false).description('选图模型支持识别图片（多模态/VL）。开启后会把候选图片本身一起发给模型，而不只是发文字描述，选得更准（需要图片链接能被模型访问）'),
      visionMaxImages: Schema.number().default(6).min(1).max(20).step(1).description('开启识别图片时，最多附带多少张候选图片（超出部分只发文字描述，避免请求过大）'),
      visionMaxImageBytes: Schema.number().default(4).min(0).max(32).step(1).description('识图时单张候选图的体积上限（MB）。插件会先把图片自己下载下来转成 base64 再发给选图模型（上游拉不到你的图片链接时会整条请求 400），超过上限的只发文字描述'),
      visionFallback: Schema.boolean().default(true).description('带图片请求失败时，自动退回纯文字再试一次'),
      appendHint: Schema.boolean().default(true).description('把模型看图后给出的关键视觉特征并入绘图提示词（仅在开启识别图片时生效，让出图更还原参考图）'),
      twoStage: Schema.boolean().default(true).description('【仅旧版模式生效】两级检索选图：先让模型产出检索关键词并在本地召回，再对召回结果精排。打分制已内置召回，无需此项'),
      twoStageThreshold: Schema.number().default(12).min(2).max(200).step(1).description('候选图片超过多少张才启用两级检索（少于此值直接一次问完，更省事）'),
      retrievalTopK: Schema.number().default(12).min(1).max(50).step(1).description('第一级召回的候选数量上限（精排只看这么多张）'),
      keywordPrompt: Schema.string().role('textarea', { rows: [10, 6] }).default(DEFAULT_KEYWORD_PROMPT).description('检索提示词模板，可用占位符：{index} 图片索引、{userInput} 用户附加需求、{command} 指令名、{prompt} 指令提示词、{topK} 召回上限'),
      analyzePrompt: Schema.string().role('textarea', { rows: [12, 6] }).default(DEFAULT_ANALYZE_PROMPT).description('（打分制第一步）需求分析提示词，可用占位符：{command} 指令名、{prompt} 指令提示词、{userInput} 用户附加需求。这一步**不把候选图给模型**，所以模型没有乱选的机会'),
      scorePrompt: Schema.string().role('textarea', { rows: [12, 6] }).default(DEFAULT_SCORE_PROMPT).description('（打分制第二步）逐图打分提示词，可用占位符：{subject} 主体、{must} 硬性要素、{nice} 加分要素、{avoid} 不要出现、{candidates} 候选图片列表、{max} 最多选择数量'),
      captionCommand: Schema.string().default('生成描述').description('自动生成描述的指令名（挂在指令根下；直接发图则只识别并返回描述）'),
      captionModel: Schema.string().description('生成描述用的模型（留空则用上面的选图模型；必须是支持图片输入的模型）'),
      captionPrompt: Schema.string().role('textarea', { rows: [8, 4] }).default(DEFAULT_CAPTION_PROMPT).description('生成描述的提示词（要求模型写出便于检索的关键词）'),
      captionBatch: Schema.number().default(8).min(1).max(50).step(1).description('一次指令最多为多少张参考图生成描述（避免请求过多被限流）'),
      optimizeTemperature: Schema.number().default(0.7).min(0).max(2).step(0.1).description('提示词优化（融合/扩写）用的采样温度，比选图高一些更有创造性'),
      maxTokensParam: Schema.union([
        Schema.const('auto').description('自动（o1/o3/gpt-5/reasoner 等推理模型用 max_completion_tokens）'),
        Schema.const('max_tokens').description('始终用 max_tokens'),
        Schema.const('max_completion_tokens').description('始终用 max_completion_tokens（新模型不支持 max_tokens 时会返回空内容）'),
      ]).default('auto').description('输出长度参数名。模型不支持 max_tokens 时会返回空内容，导致「响应中没有文本内容」'),
      debugCommand: Schema.string().default('测试选图').description('诊断指令名（挂在指令根下）：发一次选图请求并回显模型原始返回，用于排查「没有文本内容」'),
      selectMaxTokens: Schema.number().default(8000).min(0).max(64000).step(500).description('选图（精排）的输出长度上限。**推理模型（DeepSeek-V4.1-Flash 等）会把额度耗在思考上**，太小会导致正文一个字都生成不出来，报「响应中没有文本内容」。0 = 不限制'),
      keywordMaxTokens: Schema.number().default(3000).min(0).max(64000).step(500).description('两级检索「关键词」阶段的输出长度上限（0 = 不限制）'),
      optimizeMaxTokens: Schema.number().default(8000).min(0).max(64000).step(500).description('提示词优化（融合/扩写）的输出长度上限（0 = 不限制）'),
      maxTokensCeiling: Schema.number().default(32000).min(1000).max(128000).step(1000).description('输出被截断时自动加大上限，最多加到这个值'),
    }).collapse().description('AI 选图配置项（提示词较长，已折叠）'),
  }).description('AI 选图设置'),

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
    mergeNotifications: Schema.boolean().default(true).description('把「选图结果 / 正在处理 / 优化后提示词」合并成**一条**消息发出（QQ 被动回复有次数上限，消息越少越稳）'),
    ackOnStart: Schema.boolean().default(true).description('指令一触发就立刻回一条「收到，正在准备...」。后面的「优化提示词 + AI 选图」是两轮模型请求、可能要几十秒，不发这条用户会以为机器人卡住了'),
    confirmBeforeDraw: Schema.boolean().default(true).description('AI 选好参考图后**先请用户确认再开始画**（把「本次参考这几张图」列出来，回复「确认」才画）。可防止选错参考图白画一张'),
    confirmTimeout: Schema.number().default(60).min(5).max(300).step(5).description('等待用户确认的时间（秒），超时按取消处理；0 = 不限时'),
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
          confirmask: '准备开始绘图，本次会参考：\n{0}\n\n回复「确认」开始画（{1} 秒内未确认则取消）',
          confirmcancel: '未收到确认，已取消本次绘图',
          confirmok: '已确认，开始绘图...',
          failed: '图片生成失败，请稍后重试',
          error: '处理过程中发生错误，请稍后重试',
          needprompt: '请提供自定义提示词',
          needimages: '请提供至少一张图片',
          selecting: '正在智能挑选参考图片...',
          selectfailed: 'AI 选图失败（{0}），已改用全部候选参考图片',
          selectfailedNoFallback: 'AI 选图失败（{0}），本次不使用参考图片',
          nomatch: '图库里没有合适的参考图：{0}',
          selected: '已为你挑选参考图片：\n{0}',
          askimage: '{0}\n请在{1}秒内发送图片...',
          askimageDefault: '候选参考图片里没有合适的图片，需要你补充一张参考图',
          noask: '未收到补充图片，继续处理',
          gotimage: '已收到补充图片，继续处理...',
          recalled: '（参考图检索：{0} 张中命中 {1} 张候选）',
          hintsingle: '参考图关键特征（务必还原）：{0}',
          hintscene: '画面编排（务必还原）：{0}',
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

          const quote = h.quote(session.messageId)
          const customCommand = cmdConfig.custom || false
          const maxImages = cmdConfig.maxImages || 0 // 用户需要提供的图片数量
          const waitTimeout = cmdConfig.waitTimeout || config.defaultWaitTimeout
          const defaultImageUrls = cmdConfig.defaultImageUrls || [] // 多个默认图片URL

          let promptText = cmdConfig.prompt
          let images: string[] = []
          let userImages: string[] = []

          // AI 选图相关开关
          const selector: AISelectorConfig = config.aiSelector || ({} as AISelectorConfig)
          const aiSelectOn = selector.enabled !== false && cmdConfig.aiSelect !== false
          // 指令级为 0（默认）时跟随全局数量；否则以指令级为准
          const aiMaxSelect = (cmdConfig.aiMaxSelect || 0) > 0 ? cmdConfig.aiMaxSelect : (selector.maxSelect || 1)
          const aiAskOn = cmdConfig.aiAskUser !== false && selector.askUser !== false
          const aiAskTimeout = selector.askTimeout || waitTimeout

          // 用户随指令附带的文本（并入提示词，同时也作为 AI 选图的参考）
          // 必须用指令参数 message：session.stripped.content 是整条消息，会把指令名一起带进来
          let userInputText = ''
          if (message) userInputText = String(message).trim()
          if (!userInputText) {
            userInputText = stripCommandName(extractTextFromMessage(session.stripped.content), cmdConfig.name)
          }
          logInfo(`用户附加需求: ${userInputText || '（无）'}`)

          // ============ 立刻回一条「收到」 ============
          // 后面「优化提示词 + AI 选图」是两轮模型请求，加起来可能要几十秒，
          // 期间一句话都不发，用户会以为机器人在卡死（连指令有没有被识别都不知道）。
          if (config.ackOnStart !== false) {
            try {
              await reply(session, [session.text('image-prompt.messages.ack')])
            } catch (error) {
              ctx.logger.warn(`发送「收到」提示失败: ${error}`)
            }
          }

          // ============ 合并消息（省 QQ 被动消息额度） ============
          // 「正在选图 / 处理中 / 优化后的提示词」先攒着，最后合成一条发出去。
          // 只有需要用户立刻回应（等你发图）时才提前 flush。
          const noticeLines: string[] = []
          const notify = (text: any) => {
            const value = String(text ?? '').trim()
            if (value) noticeLines.push(value)
          }
          async function flushNotice(): Promise<void> {
            if (!noticeLines.length) return
            const lines = noticeLines.slice()
            noticeLines.length = 0

            const md = supportsMarkdown(session.platform)
            const send = (text: string) => reply(session, [md ? h('markdown', text) : text])
            const merged = lines.join('\n').trim()
            if (!merged) return

            // QQ markdown 单条有长度上限：整体放不下就把提示词块拆成第二条，
            // 宁可多一条也不能整条发不出去
            if (merged.length <= 4000) {
              await send(merged)
              return
            }
            const fenceAt = lines.findIndex(line => line.includes('```'))
            if (fenceAt > 0) {
              const head = lines.slice(0, fenceAt).join('\n').trim()
              const tail = lines.slice(fenceAt).join('\n').trim()
              if (head) await send(head)
              await send(tail)
              return
            }
            await send(merged)
          }

          // 添加所有默认图片（若交给 AI 挑选，则不在此时直接加入）
          if (defaultImageUrls.length > 0 && !(aiSelectOn && selector.includeCommandDefaults)) {
            images.push(...defaultImageUrls)
            logInfo(`添加 ${defaultImageUrls.length} 张默认图片`)
          }

          // 自定义指令：本身没有提示词、用户也没给文本时，向用户索要
          if (customCommand && !promptText && !userInputText) {
            const [msgId] = await session.send(session.text("image-prompt.messages.customprompt", [waitTimeout]))
            const userPrompt = await session.prompt(waitTimeout * 1000)

            try {
              await session.bot.deleteMessage(session.channelId, msgId)
            } catch {
              ctx.logger.warn(`在频道 ${session.channelId} 尝试撤回消息ID ${msgId} 失败。`)
            }

            if (userPrompt) {
              userInputText = extractTextFromMessage(userPrompt) || String(userPrompt).trim()
            } else {
              await reply(session, [session.text("image-prompt.messages.needprompt")])
              return
            }
          }

          let optimizeFailed = false

          // 用户随指令发的附加需求并入绘图提示词（自定义指令、普通指令都生效）
          // 例如「手办化 xxx 在偷吃白饭被发现的表情」——否则只会被拿去选图，画图时丢掉
          if (userInputText && config.appendUserInput !== false) {
            promptText = mergePrompt(promptText, userInputText, true)
            logInfo(`已并入用户附加需求: ${userInputText}`)

            // 融合重写：把需求写进提示词对应位置，而不是贴在最后
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

          // ================== AI 智能选择参考图片 ==================
          let selectionNote = ''
          let aiProvidedImages = 0 // AI 选中的参考图数量（计入「还需用户提供」的抵扣）
          let aiRenderText = '' // 选图模型认为画面上要出现的文字（台词/标题/字幕）
          // 本次要参考的图片清单（给「开画前确认」用）
          const refDescs: string[] = []
          if (aiSelectOn) {
            const candidates = collectCandidates(cmdConfig, defaultImageUrls)
            const declaredGroups = (cmdConfig.referenceGroups || []).filter(Boolean)
            logInfo(`AI 选图候选图片数量: ${candidates.length}`)

            if (candidates.length > 0) {
              // 合并模式下不再单独发「正在挑选」（那条本来也要撤回，白占一次被动消息额度）
              if (config.mergeNotifications === false) {
                const [selMsgId] = await reply(session, [session.text('image-prompt.messages.selecting')])
                try {
                  await session.bot.deleteMessage(session.channelId, selMsgId)
                } catch {
                  ctx.logger.warn(`在频道 ${session.channelId} 尝试撤回消息ID ${selMsgId} 失败。`)
                }
              } else {
                notify(session.text('image-prompt.messages.selecting'))
              }
              let selection = await runAISelection(candidates, userInputText, cmdConfig, promptText, aiMaxSelect)

              // AI 判定缺少合适的参考图片 -> 询问用户补充发送
              if (selection.needUserImage && aiAskOn) {
                const askText = selection.askMessage || session.text('image-prompt.messages.askimageDefault')
                await flushNotice()
                const answer = await askUserForImage(session, quote, askText, aiAskTimeout)

                if (answer) {
                  const extra = extractImagesFromMessage(answer)
                  const extraText = extractTextFromMessage(answer)
                  if (extra.length > 0) {
                    userImages.push(...extra)
                    notify(session.text('image-prompt.messages.gotimage'))
                  }
                  if (extraText) {
                    // 带上用户的补充说明重新挑选一次
                    selection = await runAISelection(
                      candidates,
                      `${userInputText}\n用户补充说明：${extraText}`.trim(),
                      cmdConfig, promptText, aiMaxSelect
                    )
                  }
                } else {
                  notify(session.text('image-prompt.messages.noask'))
                }
              }

              if (selection.ok && selection.picked.length > 0) {
                images.push(...selection.picked.map(c => c.url))
                aiProvidedImages += selection.picked.length
                for (const c of selection.picked) refDescs.push(`【图库】${c.description || c.url}`)
                logInfo(`AI 选中参考图片: ${selection.picked.map(c => c.url).join(' , ')} 理由: ${selection.reason}`)

                // 模型看图后给出的特征/画面编排并入绘图提示词（仅识别图片模式）
                if (selector.vision === true && selector.appendHint !== false && selection.hint) {
                  const hintKey = selection.picked.length > 1 ? 'hintscene' : 'hintsingle'
                  promptText = `${promptText}\n\n${session.text(`image-prompt.messages.${hintKey}`, [selection.hint])}`
                  logInfo(`AI 看图得到的${selection.picked.length > 1 ? '画面编排' : '关键特征'}: ${selection.hint}`)
                }

                if (selector.notify) {
                  selectionNote = '\n' + session.text('image-prompt.messages.selected', [
                    selection.picked.map((c, i) => `${i + 1}. ${c.description || c.url}`).join('\n')
                  ])
                  if (selection.recalled && selection.total) {
                    selectionNote += '\n' + session.text('image-prompt.messages.recalled', [selection.total, selection.recalled])
                  }
                }
                // 选图模型自己给出的「画面上要出现的文字」，后面交给浏览器渲染成参考图
                if (selection.renderText) {
                  aiRenderText = selection.renderText
                  logInfo(`选图模型给出需要渲染的文字: ${aiRenderText.replace(/\n/g, ' / ')}`)
                }
              } else if (selection.ok && selection.picked.length === 0) {
                // 打分制判定「图库确实没有合适的图」：如实告诉用户，**不**回退成
                // 「把候选全塞进去」—— 那正是以前「乱选参考图」的根源。
                // 说明文字留在 selectionNote 里，后面无论是询问用户补图、
                // 还是最终因为一张图都没有而中止，用户都能看到原因。
                logInfo(`[${cmdConfig.name}] 没有参考图达到阈值：${selection.reason}`)
                if (selector.notify) {
                  selectionNote = '\n' + session.text('image-prompt.messages.nomatch', [
                    selection.reason || '无匹配',
                  ])
                }
              } else if (!selection.ok) {
                ctx.logger.warn(`[${cmdConfig.name}] AI 选图失败，fallbackOnError=${selector.fallbackOnError}`)
                if (selector.fallbackOnError) {
                  images.push(...candidates.map(c => c.url))
                  aiProvidedImages += candidates.length
                }
                // 无论是否回退，都告知用户选图未生效及原因
                if (selector.notify) {
                  selectionNote = '\n' + session.text(
                    selector.fallbackOnError
                      ? 'image-prompt.messages.selectfailed'
                      : 'image-prompt.messages.selectfailedNoFallback',
                    [selection.error || '未知原因']
                  )
                }
              }
            } else if (aiAskOn && declaredGroups.length > 0) {
              // 指令声明了参考图片组，但组内没有任何可用图片 -> 直接询问用户发送
              await flushNotice()
              const answer = await askUserForImage(
                session,
                quote,
                session.text('image-prompt.messages.askimageDefault'),
                aiAskTimeout
              )
              if (answer) {
                const extra = extractImagesFromMessage(answer)
                if (extra.length > 0) {
                  userImages.push(...extra)
                  notify(session.text('image-prompt.messages.gotimage'))
                }
              } else {
                notify(session.text('image-prompt.messages.noask'))
              }
            }
          }

          // 收集用户提供的图片（不包括默认图片与 AI 选中的参考图）
          const sessionImages = extractImagesFromSession(session)
          const extractedImages = [...sessionImages, ...userImages]
          images.push(...extractedImages)
          extractedImages.forEach((_, i) => refDescs.push(`【你发送的】第 ${i + 1} 张`))

          // 计算还需要用户提供的图片数量（AI 选中的参考图也算数，已有图就不再追问）
          const providedImages = extractedImages.length + aiProvidedImages
          const remainingImages = Math.max(0, maxImages - providedImages)
          if (aiProvidedImages > 0 && remainingImages === 0) {
            logInfo(`AI 已提供 ${aiProvidedImages} 张参考图，不再要求用户发送图片`)
          }

          // 如果还需要用户提供图片，等待用户发送
          if (remainingImages > 0) {
            await flushNotice()
            const [msgId] = await session.send(
              session.text("image-prompt.messages.waitpromptmultiple", [waitTimeout, remainingImages])
            )

            try {
              for (let i = 0; i < remainingImages; i++) {
                const promptContent = await session.prompt(waitTimeout * 1000)
                if (promptContent !== undefined) {
                  const newImages = extractImagesFromMessage(promptContent)
                  images.push(...newImages)
                  newImages.forEach(() => refDescs.push('【你发送的】补发的图'))
                } else {
                  break
                }
              }
            } finally {
              try {
                await session.bot.deleteMessage(session.channelId, msgId)
              } catch {
                ctx.logger.warn(`在频道 ${session.channelId} 尝试撤回消息ID ${msgId} 失败。`)
              }
            }
          }

          // ================== 文字渲染参考图 ==================
          // 优先级：手动「渲染文字」指令暂存的 > 选图模型自己写出来的台词 > 从提示词里正则识别的
          // 渲染结果只给绘图模型用（选图模型自己知道写了什么，不需要再发回去）
          let textRef: { file: { data: any, mime: string }, text: string } | null = null
          if (config.textRender?.enabled) {
            textRef = await resolveTextReference(session, promptText, userInputText, aiRenderText)
            if (textRef) {
              const preview = textRef.text.length > 40 ? `${textRef.text.slice(0, 40)}…` : textRef.text
              selectionNote += '\n' + session.text('image-prompt.messages.textrenderAttached', [preview])
              // 提醒绘图模型：画面上的文字以参考图为准，不要自己胡编字形
              promptText = `${promptText}\n\nText in the image must be rendered exactly as shown in the attached text-reference image; copy the glyphs precisely, never distort or invent characters.`
              logInfo('已附加文字渲染参考图')
              if (config.textRender?.sendPreview !== false) {
                await reply(session, [session.text('image-prompt.messages.textrenderPreview'), h.image(textRef.file.data, 'image/png')])
              }
            }
          }

          // 检查是否有图片（文字参考图也算一张图）
          if (images.length === 0 && !textRef) {
            // 带上选图说明：图库里没有匹配时不至于只丢一句「请提供至少一张图片」，
            // 用户能马上知道是「图库没匹配上」还是「自己忘了发图」。
            await reply(session, [session.text("image-prompt.messages.needimages") + selectionNote])
            return
          }

          logInfo(images)

          // 回显优化后的提示词：合并模式下要纯文本的围栏（和上面几条合成一条 markdown）
          const promptEcho = config.showPrompt === false
            ? ''
            : buildPromptBlock(promptText, config.promptMaxLength || 4000)

          // 开画前是否要用户确认：指令级 'on'/'off' 覆盖全局，'follow'/未填跟随全局
          const confirmMode = cmdConfig.confirmBeforeDraw
          const confirmOn = confirmMode === 'off' || confirmMode === false
            ? false
            : confirmMode === 'on' || confirmMode === true
              ? true
              : config.confirmBeforeDraw !== false
          const confirmTimeout = typeof config.confirmTimeout === 'number' ? config.confirmTimeout : 60

          try {
            if (config.mergeNotifications === false) {
              await reply(session, [session.text('image-prompt.messages.processing') + selectionNote
                + (optimizeFailed ? '\n' + session.text('image-prompt.messages.optimizefailed') : '')])
              if (promptEcho) {
                await session.send([supportsMarkdown(session.platform) ? h('markdown', promptEcho) : promptEcho])
              }
            } else {
              // 攒成一条：状态说明 + 提示词代码块（围栏独占一行，不会被前文顶到行中）
              notify(session.text('image-prompt.messages.processing') + selectionNote
                + (optimizeFailed ? '\n' + session.text('image-prompt.messages.optimizefailed') : ''))
              notify(promptEcho)
            }

            // 下载所有图片
            const files = await Promise.all(
              images.map(src => ctx.http.file(src).catch(err => {
                ctx.logger.error(`下载图片失败: ${src}`, err)
                return null
              }))
            ).then(results => results.filter(Boolean))

            // 文字参考图直接以字节并入，不需要再下载
            if (textRef) files.push(textRef.file)

            if (files.length === 0) {
              await reply(session, [session.text("image-prompt.messages.invalidimage")])
              return
            }

            // ============ 开画前确认 ============
            // 到这一步 AI 已经把参考图挑完了。直接把画发出去太亏 —— 万一挑错，
            // 用户只能白等一张图。所以先把「这次会参考哪几张」摆出来，回复「确认」才开画。
            if (confirmOn) {
              const refList = refDescs.length
                ? refDescs.map((desc, i) => `${i + 1}. ${desc}`).join('\n')
                : `（图库里没有匹配的参考图，将按提示词生成，共 ${files.length} 张输入）`
              notify(session.text('image-prompt.messages.confirmask', [
                refList,
                confirmTimeout > 0 ? String(confirmTimeout) : '不限',
              ]))
              // 必须先把清单发出去：用户得知道自己在确认什么
              await flushNotice()
              const confirmed = await waitForConfirm(session, confirmTimeout)
              if (!confirmed) {
                await reply(session, [session.text('image-prompt.messages.confirmcancel')])
                return
              }
              notify(session.text('image-prompt.messages.confirmok'))
            }

            // 后台绘图：先把消息还给用户，出图在后台跑，完成后主动推送
            if (config.backgroundDrawing?.enabled) {
              const snapshot = {
                bot: session.bot,
                channelId: session.channelId,
                guildId: session.guildId,
                messageId: session.messageId,
                promptText,
                commandName: cmdConfig.name,
                texts: {
                  done: session.text('image-prompt.messages.bgdone'),
                  failed: session.text('image-prompt.messages.failed'),
                  error: session.text('image-prompt.messages.error')
                }
              }
              const queued = enqueueDrawJob(snapshot, files)
              // 只补「已开始后台绘图」这一行。**不要**再把 selectionNote / promptEcho
              // 加一遍 —— 上面已经进过 noticeLines 队列了，再加就会连同提示词一起发两遍。
              notify(`${session.text('image-prompt.messages.bgstart', [files.length])}${queued > 0 ? session.text('image-prompt.messages.bgqueue', [queued]) : ''}`)
              await flushNotice()
              return
            }

            // 合并消息要在**开始画之前**发：不然整个绘图期间一条消息都没有，用户会以为卡住了
            await flushNotice()

            const result = await generateFigureImage(files, promptText)

            if (result) {
              await saveToGallery(result, buildGalleryDescription(promptText, userInputText), cmdConfig.name)
              await sendResultImage(session, result, cmdConfig.name)
              return
            } else {
              return session.text('image-prompt.messages.failed')
            }
          } catch (error) {
            ctx.logger.error(`[${cmdConfig.name}] 处理图片时发生错误:`, error)
            return session.text('image-prompt.messages.error')
          }
        })
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
        content,
        false,
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
        // 纯文本模型会在这里失败，给出明确指引
        if (selector.vision !== true && !selector.captionModel) {
          ctx.logger.warn('生成描述需要支持图片输入的模型：请勾选「选图模型支持识别图片」或单独填写「生成描述用的模型」')
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
     * 选图入口。
     *
     * 默认走「打分制」（selectionMode = 'score'）：
     *   需求分析（不给候选）→ 关键词召回 → 逐图显式打分 → 分数够不到阈值就不要
     * 这套流程的要点是**给模型留退路**：候选项不达标时它可以一张都不选，
     * 而不是像以前那样被逼着从一堆图里挑一张出来凑数。
     *
     * 传 selectionMode = 'legacy' 可回到旧的「候选全量丢给模型挑」逻辑。
     */
    async function runAISelection(
      candidates: CandidateImage[],
      userInput: string,
      cmdConfig: CommandConfig['nested']['commands'][number],
      promptText: string,
      max: number
    ): Promise<SelectionResult> {
      const selector: AISelectorConfig = config.aiSelector || ({} as AISelectorConfig)

      if (selector.selectionMode !== 'legacy') {
        return runScoredSelection(candidates, userInput, cmdConfig, promptText, max)
      }

      const threshold = selector.twoStageThreshold || 12
      if (selector.twoStage !== false && candidates.length > threshold) {
        const result = await runTwoStageSelection(candidates, userInput, cmdConfig, promptText, max)
        // 两级检索没召回任何东西（关键词没命中）时，退回单阶段全量问一次
        if (result.ok || result.needUserImage) return result
        ctx.logger.warn('两级检索未召回候选，退回单阶段全量选择')
      }

      return runSingleStageSelection(candidates, userInput, cmdConfig, promptText, max)
    }

    /**
     * 打分制选图（默认）：
     *
     * 1. 需求分析 —— 只给指令和用户需求，**不给任何候选图**。
     *    模型没有「可挑的对象」，自然不可能乱选，只会老实说清「这次要什么」。
     * 2. 本地召回 —— 拿分析出的硬性/加分要素做关键词匹配，把候选池缩到十几张。
     * 3. 逐图打分 —— 要求模型给**每一张**打 0-100 分，并强制「硬性要素缺失就给低分、
     *    描述为空一律 0 分、拿不准就打低分」。
     * 4. 阈值兜底 —— 达不到 minScore 的一律丢弃；一张都不够就如实回「没有合适的图」，
     *    交给上层去问用户补图，而不是硬塞一张不相关的图进参考。
     */
    async function runScoredSelection(
      candidates: CandidateImage[],
      userInput: string,
      cmdConfig: CommandConfig['nested']['commands'][number],
      promptText: string,
      max: number
    ): Promise<SelectionResult> {
      const selector: AISelectorConfig = config.aiSelector || ({} as AISelectorConfig)
      const minScore = typeof selector.minScore === 'number' ? selector.minScore : 60
      const topK = selector.retrievalTopK || 12
      const respectSkip = selector.respectSkipReference !== false

      // ---- 0. 用户明说「不用参考」就省掉请求 ----
      if (respectSkip && isSkipReferenceInput(userInput)) {
        logInfo('用户表示不需要参考图，跳过选图')
        return { picked: [], needUserImage: false, askMessage: '', reason: '用户表示不需要参考图', ok: true }
      }

      // ---- 1. 需求分析（不给候选）----
      const analyzeContent = (selector.analyzePrompt || DEFAULT_ANALYZE_PROMPT)
        .replace(/\{command\}/g, cmdConfig.name || '')
        .replace(/\{prompt\}/g, promptText || '')
        .replace(/\{userInput\}/g, userInput || '（用户未附加说明）')

      const analysisCall = await callSelectorModel(
        analyzeContent, analyzeContent, false, selector.keywordMaxTokens || 3000,
        '你是绘图参考图需求分析助手，只输出 JSON，不要挑选图片。'
      )
      const analysis = parseAnalysisResult(analysisCall.raw)
      if (!analysis) {
        return {
          picked: [], needUserImage: false, askMessage: '', reason: '', ok: false,
          error: analysisCall.error || '需求分析没有返回可解析的结果',
        }
      }
      logInfo(`需求分析：主体=${analysis.subject || '（无）'} 硬性=${JSON.stringify(analysis.must)} 加分=${JSON.stringify(analysis.nice)}`)

      if (analysis.skipReference && respectSkip) {
        logInfo('需求分析判定本次不需要参考图')
        return {
          picked: [], needUserImage: false, askMessage: '', reason: '本次不需要参考图',
          ok: true, keywords: keywordsFromAnalysis(analysis),
        }
      }

      // ---- 2. 召回 ----
      const pool = selector.dedupe === false ? candidates : dedupeCandidates(candidates)
      const keywords = keywordsFromAnalysis(analysis)
      const matched = matchCandidatesByKeywords(pool, keywords, topK)
      // 关键词没命中就退化成「全量截断」：评分阈值会兜住乱选，不会因为召回空就放弃
      const shortlist = matched.length > 0 ? matched : pool.slice(0, Math.max(topK, 1) * 2)
      logInfo(`关键词召回 ${shortlist.length}/${pool.length} 张进入打分（关键词：${keywords.join('/') || '无'}）`)

      if (shortlist.length === 0) {
        return {
          picked: [], needUserImage: true, askMessage: analysis.needTypes, reason: '候选池里没有图片',
          ok: true, keywords, recalled: 0, total: pool.length, renderText: analysis.text || undefined,
        }
      }

      // ---- 3. 逐图打分（开了识图就把召回图的图片本身一起发过去）----
      const scoreContent = (selector.scorePrompt || DEFAULT_SCORE_PROMPT)
        .replace(/\{subject\}/g, analysis.subject || '（未指定）')
        .replace(/\{must\}/g, analysis.must.length ? analysis.must.join('、') : '（无）')
        .replace(/\{nice\}/g, analysis.nice.length ? analysis.nice.join('、') : '（无）')
        .replace(/\{avoid\}/g, analysis.avoid.length ? analysis.avoid.join('、') : '（无）')
        .replace(/\{candidates\}/g, buildIndexText(shortlist))
        .replace(/\{max\}/g, String(max))

      const visionOn = selector.vision === true
      // 识图模式：候选图先自己下载成 base64。直接把原 URL 交给上游，
      // 上游拉不到（私有 CDN / 防盗链）会整条请求 400，连文字描述一起废掉。
      const inlined = visionOn
        ? await inlineCandidateImages(shortlist, selector.visionMaxImages || 6)
        : undefined
      const scoreUserContent = buildSelectorContent(
        scoreContent, shortlist, visionOn, selector.visionMaxImages || 6, inlined
      )
      const scoreCall = await callSelectorModel(
        scoreUserContent, scoreContent, visionOn, selector.selectMaxTokens || 8000,
        '你是参考图打分助手，只输出 JSON。'
      )
      const scored = parseScoreResult(scoreCall.raw, shortlist)

      if (scored.length === 0) {
        return {
          picked: [], needUserImage: false, askMessage: '', reason: '', ok: false,
          keywords, recalled: shortlist.length, total: pool.length,
          error: scoreCall.error || '打分阶段没有拿到有效的分数',
        }
      }

      // ---- 4. 阈值兜底 ----
      const { picked, best, passed } = selectByScore(scored, shortlist, minScore, max)
      const detail = scored
        .slice()
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map(item => `${item.index}:${item.score}分(${item.why || '-'})`)
        .join('  ')
      logInfo(`逐图打分（阈值 ${minScore}）：最高 ${best} 分，达标 ${passed} 张，选中 ${picked.length} 张 | ${detail}`)

      const hint = String(extractJsonObject(scoreCall.raw)?.hint || '').trim() || undefined

      return {
        picked,
        // 一张都不达标 = 图库里确实没有合适的 -> 让上层去问用户补图，而不是硬塞
        needUserImage: picked.length === 0,
        askMessage: picked.length === 0 ? (analysis.needTypes || '') : '',
        reason: picked.length
          ? `命中需求（最高 ${best} 分）`
          : `没有图达到 ${minScore} 分门槛（最高只有 ${best} 分）`,
        ok: true,
        keywords,
        recalled: shortlist.length,
        total: pool.length,
        renderText: analysis.text || undefined,
        hint: visionOn && selector.appendHint !== false ? hint : undefined,
      }
    }

    /**
     * 识图模式用：把候选图自己下载成 base64 data URL。
     *
     * 不能直接把图片链接丢给上游模型 —— 上游是它自己去下载的，
     * 碰到私有 CDN / 防盗链（实测 pro.filesystem.site 就是）就会返回
     * 「Failed to download image from ...」并让**整条请求 400**，
     * 于是只能退回纯文字选图，识图功能白开。
     *
     * 下载失败或图片过大的，对应位置留 undefined → buildSelectorContent 只发文字描述。
     * @returns 与 candidates 同下标的 data URL 数组
     */
    async function inlineCandidateImages(
      candidates: CandidateImage[],
      max: number
    ): Promise<(string | undefined)[]> {
      const selector: AISelectorConfig = config.aiSelector || ({} as AISelectorConfig)
      const cap = (selector.visionMaxImageBytes || 4) * 1024 * 1024
      const out: (string | undefined)[] = new Array(candidates.length)
      const limit = max > 0 ? Math.min(max, candidates.length) : candidates.length

      await Promise.all(candidates.map(async (candidate, index) => {
        if (index >= limit) return
        const brief = (candidate.url || '').slice(0, 80)
        try {
          const file = await ctx.http.file(candidate.url)
          const data = file?.data
          if (!data) throw new Error('没有拿到图片数据')
          const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data)
          if (!buffer.length) throw new Error('图片是空的')
          if (buffer.length > cap) {
            ctx.logger.warn(
              `候选图 ${(buffer.length / 1048576).toFixed(1)}MB 超过上限 `
              + `${(cap / 1048576).toFixed(1)}MB，识图时只发文字描述：${brief}`
            )
            return
          }
          out[index] = `data:${file?.mime || 'image/jpeg'};base64,${buffer.toString('base64')}`
        } catch (error) {
          ctx.logger.warn(`候选图下载失败，识图时只发文字描述：${brief}（${error}）`)
        }
      }))

      const ok = out.filter(Boolean).length
      logInfo(`识图候选图已内联 ${ok}/${limit} 张（其余只发文字描述）`)
      return out
    }

    /** 候选图片索引文本 */
    function buildIndexText(candidates: CandidateImage[]): string {
      return candidates
        .map((c, i) => `[${i + 1}] 所属组：${c.group} | 描述：${c.description || '（无描述）'}`)
        .join('\n')
    }

    /**
     * 两级检索：
     * 第一级 让模型产出关键词 + 粗筛编号 → 本地文本匹配召回
     * 第二级 只把召回的少量候选交给模型精排（识图模式下也只有这几张需要发图）
     */
    async function runTwoStageSelection(
      candidates: CandidateImage[],
      userInput: string,
      cmdConfig: CommandConfig['nested']['commands'][number],
      promptText: string,
      max: number
    ): Promise<SelectionResult> {
      const selector: AISelectorConfig = config.aiSelector || ({} as AISelectorConfig)
      const topK = selector.retrievalTopK || 12

      // ---- 第一级：关键词 ----
      const keywordContent = (selector.keywordPrompt || DEFAULT_KEYWORD_PROMPT)
        .replace(/\{index\}/g, buildIndexText(candidates))
        .replace(/\{userInput\}/g, userInput || '（用户未附加说明）')
        .replace(/\{topK\}/g, String(topK))
        .replace(/\{command\}/g, cmdConfig.name || '')
        .replace(/\{prompt\}/g, promptText || '')

      const { raw, error } = await callSelectorModel(
        keywordContent, keywordContent, false, selector.keywordMaxTokens || 3000
      )
      const first = parseSelection(raw, candidates, topK)
      logInfo(`两级检索·关键词: ${JSON.stringify(first.keywords || [])} 粗筛: ${first.picked.length}`)

      // ---- 召回：关键词匹配 + 模型粗筛 ----
      const matched = matchCandidatesByKeywords(candidates, first.keywords || [], topK)
      const shortlist = mergeCandidates(first.picked, matched).slice(0, topK)

      if (shortlist.length === 0) {
        const result: SelectionResult = {
          picked: [], needUserImage: false, askMessage: '', reason: '', ok: false,
          error: error || '检索阶段未召回任何候选图片'
        }
        return result
      }

      logInfo(`两级检索召回 ${shortlist.length}/${candidates.length} 张进入精排`)

      // ---- 第二级：精排 ----
      const final = await runSingleStageSelection(shortlist, userInput, cmdConfig, promptText, max)
      final.recalled = shortlist.length
      final.total = candidates.length
      return final
    }

    /** 单阶段：把候选一次性交给模型挑选 */
    async function runSingleStageSelection(
      candidates: CandidateImage[],
      userInput: string,
      cmdConfig: CommandConfig['nested']['commands'][number],
      promptText: string,
      max: number
    ): Promise<SelectionResult> {
      const selector: AISelectorConfig = config.aiSelector || ({} as AISelectorConfig)
      const content = (selector.prompt || DEFAULT_SELECTOR_PROMPT)
        .replace(/\{candidates\}/g, buildIndexText(candidates))
        .replace(/\{userInput\}/g, userInput || '（用户未附加说明）')
        .replace(/\{max\}/g, String(max))
        .replace(/\{command\}/g, cmdConfig.name || '')
        .replace(/\{prompt\}/g, promptText || '')

      // 支持识别图片时，把候选图片本身一起发给模型（编号文字 + 图片交替）
      // 图片先自己下载转 base64：上游拉不到原链接会整条请求 400
      const visionOn = selector.vision === true
      const inlined = visionOn
        ? await inlineCandidateImages(candidates, selector.visionMaxImages || 6)
        : undefined
      const userContent = buildSelectorContent(content, candidates, visionOn, selector.visionMaxImages || 6, inlined)

      const { raw, error } = await callSelectorModel(
        userContent, content, visionOn, selector.selectMaxTokens || 8000
      )

      logInfo(`AI 选图原始响应: ${raw}`)
      const result = parseSelection(raw, candidates, max)
      if (!result.ok) result.error = error || '模型未返回可解析的选择结果'
      return result
    }

    /** 发起一次选图请求；识图失败时自动退回纯文字再试一次 */
    async function callSelectorModel(
      content: string | any[],
      plainText: string,
      visionOn: boolean,
      maxTokens: number,
      systemPrompt?: string,
      temperature?: number
    ): Promise<{ raw: string | null, error: string }> {
      const selector: AISelectorConfig = config.aiSelector || ({} as AISelectorConfig)
      const sysText = systemPrompt || '你是一个精准的参考图片选择助手，只输出 JSON。'
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

      logInfo(`AI 选图请求: ${url} 模型 ${requestBody.model} 识别图片=${visionOn}`)
      let { raw, error } = await requestSelectorModel(url, apiKey, requestBody, timeout)

      // 带图片请求失败（模型不支持/图片取不到）时，退回纯文字再试一次
      if (!raw && visionOn && selector.visionFallback !== false) {
        ctx.logger.warn(
          `AI 选图带图片请求失败（${error || '未知原因'}），退回纯文字描述再试一次。` +
          `若该模型不支持图片输入（DeepSeek 等纯文本模型会返回 400），请关闭「选图模型支持识别图片」`
        )
        const retry = await requestSelectorModel(url, apiKey, {
          ...requestBody,
          messages: [
            { role: 'system', content: sysText },
            { role: 'user', content: plainText }
          ]
        }, timeout)
        raw = retry.raw
        error = retry.error
      }

      return { raw, error }
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


    /** 解析模型返回的 JSON 选择结果 */
    function parseSelection(raw: string | null, candidates: CandidateImage[], max: number): SelectionResult {
      return parseSelectionResult(raw, candidates, max, (msg: string) => ctx.logger.warn(msg))
    }

    /** 询问用户补充发送参考图片，返回用户输入内容（可能是图片或文字） */
    async function askUserForImage(session: Session, quote: any, askText: string, timeoutSec: number): Promise<string | undefined> {
      const [msgId] = await reply(session, [
        session.text('image-prompt.messages.askimage', [askText, timeoutSec])
      ])
      try {
        return await session.prompt(timeoutSec * 1000)
      } finally {
        try {
          await session.bot.deleteMessage(session.channelId, msgId)
        } catch {
          ctx.logger.warn(`在频道 ${session.channelId} 尝试撤回消息ID ${msgId} 失败。`)
        }
      }
    }

    /**
     * 等用户确认开画。
     * 复用「等你发图」那套 session.prompt：拿到用户在这个频道的下一条消息再判断。
     * 超时、或者回了别的话，都算取消（宁可让用户重发指令，也不要画错一张）。
     */
    async function waitForConfirm(session: Session, timeoutSec: number): Promise<boolean> {
      let answer: string | undefined
      try {
        answer = await session.prompt((timeoutSec > 0 ? timeoutSec : 600) * 1000)
      } catch (error) {
        ctx.logger.warn(`等待确认时出错: ${error}`)
        return false
      }
      if (answer === undefined || answer === null) {
        logInfo(`等待确认超时（${timeoutSec} 秒未回复）`)
        return false
      }
      const text = extractTextFromMessage(answer)
      const ok = isConfirmInput(text)
      logInfo(`开画前确认：用户回复 ${JSON.stringify(text)} -> ${ok ? '开始画' : '视为取消'}`)
      return ok
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
