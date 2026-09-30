/**
 * 加载冒烟测试：用真实 koishi Context 跑一遍 apply + ready，
 * 专门捕捉「let 暂时性死区」这类只在启动时暴露的崩溃
 * （历史 bug: void loadGallery() 写在 let galleryLoaded 之前 → Cannot access 'galleryLoaded' before initialization）
 *
 * 运行: node tests/apply-smoke.js [lib/index.js]
 */
const path = require('path')
const Module = require('module')

const KOISHI_ROOT = process.env.KOISHI_ROOT || path.resolve(__dirname, '../../..')
const target = path.resolve(process.argv[2] || path.join(__dirname, '../lib/index.js'))

// 让插件里的 require('koishi') 解析到工作区的 koishi
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request === 'koishi') {
    return origResolve.call(this, path.join(KOISHI_ROOT, 'node_modules/koishi'), ...rest)
  }
  return origResolve.call(this, request, ...rest)
}

const { Context } = require(path.join(KOISHI_ROOT, 'node_modules/koishi'))
const plugin = require(target)
console.log('目标产物:', target)

const rejections = []
process.on('unhandledRejection', error => {
  rejections.push(error)
  console.log('!!! unhandledRejection:', error && error.message)
})

const ctx = new Context()
ctx.provide('http')
ctx.provide('i18n')
ctx.provide('logger')

const realCommand = ctx.command.bind(ctx)
let commandCount = 0

// 用 Proxy 补齐插件需要但裸 Context 没有的东西
const shim = new Proxy(ctx, {
  get(t, key) {
    if (key === 'command') return (...args) => { commandCount++; return realCommand(...args) }
    if (key === 'scope') return { isActive: true, update() {} }
    if (key === 'baseDir') return KOISHI_ROOT
    const value = t[key]
    return typeof value === 'function' ? value.bind(t) : value
  },
})

plugin.apply(shim, {
  basename: '画图',
  aiSelector: { enabled: false },
  resultGallery: { enabled: false },
  nested: { commands: [] },
})

;(async () => {
  try {
    await ctx.start()
  } catch (error) {
    console.log('ctx.start() 抛错:', error && error.message)
  }

  // 等一拍，让 ready 回调里同步抛出的 async 异常变成 unhandledRejection
  await new Promise(resolve => setTimeout(resolve, 300))

  console.log('注册命令数:', commandCount)
  if (rejections.length === 0 && commandCount > 0) {
    console.log('✅ 通过：apply + ready 无 TDZ / 无未处理拒绝')
  } else {
    console.log('❌ 失败：启动阶段存在未处理拒绝')
    process.exitCode = 1
  }
})()
