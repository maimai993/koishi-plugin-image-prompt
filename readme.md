# koishi-plugin-image-prompt

[![npm](https://img.shields.io/npm/v/koishi-plugin-image-prompt?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-image-prompt)

🎯 **一键将图片转换为手办风格！**

基于 OpenAI 兼容的 Chat Completions 接口，支持多种 AI 绘图模型，让你的图片瞬间变成精美手办。

## ⚙️ 插件设置

直接在 Koishi 控制台的插件设置中填写「API 设置」即可：

| 配置项 | 说明 | 默认值 |
|---|---|---|
| API 服务器地址（baseUrl） | OpenAI 兼容的 Chat Completions 接口地址 | `https://api.gptgod.online/v1/chat/completions` |
| 使用的模型（model） | 生成图片所使用的模型名称 | `gemini-2.5-flash-image` |
| API 密钥（apiKey） | 你的 API Key（请求会携带 `Authorization: Bearer <key>`） | 空 |
| 最大重试次数 | 请求失败后的最大重试次数 | 3 |
| 重试间隔(毫秒) | 每次重试之间的等待时间 | 1000 |

建议前往[gptgod](https://gptgod.online/register/n7iydg8nf09ghbikik3jytod)获取你的api key

> 注意：请填写支持图片输入（vision / image）的模型，否则无法正常生成图片。

## 📖 使用说明

配置完成后即可使用内置指令生成图片，例如：

- 手办化
- 手办化2
- 手办化3
- coser化
- mc化
- 合并图片（自定义指令，允许附带自定义提示词）
- 修图（自定义指令）

## 🔧 常见问题

### Q: 提示生成失败
**A:** 检查 baseUrl 是否可访问、apiKey 是否正确、所用模型是否支持图片输入。

### Q: API 返回 401
**A:** 确认 apiKey 已正确填写，并且服务端允许 Bearer Token 鉴权。

### Q: API 返回 429 或配额不足
**A:** 检查账户额度，插件检测到配额不足会自动停止重试。

# 本插件基于[koishi-plugin-lmarena](https://github.com/HydroGest/lmarena)修改
# 部分prompt来自[astrbot_plugin_lmarena](https://github.com/Zhalslar/astrbot_plugin_lmarena)