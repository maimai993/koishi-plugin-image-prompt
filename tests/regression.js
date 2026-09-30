/**
 * 纯函数回归测试（不需要 koishi 运行环境）
 * 运行: node tests/regression.js
 * 覆盖历史上踩过的坑：图片头解析、等比尺寸、被动回复错误识别、markdown 图片语法
 */
const assert = require('node:assert')
const {
  readImageSize,
  fitImageSize,
  buildMarkdownImage,
  isPassiveReplyError,
  supportsMarkdown,
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

/** 只比较 width/height 的值，不受对象 key 顺序影响 */
function sizeEq(actual, expected) {
  assert.strictEqual(actual && actual.width, expected && expected.width, 'width 不符')
  assert.strictEqual(actual && actual.height, expected && expected.height, 'height 不符')
}

// ---------- 构造各格式图片头 ----------
function png(w, h) {
  const b = Buffer.alloc(32)
  Buffer.from('89504E470D0A1A0A', 'hex').copy(b, 0)
  b.writeUInt32BE(13, 8)
  Buffer.from('49484452', 'hex').copy(b, 12)
  b.writeUInt32BE(w, 16)
  b.writeUInt32BE(h, 20)
  return b
}
function gif(w, h) {
  const b = Buffer.alloc(32)
  Buffer.from('474946383961', 'hex').copy(b, 0)
  b.writeUInt16LE(w, 6)
  b.writeUInt16LE(h, 8)
  return b
}
function jpeg(w, h) {
  const b = Buffer.alloc(64)
  Buffer.from('FFD8FFE000104A46494600010100000100010000', 'hex').copy(b, 0)
  const o = 20
  b[o] = 0xFF; b[o + 1] = 0xC0
  b.writeUInt16BE(17, o + 2)
  b[o + 4] = 8
  b.writeUInt16BE(h, o + 5)
  b.writeUInt16BE(w, o + 7)
  return b
}
function webpVp8x(w, h) {
  const b = Buffer.alloc(64)
  Buffer.from('52494646', 'hex').copy(b, 0)
  Buffer.from('57454250', 'hex').copy(b, 8)
  Buffer.from('56503858', 'hex').copy(b, 12)
  b.writeUIntLE(w - 1, 24, 3)
  b.writeUIntLE(h - 1, 27, 3)
  return b
}

// ---------- readImageSize ----------
check('readImageSize PNG 1024x768', () => sizeEq(readImageSize(png(1024, 768)), { width: 1024, height: 768 }))
check('readImageSize GIF 320x240', () => sizeEq(readImageSize(gif(320, 240)), { width: 320, height: 240 }))
check('readImageSize JPEG 800x600', () => sizeEq(readImageSize(jpeg(800, 600)), { width: 800, height: 600 }))
check('readImageSize WebP VP8X 1920x1080', () => sizeEq(readImageSize(webpVp8x(1920, 1080)), { width: 1920, height: 1080 }))
check('readImageSize 过短返回 null', () => assert.strictEqual(readImageSize(Buffer.from([1, 2, 3])), null))
check('readImageSize 空输入返回 null', () => assert.strictEqual(readImageSize(null), null))

// ---------- fitImageSize：等比缩放，绝不拉伸 ----------
check('fit 1024x768 -> 400x300', () => sizeEq(fitImageSize({ width: 1024, height: 768 }, 400, { width: 400, height: 400 }), { width: 400, height: 300 }))
check('fit 1920x1080 -> 400x225', () => sizeEq(fitImageSize({ width: 1920, height: 1080 }, 400, { width: 400, height: 400 }), { width: 400, height: 225 }))
check('fit 竖图 800x1200 -> 400x600', () => sizeEq(fitImageSize({ width: 800, height: 1200 }, 400, { width: 400, height: 400 }), { width: 400, height: 600 }))
check('fit 小图不放大 200x150', () => sizeEq(fitImageSize({ width: 200, height: 150 }, 400, { width: 400, height: 400 }), { width: 200, height: 150 }))
check('fit 读不到尺寸用兜底', () => sizeEq(fitImageSize(null, 400, { width: 400, height: 400 }), { width: 400, height: 400 }))
check('fit maxWidth=0 用原尺寸', () => sizeEq(fitImageSize({ width: 1024, height: 768 }, 0, { width: 400, height: 400 }), { width: 1024, height: 768 }))
check('fit 等比性：宽高比保持', () => {
  const r = fitImageSize({ width: 3000, height: 1000 }, 600, { width: 600, height: 600 })
  assert.strictEqual(r.width, 600)
  assert.strictEqual(r.height, 200)
})

// ---------- buildMarkdownImage（QQ 必须带尺寸） ----------
check('buildMarkdownImage 带尺寸', () => assert.strictEqual(buildMarkdownImage('https://x/y.png', 400, 300), '![#400px #300px](https://x/y.png)'))
check('buildMarkdownImage 只给宽则高=宽', () => assert.strictEqual(buildMarkdownImage('https://x/y.png', 400), '![#400px #400px](https://x/y.png)'))
check('buildMarkdownImage 无尺寸', () => assert.strictEqual(buildMarkdownImage('https://x/y.png'), '![](https://x/y.png)'))
check('buildMarkdownImage 空链接', () => assert.strictEqual(buildMarkdownImage(''), ''))

// ---------- isPassiveReplyError（40034128 被动回复超限） ----------
check('识别 code 40034128', () => assert.strictEqual(isPassiveReplyError({ code: 40034128 }), true))
check('识别 response.data.code', () => assert.strictEqual(isPassiveReplyError({ response: { data: { code: 40034128 } } }), true))
check('识别消息里的 40034128', () => assert.strictEqual(isPassiveReplyError(new Error('QQ 消息发送失败 [40034128]')), true))
check('识别「被动回复」字样', () => assert.strictEqual(isPassiveReplyError(new Error('被动回复时间或者次数超过限制')), true))
check('普通错误不误判', () => assert.strictEqual(isPassiveReplyError(new Error('请求超时')), false))
check('null 不误判', () => assert.strictEqual(isPassiveReplyError(null), false))

// ---------- supportsMarkdown ----------
check('qq 支持 markdown', () => assert.strictEqual(supportsMarkdown('qq'), true))
check('onebot 不支持 markdown', () => assert.strictEqual(supportsMarkdown('onebot'), false))

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
