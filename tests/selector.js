/**
 * 选图重构回归测试（纯函数，不需要网络）
 * 运行: node tests/selector.js
 *
 * 重点覆盖「乱选图」的四种表现：
 *   1. 选了完全不相关的图   -> 分数不达标就被阈值挡掉
 *   2. 硬凑数/该不选时乱选  -> 全部不达标时 picked 必须为空（交给上层判定缺图）
 *   3. 选太多、或重复       -> dedupe + max 限制
 *   4. 该选的没选中         -> 分数排序取最高的
 */
const assert = require('node:assert')
const {
  isSkipReferenceInput,
  parseAnalysisResult,
  keywordsFromAnalysis,
  normalizeScore,
  parseScoreResult,
  selectByScore,
  dedupeCandidates,
  extractJsonObject,
  sanitizeAskMessage,
  isConfirmInput,
  buildSelectorContent,
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

const C = (group, url, description) => ({ group, url, description })

// ---------- 1. 识别「不用参考」 ----------
check('识别「不用参考」', () => {
  for (const text of ['不用参考', '不需要参考图', '别参考了', '随意画', '随便画一个', '自由发挥', '你看着办']) {
    assert.strictEqual(isSkipReferenceInput(text), true, `应识别: ${text}`)
  }
})
check('正常需求不误判为跳过', () => {
  for (const text of ['画一个白发少女', '参考这张图', '帮她换个红色裙子', '']) {
    assert.strictEqual(isSkipReferenceInput(text), false, `不该误判: ${text}`)
  }
})

// ---------- 2. 需求分析解析 ----------
check('解析需求分析结果', () => {
  const raw = '{"subject":"白发的少女","must":["白发","水手服"],"nice":["站立"],"avoid":["眼镜"],"text":"你好","skipReference":false,"needTypes":"需要一张白发角色立绘"}'
  const a = parseAnalysisResult(raw)
  assert.strictEqual(a.subject, '白发的少女')
  assert.deepStrictEqual(a.must, ['白发', '水手服'])
  assert.deepStrictEqual(a.nice, ['站立'])
  assert.deepStrictEqual(a.avoid, ['眼镜'])
  assert.strictEqual(a.text, '你好')
  assert.strictEqual(a.needTypes, '需要一张白发角色立绘')
})
check('需求分析容忍代码块与前后废话', () => {
  const raw = '好的，分析如下：\n```json\n{"subject":"猫","must":"橘猫、胖","nice":[]}\n```\n以上。'
  const a = parseAnalysisResult(raw)
  assert.strictEqual(a.subject, '猫')
  assert.deepStrictEqual(a.must, ['橘猫', '胖']) // 字符串会被拆分
})
check('需求分析无法解析时返回 null', () => {
  assert.strictEqual(parseAnalysisResult('完全不是 JSON'), null)
  assert.strictEqual(parseAnalysisResult(''), null)
  assert.strictEqual(parseAnalysisResult(null), null)
})
check('需求分析的 text 支持数组', () => {
  const a = parseAnalysisResult('{"text":["第一行","第二行"]}')
  assert.strictEqual(a.text, '第一行\n第二行')
})

// ---------- 3. 关键词生成 ----------
check('关键词 = 主体 + 硬性 + 加分，且去重', () => {
  const a = parseAnalysisResult('{"subject":"白发少女","must":["白发","蝴蝶结"],"nice":["白发","站立"]}')
  assert.deepStrictEqual(keywordsFromAnalysis(a), ['白发少女', '白发', '蝴蝶结', '站立'])
})
check('空分析返回空关键词', () => {
  assert.deepStrictEqual(keywordsFromAnalysis(null), [])
})

// ---------- 4. 分数归一化 ----------
check('分数兼容 0-100 / 0-1 / 字符串', () => {
  assert.strictEqual(normalizeScore(85), 85)
  assert.strictEqual(normalizeScore(0.85), 85)
  assert.strictEqual(normalizeScore('85分'), 85)
  assert.strictEqual(normalizeScore('0.9'), 90)
  assert.strictEqual(normalizeScore(0), 0)
  assert.strictEqual(normalizeScore(120), 100)
  assert.strictEqual(normalizeScore(-5), 0)
  assert.strictEqual(normalizeScore('abc'), null)
})

// ---------- 5. 打分解析 ----------
check('解析逐图打分结果', () => {
  const candidates = [C('组A', 'u1', '白发双马尾'), C('组A', 'u2', '黑发短发'), C('组B', 'u3', '')]
  const raw = '{"scores":[{"index":1,"score":90,"why":"命中白发"},{"index":2,"score":20,"why":"发色不符"},{"index":3,"score":0,"why":"描述为空"}]}'
  const scored = parseScoreResult(raw, candidates)
  assert.strictEqual(scored.length, 3)
  assert.deepStrictEqual(scored[0], { index: 1, score: 90, why: '命中白发' })
  assert.strictEqual(scored[2].score, 0)
})
check('打分解析忽略越界编号', () => {
  const candidates = [C('组A', 'u1', 'x')]
  const scored = parseScoreResult('{"scores":[{"index":9,"score":99},{"index":1,"score":50}]}', candidates)
  assert.strictEqual(scored.length, 1)
  assert.strictEqual(scored[0].index, 1)
})
check('打分解析空/坏输入返回空数组', () => {
  assert.deepStrictEqual(parseScoreResult(null, []), [])
  assert.deepStrictEqual(parseScoreResult('{"scores":[]}', [C('g', 'u', 'd')]), [])
})

// ---------- 6. 阈值兜底（本次重构的核心） ----------
check('★ 全部低于阈值 -> 一张都不选（不乱凑）', () => {
  const candidates = [C('组A', 'u1', '风景照'), C('组A', 'u2', '猫'), C('组A', 'u3', '')]
  const raw = '{"scores":[{"index":1,"score":30,"why":"不相关"},{"index":2,"score":10,"why":"不相关"},{"index":3,"score":0,"why":"描述为空"}]}'
  const scored = parseScoreResult(raw, candidates)
  const { picked, best, passed } = selectByScore(scored, candidates, 60, 3)
  assert.strictEqual(picked.length, 0, '不达标就该一张都不选')
  assert.strictEqual(passed, 0)
  assert.strictEqual(best, 30)
})
check('★ 只有达标的才被选中，并按分数降序', () => {
  const candidates = [C('组A', 'u1', '一般'), C('组A', 'u2', '很match'), C('组A', 'u3', '勉强')]
  const raw = '{"scores":[{"index":1,"score":55},{"index":2,"score":95},{"index":3,"score":70}]}'
  const scored = parseScoreResult(raw, candidates)
  const { picked, best, passed } = selectByScore(scored, candidates, 60, 3)
  assert.deepStrictEqual(picked.map(c => c.url), ['u2', 'u3'])
  assert.strictEqual(best, 95)
  assert.strictEqual(passed, 2)
})
check('★ max 限制选择数量', () => {
  const candidates = [C('g', 'u1', 'a'), C('g', 'u2', 'b'), C('g', 'u3', 'c')]
  const scored = parseScoreResult('{"scores":[{"index":1,"score":90},{"index":2,"score":88},{"index":3,"score":86}]}', candidates)
  assert.strictEqual(selectByScore(scored, candidates, 60, 1).picked.length, 1)
  assert.strictEqual(selectByScore(scored, candidates, 60, 2).picked.length, 2)
})
check('阈值 0 时取最高分那批', () => {
  const candidates = [C('g', 'u1', 'a'), C('g', 'u2', 'b')]
  const scored = parseScoreResult('{"scores":[{"index":1,"score":10},{"index":2,"score":5}]}', candidates)
  assert.deepStrictEqual(selectByScore(scored, candidates, 0, 5).picked.map(c => c.url), ['u1', 'u2'])
})
check('同一张图重复打分取最高分', () => {
  const candidates = [C('g', 'u1', 'a')]
  const scored = [
    { index: 1, score: 30, why: '' },
    { index: 1, score: 88, why: '' },
  ]
  const { picked } = selectByScore(scored, candidates, 60, 3)
  assert.deepStrictEqual(picked.map(c => c.url), ['u1'])
})

// ---------- 7. 去重 ----------
check('链接相同去重', () => {
  const list = [C('g', 'same', '描述甲'), C('g', 'same', '描述乙'), C('g', 'other', '描述丙')]
  assert.strictEqual(dedupeCandidates(list).length, 2)
})
check('★ 描述完全相同的近似图去重（保留第一张）', () => {
  const list = [C('g', 'u1', '白发少女站立'), C('g', 'u2', '白发少女站立'), C('g', 'u3', '黑发少女坐姿')]
  const out = dedupeCandidates(list)
  assert.deepStrictEqual(out.map(c => c.url), ['u1', 'u3'])
})
check('短描述不参与去重（避免误杀）', () => {
  const list = [C('g', 'u1', ''), C('g', 'u2', ''), C('g', 'u3', '无描述')]
  assert.strictEqual(dedupeCandidates(list).length, 3)
})

// ---------- 8. JSON 抽取 ----------
check('extractJsonObject 取第一个对象', () => {
  assert.deepStrictEqual(extractJsonObject('前言 {"a":1} 后记'), { a: 1 })
  assert.deepStrictEqual(extractJsonObject('```json\n{"a":1}\n```'), { a: 1 })
  assert.strictEqual(extractJsonObject('没有对象'), null)
})

// ---------- 9. 追问文案清洗 ----------
// 实测模型会输出「能发一张…参考图吗？顺便说说 DeepSeek 画成鲸鱼可以吗？」这种
check('★ 只保留第一句，砍掉后面瞎聊的', () => {
  const raw = '能发一张你想用的自己形象的参考图吗？顺便说说DeepSeek画成鲸鱼可以吗？'
  const out = sanitizeAskMessage(raw)
  assert.strictEqual(out, '能发一张你想用的自己形象的参考图吗？')
  assert.ok(!out.includes('DeepSeek'), '不该把模型名带进来')
})
check('正常的一句话原样保留', () => {
  assert.strictEqual(sanitizeAskMessage('能发一张白发水手服的立绘吗？'), '能发一张白发水手服的立绘吗？')
})
check('去掉换行、markdown 与包裹引号', () => {
  assert.strictEqual(sanitizeAskMessage('「能发一张立绘吗？」'), '能发一张立绘吗？')
  assert.strictEqual(sanitizeAskMessage('- 发张图\n'), '发张图')
})
check('超长截断', () => {
  const out = sanitizeAskMessage('一'.repeat(80) + '，后面还有很多话')
  assert.ok(out.length <= 41, `实际长度 ${out.length}`)
  assert.ok(out.endsWith('…'))
})
check('空值返回空串', () => {
  assert.strictEqual(sanitizeAskMessage(''), '')
  assert.strictEqual(sanitizeAskMessage(null), '')
  assert.strictEqual(sanitizeAskMessage(undefined), '')
})
check('parseAnalysisResult 出来的 needTypes 已经洗过', () => {
  const a = parseAnalysisResult(JSON.stringify({ needTypes: '发张图吧。顺便聊聊天气' }))
  assert.strictEqual(a.needTypes, '发张图吧。')
})

// ---------- 10. 开画前确认的回复判定 ----------
check('★ 认这些确认词', () => {
  for (const s of ['确认', '确定', 'ok', 'OK', '好的', '可以', '开始', '画吧', 'yes', '1', '确认！', ' 确认 ']) {
    assert.ok(isConfirmInput(s), `${s} 应该算确认`)
  }
})
check('★ 聊天/否定不算确认', () => {
  for (const s of ['算了', '不确定', '不要', '等等', '确认，另外把头发画长一点', '', '?', '我再想想', 'no']) {
    assert.ok(!isConfirmInput(s), `${s} 不该算确认`)
  }
  assert.ok(!isConfirmInput(undefined))
})

// ---------- 11. 识图模式：图片内联 ----------
const V = [C('g', 'https://a/1.png', '甲'), C('g', 'https://a/2.png', '乙')]
check('没传 dataUrls 时退回原始链接（保持老行为）', () => {
  const parts = buildSelectorContent('正文', V, true, 6)
  const urls = parts.filter(p => p.type === 'image_url').map(p => p.image_url.url)
  assert.deepStrictEqual(urls, ['https://a/1.png', 'https://a/2.png'])
})
check('★ 传了 dataUrls 就只发内联的，下载失败的不再发原链接', () => {
  const parts = buildSelectorContent('正文', V, true, 6, ['data:image/png;base64,AAA', undefined])
  const urls = parts.filter(p => p.type === 'image_url').map(p => p.image_url.url)
  assert.deepStrictEqual(urls, ['data:image/png;base64,AAA'])
  // 文字描述必须都还在，模型还能靠描述判断
  const texts = parts.filter(p => p.type === 'text').map(p => p.text).join('\n')
  assert.ok(texts.includes('甲') && texts.includes('乙'))
})
check('关掉识图就是纯文本', () => {
  assert.strictEqual(buildSelectorContent('正文', V, false, 6), '正文')
})

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
