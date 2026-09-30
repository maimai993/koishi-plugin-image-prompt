var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  Config: () => Config,
  apply: () => apply,
  buildMarkdownImage: () => buildMarkdownImage,
  buildPromptBlock: () => buildPromptBlock,
  buildPromptEcho: () => buildPromptEcho,
  buildSelectorContent: () => buildSelectorContent,
  buildTextHtml: () => buildTextHtml,
  computeRetryDelay: () => computeRetryDelay,
  describeSelectorError: () => describeSelectorError,
  escapeHtml: () => escapeHtml,
  extractResponseText: () => extractResponseText,
  extractServerMessage: () => extractServerMessage,
  extractTextToRender: () => extractTextToRender,
  inject: () => inject,
  isPassiveReplyError: () => isPassiveReplyError,
  isRetryableStatus: () => isRetryableStatus,
  matchCandidatesByKeywords: () => matchCandidatesByKeywords,
  mergeCandidates: () => mergeCandidates,
  mergePrompt: () => mergePrompt,
  name: () => name,
  parseRetryAfterHeader: () => parseRetryAfterHeader,
  parseSelectionResult: () => parseSelectionResult,
  previewJson: () => previewJson,
  resolveTokenParam: () => resolveTokenParam,
  sanitizeCaption: () => sanitizeCaption,
  stripCommandName: () => stripCommandName,
  stripThinkTags: () => stripThinkTags,
  supportsMarkdown: () => supportsMarkdown,
  trimGallery: () => trimGallery,
  truncateText: () => truncateText,
  usage: () => usage,
  withTokenParam: () => withTokenParam
});
module.exports = __toCommonJS(src_exports);
var import_koishi = require("koishi");
var import_node_fs = require("node:fs");
var nodePath = __toESM(require("node:path"));
var name = "image-prompt";
var inject = {
  required: ["http", "logger", "i18n"],
  optional: ["puppeteer", "assets"]
};
var usage = `
---

\u6B64\u63D2\u4EF6\u76F4\u63A5\u8C03\u7528 OpenAI \u517C\u5BB9\u7684 Chat Completions \u63A5\u53E3\u751F\u6210\u56FE\u7247

\u8BF7\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u586B\u5199\uFF1A

- API \u670D\u52A1\u5668\u5730\u5740\uFF08baseUrl\uFF09
- \u4F7F\u7528\u7684\u6A21\u578B\uFF08model\uFF09
- API \u5BC6\u94A5\uFF08apiKey\uFF09

\u3010AI \u9009\u62E9\u53C2\u8003\u56FE\u7247\u3011

1. \u5728\u300C\u53C2\u8003\u56FE\u7247\u7EC4\u300D\u4E2D\u6CE8\u518C\u5206\u7EC4\uFF1A\u6BCF\u7EC4\u586B\u5199\u82E5\u5E72\u5F20\u300C\u56FE\u7247\u94FE\u63A5 + \u63CF\u8FF0\u300D\uFF08\u63CF\u8FF0\u7528\u4E8E\u8BA9 AI \u5224\u65AD\u8BE5\u56FE\u7684\u7528\u9014\uFF09\u3002
2. \u5728\u6307\u4EE4\u914D\u7F6E\u7684\u300C\u5F15\u7528\u7684\u53C2\u8003\u56FE\u7247\u7EC4\u540D\u79F0\u300D\u4E2D\u586B\u5165\u7EC4\u540D\uFF08\u53EF\u586B\u591A\u4E2A\uFF09\uFF0C\u8BE5\u6307\u4EE4\u6267\u884C\u65F6\u4F1A\u628A\u7EC4\u5185\u56FE\u7247\u5168\u90E8\u4EA4\u7ED9 AI \u6311\u9009\u3002
3. \u300CAI \u9009\u56FE\u8BBE\u7F6E\u300D\u53EF\u4FEE\u6539\u5BF9\u8BDD\u6A21\u578B\uFF08\u9ED8\u8BA4 Qwen/Qwen2.5-7B-Instruct\uFF09\u3001\u9009\u62E9\u63D0\u793A\u8BCD\u6A21\u677F\u3001\u8D85\u65F6\u4E0E\u91CD\u8BD5\u7B49\uFF1B
   \u63A5\u53E3\u5730\u5740/\u5BC6\u94A5\u7559\u7A7A\u65F6\u590D\u7528\u7ED8\u56FE\u63A5\u53E3\u7684\u914D\u7F6E\u3002
4. \u5F53 AI \u5224\u5B9A\u5019\u9009\u56FE\u7247\u91CC\u6CA1\u6709\u5408\u9002\u7684\u53C2\u8003\u56FE\u65F6\uFF0C\u4F1A\u6309\u914D\u7F6E\u8BE2\u95EE\u7528\u6237\u8865\u5145\u53D1\u9001\u56FE\u7247\uFF08\u7528\u6237\u53D1\u9001\u540E\u4F1A\u88AB\u76F4\u63A5\u4F7F\u7528\uFF09\u3002
   \u82E5\u9009\u56FE\u6A21\u578B\u652F\u6301\u8BC6\u522B\u56FE\u7247\uFF08\u591A\u6A21\u6001\uFF09\uFF0C\u53EF\u52FE\u9009\u300C\u9009\u56FE\u6A21\u578B\u652F\u6301\u8BC6\u522B\u56FE\u7247\u300D\uFF0C\u63D2\u4EF6\u4F1A\u628A\u5019\u9009\u56FE\u7247\u672C\u8EAB\u53D1\u7ED9\u6A21\u578B\uFF0C
   \u6A21\u578B\u5BF9\u7740\u771F\u5B9E\u56FE\u7247\u6311\u9009\uFF1B\u5B83\u7ED9\u51FA\u7684\u5173\u952E\u89C6\u89C9\u7279\u5F81\u8FD8\u4F1A\u5E76\u5165\u7ED8\u56FE\u63D0\u793A\u8BCD\uFF0C\u8BA9\u51FA\u56FE\u66F4\u8FD8\u539F\u53C2\u8003\u56FE\u3002
5. \u300C\u542F\u7528 AI \u667A\u80FD\u9009\u62E9\u53C2\u8003\u56FE\u7247\u300D\u9ED8\u8BA4\u5173\u95ED\uFF0C\u9700\u624B\u52A8\u5F00\u542F\uFF1B\u300CAI \u9009\u56FE\u5931\u8D25\u65F6\u56DE\u9000\u4E3A\u4F7F\u7528\u5019\u9009\u6C60\u5185\u5168\u90E8\u56FE\u7247\u300D\u9ED8\u8BA4\u5173\u95ED\uFF0C
   \u5931\u8D25\u65F6\u672C\u6B21\u4E0D\u4F7F\u7528\u53C2\u8003\u56FE\u7247\uFF08\u5F00\u542F\u5219\u6539\u7528\u5019\u9009\u6C60\u5185\u5168\u90E8\u56FE\u7247\uFF09\u3002
6. \u53C2\u8003\u56FE\u8F83\u591A\u65F6\uFF08\u8D85\u8FC7 12 \u5F20\uFF09\u81EA\u52A8\u8D70\u4E24\u7EA7\u68C0\u7D22\uFF1A\u5148\u8BA9\u6A21\u578B\u4EA7\u51FA\u68C0\u7D22\u5173\u952E\u8BCD\u3001\u672C\u5730\u5339\u914D\u53EC\u56DE\uFF0C\u518D\u5BF9\u53EC\u56DE\u7ED3\u679C\u7CBE\u6392\uFF1B
   \u8BC6\u56FE\u6A21\u5F0F\u4E0B\u4E5F\u53EA\u53D1\u9001\u53EC\u56DE\u7684\u8FD9\u51E0\u5F20\u56FE\u7247\uFF0C\u907F\u514D\u6BCF\u6B21\u90FD\u628A\u6574\u4E2A\u56FE\u5E93\u53D1\u7ED9\u6A21\u578B\u3002
7. \u63CF\u8FF0\u53EF\u4EE5\u7528\u300C\u751F\u6210\u63CF\u8FF0\u300D\u6307\u4EE4\u8BA9\u6A21\u578B\u770B\u56FE\u81EA\u52A8\u751F\u6210\u5E76\u5199\u56DE\u914D\u7F6E\uFF08\u9700\u8981\u652F\u6301\u56FE\u7247\u8F93\u5165\u7684\u6A21\u578B\uFF09\u3002
8. \u751F\u6210\u7ED3\u679C\u53EF\u81EA\u52A8\u5165\u5E93\uFF08\u9ED8\u8BA4\u5173\u95ED\uFF09\uFF0C\u4E0B\u6B21\u80FD\u88AB\u81EA\u5DF1\u68C0\u7D22\u5230\u5E76\u590D\u7528\uFF0C\u5F62\u6210\u95ED\u73AF\uFF1B
   \u5F00\u542F\u300C\u540E\u53F0\u7ED8\u56FE\u300D\u540E\u51FA\u56FE\u4E0D\u518D\u963B\u585E\uFF0C\u5148\u56DE\u300C\u6B63\u5728\u753B\u300D\uFF0C\u753B\u597D\u4E3B\u52A8\u63A8\u9001\u3002

\u63D0\u793A\u8BCD\u6A21\u677F\u53EF\u7528\u5360\u4F4D\u7B26\uFF1A{candidates} \u5019\u9009\u56FE\u7247\u5217\u8868\u3001{userInput} \u7528\u6237\u9644\u52A0\u9700\u6C42\u3001{max} \u6700\u591A\u9009\u62E9\u6570\u91CF\u3001{command} \u6307\u4EE4\u540D\u3001{prompt} \u6307\u4EE4\u63D0\u793A\u8BCD

---
\u6B64\u9879\u76EE\u6240\u9700\u7684koishi\u670D\u52A1\uFF1A\u5FC5\u9700 'http', 'logger', 'i18n'\uFF1B\u53EF\u9009 'puppeteer'\uFF08\u4EC5\u300C\u6587\u5B57\u6E32\u67D3\u53C2\u8003\u56FE\u300D\u9700\u8981\uFF09

---
`;
var logger = new import_koishi.Logger(name);
function parseSelectionResult(raw, candidates, max, warn = () => {
}) {
  const result = { picked: [], needUserImage: false, askMessage: "", reason: "", ok: false };
  if (!raw) return result;
  let text = raw.trim();
  const codeMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeMatch) text = codeMatch[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return result;
  let data;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch (error) {
    warn(`AI \u9009\u56FE\u8FD4\u56DE\u5185\u5BB9\u65E0\u6CD5\u89E3\u6790\u4E3A JSON: ${text.slice(0, 200)}`);
    return result;
  }
  result.ok = true;
  result.reason = String(data.reason || data.reasoning || "");
  result.needUserImage = data.needUserImage === true || data.need_user_image === true;
  result.askMessage = String(data.askMessage || data.ask_message || "");
  result.hint = String(data.hint || data.observation || data.description || "").trim() || void 0;
  const rawText = data.text ?? data.texts ?? data.dialogue ?? data.renderText ?? data.lines ?? data.caption;
  if (Array.isArray(rawText)) {
    result.renderText = rawText.map((line) => String(line).trim()).filter(Boolean).join("\n");
  } else if (typeof rawText === "string" && rawText.trim()) {
    result.renderText = rawText.trim();
  }
  const rawKeywords = data.keywords ?? data.query ?? data.queries;
  if (Array.isArray(rawKeywords)) {
    result.keywords = rawKeywords.map((k) => String(k).trim()).filter(Boolean);
  } else if (typeof rawKeywords === "string" && rawKeywords.trim()) {
    result.keywords = rawKeywords.split(/[,，\n]+/).map((k) => k.trim()).filter(Boolean);
  }
  const rawSelected = data.selected ?? data.candidates ?? data.picked ?? data.indexes ?? data.index;
  const indexes = [];
  const pushIndex = (value) => {
    const num = typeof value === "number" ? value : parseInt(String(value).replace(/[^0-9-]/g, ""), 10);
    if (!isNaN(num)) indexes.push(num);
  };
  if (Array.isArray(rawSelected)) {
    rawSelected.forEach(pushIndex);
  } else if (typeof rawSelected === "string") {
    rawSelected.split(/[,，\s]+/).forEach(pushIndex);
  } else if (typeof rawSelected === "number") {
    pushIndex(rawSelected);
  }
  for (const index of indexes) {
    const candidate = candidates[index - 1] || candidates[index];
    if (candidate && !result.picked.includes(candidate)) result.picked.push(candidate);
    if (result.picked.length >= max) break;
  }
  return result;
}
function computeRetryDelay(status, retryAfter, baseInterval, attempt) {
  const base = baseInterval > 0 ? baseInterval : 1e3;
  if (status === 429 || status === 503) {
    if (retryAfter && retryAfter > 0) return retryAfter;
    return Math.min(base * Math.pow(2, attempt), 3e4);
  }
  return base;
}
function matchCandidatesByKeywords(candidates, keywords, topK) {
  const words = (keywords || []).flatMap((k) => String(k).split(/[\s,，、;；/|]+/)).map((w) => normalizeText(w)).filter((w) => w.length > 0);
  if (!words.length) return [];
  const scored = [];
  for (const candidate of candidates) {
    const haystack = normalizeText(`${candidate.group} ${candidate.description}`);
    let score = 0;
    for (const word of words) {
      if (haystack.includes(word)) {
        score += Math.max(2, word.length) * 2;
      } else if (word.length > 2) {
        for (const gram of toGrams(word)) {
          if (haystack.includes(gram)) score += 1;
        }
      }
    }
    if (score > 0) scored.push({ item: candidate, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK > 0 ? topK : 12).map((s) => s.item);
}
function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, "");
}
function toGrams(word) {
  const grams = [];
  for (let i = 0; i < word.length - 1; i++) grams.push(word.slice(i, i + 2));
  return grams;
}
function mergeCandidates(...lists) {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const list of lists) {
    for (const item of list || []) {
      if (!item || !item.url || seen.has(item.url)) continue;
      seen.add(item.url);
      result.push(item);
    }
  }
  return result;
}
function trimGallery(records, capacity) {
  const limit = capacity > 0 ? capacity : 50;
  const byGroup = /* @__PURE__ */ new Map();
  for (const record of records || []) {
    const list = byGroup.get(record.group) || [];
    list.push(record);
    byGroup.set(record.group, list);
  }
  const kept = [];
  for (const list of byGroup.values()) {
    list.sort((a, b) => (a.time || 0) - (b.time || 0));
    kept.push(...list.slice(-limit));
  }
  return kept;
}
function stripCommandName(text, commandName) {
  let value = String(text || "").trim();
  if (!value || !commandName) return value;
  const name2 = String(commandName).trim();
  if (value.startsWith(name2)) value = value.slice(name2.length).trim();
  return value;
}
function mergePrompt(basePrompt, userInput, enabled) {
  const input = String(userInput || "").trim();
  if (!input || enabled === false) return String(basePrompt || "");
  const base = String(basePrompt || "").trim();
  return base ? `${base}

${input}` : input;
}
function truncateText(text, maxLength) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  const limit = maxLength > 0 ? maxLength : 120;
  return value.length > limit ? value.slice(0, limit) : value;
}
var ONEBOT_LIKE = /onebot|napcat|lagrange|go-?cqhttp|chronocat|mirai/i;
function supportsMarkdown(platform) {
  const name2 = String(platform || "").toLowerCase();
  if (!name2) return false;
  if (ONEBOT_LIKE.test(name2)) return false;
  if (name2.startsWith("qqguild")) return false;
  return name2 === "qq" || name2.startsWith("qq-") || name2.startsWith("qqbot");
}
function buildPromptEcho(promptText, platform, maxLength = 4e3) {
  let text = String(promptText || "").trim();
  if (!text) return "";
  const limit = maxLength > 0 ? maxLength : 0;
  if (limit && text.length > limit) {
    text = text.slice(0, limit) + "\n\u2026\uFF08\u63D0\u793A\u8BCD\u8FC7\u957F\u5DF2\u622A\u65AD\uFF0C\u53EF\u5728\u300C\u56DE\u663E\u63D0\u793A\u8BCD\u7684\u6700\u5927\u957F\u5EA6\u300D\u91CC\u8C03\u5927\uFF0C\u8BBE\u4E3A 0 \u4E0D\u622A\u65AD\uFF09";
  }
  if (supportsMarkdown(platform)) return (0, import_koishi.h)("markdown", "\n```\n" + text + "\n```");
  return text;
}
function buildPromptBlock(promptText, maxLength = 4e3) {
  let text = String(promptText || "").trim();
  if (!text) return "";
  const limit = maxLength > 0 ? maxLength : 0;
  if (limit && text.length > limit) {
    text = text.slice(0, limit) + "\n\u2026\uFF08\u63D0\u793A\u8BCD\u8FC7\u957F\u5DF2\u622A\u65AD\uFF0C\u53EF\u5728\u300C\u56DE\u663E\u63D0\u793A\u8BCD\u7684\u6700\u5927\u957F\u5EA6\u300D\u91CC\u8C03\u5927\uFF0C\u8BBE\u4E3A 0 \u4E0D\u622A\u65AD\uFF09";
  }
  return "\n```\n" + text + "\n```";
}
function buildMarkdownImage(url, width = 0, height = 0) {
  const link = String(url || "").trim();
  if (!link) return "";
  const w = width > 0 ? Math.round(width) : 0;
  const h2 = height > 0 ? Math.round(height) : w || 0;
  const size = w > 0 ? `#${w}px #${h2}px` : "";
  return `![${size}](${link})`;
}
function sanitizeCaption(text, maxLen = 120) {
  let value = String(text || "").trim();
  value = value.replace(/^```[a-zA-Z]*\s*/, "").replace(/```\s*$/, "").trim();
  value = value.replace(/^[「『"'【]+/, "").replace(/[」』"'】]+$/, "").trim();
  value = value.replace(/^(描述|图片描述|图片说明|caption)[:：]\s*/i, "");
  value = value.replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").trim();
  if (maxLen > 0 && value.length > maxLen) value = value.slice(0, maxLen);
  return value.trim();
}
function isRetryableStatus(status) {
  if (typeof status !== "number") return true;
  if (status === 429 || status === 503) return true;
  if (status >= 500) return true;
  if (status >= 400) return false;
  return true;
}
function extractServerMessage(error) {
  const data = error?.response?.data ?? error?.data;
  if (!data) return "";
  if (typeof data === "string") return data.slice(0, 200);
  if (data.error?.message) return String(data.error.message).slice(0, 200);
  if (typeof data.message === "string") return data.message.slice(0, 200);
  if (typeof data.msg === "string") return data.msg.slice(0, 200);
  try {
    return JSON.stringify(data).slice(0, 200);
  } catch {
    return "";
  }
}
function describeSelectorError(status, serverMessage, rawMessage) {
  const detail = serverMessage ? `\uFF1A${serverMessage}` : rawMessage ? `\uFF1A${rawMessage}` : "";
  if (status === 429) return `\u88AB\u9650\u6D41\uFF08429\uFF09${detail}`;
  if (status === 401) return `\u9274\u6743\u5931\u8D25\uFF08401\uFF09\uFF0C\u8BF7\u68C0\u67E5 AI \u9009\u56FE\u63A5\u53E3\u5BC6\u94A5${detail}`;
  if (status === 403) return `\u65E0\u6743\u9650\uFF08403\uFF09\uFF0C\u8BF7\u68C0\u67E5\u5BC6\u94A5\u6216\u6A21\u578B\u6743\u9650${detail}`;
  if (status === 404) return `\u63A5\u53E3\u5730\u5740\u4E0D\u5B58\u5728\uFF08404\uFF09\uFF0C\u8BF7\u68C0\u67E5 AI \u9009\u56FE\u63A5\u53E3\u5730\u5740${detail}`;
  if (status === 400) return `\u8BF7\u6C42\u88AB\u62D2\u7EDD\uFF08400\uFF09${detail}`;
  if (typeof status === "number" && status >= 500) return `\u670D\u52A1\u7AEF\u9519\u8BEF\uFF08${status}\uFF09${detail}`;
  return serverMessage || rawMessage || "\u672A\u77E5\u9519\u8BEF";
}
function parseRetryAfterHeader(headers) {
  if (!headers) return void 0;
  const value = typeof headers.get === "function" ? headers.get("retry-after") ?? headers.get("Retry-After") : headers["retry-after"] ?? headers["Retry-After"];
  if (!value) return void 0;
  const seconds = parseFloat(String(value));
  if (!isNaN(seconds)) return Math.min(Math.max(seconds * 1e3, 500), 6e4);
  const date = Date.parse(String(value));
  if (!isNaN(date)) return Math.min(Math.max(date - Date.now(), 500), 6e4);
  return void 0;
}
function stripThinkTags(text) {
  const source = String(text || "");
  const openRe = /<\s*(think|thinking|reasoning)\s*>/i;
  const closeRe = /<\s*\/\s*(think|thinking|reasoning)\s*>/i;
  const open = source.search(openRe);
  if (open < 0) return source.trim();
  const rest = source.slice(open);
  const closeMatch = rest.match(closeRe);
  if (!closeMatch) {
    return source.slice(0, open).trim();
  }
  const closeEnd = open + (closeMatch.index || 0) + closeMatch[0].length;
  return (source.slice(0, open) + source.slice(closeEnd)).trim();
}
function getByPath(obj, path) {
  let current = obj;
  for (const key of path.split(".")) {
    if (current === null || current === void 0) return void 0;
    current = current[key];
  }
  return current;
}
var RESPONSE_TEXT_PATHS = [
  "choices.0.message.content",
  "choices.0.message.text",
  "choices.0.text",
  "choices.0.delta.content",
  "choices.0.content",
  "data.choices.0.message.content",
  "data.choices.0.text",
  "output_text",
  "output.0.content.0.text",
  "output.0.text",
  "content.0.text",
  "message.content",
  "delta.content",
  "result",
  "text",
  "response"
];
var REASONING_TEXT_PATHS = [
  "choices.0.message.reasoning_content",
  "choices.0.message.reasoning",
  "choices.0.message.thinking",
  "choices.0.message.thinking_content",
  "data.choices.0.message.reasoning_content"
];
var TEXT_KEYS = ["content", "text", "output_text", "result"];
function deepFindText(node, depth, budget) {
  if (budget.left <= 0 || depth > 5 || node === null || node === void 0) return "";
  if (typeof node !== "object") return "";
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = deepFindText(item, depth + 1, budget);
      if (found) return found;
    }
    return "";
  }
  for (const key of TEXT_KEYS) {
    const value = node[key];
    if (typeof value === "string" && value.trim()) return value;
    if (Array.isArray(value)) {
      const joined = value.map((part) => typeof part === "string" ? part : part?.text || "").filter(Boolean).join("");
      if (joined.trim()) return joined;
    }
  }
  for (const key of Object.keys(node)) {
    budget.left--;
    if (budget.left <= 0) break;
    const found = deepFindText(node[key], depth + 1, budget);
    if (found) return found;
  }
  return "";
}
function previewJson(value, maxLength = 400) {
  if (value === null || value === void 0) return "\uFF08\u7A7A\uFF09";
  const text = typeof value === "string" ? value : (() => {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  })();
  return text.length > maxLength ? `${text.slice(0, maxLength)}\u2026` : text;
}
function extractResponseText(response) {
  let data = response;
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === "object") data = data[0];
  if (typeof data === "string") {
    const raw = data.trim();
    if (/^\s*data:/m.test(raw)) {
      const chunks = raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).filter((line) => line && line !== "[DONE]");
      const parsed = [];
      for (const chunk of chunks) {
        try {
          parsed.push(JSON.parse(chunk));
        } catch {
        }
      }
      if (parsed.length === 0) {
        return { text: "", reason: `\u63A5\u53E3\u8FD4\u56DE\u7684\u662F\u6D41\u5F0F\uFF08SSE\uFF09\u6570\u636E\uFF0C\u4F46\u6CA1\u80FD\u89E3\u6790\u51FA\u5185\u5BB9\uFF1A${previewJson(raw, 200)}`, truncated: false };
      }
      const delta = parsed.map((item) => String(item?.choices?.[0]?.delta?.content ?? item?.delta?.content ?? "")).join("");
      if (delta.trim()) return { text: delta, reason: "", truncated: false };
      data = parsed[parsed.length - 1];
    } else if (raw.startsWith("{") || raw.startsWith("[")) {
      try {
        data = JSON.parse(raw);
      } catch {
      }
    } else if (raw) {
      return { text: raw, reason: "", truncated: false };
    } else {
      return { text: "", reason: "\u63A5\u53E3\u8FD4\u56DE\u7684\u662F\u7A7A\u5B57\u7B26\u4E32", truncated: false };
    }
  }
  if (data === null || data === void 0) return { text: "", reason: "\u63A5\u53E3\u6CA1\u6709\u8FD4\u56DE\u4EFB\u4F55\u6570\u636E", truncated: false };
  if (typeof data !== "object") {
    const text = String(data).trim();
    return text ? { text, reason: "", truncated: false } : { text: "", reason: "\u63A5\u53E3\u8FD4\u56DE\u4E3A\u7A7A", truncated: false };
  }
  for (const path of RESPONSE_TEXT_PATHS) {
    const value = getByPath(data, path);
    let text = "";
    if (typeof value === "string") text = value;
    else if (Array.isArray(value)) {
      text = value.map((part) => typeof part === "string" ? part : part?.text || "").filter(Boolean).join("");
    }
    if (text && text.trim()) {
      const stripped = stripThinkTags(text);
      return { text: stripped || text.trim(), reason: "", truncated: false };
    }
  }
  const found = deepFindText(data, 0, { left: 300 });
  if (found) {
    const stripped = stripThinkTags(found);
    return { text: stripped || found.trim(), reason: "", truncated: false };
  }
  const choice = data.choices?.[0] ?? data.data?.choices?.[0];
  const finish = choice?.finish_reason ?? choice?.finishReason;
  if (finish === "length") return { text: "", reason: "\u8F93\u51FA\u88AB max_tokens \u622A\u65AD\uFF08finish_reason=length\uFF09\uFF1A\u6A21\u578B\u628A\u989D\u5EA6\u5168\u7528\u5728\u601D\u8003\u4E0A\uFF0C\u6B63\u6587\u4E00\u4E2A\u5B57\u90FD\u6CA1\u751F\u6210", truncated: true };
  if (finish === "content_filter") return { text: "", reason: "\u5185\u5BB9\u88AB\u5B89\u5168\u7B56\u7565\u62E6\u622A\uFF08finish_reason=content_filter\uFF09", truncated: false };
  if (finish === "tool_calls") return { text: "", reason: "\u6A21\u578B\u8C03\u7528\u4E86\u5DE5\u5177\u800C\u4E0D\u662F\u8F93\u51FA\u6587\u672C\uFF08finish_reason=tool_calls\uFF09", truncated: false };
  if (Array.isArray(data.choices) && data.choices.length === 0) {
    return { text: "", reason: `choices \u662F\u7A7A\u6570\u7EC4\uFF1A${previewJson(data, 300)}`, truncated: false };
  }
  for (const path of REASONING_TEXT_PATHS) {
    const value = getByPath(data, path);
    if (typeof value === "string" && value.trim()) {
      const stripped = stripThinkTags(value);
      return { text: stripped || value.trim(), reason: "", truncated: false };
    }
  }
  if (choice && choice.message) return { text: "", reason: `message.content \u4E3A\u7A7A\uFF1A${previewJson(choice, 300)}`, truncated: false };
  return { text: "", reason: `\u54CD\u5E94\u91CC\u6CA1\u6709\u53EF\u8BC6\u522B\u7684\u6587\u672C\u5B57\u6BB5\uFF1A${previewJson(data, 300)}`, truncated: false };
}
function isPassiveReplyError(error) {
  if (!error) return false;
  const code = error?.code ?? error?.response?.data?.code ?? error?.data?.code;
  if (code === 40034128 || String(code) === "40034128") return true;
  const text = String(error?.message || error?.response?.data?.message || error || "");
  return text.includes("40034128") || text.includes("\u88AB\u52A8\u56DE\u590D");
}
function resolveTokenParam(model, mode) {
  if (mode === "max_tokens" || mode === "max_completion_tokens") return mode;
  const name2 = String(model || "").toLowerCase();
  if (/(^|[^a-z])o[134](-|$|[^a-z])|gpt-5|reasoner|reasoning|think/.test(name2)) return "max_completion_tokens";
  return "max_tokens";
}
function withTokenParam(body, param) {
  const { max_tokens, max_completion_tokens, ...rest } = body || {};
  const value = max_tokens ?? max_completion_tokens;
  const next = { ...rest };
  if (value !== void 0) next[param] = value;
  return next;
}
function buildSelectorContent(text, candidates, vision, visionMaxImages) {
  if (!vision) return text;
  const max = visionMaxImages > 0 ? visionMaxImages : candidates.length;
  const parts = [];
  candidates.forEach((candidate, index) => {
    parts.push({ type: "text", text: `[${index + 1}] \u6240\u5C5E\u7EC4\uFF1A${candidate.group} | \u63CF\u8FF0\uFF1A${candidate.description || "\uFF08\u65E0\u63CF\u8FF0\uFF09"}` });
    if (index < max) {
      parts.push({ type: "image_url", image_url: { url: candidate.url } });
    }
  });
  const hintRule = visionMaxImages && candidates.length > 1 ? `\u5E76\u5728 hint \u5B57\u6BB5\u4E2D\u5199\u4E00\u6BB5\u300C\u753B\u9762\u7F16\u6392\u300D\uFF1A\u6309\u9009\u4E2D\u987A\u5E8F\u8BF4\u660E\u6BCF\u4E2A\u89D2\u8272/\u5143\u7D20\u5728\u753B\u9762\u4E2D\u7684\u4F4D\u7F6E\u548C\u59FF\u6001\u3001\u5F7C\u6B64\u7684\u52A8\u4F5C\u4E92\u52A8\u4E0E\u89C6\u7EBF\u5173\u7CFB\u3001\u5171\u540C\u6240\u5904\u7684\u573A\u666F\u4E0E\u6C1B\u56F4\uFF0C\u4EE5\u53CA\u9700\u8981\u8FD8\u539F\u7684\u5404\u81EA\u5916\u5F62\u7279\u5F81\uFF08\u53D1\u578B\u53D1\u8272\u3001\u670D\u88C5\u3001\u914D\u8272\u3001\u753B\u98CE\uFF09\u3002\u5185\u5BB9\u8981\u50CF\u4E00\u6BB5\u53EF\u4EE5\u76F4\u63A5\u4EA4\u7ED9\u753B\u5E08\u7684\u5206\u955C\u8BF4\u660E\uFF0C\u800C\u4E0D\u662F\u9010\u5F20\u7F57\u5217\u3002` : `\u5E76\u5728 hint \u5B57\u6BB5\u4E2D\u7528\u4E00\u53E5\u8BDD\u6982\u62EC\u4F60\u9009\u4E2D\u56FE\u7247\u7684\u5173\u952E\u89C6\u89C9\u7279\u5F81\uFF08\u5982\u53D1\u578B\u3001\u53D1\u8272\u3001\u670D\u88C5\u3001\u914D\u8272\u3001\u59FF\u6001\u3001\u753B\u98CE\uFF09\uFF0C\u4F9B\u540E\u7EED\u7ED8\u56FE\u65F6\u8FD8\u539F\u8BE5\u53C2\u8003\u56FE\u3002`;
  parts.push({
    type: "text",
    text: `${text}

\uFF08\u4E0A\u65B9\u5DF2\u6309\u987A\u5E8F\u9644\u4E0A\u5019\u9009\u56FE\u7247\uFF0C\u8BF7\u7ED3\u5408\u56FE\u7247\u5B9E\u9645\u5185\u5BB9\u6311\u9009\u3002${hintRule}\u4ECD\u7136\u53EA\u8F93\u51FA JSON\u3002\uFF09`
  });
  return parts;
}
function escapeHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function buildTextHtml(lines, cfg = {}) {
  const width = cfg.width || 1024;
  const fontSize = cfg.fontSize || 96;
  const lineHeight = cfg.lineHeight || 1.4;
  const padding = cfg.padding || 48;
  const background = cfg.background || "#ffffff";
  const color = cfg.color || "#111111";
  const fontFamily = cfg.fontFamily || "Microsoft YaHei, PingFang SC, Noto Sans CJK SC, sans-serif";
  const align = cfg.align === "left" ? "left" : "center";
  const weight = cfg.bold ? "700" : "400";
  const strokeWidth = cfg.strokeWidth || 0;
  const strokeColor = cfg.strokeColor || "#ffffff";
  const stroke = strokeWidth > 0 ? `-webkit-text-stroke: ${strokeWidth}px ${strokeColor}; paint-order: stroke fill;` : "";
  const body = lines.map((line) => `<div class="line">${escapeHtml(line)}</div>`).join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { background: ${background}; }
#stage { display: inline-block; min-width: ${width}px; padding: ${padding}px; }
.line { font-family: ${fontFamily}; font-size: ${fontSize}px; line-height: ${lineHeight};
  color: ${color}; font-weight: ${weight}; text-align: ${align};
  white-space: pre-wrap; word-break: break-word; ${stroke} }
</style></head><body><div id="stage">${body}</div></body></html>`;
}
var CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\uf900-\ufaff]/;
function extractTextToRender(text, options = {}) {
  const source = String(text || "");
  if (!source.trim()) return [];
  const maxChars = options.maxChars && options.maxChars > 0 ? options.maxChars : 200;
  const results = [];
  const push = (raw) => {
    const value = String(raw || "").trim().replace(/^[\s"'`「『“《【（(\[]+/, "").replace(/[\s"'`」』”》】）)\]]+$/, "").replace(/\s+/g, " ");
    if (!value) return;
    if (value.length > maxChars) return;
    if (!CJK_RE.test(value)) return;
    if (results.includes(value)) return;
    results.push(value);
  };
  const patterns = [
    /「([^」\n]{1,200})」/g,
    /『([^』\n]{1,200})』/g,
    /“([^”\n]{1,200})”/g,
    /《([^》\n]{1,200})》/g,
    /【([^】\n]{1,200})】/g,
    /"([^"\n]{1,200})"/g,
    /'([^'\n]{1,200})'/g,
    /(?:台词|字幕|标语|招牌|标题|写着|写着的是|对话)\s*[:：]?\s*([^\n。；;！!？?]{1,200})/g
  ];
  for (const pattern of patterns) {
    let match;
    while (match = pattern.exec(source)) push(match[1]);
  }
  if (results.length === 0 && options.loose) {
    const chunks = source.match(/[\u3400-\u4dbf\u4e00-\u9fff][\u3400-\u4dbf\u4e00-\u9fff\u3001\u3002\uff0c\uff01\uff1f\uff1a\u201c\u201d\s]{3,}/g);
    for (const chunk of chunks || []) push(chunk);
  }
  return results;
}
var DEFAULT_SELECTOR_PROMPT = `\u4F60\u662F\u4E00\u4E2A\u300C\u53C2\u8003\u56FE\u7247\u9009\u62E9\u52A9\u624B\u300D\u3002\u7528\u6237\u6B63\u5728\u4F7F\u7528 AI \u7ED8\u56FE\u529F\u80FD\uFF0C\u9700\u8981\u4ECE\u4E0B\u65B9\u7684\u5019\u9009\u53C2\u8003\u56FE\u7247\u6C60\u4E2D\u6311\u9009\u6700\u7B26\u5408\u5176\u9700\u6C42\u7684\u56FE\u7247\u4F5C\u4E3A\u7ED8\u56FE\u53C2\u8003\u3002

\u53EF\u7528\u53C2\u8003\u56FE\u7247\u5217\u8868\uFF08\u7F16\u53F7 | \u6240\u5C5E\u7EC4 | \u63CF\u8FF0\uFF09\uFF1A
{candidates}

\u5F53\u524D\u4F7F\u7528\u7684\u7ED8\u56FE\u6307\u4EE4\uFF1A{command}
\u8BE5\u6307\u4EE4\u7684\u7528\u9014\u63D0\u793A\u8BCD\uFF1A{prompt}
\u7528\u6237\u7684\u9644\u52A0\u9700\u6C42\uFF1A{userInput}

\u89C4\u5219\uFF1A
1. \u4ED4\u7EC6\u9605\u8BFB\u6BCF\u5F20\u56FE\u7247\u7684\u63CF\u8FF0\uFF08\u5982\u679C\u540C\u65F6\u9644\u4E0A\u4E86\u56FE\u7247\u672C\u8EAB\uFF0C\u4EE5\u56FE\u7247\u5B9E\u9645\u5185\u5BB9\u4E3A\u51C6\uFF09\uFF0C\u6311\u9009\u6700\u8D34\u5408\u7528\u6237\u9700\u6C42\u4E0E\u6307\u4EE4\u7528\u9014\u7684\u53C2\u8003\u56FE\u7247\uFF0C\u6700\u591A\u9009\u62E9 {max} \u5F20\u3002
2. \u5982\u679C\u5019\u9009\u6C60\u91CC\u6CA1\u6709\u4EFB\u4F55\u56FE\u7247\u80FD\u6EE1\u8DB3\u7528\u6237\u9700\u6C42\uFF08\u7F3A\u5931\u5173\u952E\u53C2\u8003\u56FE\uFF09\uFF0C\u5C06 needUserImage \u8BBE\u4E3A true\uFF0C\u5E76\u5728 askMessage \u4E2D\u7528\u4E00\u53E5\u8BDD\u544A\u8BC9\u7528\u6237\u9700\u8981\u8865\u5145\u53D1\u9001\u4EC0\u4E48\u6837\u7684\u56FE\u7247\uFF08\u4E2D\u6587\uFF0C40 \u5B57\u4EE5\u5185\uFF0C\u8BED\u6C14\u81EA\u7136\uFF0C\u76F4\u63A5\u5BF9\u7528\u6237\u8BF4\uFF09\u3002
3. \u5224\u65AD\u8FD9\u6B21\u7684\u753B\u9762\u4E0A**\u662F\u5426\u9700\u8981\u51FA\u73B0\u6587\u5B57**\uFF08\u53F0\u8BCD\u3001\u5BF9\u767D\u3001\u6807\u9898\u3001\u62DB\u724C\u3001\u5B57\u5E55\u7B49\uFF09\u3002\u9700\u8981\u7684\u8BDD\uFF0C\u628A\u8981\u663E\u793A\u7684\u6240\u6709\u6587\u5B57\u5199\u8FDB text \u5B57\u6BB5\uFF1A
   - \u6BCF\u884C\u4E00\u53E5\uFF0C\u591A\u53E5\u7528 \\n \u6362\u884C\uFF1B\u53EA\u5199\u771F\u6B63\u8981\u51FA\u73B0\u5728\u753B\u9762\u4E0A\u7684\u5B57\uFF0C\u4E0D\u8981\u5199\u89E3\u91CA\u3001\u4E0D\u8981\u52A0\u5F15\u53F7\u4EE5\u5916\u7684\u88C5\u9970\u3002
   - \u4E00\u53E5\u4E5F\u4E0D\u8981\u8D85\u8FC7 30 \u4E2A\u5B57\uFF0C\u957F\u53E5\u8BF7\u62C6\u6210\u591A\u884C\u3002
   - \u4E0D\u9700\u8981\u51FA\u73B0\u6587\u5B57\u5C31\u7559\u7A7A\u5B57\u7B26\u4E32\u3002
4. \u53EA\u8F93\u51FA\u4E00\u4E2A JSON \u5BF9\u8C61\uFF0C\u4E0D\u8981\u8F93\u51FA\u4EFB\u4F55\u89E3\u91CA\u3001Markdown \u4EE3\u7801\u5757\u6216\u591A\u4F59\u6587\u5B57\u3002

\u8F93\u51FA\u683C\u5F0F\uFF1A
{"selected": [\u7F16\u53F71,\u7F16\u53F72], "reason": "\u4E00\u53E5\u8BDD\u8BF4\u660E\u9009\u62E9\u7406\u7531", "needUserImage": false, "askMessage": "", "text": ""}`;
var DEFAULT_OPTIMIZE_PROMPT = `\u4F60\u662F\u7ED8\u56FE\u63D0\u793A\u8BCD\u4F18\u5316\u52A9\u624B\u3002\u4E0B\u9762\u662F\u300C\u7ED8\u56FE\u6307\u4EE4\u7684\u539F\u59CB\u63D0\u793A\u8BCD\u300D\u548C\u300C\u7528\u6237\u672C\u6B21\u7684\u9700\u6C42\u300D\u3002

\u8BF7\u8F93\u51FA\u4E00\u4EFD\u5B8C\u6574\u3001\u53EF\u76F4\u63A5\u7528\u4E8E\u7ED8\u56FE\u6A21\u578B\u7684\u63D0\u793A\u8BCD\u3002\u89C4\u5219\uFF1A

1. \u539F\u59CB\u63D0\u793A\u8BCD\u4E0D\u4E3A\u7A7A\u65F6\uFF1A\u628A\u7528\u6237\u9700\u6C42\u81EA\u7136\u5730\u878D\u5408\u8FDB\u539F\u59CB\u63D0\u793A\u8BCD\uFF0C\u5E76**\u4FDD\u7559\u539F\u59CB\u63D0\u793A\u8BCD\u4E2D\u7684\u5168\u90E8\u573A\u666F\u3001\u6784\u56FE\u3001\u98CE\u683C\u3001\u6750\u8D28\u3001\u5149\u7EBF\u7B49\u7EC6\u8282**\uFF0C\u4E0D\u5F97\u5220\u51CF\u6216\u7B80\u5316\u3002
2. \u539F\u59CB\u63D0\u793A\u8BCD\u4E3A\u7A7A\u65F6\uFF08\u4F8B\u5982\u81EA\u5B9A\u4E49\u6307\u4EE4\uFF09\uFF1A\u6839\u636E\u7528\u6237\u9700\u6C42**\u6269\u5199**\u6210\u5B8C\u6574\u7684\u7ED8\u56FE\u63D0\u793A\u8BCD\uFF0C\u8865\u8DB3\u753B\u98CE\u3001\u6784\u56FE\u3001\u955C\u5934\u3001\u5149\u7EBF\u3001\u6C1B\u56F4\u3001\u914D\u8272\u4E0E\u7EC6\u8282\uFF0C\u4F46\u4E0D\u8981\u6539\u53D8\u7528\u6237\u7684\u539F\u610F\u3002
3. \u628A\u7528\u6237\u9700\u6C42\u5199\u5230\u5B83\u8BE5\u53BB\u7684\u4F4D\u7F6E\uFF08\u8868\u60C5/\u52A8\u4F5C/\u795E\u6001/\u670D\u88C5/\u573A\u666F/\u4E92\u52A8\u7B49\uFF09\uFF0C\u4E0D\u8981\u539F\u6837\u8D34\u5728\u672B\u5C3E\u3002
4. \u8BED\u8A00\uFF1A\u539F\u59CB\u63D0\u793A\u8BCD\u662F\u82F1\u6587\u5C31\u8F93\u51FA\u82F1\u6587\uFF1B\u539F\u59CB\u63D0\u793A\u8BCD\u4E3A\u7A7A\u65F6\u4E5F\u7528\u82F1\u6587\uFF08\u82F1\u6587\u63D0\u793A\u8BCD\u51FA\u56FE\u6548\u679C\u901A\u5E38\u66F4\u7A33\uFF09\u3002
5. \u53EA\u8F93\u51FA\u4F18\u5316\u540E\u7684\u63D0\u793A\u8BCD\u6B63\u6587\uFF0C\u4E0D\u8981\u89E3\u91CA\u3001\u4E0D\u8981\u6807\u9898\u3001\u4E0D\u8981 Markdown \u4EE3\u7801\u5757\u3001\u4E0D\u8981\u5F15\u53F7\u3002

\u539F\u59CB\u63D0\u793A\u8BCD\uFF1A
{prompt}

\u7528\u6237\u672C\u6B21\u7684\u9700\u6C42\uFF1A
{userInput}`;
var DEFAULT_CAPTION_PROMPT = `\u8BF7\u7528\u4E00\u53E5\u4E2D\u6587\u63CF\u8FF0\u8FD9\u5F20\u56FE\u7247\u7684\u5173\u952E\u89C6\u89C9\u7279\u5F81\uFF0C\u8FD9\u53E5\u8BDD\u5C06\u7528\u4E8E\u4EE5\u540E\u6309\u5173\u952E\u8BCD\u68C0\u7D22\u8FD9\u5F20\u53C2\u8003\u56FE\u3002

\u5FC5\u987B\u5C3D\u91CF\u5305\u542B\uFF1A\u4E3B\u4F53\uFF08\u4EBA\u7269/\u7269\u4EF6\uFF09\u3001\u53D1\u578B\u53D1\u8272\u3001\u670D\u88C5\u3001\u59FF\u6001\u6216\u52A8\u4F5C\u3001\u753B\u98CE\u6216\u573A\u666F\u3002
\u7528\u8BCD\u8981\u5177\u4F53\uFF0C\u4F8B\u5982\u5199\u300C\u7EA2\u53D1\u53CC\u9A6C\u5C3E\u300D\u300C\u767D\u8272\u6C34\u624B\u670D\u300D\u300C\u7AD9\u7ACB\u300D\u300C\u65E5\u7CFB\u539A\u6D82\u300D\uFF0C\u800C\u4E0D\u662F\u300C\u4E00\u4E2A\u5973\u5B69\u300D\u3002

\u53EA\u8F93\u51FA\u8FD9\u4E00\u53E5\u63CF\u8FF0\uFF0C\u4E0D\u8981\u89E3\u91CA\u3001\u4E0D\u8981\u6362\u884C\u3001\u4E0D\u8981 Markdown\u3001\u4E0D\u8981\u52A0\u5F15\u53F7\u3002`;
var DEFAULT_KEYWORD_PROMPT = `\u4F60\u662F\u4E00\u4E2A\u53C2\u8003\u56FE\u7247\u68C0\u7D22\u52A9\u624B\u3002\u7528\u6237\u8981\u7528 AI \u7ED8\u56FE\uFF0C\u9700\u8981\u4ECE\u4E0B\u9762\u7684\u56FE\u7247\u7D22\u5F15\u91CC\u627E\u51FA\u53EF\u80FD\u76F8\u5173\u7684\u53C2\u8003\u56FE\u3002

\u56FE\u7247\u7D22\u5F15\uFF08\u7F16\u53F7 | \u6240\u5C5E\u7EC4 | \u63CF\u8FF0\uFF09\uFF1A
{index}

\u7ED8\u56FE\u6307\u4EE4\uFF1A{command}
\u6307\u4EE4\u7528\u9014\u63D0\u793A\u8BCD\uFF1A{prompt}
\u7528\u6237\u9700\u6C42\uFF1A{userInput}

\u8BF7\u8F93\u51FA\uFF1A
1. keywords\uFF1A3-6 \u4E2A\u68C0\u7D22\u5173\u952E\u8BCD\uFF08\u4E2D\u6587\uFF0C\u63D0\u70BC\u7528\u6237\u9700\u6C42\u91CC\u7684\u6838\u5FC3\u89C6\u89C9\u8981\u7D20\uFF0C\u5982\u4EBA\u7269\u7279\u5F81\u3001\u53D1\u578B\u53D1\u8272\u3001\u670D\u88C5\u3001\u52A8\u4F5C\u3001\u753B\u98CE\u3001\u573A\u666F\uFF09\uFF0C
   \u7528\u4E8E\u5728\u5B8C\u6574\u56FE\u5E93\u91CC\u505A\u6587\u672C\u5339\u914D\u68C0\u7D22\u3002\u5173\u952E\u8BCD\u8981\u5199\u5F97\u50CF\u56FE\u7247\u63CF\u8FF0\u91CC\u4F1A\u51FA\u73B0\u7684\u8BCD\u3002
2. candidates\uFF1A\u4F60\u4ECE\u4E0A\u9762\u7D22\u5F15\u91CC\u76F4\u63A5\u770B\u4E2D\u7684\u7F16\u53F7\uFF08\u6700\u591A {topK} \u4E2A\uFF0C\u53EF\u4EE5\u4E3A\u7A7A\u6570\u7EC4\uFF09\u3002

\u53EA\u8F93\u51FA\u4E00\u4E2A JSON \u5BF9\u8C61\uFF0C\u4E0D\u8981\u8F93\u51FA\u89E3\u91CA\u6216\u4EE3\u7801\u5757\uFF1A
{"keywords":["\u5173\u952E\u8BCD1","\u5173\u952E\u8BCD2"],"candidates":[1,3]}`;
var defaultCommands = [
  {
    name: "\u624B\u529E\u5316",
    prompt: "Your task is to create a photorealistic, masterpiece-quality image of a 1/7 scale commercialized figurine based on the user's character. The final image must be in a realistic style and environment.\n\n**Crucial Instruction on Face & Likeness:** The figurine's face is the most critical element. It must be a perfect, high-fidelity 3D translation of the character from the source image. The sculpt must be sharp, clean, and intricately detailed, accurately capturing the original artwork's facial structure, eye style, expression, and hair. The final result must be immediately recognizable as the same character, elevated to a premium physical product standard. Do NOT generate a generic or abstract face.\n\n**Scene Composition (Strictly follow these details):**\n1. **Figurine & Base:** Place the figure on a computer desk. It must stand on a simple, circular, transparent acrylic base WITHOUT any text or markings.\n2. **Computer Monitor:** In the background, a computer monitor must display 3D modeling software (like ZBrush or Blender) with the digital sculpt of the very same figurine visible on the screen.\n3. **Artwork Display:** Next to the computer screen, include a transparent acrylic board with a wooden base. This board holds a print of the original 2D artwork that the figurine is based on.\n4. **Environment:** The overall setting is a desk, with elements like a keyboard to enhance realism. The lighting should be natural and well-lit, as if in a room.",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "\u624B\u529E\u53162",
    prompt: "Use the nano-banana model to create a 1/7 scale commercialized figure of thecharacter in the illustration, in a realistic styie and environment.Place the figure on a computer desk, using a circular transparent acrylic basewithout any text.On the computer screen, display the ZBrush modeling process of the figure.Next to the computer screen, place a BANDAl-style toy packaging box printedwith the original artwork.",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "\u624B\u529E\u53163",
    prompt: "Your primary mission is to accurately convert the subject from the user's photo into a photorealistic, masterpiece quality, 1/7 scale PVC figurine, presented in its commercial packaging.\n\n**Crucial First Step: Analyze the image to identify the subject's key attributes (e.g., human male, human female, animal, specific creature) and defining features (hair style, clothing, expression). The generated figurine must strictly adhere to these identified attributes.** This is a mandatory instruction to avoid generating a generic female figure.\n\n**Top Priority - Character Likeness:** The figurine's face MUST maintain a strong likeness to the original character. Your task is to translate the 2D facial features into a 3D sculpt, preserving the identity, expression, and core characteristics. If the source is blurry, interpret the features to create a sharp, well-defined version that is clearly recognizable as the same character.\n\n**Scene Details:**\n1. **Figurine:** The figure version of the photo I gave you, with a clear representation of PVC material, placed on a round plastic base.\n2. **Packaging:** Behind the figure, there should be a partially transparent plastic and paper box, with the character from the photo printed on it.\n3. **Environment:** The entire scene should be in an indoor setting with good lighting.",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "coser\u5316",
    prompt: "Create a realistic cosplay photograph of the character in the image. The cosplayer should be wearing a high-quality costume that accurately replicates the character's outfit. Include appropriate props and background setting that matches the character's universe. Focus on accurate representation of costume details and realistic materials. Draw the picture for me with the background of a comic convention. East-asian face.",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "mc\u5316",
    prompt: "Transform the image into a Minecraft-style character. Create a blocky, pixelated version of the character using Minecraft's visual style. Include appropriate Minecraft environment and elements in the background. The generated entities must be Minecraft-style entities or blocks/structures.",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "\u7EBF\u7A3F\u5316",
    prompt: "\u624B\u7ED8\u7EBF\u7A3F\uFF0C\u7CBE\u7EC6\u7684\u94C5\u7B14\u7D20\u63CF\u98CE\u683C\uFF0C\u7EB8\u4E0A\u7ED8\u753B\u6548\u679C\uFF0C\u6E05\u6670\u7684\u7EBF\u6761\u52FE\u52D2\uFF0C\u9002\u5EA6\u7684\u7EC6\u8282\u523B\u753B\u3002\u753B\u9762\u4E2D\u5305\u542B\u7ED8\u753B\u5DE5\u5177\uFF08\u5982\u94C5\u7B14\u3001\u6A61\u76AE\u3001\u5377\u7B14\u5200\u3001\u7D20\u63CF\u672C\uFF09\u81EA\u7136\u6563\u843D\u5728\u65C1\uFF0C\u5448\u73B0\u521B\u4F5C\u4E2D\u7684\u6C1B\u56F4\u3002\u7EBF\u6761\u9ED1\u767D\u7070\u8C03\u6027\uFF0C\u65E0\u8272\u5F69\uFF0C\u7A81\u51FA\u7EB8\u5F20\u7EB9\u7406\u548C\u624B\u7ED8\u8D28\u611F\uFF0C\u4E13\u6CE8\u4E8E\u5F62\u4F53\u7ED3\u6784\u548C\u8F6E\u5ED3\u8868\u73B0",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "\u7231\u4E0A\u6211\u4E86",
    prompt: "\u751F\u6210\u4E00\u5F20\u4E09\u683C\u6F2B\u753B\uFF0C\u753B\u9762\u4E0A\u65B9\u4E09\u5206\u4E4B\u4E00\u5904\u7684\u5DE6\u534A\u90E8\u5206\u662F\u7B2C\u4E00\u683C\uFF0C\u53F3\u534A\u90E8\u5206\u662F\u7B2C\u4E8C\u683C\uFF0C\u753B\u9762\u4E0B\u65B9\u5360\u603B\u753B\u9762\u4E09\u5206\u4E4B\u4E8C\u7684\u4F4D\u7F6E\u662F\u7B2C\u4E09\u683C\u3002\u8981\u6C42\u4EBA\u7269\u957F\u76F8\u670D\u88C5\u4E0E\u53C2\u8003\u56FE\u5B8C\u5168\u4E00\u81F4\u3002\u7B2C\u4E00\u683C\u4E3A\u4EBA\u7269\u7684\u9762\u90E8\u7279\u5199\uFF0C\u773C\u775B\u7741\u5927\uFF0C\u773C\u795E\u4E2D\u5E26\u7740\u4E00\u4E1D\u60CA\u8BB6\uFF0C\u5634\u5DF4\u88AB\u4E00\u53EA\u624B\u8F7B\u8F7B\u6342\u4F4F\uFF0C\u65C1\u8FB9\u914D\u6709\u4E00\u4E2A \u201C\uFF01\u201D \u7684\u7B26\u53F7\uFF0C\u6574\u4F53\u795E\u6001\u5448\u73B0\u51FA\u610F\u5916\u3001\u7565\u5E26\u7F9E\u602F\u7684\u611F\u89C9\uFF0C\u52A8\u4F5C\u4E0A\u662F\u5355\u624B\u63A9\u53E3\uFF0C\u59FF\u6001\u663E\u5F97\u8F83\u4E3A\u5A07\u4FCF\u3002\u7B2C\u4E8C\u683C\u4E5F\u662F\u4EBA\u7269\u7684\u9762\u90E8\u7279\u5199\uFF0C\u773C\u775B\u772F\u8D77\uFF0C\u5448\u73B0\u51FA\u7B11\u610F\uFF0C\u5634\u5DF4\u5FAE\u5F20\uFF0C\u90A3\u53EA\u6342\u4F4F\u5634\u7684\u624B\u8FD8\u4FDD\u6301\u7740\u52A8\u4F5C\uFF0C\u540C\u65F6\u6709 \u201C\u5657\uFF5E\u201D \u7684\u62DF\u58F0\u8BCD\uFF0C\u795E\u6001\u662F\u5F00\u5FC3\u3001\u4FCF\u76AE\u7684\uFF0C\u4EFF\u4F5B\u662F\u5FCD\u4E0D\u4F4F\u8981\u7B11\u51FA\u58F0\uFF0C\u52A8\u4F5C\u4E0A\u5EF6\u7EED\u4E86\u63A9\u53E3\u7684\u59FF\u6001\uFF0C\u5374\u591A\u4E86\u51E0\u5206\u6D3B\u6CFC\u7684\u60C5\u7EEA\u3002\u7B2C\u4E09\u683C\u80CC\u666F\u662F\u6709\u4E91\u6735\u7684\u5929\u7A7A\uFF0C\u753B\u9762\u53EA\u51FA\u73B0\u4E86\u4EBA\u7269\u7684\u4E0A\u534A\u8EAB\uFF0C\u4EBA\u7269\u753B\u98CE\u4E0E\u53C2\u8003\u56FE\u5B8C\u5168\u4E00\u81F4\u3002\u4EBA\u7269\u7684\u53D1\u4E1D\u88AB\u98CE\u5439\u8D77\uFF0C\u773C\u775B\u5F2F\u5F2F\uFF0C\u9762\u5E26\u67D4\u548C\u7684\u7B11\u5BB9\uFF0C\u8138\u988A\u8FD8\u6709\u6DE1\u6DE1\u7684\u7EA2\u6655\u3002\u5979\u59FF\u6001\u653E\u677E\uFF0C\u8EAB\u4F53\u7565\u5411\u524D\u503E\uFF0C\u53CC\u624B\u80CC\u5728\u8EAB\u540E\uFF0C\u6574\u4F53\u795E\u6001\u662F\u81EA\u4FE1\u4E14\u6E29\u67D4\uFF0C\u5448\u73B0\u51FA\u4E00\u79CD\u5927\u65B9\u53C8\u8FF7\u4EBA\u7684\u72B6\u6001\u3002\u7B2C\u4E09\u683C\u5DE6\u8FB9\u6709\u5706\u5F62\u5BF9\u8BDD\u6846\uFF0C\u5199\u7740\u201C\u4F60\u89C9\u5F97\u6211\u6F02\u4EAE\u201D\u3002\u53F3\u4FA7\u4E0B\u65B9\u6709\u5706\u5F62\u5BF9\u8BDD\u6846\uFF0C\u5199\u7740 \u90A3\u662F\u56E0\u4E3A\u4F60\u5DF2\u7ECF\u7231\u4E0A\u6211\u4E86\uFF0C\u7B28\u86CB",
    enabled: true,
    custom: true,
    maxImages: 1,
    waitTimeout: 60,
    defaultImageUrls: []
  },
  {
    name: "\u5408\u5E76\u56FE\u7247",
    prompt: "\u5C06\u4E24\u5F20\u56FE\u7247\u5408\u5E76\u4E3A\u4E00\u5F20",
    enabled: true,
    custom: true,
    maxImages: 2,
    waitTimeout: 60,
    defaultImageUrls: []
  },
  {
    name: "\u4FEE\u56FE",
    prompt: "\u4FEE\u590D\u56FE\u7247\u4E2D\u7684\u7F3A\u9677",
    enabled: true,
    custom: true,
    maxImages: 1,
    waitTimeout: 60,
    defaultImageUrls: []
  },
  {
    name: "\u624B\u529E\u53164",
    prompt: "Please accurately transform the subject in this photo into a realistic, masterpiece-worthy 1/7 scale PVC figurine. This figurine must possess 3D dimensionality, and the PVC texture must be clearly represented. The figurine is placed in a figurine display cabinet made of multi-layered glass; appropriate space should be left between the top of the figurine and the upper shelf, and the figurine must be paired with a transparent base. The indoor scene must be visible through the glass. Different figurines can be placed on other shelves, but they should exhibit a natural depth of field and blurred effect to further enhance the sense of spatial depth and highlight the main figurine. The scene requires a bright main light source, and the display cabinet should be embedded with dim LED strip lights; the overall light and reflections must blend naturally with the scene. The frame angle does not need to be fixed in a specific orientation.\nDetail Specifications: Every part of the figurine must be 3D dimensional, and flat or two-dimensional effects are prohibited; under no circumstances shall contour lines or outlines appear; when repairing missing parts of the figurine, no low-quality content shall appear; if repairing a human figure, it is necessary to ensure normal limb shape, coordinated movements, and reasonable proportions of all parts; if the original photo is not a full-body shot, try to supplement the figurine into a full-body form as much as possible; the expression, movements, and angle of the human figurine must be completely consistent with the original photo, but it must be 3D dimensional; the head of the human figurine must not be too large, the legs must not be too short, and the overall figure must not look short; for chibi cartoon subjects, their original proportions shall be retained, but they must be 3D dimensional; if the subject is an animal, its fur should be simplified to make it more like a figurine product; attention must be paid to following the perspective principle of objects appearing larger when closer and smaller when farther away.",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "\u624B\u529E\u53165",
    prompt: "Realistic PVC figure based on the game screenshot character, exact pose replication highly detailed textures PVC material with subtle sheen and smooth paint finish, placed on an indoor wooden computer desk (with subtle desk items like a figure box/mouse), illuminated by soft indoor light (mix of desk lamp and natural window light) for realistic shadows and highlights, macro photography style,high resolution,sharp focus on the figure,shallow depth of field (desk background slightly blurred but visible), no stylization,true-to-reference color and design, 1:1scale.",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "\u624B\u529E\u53166",
    prompt: "Create a premium, collectible 1/7 scale standalone figurine based on the image, meticulously replicating the character, made from smooth PVC and ABS plastic with a professional matte finish. It stands on a minimalist transparent acrylic base. Next to it is its retail packaging box displaying the price and brand information, with the figure wrapped in plastic inside the slightly larger box. They are naturally arranged on a clean wooden table surrounded by reference books, with a bookshelf in the background and soft afternoon sunlight streaming through the window. Photo-realistic, DSLR effect, depth of field, bokeh background.",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "Q\u7248\u5316",
    prompt: "((chibi style)), ((super-deformed)), ((head-to-body ratio 1:2)), ((huge head, tiny body)), ((smooth rounded limbs)), ((soft balloon-like hands and feet)), ((plump cheeks)), ((childlike big eyes)), ((simplified facial features)), ((smooth matte skin, no pores)), ((soft pastel color palette)), ((gentle ambient lighting, natural shadows)), ((same facial expression, same pose, same background scene)), ((seamless integration with original environment, correct perspective and scale)), ((no outline or thin soft outline)), ((high resolution, sharp focus, 8k, ultra-detailed)), avoid: realistic proportions, long limbs, sharp edges, harsh lighting, wrinkles, blemishes, thick black outlines, low resolution, blurry, extra limbs, distorted face",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "cos\u5316",
    prompt: "Generate a highly detailed photo of a real-life girl cosplaying this illustration, at Comiket. Exactly replicate the same pose, body posture, hand gestures, facial expression, and camera framing as in the original illustration. Keep the same angle, perspective, and composition, without any deviation.",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "cos\u81EA\u62CD",
    prompt: "Generate a first-person perspective (POV) snapshot of a cosplayer in a cluttered bedroom. The cosplayer's hairstyle and anime costume must exactly match the subject in the reference image. She holds a phone in front of her face with both hands, completely covering her face. The phone screen is the focal point of the image, displaying the uploaded picture. The background is a room filled with posters on the walls and a slightly messy bed. The image should have a casual, informal snapshot quality with a slightly low-resolution and grainy texture, lit by natural indoor lighting.",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "\u75DB\u5C4B\u5316",
    prompt: "[ABSOLUTE PRIORITY AND NON-NEGOTIABLE DIRECTIVE] Based on the provided reference image, generate a hyper-detailed photograph of a maximalist otaku shrine with a strict, uncompromising requirement: all character-related elements\u2014including figures, posters, bedding patterns, and the PC wallpaper\u2014must be a 90%+ faithful, pixel-perfect replication of the character in the reference image. Strictly maintain the precise facial features, hairstyle, outfit, and expression with zero artistic reinterpretation or stylistic variation. With this core rule, create the scene at a 16:9 aspect ratio. The room is densely packed from floor to ceiling with merchandise that is an exact reproduction of this source character. The entire space is bathed in a moody, immersive ambient glow dominated by the reference character's primary color scheme (e.g., deep purple), which is sharply contrasted by a focused, brighter white light from a monitor screen bar lamp, creating dramatic visual layers. The walls are a collage made of posters and prints that are direct, unaltered copies of the reference image itself; the glass cabinets are cluttered with high-poly figures that are perfect 1:1 replicas of the reference character model; and the ultrawide monitor clearly displays the original reference image as its wallpaper. The final image must be a photorealistic, lived-in sanctuary, defined by its obsessive and flawless fidelity to the source character.",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "\u75DB\u5C4B\u53162",
    prompt: "Transform the uploaded indoor photo into a Japanese-style ita-room with the following specific requirements: Walls: Generate multi-size posters/scrolls (A2/A3/banner mixed arrangement) in an orderly matrix; no watermarks or garbled text. Curtains and bedding: Fully replace with themed patterns while retaining fabric folds and textures; pillowcases and life-sized cushions use the same character design. Display: Add glass display cabinets and open shelves, densely displaying themed figurines, acrylic stands, badge boards, and boxed peripherals of the same theme; arrange them in groups by height and color system. Desk: Keep the original equipment and light and shadow, only replace the screensaver/wallpaper with themed images; organize the wires neatly. Lighting: Add soft RGB light strips (along the ceiling and desk edges), coordinated with the main color, avoiding overexposure and color overflow. Texture: Realistic materials for PVC figurines, spray-painted paper, acrylic, and cotton fabrics; natural glass reflections without ghosting. Consistency: The face, hair color, and clothing details of the character on all carriers (posters/cushions/stands/box art) must maintain the same character and art style. Constraints (negative): No brand logos, watermarks, typos, distorted faces, perspective errors, repeated textures, over-sharpening, or noise.",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "\u75DB\u8F66\u5316",
    prompt: "A Xiaomi SU7 electric sedan with a professional 'itasha' wrap, parked on a rain-slicked, neon-lit city street at dusk. Accurately depict the Xiaomi SU7 body shape, grille-less front fascia, slim headlights, taillights, wheel design, and logo placements. The entire car is covered in a vibrant, high-resolution decal featuring multiple dynamic poses and expressions of ONLY the provided anime character. The glossy finish reflects colorful city lights, making the character artwork pop.Seamless full-body wrap integrating hood, doors, and rear quarter panels. Dynamic three-quarter front view showcasing the hood and side artwork.",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "\u5B64\u72EC\u7684\u6211",
    prompt: "Generate a hyper-realistic photograph with RAW photo quality, captured by a top-tier camera. The image must exhibit realistic skin textures, rich lighting layers, and a natural depth of field. Absolutely no anime, cartoon, CG, or painted elements are allowed\u2014the result must be a 100% authentic photographic representation. The scene is set in a restaurant, captured from a first-person perspective. I am sitting alone, holding chopsticks in one hand and a phone in the other, displaying a photo of a beautiful cosplayer. In the background, the same cosplayer (dressed as the anime character) is dining with her boyfriend, feeding him a bite of food. The composition should evoke a sense of loneliness and contrast between the observer and the observed.",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "\u7B2C\u4E00\u89C6\u89D2",
    prompt: "At the venue of Japan's Comic Market Doujinshi Sales Event commonly known as Comiket a real Chinese boy or girl of the same gender as the character in the original image is sitting directly opposite you wearing a costume consistent with the one in the original image. A double meal set including hamburgers and French fries is placed on your table with crumpled tissues and some food scraps scattered beside it creating a strong sense of realism. Your Android phone is casually laid on the table and its screen displays an unedited original image of the character. The person is engaging in intimate interaction with you gazing gently into your eyes leaning slightly towards you and placing one hand softly on your arm.You are holding a hamburger or a few French fries.",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "\u7B2C\u4E09\u89C6\u89D2",
    prompt: "A scene in a bright, modern McDonald\u2019s or KFC restaurant at night, consistent with the visual style of the provided original image (no AI-generated imagery). In front of you (the viewer), there are foods like a hamburger and a small serving of French fries (with a visibly small portion) on the table, along with a crumpled used tissue, a few food crumbs (adding a sense of realism), and an Android phone (with a character displayed on the screen)\u2014you are holding a hamburger or a French fry in your hand. At a very nearby separate table (not a shared table)\u2014so close that it\u2019s within easy sight\u2014two Chinese people are sitting and engaging in intimate interactions (e.g., gentle eye contact, leaning slightly towards each other, or one resting a hand lightly on the other\u2019s arm). One of them is a coser dressed exactly as the character on your Android phone, with the coser\u2019s gender strictly corresponding to the character\u2019s gender (male coser remains male, female coser remains female, no gender reversal) and matching that of the character in the provided original image; the other is a man. On their table, there is a two-person set meal, and both figures are slightly blurred (not overly so). The overall atmosphere blends a relaxed dining vibe with character-related elements, featuring natural lighting, and adheres to the visual style of the original image.",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "\u9B3C\u56FE",
    prompt: "Convert the Input Image into a Convincing, Found-Footage Style Cryptid Sighting Photograph 1. The image should depict a [insert creature name or description - e.g., slender, pale humanoid; multi-limbed, insect-like entity; shadowy, canine-like beast], and the creature\u2019s appearance must be highly similar to that in the original image. The creature should be spotted in a hyperrealistic and eerily desolate location, such as [e.g., an abandoned industrial complex at night, a remote, snow-covered mountain pass, the murky depths of a forgotten urban canal, a desolate rural road in the dead of winter]. 2. The shot must appear accidental, amateurish, and raw, as if captured spontaneously by a low-fidelity device like a [e.g., degraded VHS camcorder, grainy security camera, old disposable camera with flash, an infrared trail cam that's seen better days]. 3. To maximize the unsettling authenticity, the image quality should be significantly imperfect: featuring extreme [e.g., heavy digital noise, pronounced film grain, severe motion blur making details indistinct, a strong, disorienting lens flare, being significantly out of focus, or displaying visible static and tracking lines]. The creature should be partially obscured and difficult to clearly discern, perhaps hidden by [e.g., dense, skeletal tree branches; thick, unnatural fog; distorted reflections on murky water; the jagged silhouette of derelict machinery; or existing within deep, oppressive shadows]. 4. The lighting is critically dim and unsettling, possibly at [e.g., the darkest hour before dawn, a moonless midnight, or starkly illuminated by a harsh, direct, and slightly malfunctioning camera flash that overexposes parts of the scene].5. The overall feeling should evoke profound unease, dread, and a sense of witnessing something truly inexplicable and horrifying. Emphasize an atmosphere of isolation, decay, and the uncanny. 6. Keywords: cryptozoology, urban legend, paranormal, faked sighting, unsettling, horror, cryptid, grotesque, eerie, found footage, degraded quality, creature feature.",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "\u8D34\u7EB8\u5316",
    prompt: "Generate A creative collage artwork based on the provided input image. The artwork should be created using a variety of materials such as paper, fabric, and found objects to achieve a textured, layered look. The composition should capture the essence of the original subject while incorporating collage techniques such as cutting, layering, and mixed media. The final piece should have a dynamic",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "\u7389\u8DB3",
    prompt: "Use the attached image as the exact protagonist (identity lock), maintaining exact facial features, hairstyle, and distinctive characteristics from the reference image. 1/7 scale commercial figurine, nano-banana model, hyper-detailed PVC figure. A character sitting on the ground with body positioned on the left side of the frame. From the character's perspective: RIGHT LEG fully extended straight forward, while LEFT LEG bent at the knee with foot flat on the ground. From viewer's perspective: The extended RIGHT LEG of the character appears on the LEFT SIDE of the frame, creating strong forced perspective with LOW ANGLE SHOT (foot size 2x larger than head). The character's extended right foot (viewer's left side) must be in sharp focus with soft milky-white skin tone, subtle pink undertones, and sole facing viewer at 45\xB0, showing exactly 5 distinct toes with natural nail beds and delicate skin texture. Smooth, soft skin with a healthy, supple appearance. Arms crossed on chest, realistic hand-painted details, translucent PVC material effect. No background elements - focus entirely on the figurine's pose and foot details.",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "\u73A9\u5076\u5316",
    prompt: "Reshape the character in the picture into a top-tier collectible *fumo*, with a fully soft and dynamic pose, and place it on the character theme fur pad. High-precision material, hand-stitched, the texture of the plush fabric and the clothing is truly distinct.\nIts eyes are the signature large embroidered semi-oval ones, without pupils, presenting a flat, sleepy or listless expression.\nThe main light source is soft diffused light, highlighting the fluffy feeling and soft texture, without overexposure. Powerful fill light eliminates dead black, and details are fully visible. The background is a blurred depth of field by the window, and the product packaging box is faintly visible on the side and rear. The sticker on the packaging box should be the original uploaded image.\nMuseum-level photography quality, every detail of the body is intact, and the embroidered facial features are exquisite and accurate.\nProhibited: Any 2D elements or direct copying of the original image, plastic feel, hard texture, blurred face, misaligned facial features, and loss of details.",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "cos\u76F8\u9047",
    prompt: "A lively comic convention scene with a bustling real-world environment, featuring the original manga-style character from the input image, retaining her exact colorful design, unique art style, and distinct features (including her specific hair color, outfit, and expression). The character remains a vibrant, non-realistic manga-style figure, not a 2D flat plane but preserving her original artistic depth and color palette. She stands in a crowded convention hall with colorful cosplay booths and attendees. Facing her is a cosplayer dressed in an identical outfit, mimicking her pose, both positioned at a 45-degree angle toward the viewer. The background is a detailed, realistic comic convention with vivid colors, dynamic crowd, and cosplay elements, creating a surreal blend of the manga character\u2019s vibrant, non-realistic style with a real-world setting. Emphasize the magical encounter between the manga character and her cosplayer counterpart.",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "\u4E09\u89C6\u56FE",
    prompt: "a 3-view orthographic drawing of a young woman from a photo, showing front, right side, and back views. Realistic rendering, professional character sheet style, on a white background",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "\u7A7F\u642D\u62C6\u89E3",
    prompt: "A professional e-commerce fashion showcase featuring the clothing worn by the character from the input image, presented in a clean, studio-style setting. The outfit is decomposed into individual pieces (e.g., top, bottom, jacket, shoes, accessories), each clearly displayed and arranged in an organized, visually appealing layout. Each clothing item retains the exact design, color, texture, and details from the original image, showcased with crisp lighting and high-definition clarity. The background is minimalistic, white or neutral, to emphasize the clothing details, suitable for an online retail platform. The presentation includes subtle annotations or labels for each item, ensuring a polished, catalog-style look for wear and styling inspiration.",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "\u62C6\u89E3\u56FE",
    prompt: "Convert the people in the photos to the style of a model kit box, rendered in isometric perspective. Label the box with the title\u201CZhogue\u201D. Inside the box, a gouda-styled robotic version of the person in the photo is displayed, along with its essentials (such as cosmetics, bags, or other items) redesigned as a futuristic mechanical accessory. The box should resemble a real Gunpla box, with technical illustrations, manual-style details, and sci-fi fonts. Next to the box, the actual gouda-style robot itself is also displayed, rendered in a realistic and lifelike style on the outside of the packaging, similar to the official Bandai propaganda renderings.",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "\u89D2\u8272\u754C\u9762",
    prompt: "Transform the input person image into a game character selection interface. Display the character on the right side as a full-body portrait, standing upright at a 45-degree angle facing both the screen and the left-side selection module, mimicking a selected state in a video game. Retain the person image's facial features, expression, and hairstyle, but adapt the clothing to a game-inspired style (e.g., fantasy armor, sci-fi suit, or RPG adventurer outfit) with intricate details, vibrant textures, and thematic accessories, while preserving the original clothing's color scheme and general aesthetic. If the input is a half-body image, seamlessly complete the lower body, matching the game-style clothing and proportions. On the left side, present a sleek interface with selectable options including game-style clothing variations (e.g., different armor sets, robes, tactical gear), martial stats (e.g., strength, agility), equipment (e.g., swords, gadgets, shields), and health points, styled as interactive game UI elements with clear labels and modern design. Arrange the layout to mimic a video game character selection screen, with a smooth, unified background gradient (e.g., dark blue to soft gray) for a cohesive, natural transition across the image. Use consistent, cinematic lighting and subtle glow effects to enhance the game-like atmosphere while maintaining the character's real-world facial essence.",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "\u89D2\u8272\u8BBE\u5B9A",
    prompt: "\u4E3A\u6211\u751F\u6210\u4EBA\u7269\u7684\u89D2\u8272\u8BBE\u5B9A\uFF08Character Design\uFF09,\u6BD4\u4F8B\u8BBE\u5B9A\uFF08\u4E0D\u540C\u8EAB\u9AD8\u5BF9\u6BD4\u3001\u5934\u8EAB\u6BD4\u7B49\uFF09,\u4E09\u89C6\u56FE\uFF08\u6B63\u9762\u3001\u4FA7\u9762\u3001\u80CC\u9762\uFF09,\u8868\u60C5\u8BBE\u5B9A\uFF08Expression Sheet\uFF09 \u2192 \u5C31\u662F\u4F60\u53D1\u7684\u90A3\u79CD\u56FE,\u52A8\u4F5C\u8BBE\u5B9A\uFF08Pose Sheet\uFF09 \u2192 \u5404\u79CD\u5E38\u89C1\u59FF\u52BF,\u670D\u88C5\u8BBE\u5B9A\uFF08Costume Design\uFF09",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "3D\u6253\u5370",
    prompt: "Please transform the object in the uploaded image into a collectible figurine.Behind it, place a figurine box printed with the object's image and its name. Next to it, add a high-end 3D printer that is currently printing the figurine. In front of the figurine box, add a round plastic base for the figurine to stand on.The PVC material of the base should have a crystal-clear, translucent texture, and set the entire scene indoors.",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "\u5FAE\u578B\u5316",
    prompt: "A high-resolution advertising photograph of a realistic, miniature [PRODUCT] held delicately between a person's thumb and index finger. clean and white background, studio lighting, soft shadows. The hand is well-groomed, natural skin tone, and positioned to highlight the product's shape and details. The product appears extremely small but hyper-detailed and brand-accurate, centered in the frame with a shallow depth of field. Emulates luxury product photography and minimalist commercial style.",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "\u6302\u4EF6\u5316",
    prompt: "Turn this photo into a cute charm / a flat acrylic keychain / a flat rubber keychain to hang on an LV bag / the bag in photo 2.",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "\u59FF\u52BF\u8868",
    prompt: "\u8BF7\u4E3A\u8FD9\u5E45\u63D2\u56FE\u521B\u5EFA\u4E00\u4E2A\u59FF\u52BF\u8868\uFF0C\u6446\u51FA\u5404\u79CD\u59FF\u52BF",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "\u9AD8\u6E05\u4FEE\u590D",
    prompt: "Enhance this image to high resolution",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "\u4EBA\u7269\u8F6C\u8EAB",
    prompt: "show me this scene from behind the subjects. keep the details and the lighting identical",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "\u7ED8\u753B\u56DB\u5BAB\u683C",
    prompt: "Step 1: line drawing. Step 2: tile colors. Step 3: Add Shadows. Step 4: Refine and shape. No words",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "\u53D1\u578B\u4E5D\u5BAB\u683C",
    prompt: "A professional hairstyle showcase based on the input image of a person's upper body and face, displaying the character with nine distinct hairstyles arranged in a clean, grid-like layout (3x3 grid) on a single image. Each hairstyle replaces the original hair while preserving the person's facial features, skin tone, and clothing details from the input image. The hairstyles include a variety of styles: short pixie cut, long wavy hair, sleek bob, voluminous curls, high ponytail, messy bun, side-swept bangs, braided updo, and straight layered cut, each rendered with realistic textures and natural lighting. The background is a consistent, neutral color (pure white or light gray) to emphasize the hairstyles and maintain a polished, professional look suitable for hairstyle selection. Subtle labels beneath each hairstyle indicate the style name for clarity.",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "\u5934\u50CF\u4E5D\u5BAB\u683C",
    prompt: "Id photos of the person in the picture with 9 different hairstyles, showing close-ups of the person with each hairstyle (Japanese, Korean, n) , keeping the features and clothes, and integration of the output for a nine grid picture",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "\u8868\u60C5\u4E5D\u5BAB\u683C",
    prompt: "Transform the input person image (half-body portrait) into a 3x3 grid of nine distinct images, each showcasing a different facial expression with the corresponding text label below the face, while retaining the original character's facial features, hairstyle, and clothing details. Arrange the expressions as follows: top row (happy with raised corners and squinted eyes labeled 'Happy', sad with downturned mouth and raised inner brows labeled 'Sad', angry with furrowed brows and narrowed eyes labeled 'Angry'); middle row (surprised with wide eyes and open mouth labeled 'Surprised', fearful with wide eyes and tense brows labeled 'Fearful', disgusted with wrinkled nose and pursed lips labeled 'Disgusted'); bottom row (confused with uneven brows and asymmetrical mouth labeled 'Confused', proud with lifted chin and firm gaze labeled 'Proud', embarrassed with tense smile and downward gaze labeled 'Embarrassed'). Ensure each cell reflects the described expression naturally, with seamless completion of the lower body to match the original clothing style. Use a soft, unified background (e.g., light gray) and consistent lighting across all grids to maintain coherence and focus on the expressions.",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "\u591A\u673A\u4F4D",
    prompt: "\u751F\u6210\u8FD9\u5F20\u56FE\u7247\u7684\u6B63\u8138\u7279\u5199\u3001\u4FA7\u8EAB\u7167\u3001\u8FDC\u666F\u3001\u80CC\u5F71\u7684\u56DB\u79CD\u591A\u673A\u4F4D\u955C\u5934\uFF0C\u7136\u540E\u6574\u5408\u8F93\u51FA\u5230\u4E00\u5F20\u7167\u7247\u91CC\uFF0C\u4FDD\u6301\u4EBA\u7269\u9AD8\u5EA6\u7684\u4E00\u81F4\u6027\uFF0C\u9002\u5408\u751F\u6210\u8FDE\u7EED\u5267\u60C5\u611F\u955C\u5934",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "\u7535\u5F71\u5206\u955C",
    prompt: "\u7528\u8FD9\u56FE\u91CC\u7684\u89D2\u8272\u521B\u4F5C\u4E00\u4E2A\u4EE4\u4EBA\u4E0A\u763E\u768412\u90E8\u5206\u6545\u4E8B\uFF0C\u5305\u542B12\u5F20\u56FE\u50CF\uFF0C\u8BB2\u8FF0\u7ECF\u5178\u7684\u9ED1\u8272\u7535\u5F71\u4FA6\u63A2\u6545\u4E8B\u3002\u6545\u4E8B\u5173\u4E8E\u4ED6\u4EEC\u5BFB\u627E\u7EBF\u7D22\u5E76\u6700\u7EC8\u53D1\u73B0\u7684\u5931\u843D\u7684\u5B9D\u85CF\u3002\u6574\u4E2A\u6545\u4E8B\u5145\u6EE1\u523A\u6FC0\uFF0C\u6709\u60C5\u611F\u7684\u9AD8\u6F6E\u548C\u4F4E\u8C37\uFF0C\u4EE5\u7CBE\u5F69\u7684\u8F6C\u6298\u548C\u9AD8\u6F6E\u7ED3\u5C3E\u3002\u4E0D\u8981\u5728\u56FE\u50CF\u4E2D\u5305\u542B\u4EFB\u4F55\u6587\u5B57\u6216\u6587\u672C\uFF0C\u7EAF\u7CB9\u901A\u8FC7\u56FE\u50CF\u672C\u8EAB\u8BB2\u8FF0\u6545\u4E8B",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "\u52A8\u6F2B\u5206\u955C",
    prompt: "According to the content of the picture to generate nine frames of comics, with pictures and lenses to tell a story.",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "\u771F\u4EBA\u5316",
    prompt: "in Studio, pure white background, a cosplayer dressed in an identical outfit, as the girl in the reference image, mimicking her pose and outfit. enhanced with film grain for a gritty, authentic particle effect reminiscent of 35mm film stock; 8K ultra-HD, sharp and believable, no abstraction.",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "\u771F\u4EBA\u53162",
    prompt: "Generate a highly detailed photo of a girl cosplaying this illustration, at Comiket. Exactly replicate the same pose, body posture, hand gestures, facial expression, and camera framing as in the original illustration. Keep the same angle, perspective, and composition, without any deviation",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "\u534A\u771F\u4EBA",
    prompt: "Take the image of the woman in [Input Photo]. Apply a creative split-style effect. Keep the lower half of her body (legs and boots) as the original photograph. Transform the upper half of her body (torso, arms, head) into a vibrant, 2D anime style with bold outlines and flat colors, similar to the anime 'Cyberpunk: Edgerunners'. The transition between the two styles should be a clean, slightly curved line.",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  },
  {
    name: "\u534A\u878D\u5408",
    prompt: "A striking, high-definition frontal portrait of the character from the input photo, with the face perfectly centered. The image blends two styles seamlessly: the left half retains the character's original realistic appearance, including detailed skin textures, natural lighting, and exact facial features from the input image, while the right half transitions into a vibrant manga-style version, featuring bold outlines, expressive eyes, and stylized features typical of high-quality anime art, while preserving recognizable traits (e.g., hair shape, facial structure). The transition between the realistic and manga halves is smooth and gradual, with no visible dividing line, ensuring a natural, cohesive fusion at the center of the face. The blending emphasizes the contrast between realistic and manga aesthetics while maintaining a unified appearance. The background is a neutral, solid color (e.g., soft gray or white) to highlight the fusion effect, with consistent lighting to enhance the artistic impact and no harsh separation.",
    enabled: true,
    custom: false,
    maxImages: 1,
    waitTimeout: 50,
    defaultImageUrls: []
  }
];
var Config = import_koishi.Schema.intersect([
  import_koishi.Schema.object({
    basename: import_koishi.Schema.string().default(name).description("\u7236\u7EA7\u6307\u4EE4\u540D\u79F0"),
    nested: import_koishi.Schema.object({
      commands: import_koishi.Schema.array(
        import_koishi.Schema.object({
          name: import_koishi.Schema.string().required().description("\u6307\u4EE4\u540D\u79F0"),
          prompt: import_koishi.Schema.string().role("textarea", { rows: [6, 4] }).description("\u8BE5\u6307\u4EE4\u5BF9\u5E94\u7684\u63D0\u793A\u8BCD\uFF08\u81EA\u5B9A\u4E49\u6307\u4EE4\u53EF\u7559\u7A7A\uFF09"),
          enabled: import_koishi.Schema.boolean().default(true).description("\u662F\u5426\u542F\u7528\u8BE5\u6307\u4EE4"),
          custom: import_koishi.Schema.boolean().default(false).description("\u662F\u5426\u4E3A\u81EA\u5B9A\u4E49\u6307\u4EE4\uFF08\u5141\u8BB8\u7528\u6237\u8F93\u5165\u63D0\u793A\u8BCD\uFF09"),
          maxImages: import_koishi.Schema.number().default(1).min(0).max(5).description("\u9700\u8981\u7528\u6237\u63D0\u4F9B\u7684\u6700\u5927\u56FE\u7247\u6570\u91CF\uFF08\u4E0D\u5305\u62EC\u9ED8\u8BA4\u56FE\u7247\uFF09"),
          waitTimeout: import_koishi.Schema.number().default(30).max(120).min(10).step(1).description("\u7B49\u5F85\u8F93\u5165\u56FE\u7247\u7684\u6700\u5927\u65F6\u95F4\uFF08\u79D2\uFF09"),
          defaultImageUrls: import_koishi.Schema.array(import_koishi.Schema.string().role("link")).description("\u9ED8\u8BA4\u56FE\u7247URL\u5217\u8868\uFF08\u4E0D\u8BA1\u5165\u7528\u6237\u56FE\u7247\u6570\u91CF\uFF09").default([]),
          referenceGroups: import_koishi.Schema.array(import_koishi.Schema.string()).description("\u5F15\u7528\u7684\u53C2\u8003\u56FE\u7247\u7EC4\u540D\u79F0\uFF08AI \u5C06\u4ECE\u8FD9\u4E9B\u7EC4\u4E2D\u6311\u9009\u56FE\u7247\uFF0C\u7559\u7A7A\u5219\u7531\u300CAI \u9009\u56FE\u8BBE\u7F6E\u300D\u51B3\u5B9A\u662F\u5426\u4F7F\u7528\u5168\u90E8\u7EC4\uFF09").default([]),
          aiSelect: import_koishi.Schema.boolean().default(true).description("\u542F\u7528 AI \u667A\u80FD\u9009\u62E9\u53C2\u8003\u56FE\u7247"),
          aiMaxSelect: import_koishi.Schema.number().default(0).min(0).max(10).step(1).description("AI \u6700\u591A\u4E3A\u8BE5\u6307\u4EE4\u9009\u62E9\u7684\u53C2\u8003\u56FE\u7247\u6570\u91CF\uFF080 = \u8DDF\u968F\u300CAI \u9009\u56FE\u8BBE\u7F6E\u300D\u91CC\u7684\u5168\u5C40\u6570\u91CF\uFF09"),
          aiAskUser: import_koishi.Schema.boolean().default(true).description("\u7F3A\u5C11\u5408\u9002\u53C2\u8003\u56FE\u65F6\u8BE2\u95EE\u7528\u6237\u8865\u5145\u53D1\u9001")
        })
      ).description("\u6307\u4EE4\u914D\u7F6E").default(defaultCommands)
    }).collapse().description("\u6307\u4EE4\u914D\u7F6E\u9879\u592A\u957F\u5566\uFF0C\u8FD9\u6837\u6298\u53E0\u8D77\u6765\u66F4\u65B9\u4FBF\u54E6~"),
    defaultWaitTimeout: import_koishi.Schema.number().default(50).max(120).min(10).step(1).description("\u9ED8\u8BA4\u7B49\u5F85\u8F93\u5165\u56FE\u7247\u7684\u6700\u5927\u65F6\u95F4\uFF08\u79D2\uFF09")
  }).description("\u57FA\u7840\u914D\u7F6E"),
  import_koishi.Schema.object({
    referenceGroups: import_koishi.Schema.array(
      import_koishi.Schema.object({
        name: import_koishi.Schema.string().required().description("\u7EC4\u540D\u79F0\uFF08\u5728\u6307\u4EE4\u914D\u7F6E\u4E2D\u901A\u8FC7\u6B64\u540D\u79F0\u5F15\u7528\uFF09"),
        enabled: import_koishi.Schema.boolean().default(true).description("\u662F\u5426\u542F\u7528\u8BE5\u7EC4"),
        items: import_koishi.Schema.array(
          import_koishi.Schema.object({
            url: import_koishi.Schema.string().role("link").required().description("\u56FE\u7247\u94FE\u63A5"),
            description: import_koishi.Schema.string().role("textarea", { rows: [2, 2] }).description("\u56FE\u7247\u63CF\u8FF0\uFF08AI \u4F9D\u636E\u8BE5\u63CF\u8FF0\u5224\u65AD\u662F\u5426\u9700\u8981\u9009\u7528\u6B64\u56FE\uFF09")
          })
        ).description("\u7EC4\u5185\u53C2\u8003\u56FE\u7247").default([])
      })
    ).description("\u53C2\u8003\u56FE\u7247\u7EC4\uFF08\u586B\u5199\u94FE\u63A5 + \u63CF\u8FF0\uFF0C\u6CE8\u518C\u4E3A\u4E00\u7EC4\uFF09").default([])
  }).description("\u53C2\u8003\u56FE\u7247\u7EC4"),
  import_koishi.Schema.object({
    baseUrl: import_koishi.Schema.string().default("https://api.gptgod.online/v1/chat/completions").role("link").description("API \u670D\u52A1\u5668\u5730\u5740\uFF08OpenAI \u517C\u5BB9 Chat Completions \u63A5\u53E3\uFF09"),
    model: import_koishi.Schema.string().default("gpt-image-2.5").description("\u4F7F\u7528\u7684\u6A21\u578B\u540D\u79F0"),
    apiKey: import_koishi.Schema.string().role("secret").description("API \u5BC6\u94A5"),
    maxRetries: import_koishi.Schema.number().default(3).description("\u6700\u5927\u91CD\u8BD5\u6B21\u6570"),
    retryInterval: import_koishi.Schema.number().default(1e3).description("\u91CD\u8BD5\u95F4\u9694(\u6BEB\u79D2)")
  }).description("API \u8BBE\u7F6E"),
  import_koishi.Schema.object({
    resultGallery: import_koishi.Schema.object({
      enabled: import_koishi.Schema.boolean().default(false).description("\u628A\u751F\u6210\u7ED3\u679C\u81EA\u52A8\u5B58\u5165\u56FE\u5E93\uFF0C\u4E0B\u6B21\u80FD\u88AB\u68C0\u7D22\u5230\uFF08\u5F62\u6210\u95ED\u73AF\uFF09"),
      groupName: import_koishi.Schema.string().default("\u751F\u6210\u7ED3\u679C").description("\u5B58\u5165\u54EA\u4E2A\u53C2\u8003\u56FE\u7247\u7EC4\uFF08\u4E0D\u5B58\u5728\u4F1A\u81EA\u52A8\u521B\u5EFA\uFF1B\u6307\u4EE4\u9700\u5F15\u7528\u8BE5\u7EC4\u6216\u5F00\u542F\u300C\u4F7F\u7528\u5168\u90E8\u7EC4\u300D\u624D\u80FD\u88AB\u68C0\u7D22\u5230\uFF09"),
      descriptionSource: import_koishi.Schema.union([
        import_koishi.Schema.const("prompt").description("\u7528\u5B8C\u6574\u63D0\u793A\u8BCD"),
        import_koishi.Schema.const("userInput").description("\u7528\u7528\u6237\u9644\u52A0\u9700\u6C42"),
        import_koishi.Schema.const("both").description("\u4E24\u8005\u62FC\u63A5")
      ]).default("prompt").description("\u7528\u4EC0\u4E48\u5F53\u5165\u5E93\u56FE\u7247\u7684\u63CF\u8FF0"),
      maxLength: import_koishi.Schema.number().default(120).min(20).max(2e3).step(10).description("\u63CF\u8FF0\u622A\u65AD\u957F\u5EA6\uFF08\u63D0\u793A\u8BCD\u901A\u5E38\u5F88\u957F\uFF09"),
      capacity: import_koishi.Schema.number().default(50).min(1).max(500).step(1).description("\u56FE\u5E93\u5BB9\u91CF\u4E0A\u9650\uFF0C\u8D85\u51FA\u540E\u6DD8\u6C70\u6700\u65E7\u7684"),
      commandName: import_koishi.Schema.string().default("\u56FE\u5E93").description("\u67E5\u770B/\u6E05\u7A7A\u56FE\u5E93\u7684\u6307\u4EE4\u540D")
    }).description("\u751F\u6210\u7ED3\u679C\u5165\u5E93\u914D\u7F6E\uFF08\u56FE\u5E93\uFF09")
  }).description("\u751F\u6210\u7ED3\u679C\u5165\u5E93"),
  import_koishi.Schema.object({
    backgroundDrawing: import_koishi.Schema.object({
      enabled: import_koishi.Schema.boolean().default(false).description("\u540E\u53F0\u7ED8\u56FE\uFF1A\u5148\u56DE\u300C\u6B63\u5728\u753B\u300D\uFF0C\u5B8C\u6210\u540E\u4E3B\u52A8\u63A8\u9001\u7ED3\u679C\uFF0C\u4E0D\u518D\u8BA9\u6D88\u606F\u963B\u585E\u7B49\u5F85"),
      maxConcurrent: import_koishi.Schema.number().default(3).min(1).max(10).step(1).description("\u540C\u65F6\u8FDB\u884C\u7684\u540E\u53F0\u7ED8\u56FE\u4EFB\u52A1\u4E0A\u9650\uFF0C\u8D85\u51FA\u7684\u6392\u961F"),
      queueNotify: import_koishi.Schema.boolean().default(true).description("\u4EFB\u52A1\u8FDB\u5165\u6392\u961F\u65F6\u63D0\u793A\u524D\u9762\u8FD8\u6709\u51E0\u4E2A")
    }).description("\u540E\u53F0\u7ED8\u56FE\u914D\u7F6E")
  }).description("\u540E\u53F0\u7ED8\u56FE"),
  import_koishi.Schema.object({
    aiSelector: import_koishi.Schema.object({
      enabled: import_koishi.Schema.boolean().default(false).description("\u542F\u7528 AI \u667A\u80FD\u9009\u62E9\u53C2\u8003\u56FE\u7247\uFF08\u9ED8\u8BA4\u5173\u95ED\uFF0C\u9700\u8981\u65F6\u624B\u52A8\u5F00\u542F\uFF09"),
      baseUrl: import_koishi.Schema.string().role("link").description("AI \u9009\u56FE\u63A5\u53E3\u5730\u5740\uFF08OpenAI \u517C\u5BB9 Chat Completions\uFF0C\u7559\u7A7A\u5219\u590D\u7528\u7ED8\u56FE\u63A5\u53E3\u5730\u5740\uFF09"),
      apiKey: import_koishi.Schema.string().role("secret").description("AI \u9009\u56FE\u63A5\u53E3\u5BC6\u94A5\uFF08\u7559\u7A7A\u5219\u590D\u7528\u7ED8\u56FE API \u5BC6\u94A5\uFF09"),
      model: import_koishi.Schema.string().default("Qwen/Qwen2.5-7B-Instruct").description("\u7528\u4E8E\u9009\u62E9\u53C2\u8003\u56FE\u7247\u7684\u5BF9\u8BDD\u6A21\u578B"),
      prompt: import_koishi.Schema.string().role("textarea", { rows: [12, 6] }).default(DEFAULT_SELECTOR_PROMPT).description("\u9009\u62E9\u63D0\u793A\u8BCD\u6A21\u677F\uFF0C\u53EF\u7528\u5360\u4F4D\u7B26\uFF1A{candidates} \u5019\u9009\u56FE\u7247\u5217\u8868\u3001{userInput} \u7528\u6237\u9644\u52A0\u9700\u6C42\u3001{max} \u6700\u591A\u9009\u62E9\u6570\u91CF\u3001{command} \u6307\u4EE4\u540D\u3001{prompt} \u6307\u4EE4\u63D0\u793A\u8BCD"),
      maxSelect: import_koishi.Schema.number().default(1).min(1).max(10).step(1).description("\u9ED8\u8BA4\u6700\u591A\u9009\u62E9\u7684\u53C2\u8003\u56FE\u7247\u6570\u91CF\uFF08\u6307\u4EE4\u5185\u53EF\u5355\u72EC\u8986\u76D6\uFF09"),
      temperature: import_koishi.Schema.number().default(0.2).min(0).max(2).step(0.1).description("\u91C7\u6837\u6E29\u5EA6\uFF08\u8D8A\u4F4E\u8D8A\u7A33\u5B9A\uFF09"),
      timeout: import_koishi.Schema.number().default(60).min(10).max(300).step(5).description("\u8BF7\u6C42\u8D85\u65F6\u65F6\u95F4\uFF08\u79D2\uFF09"),
      maxRetries: import_koishi.Schema.number().default(2).min(0).max(5).step(1).description("\u8BF7\u6C42\u5931\u8D25\u91CD\u8BD5\u6B21\u6570\uFF080 \u8868\u793A\u4E0D\u91CD\u8BD5\uFF09"),
      retryInterval: import_koishi.Schema.number().default(3e3).min(500).max(3e4).step(500).description("\u91CD\u8BD5\u57FA\u7840\u95F4\u9694\uFF08\u6BEB\u79D2\uFF09\uFF1B\u9047\u5230 429/\u9650\u6D41\u4F1A\u5728\u6B64\u57FA\u7840\u4E0A\u6307\u6570\u9000\u907F\uFF0C\u5E76\u4F18\u5148\u9075\u5FAA\u54CD\u5E94\u5934\u7684 Retry-After"),
      retryMaxWait: import_koishi.Schema.number().default(20).min(0).max(120).step(5).description("\u5355\u6B21\u91CD\u8BD5\u6700\u957F\u7B49\u5F85\u65F6\u95F4\uFF08\u79D2\uFF09\uFF0C\u8D85\u8FC7\u5219\u4E0D\u518D\u91CD\u8BD5\uFF080 \u8868\u793A\u4E0D\u9650\uFF09"),
      askUser: import_koishi.Schema.boolean().default(true).description("\u7F3A\u5C11\u5408\u9002\u53C2\u8003\u56FE\u65F6\u8BE2\u95EE\u7528\u6237\u8865\u5145\u53D1\u9001"),
      askTimeout: import_koishi.Schema.number().default(60).min(10).max(120).step(5).description("\u7B49\u5F85\u7528\u6237\u8865\u5145\u53D1\u9001\u56FE\u7247\u7684\u65F6\u95F4\uFF08\u79D2\uFF09"),
      includeAllGroups: import_koishi.Schema.boolean().default(true).description("\u6307\u4EE4\u672A\u6307\u5B9A\u7EC4\u65F6\uFF0C\u5141\u8BB8 AI \u4ECE\u5168\u90E8\u53C2\u8003\u56FE\u7247\u7EC4\u4E2D\u6311\u9009"),
      includeCommandDefaults: import_koishi.Schema.boolean().default(false).description("\u628A\u6307\u4EE4\u7684\u300C\u9ED8\u8BA4\u56FE\u7247URL\u5217\u8868\u300D\u4E5F\u7EB3\u5165 AI \u5019\u9009\u6C60"),
      fallbackOnError: import_koishi.Schema.boolean().default(false).description("AI \u9009\u56FE\u5931\u8D25\u65F6\u56DE\u9000\u4E3A\u4F7F\u7528\u5019\u9009\u6C60\u5185\u5168\u90E8\u56FE\u7247\uFF08\u9ED8\u8BA4\u5173\u95ED\uFF0C\u5931\u8D25\u5219\u4E0D\u4F7F\u7528\u53C2\u8003\u56FE\uFF09"),
      notify: import_koishi.Schema.boolean().default(true).description("\u5728\u5904\u7406\u63D0\u793A\u4E2D\u9644\u5E26 AI \u9009\u56FE\u7ED3\u679C"),
      vision: import_koishi.Schema.boolean().default(false).description("\u9009\u56FE\u6A21\u578B\u652F\u6301\u8BC6\u522B\u56FE\u7247\uFF08\u591A\u6A21\u6001/VL\uFF09\u3002\u5F00\u542F\u540E\u4F1A\u628A\u5019\u9009\u56FE\u7247\u672C\u8EAB\u4E00\u8D77\u53D1\u7ED9\u6A21\u578B\uFF0C\u800C\u4E0D\u53EA\u662F\u53D1\u6587\u5B57\u63CF\u8FF0\uFF0C\u9009\u5F97\u66F4\u51C6\uFF08\u9700\u8981\u56FE\u7247\u94FE\u63A5\u80FD\u88AB\u6A21\u578B\u8BBF\u95EE\uFF09"),
      visionMaxImages: import_koishi.Schema.number().default(6).min(1).max(20).step(1).description("\u5F00\u542F\u8BC6\u522B\u56FE\u7247\u65F6\uFF0C\u6700\u591A\u9644\u5E26\u591A\u5C11\u5F20\u5019\u9009\u56FE\u7247\uFF08\u8D85\u51FA\u90E8\u5206\u53EA\u53D1\u6587\u5B57\u63CF\u8FF0\uFF0C\u907F\u514D\u8BF7\u6C42\u8FC7\u5927\uFF09"),
      visionFallback: import_koishi.Schema.boolean().default(true).description("\u5E26\u56FE\u7247\u8BF7\u6C42\u5931\u8D25\u65F6\uFF0C\u81EA\u52A8\u9000\u56DE\u7EAF\u6587\u5B57\u518D\u8BD5\u4E00\u6B21"),
      appendHint: import_koishi.Schema.boolean().default(true).description("\u628A\u6A21\u578B\u770B\u56FE\u540E\u7ED9\u51FA\u7684\u5173\u952E\u89C6\u89C9\u7279\u5F81\u5E76\u5165\u7ED8\u56FE\u63D0\u793A\u8BCD\uFF08\u4EC5\u5728\u5F00\u542F\u8BC6\u522B\u56FE\u7247\u65F6\u751F\u6548\uFF0C\u8BA9\u51FA\u56FE\u66F4\u8FD8\u539F\u53C2\u8003\u56FE\uFF09"),
      twoStage: import_koishi.Schema.boolean().default(true).description("\u4E24\u7EA7\u68C0\u7D22\u9009\u56FE\uFF1A\u5148\u8BA9\u6A21\u578B\u4EA7\u51FA\u68C0\u7D22\u5173\u952E\u8BCD\u5E76\u5728\u672C\u5730\u53EC\u56DE\uFF0C\u518D\u5BF9\u53EC\u56DE\u7ED3\u679C\u7CBE\u6392\u3002\u53C2\u8003\u56FE\u5F88\u591A\u65F6\u5F3A\u70C8\u5EFA\u8BAE\u5F00\u542F"),
      twoStageThreshold: import_koishi.Schema.number().default(12).min(2).max(200).step(1).description("\u5019\u9009\u56FE\u7247\u8D85\u8FC7\u591A\u5C11\u5F20\u624D\u542F\u7528\u4E24\u7EA7\u68C0\u7D22\uFF08\u5C11\u4E8E\u6B64\u503C\u76F4\u63A5\u4E00\u6B21\u95EE\u5B8C\uFF0C\u66F4\u7701\u4E8B\uFF09"),
      retrievalTopK: import_koishi.Schema.number().default(12).min(1).max(50).step(1).description("\u7B2C\u4E00\u7EA7\u53EC\u56DE\u7684\u5019\u9009\u6570\u91CF\u4E0A\u9650\uFF08\u7CBE\u6392\u53EA\u770B\u8FD9\u4E48\u591A\u5F20\uFF09"),
      keywordPrompt: import_koishi.Schema.string().role("textarea", { rows: [10, 6] }).default(DEFAULT_KEYWORD_PROMPT).description("\u68C0\u7D22\u63D0\u793A\u8BCD\u6A21\u677F\uFF0C\u53EF\u7528\u5360\u4F4D\u7B26\uFF1A{index} \u56FE\u7247\u7D22\u5F15\u3001{userInput} \u7528\u6237\u9644\u52A0\u9700\u6C42\u3001{command} \u6307\u4EE4\u540D\u3001{prompt} \u6307\u4EE4\u63D0\u793A\u8BCD\u3001{topK} \u53EC\u56DE\u4E0A\u9650"),
      captionCommand: import_koishi.Schema.string().default("\u751F\u6210\u63CF\u8FF0").description("\u81EA\u52A8\u751F\u6210\u63CF\u8FF0\u7684\u6307\u4EE4\u540D\uFF08\u6302\u5728\u6307\u4EE4\u6839\u4E0B\uFF1B\u76F4\u63A5\u53D1\u56FE\u5219\u53EA\u8BC6\u522B\u5E76\u8FD4\u56DE\u63CF\u8FF0\uFF09"),
      captionModel: import_koishi.Schema.string().description("\u751F\u6210\u63CF\u8FF0\u7528\u7684\u6A21\u578B\uFF08\u7559\u7A7A\u5219\u7528\u4E0A\u9762\u7684\u9009\u56FE\u6A21\u578B\uFF1B\u5FC5\u987B\u662F\u652F\u6301\u56FE\u7247\u8F93\u5165\u7684\u6A21\u578B\uFF09"),
      captionPrompt: import_koishi.Schema.string().role("textarea", { rows: [8, 4] }).default(DEFAULT_CAPTION_PROMPT).description("\u751F\u6210\u63CF\u8FF0\u7684\u63D0\u793A\u8BCD\uFF08\u8981\u6C42\u6A21\u578B\u5199\u51FA\u4FBF\u4E8E\u68C0\u7D22\u7684\u5173\u952E\u8BCD\uFF09"),
      captionBatch: import_koishi.Schema.number().default(8).min(1).max(50).step(1).description("\u4E00\u6B21\u6307\u4EE4\u6700\u591A\u4E3A\u591A\u5C11\u5F20\u53C2\u8003\u56FE\u751F\u6210\u63CF\u8FF0\uFF08\u907F\u514D\u8BF7\u6C42\u8FC7\u591A\u88AB\u9650\u6D41\uFF09"),
      optimizeTemperature: import_koishi.Schema.number().default(0.7).min(0).max(2).step(0.1).description("\u63D0\u793A\u8BCD\u4F18\u5316\uFF08\u878D\u5408/\u6269\u5199\uFF09\u7528\u7684\u91C7\u6837\u6E29\u5EA6\uFF0C\u6BD4\u9009\u56FE\u9AD8\u4E00\u4E9B\u66F4\u6709\u521B\u9020\u6027"),
      maxTokensParam: import_koishi.Schema.union([
        import_koishi.Schema.const("auto").description("\u81EA\u52A8\uFF08o1/o3/gpt-5/reasoner \u7B49\u63A8\u7406\u6A21\u578B\u7528 max_completion_tokens\uFF09"),
        import_koishi.Schema.const("max_tokens").description("\u59CB\u7EC8\u7528 max_tokens"),
        import_koishi.Schema.const("max_completion_tokens").description("\u59CB\u7EC8\u7528 max_completion_tokens\uFF08\u65B0\u6A21\u578B\u4E0D\u652F\u6301 max_tokens \u65F6\u4F1A\u8FD4\u56DE\u7A7A\u5185\u5BB9\uFF09")
      ]).default("auto").description("\u8F93\u51FA\u957F\u5EA6\u53C2\u6570\u540D\u3002\u6A21\u578B\u4E0D\u652F\u6301 max_tokens \u65F6\u4F1A\u8FD4\u56DE\u7A7A\u5185\u5BB9\uFF0C\u5BFC\u81F4\u300C\u54CD\u5E94\u4E2D\u6CA1\u6709\u6587\u672C\u5185\u5BB9\u300D"),
      debugCommand: import_koishi.Schema.string().default("\u6D4B\u8BD5\u9009\u56FE").description("\u8BCA\u65AD\u6307\u4EE4\u540D\uFF08\u6302\u5728\u6307\u4EE4\u6839\u4E0B\uFF09\uFF1A\u53D1\u4E00\u6B21\u9009\u56FE\u8BF7\u6C42\u5E76\u56DE\u663E\u6A21\u578B\u539F\u59CB\u8FD4\u56DE\uFF0C\u7528\u4E8E\u6392\u67E5\u300C\u6CA1\u6709\u6587\u672C\u5185\u5BB9\u300D"),
      selectMaxTokens: import_koishi.Schema.number().default(8e3).min(0).max(64e3).step(500).description("\u9009\u56FE\uFF08\u7CBE\u6392\uFF09\u7684\u8F93\u51FA\u957F\u5EA6\u4E0A\u9650\u3002**\u63A8\u7406\u6A21\u578B\uFF08DeepSeek-V4.1-Flash \u7B49\uFF09\u4F1A\u628A\u989D\u5EA6\u8017\u5728\u601D\u8003\u4E0A**\uFF0C\u592A\u5C0F\u4F1A\u5BFC\u81F4\u6B63\u6587\u4E00\u4E2A\u5B57\u90FD\u751F\u6210\u4E0D\u51FA\u6765\uFF0C\u62A5\u300C\u54CD\u5E94\u4E2D\u6CA1\u6709\u6587\u672C\u5185\u5BB9\u300D\u30020 = \u4E0D\u9650\u5236"),
      keywordMaxTokens: import_koishi.Schema.number().default(3e3).min(0).max(64e3).step(500).description("\u4E24\u7EA7\u68C0\u7D22\u300C\u5173\u952E\u8BCD\u300D\u9636\u6BB5\u7684\u8F93\u51FA\u957F\u5EA6\u4E0A\u9650\uFF080 = \u4E0D\u9650\u5236\uFF09"),
      optimizeMaxTokens: import_koishi.Schema.number().default(8e3).min(0).max(64e3).step(500).description("\u63D0\u793A\u8BCD\u4F18\u5316\uFF08\u878D\u5408/\u6269\u5199\uFF09\u7684\u8F93\u51FA\u957F\u5EA6\u4E0A\u9650\uFF080 = \u4E0D\u9650\u5236\uFF09"),
      maxTokensCeiling: import_koishi.Schema.number().default(32e3).min(1e3).max(128e3).step(1e3).description("\u8F93\u51FA\u88AB\u622A\u65AD\u65F6\u81EA\u52A8\u52A0\u5927\u4E0A\u9650\uFF0C\u6700\u591A\u52A0\u5230\u8FD9\u4E2A\u503C")
    }).collapse().description("AI \u9009\u56FE\u914D\u7F6E\u9879\uFF08\u63D0\u793A\u8BCD\u8F83\u957F\uFF0C\u5DF2\u6298\u53E0\uFF09")
  }).description("AI \u9009\u56FE\u8BBE\u7F6E"),
  import_koishi.Schema.object({
    appendUserInput: import_koishi.Schema.boolean().default(true).description("\u628A\u7528\u6237\u968F\u6307\u4EE4\u53D1\u7684\u9644\u52A0\u9700\u6C42\u5E76\u5165\u7ED8\u56FE\u63D0\u793A\u8BCD\uFF08\u4F8B\u5982\u300C\u624B\u529E\u5316 xxx \u5728\u5077\u5403\u767D\u996D\u88AB\u53D1\u73B0\u7684\u8868\u60C5\u300D\uFF09"),
    promptOptimize: import_koishi.Schema.union([
      import_koishi.Schema.const("rewrite").description("\u878D\u5408\u91CD\u5199\uFF08\u63A8\u8350\uFF09\uFF1A\u8BA9\u6A21\u578B\u628A\u9700\u6C42\u5199\u8FDB\u63D0\u793A\u8BCD\u5BF9\u5E94\u4F4D\u7F6E"),
      import_koishi.Schema.const("merge").description("\u76F4\u63A5\u8FFD\u52A0\uFF1A\u628A\u9700\u6C42\u8D34\u5728\u539F\u59CB\u63D0\u793A\u8BCD\u672B\u5C3E"),
      import_koishi.Schema.const("off").description("\u4E0D\u5904\u7406\uFF1A\u53EA\u7528\u6307\u4EE4\u81EA\u8EAB\u7684\u63D0\u793A\u8BCD")
    ]).default("rewrite").description("\u7528\u6237\u9644\u52A0\u9700\u6C42\u5982\u4F55\u5E76\u5165\u63D0\u793A\u8BCD"),
    optimizePrompt: import_koishi.Schema.string().role("textarea", { rows: [10, 6] }).default(DEFAULT_OPTIMIZE_PROMPT).description("\u878D\u5408\u91CD\u5199\u7528\u7684\u63D0\u793A\u8BCD\u6A21\u677F\uFF0C\u5360\u4F4D\u7B26\uFF1A{prompt} \u539F\u59CB\u63D0\u793A\u8BCD\u3001{userInput} \u7528\u6237\u9644\u52A0\u9700\u6C42"),
    showPrompt: import_koishi.Schema.boolean().default(true).description("\u53D1\u9001\u4F18\u5316\u540E\u7684\u63D0\u793A\u8BCD\uFF08QQ / QQ \u9891\u9053\u7528\u4EE3\u7801\u5757\u5305\u88F9\uFF0C\u5176\u5B83\u5E73\u53F0\u53D1\u7EAF\u6587\u672C\uFF09"),
    promptMaxLength: import_koishi.Schema.number().default(4e3).min(0).max(2e4).step(100).description("\u56DE\u663E\u63D0\u793A\u8BCD\u7684\u6700\u5927\u5B57\u7B26\u6570\uFF0C\u8D85\u51FA\u90E8\u5206\u622A\u65AD\u5E76\u6807\u6CE8\uFF1B\u8BBE\u4E3A 0 \u8868\u793A\u4E0D\u622A\u65AD\uFF08QQ markdown \u6709\u957F\u5EA6\u4E0A\u9650\uFF0C\u592A\u957F\u53EF\u80FD\u88AB\u62D2\u6536\uFF09")
  }).description("\u63D0\u793A\u8BCD\u8BBE\u7F6E"),
  import_koishi.Schema.object({
    textRender: import_koishi.Schema.object({
      enabled: import_koishi.Schema.boolean().default(false).description("\u5F00\u542F\u300C\u6587\u5B57\u6E32\u67D3\u53C2\u8003\u56FE\u300D\uFF1A\u628A\u8981\u5728\u753B\u9762\u4E0A\u51FA\u73B0\u7684\u6587\u5B57\uFF08\u53F0\u8BCD/\u6807\u9898/\u6807\u8BED\uFF09\u5148\u7528\u6D4F\u89C8\u5668\u6E32\u67D3\u6210\u56FE\u7247\uFF0C\u4E00\u8D77\u53D1\u7ED9\u7ED8\u56FE\u6A21\u578B\uFF0C\u89E3\u51B3\u4E2D\u6587\u5D29\u5B57\u95EE\u9898\uFF08\u9700\u8981\u5B89\u88C5\u5E76\u542F\u7528 koishi-plugin-puppeteer\uFF09"),
      autoDetect: import_koishi.Schema.boolean().default(true).description("\u81EA\u52A8\u8BC6\u522B\u63D0\u793A\u8BCD\u91CC\u9700\u8981\u51FA\u73B0\u5728\u753B\u9762\u4E0A\u7684\u4E2D\u6587\u6587\u5B57\u5E76\u6E32\u67D3\uFF08\u8BC6\u522B\u300C\u300D\u201C\u201D\u300A\u300B\u3010\u3011\u4EE5\u53CA\u300C\u53F0\u8BCD\uFF1A\u300D\u7B49\uFF09"),
      loose: import_koishi.Schema.boolean().default(false).description("\u5BBD\u677E\u6A21\u5F0F\uFF1A\u5F15\u53F7\u90FD\u6CA1\u7528\u4E0A\u65F6\uFF0C\u4E5F\u76F4\u63A5\u63D0\u53D6\u8FDE\u7EED\u7684\u4E2D\u6587\u7247\u6BB5\uFF08\u53EF\u80FD\u8BEF\u5224\uFF09"),
      commandName: import_koishi.Schema.string().default("\u6E32\u67D3\u6587\u5B57").description("\u624B\u52A8\u6E32\u67D3\u6307\u4EE4\u540D\uFF08\u6302\u5728\u4E3B\u6307\u4EE4\u6839\u4E0B\uFF09\uFF0C\u7528\u6CD5\uFF1A\u6E32\u67D3\u6587\u5B57 \u8981\u753B\u7684\u6587\u5B57"),
      pendingTTL: import_koishi.Schema.number().default(600).min(0).max(86400).step(30).description("\u624B\u52A8\u6E32\u67D3\u540E\uFF0C\u591A\u5C11\u79D2\u5185\u7684\u7ED8\u56FE\u6307\u4EE4\u81EA\u52A8\u5E26\u4E0A\u8FD9\u5F20\u53C2\u8003\u56FE\uFF080 \u8868\u793A\u53EA\u5728\u4E0B\u4E00\u6B21\u751F\u6548\u524D\u4E00\u76F4\u6709\u6548\uFF09"),
      sendPreview: import_koishi.Schema.boolean().default(true).description("\u6E32\u67D3\u540E\u5148\u628A\u53C2\u8003\u56FE\u53D1\u51FA\u6765\u7ED9\u4F60\u770B"),
      attachToDraw: import_koishi.Schema.boolean().default(true).description("\u628A\u6E32\u67D3\u7ED3\u679C\u5E76\u5165\u7ED8\u56FE\u53C2\u8003\u56FE\u4E00\u8D77\u53D1\u7ED9\u7ED8\u56FE\u6A21\u578B"),
      width: import_koishi.Schema.number().default(1024).min(256).max(4096).step(64).description("\u753B\u5E03\u6700\u5C0F\u5BBD\u5EA6\uFF08\u50CF\u7D20\uFF09"),
      fontSize: import_koishi.Schema.number().default(96).min(12).max(400).step(4).description("\u5B57\u53F7"),
      lineHeight: import_koishi.Schema.number().default(1.4).min(1).max(3).step(0.1).description("\u884C\u9AD8"),
      padding: import_koishi.Schema.number().default(48).min(0).max(400).step(4).description("\u5185\u8FB9\u8DDD"),
      background: import_koishi.Schema.string().default("#ffffff").description("\u80CC\u666F\u8272\uFF08\u586B transparent \u53EF\u8F93\u51FA\u900F\u660E\u5E95\uFF0C\u9002\u5408\u8D34\u5728\u753B\u9762\u4E0A\u7684\u5B57\u5E55\uFF09"),
      color: import_koishi.Schema.string().default("#111111").description("\u6587\u5B57\u989C\u8272"),
      fontFamily: import_koishi.Schema.string().default("Microsoft YaHei, PingFang SC, Noto Sans CJK SC, sans-serif").description("\u5B57\u4F53\uFF08\u6309\u5148\u540E\u987A\u5E8F\u56DE\u9000\uFF09"),
      align: import_koishi.Schema.union([
        import_koishi.Schema.const("center").description("\u5C45\u4E2D"),
        import_koishi.Schema.const("left").description("\u5DE6\u5BF9\u9F50")
      ]).default("center").description("\u5BF9\u9F50\u65B9\u5F0F"),
      bold: import_koishi.Schema.boolean().default(false).description("\u52A0\u7C97"),
      strokeWidth: import_koishi.Schema.number().default(0).min(0).max(40).step(1).description("\u63CF\u8FB9\u5BBD\u5EA6\uFF080 \u4E0D\u63CF\u8FB9\uFF1B\u5B57\u5E55\u5EFA\u8BAE 6-10\uFF09"),
      strokeColor: import_koishi.Schema.string().default("#ffffff").description("\u63CF\u8FB9\u989C\u8272"),
      maxChars: import_koishi.Schema.number().default(200).min(10).max(2e3).step(10).description("\u5355\u6761\u6587\u5B57\u6700\u5927\u5B57\u7B26\u6570\uFF0C\u8D85\u8FC7\u5219\u4E0D\u6E32\u67D3"),
      scale: import_koishi.Schema.number().default(2).min(1).max(4).step(1).description("\u622A\u56FE\u7F29\u653E\u500D\u6570\uFF08\u8D8A\u5927\u8D8A\u6E05\u6670\uFF0C\u6587\u4EF6\u4E5F\u8D8A\u5927\uFF09")
    }).collapse().description("\u6587\u5B57\u6E32\u67D3\u914D\u7F6E\u9879")
  }).description("\u6587\u5B57\u6E32\u67D3\u53C2\u8003\u56FE\uFF08\u9632\u5D29\u5B57\uFF09"),
  import_koishi.Schema.object({
    mergeNotifications: import_koishi.Schema.boolean().default(true).description("\u628A\u300C\u9009\u56FE\u7ED3\u679C / \u6B63\u5728\u5904\u7406 / \u4F18\u5316\u540E\u63D0\u793A\u8BCD\u300D\u5408\u5E76\u6210**\u4E00\u6761**\u6D88\u606F\u53D1\u51FA\uFF08QQ \u88AB\u52A8\u56DE\u590D\u6709\u6B21\u6570\u4E0A\u9650\uFF0C\u6D88\u606F\u8D8A\u5C11\u8D8A\u7A33\uFF09"),
    markdownImage: import_koishi.Schema.boolean().default(true).description("\u751F\u6210\u7ED3\u679C\u7528 markdown \u7684 ![](\u56FE\u7247\u94FE\u63A5) \u5355\u72EC\u53D1\u4E00\u6761\uFF1B\u4E0D\u652F\u6301 markdown \u7684\u5E73\u53F0\u81EA\u52A8\u9000\u56DE\u666E\u901A\u56FE\u7247\u6D88\u606F"),
    imageViaAssets: import_koishi.Schema.boolean().default(true).description("\u7ED3\u679C\u56FE\u5148\u7ECF assets \u670D\u52A1\u4E0A\u4F20\u518D\u53D1\u3002\u5916\u94FE\u5728\u624B\u673A\u7AEF QQ \u5E38\u5E38\u62C9\u4E0D\u5230\uFF0C\u88C5\u4E0A koishi-plugin-assets-qqbot-part-file \u4E4B\u7C7B\u7684 assets \u63D2\u4EF6\u540E\u7531\u5B83\u8F6C\u6210\u5E73\u53F0\u53EF\u8BBF\u95EE\u7684\u5730\u5740\uFF1B\u4E0A\u4F20\u5931\u8D25\u4F1A\u81EA\u52A8\u7528\u539F\u94FE\u63A5"),
    imageWidth: import_koishi.Schema.number().default(1024).min(0).max(4096).step(32).description("markdown \u56FE\u7247\u7684\u5BBD\u5EA6\uFF08QQ \u5B98\u65B9\u8BED\u6CD5\u8981\u6C42\u5E26\u5C3A\u5BF8\uFF0C\u5426\u5219\u624B\u673A\u7AEF\u4E0D\u6E32\u67D3\uFF09"),
    imageHeight: import_koishi.Schema.number().default(1024).min(0).max(4096).step(32).description("markdown \u56FE\u7247\u7684\u9AD8\u5EA6")
  }).description("\u6D88\u606F\u53D1\u9001"),
  import_koishi.Schema.object({
    loggerinfo: import_koishi.Schema.boolean().default(false).description("\u65E5\u5FD7\u8C03\u8BD5\u6A21\u5F0F")
  }).description("\u8C03\u8BD5\u8BBE\u7F6E")
]);
function apply(ctx, config) {
  let isActive = true;
  ctx.on("dispose", () => {
    isActive = false;
  });
  function logInfo(...args) {
    if (config.loggerinfo) {
      ctx.logger.info(...args);
    }
  }
  const quotedKeys = /* @__PURE__ */ new Set();
  function stripQuotes(parts) {
    return parts.filter(Boolean).filter((part) => {
      if (part && typeof part === "object" && part.type === "quote") return false;
      return true;
    });
  }
  async function reply(session, parts, options = {}) {
    const body = parts.filter(Boolean);
    const key = `${session.platform}:${session.channelId || ""}:${session.messageId || ""}`;
    let useQuote = options.quote !== false && !!session.messageId && !quotedKeys.has(key);
    if (useQuote) {
      if (quotedKeys.size > 1e3) quotedKeys.clear();
      quotedKeys.add(key);
      try {
        return await session.send([import_koishi.h.quote(session.messageId), ...body]);
      } catch (error) {
        if (!isPassiveReplyError(error)) throw error;
        ctx.logger.warn("\u5F15\u7528\u56DE\u590D\u88AB\u62D2\uFF08\u88AB\u52A8\u56DE\u590D\u8D85\u65F6\u6216\u8D85\u6B21\uFF09\uFF0C\u6539\u4E3A\u666E\u901A\u6D88\u606F\u91CD\u53D1");
      }
    }
    return session.send(body);
  }
  async function resolveImageUrl(url, commandName) {
    if (config.imageViaAssets === false) return url;
    const assets = ctx.assets;
    if (!assets || typeof assets.upload !== "function") {
      logInfo("\u672A\u68C0\u6D4B\u5230 assets \u670D\u52A1\uFF0C\u76F4\u63A5\u7528\u7ED8\u56FE\u63A5\u53E3\u8FD4\u56DE\u7684\u94FE\u63A5");
      return url;
    }
    try {
      const uploaded = await assets.upload(url, `image-prompt-${commandName}-${Date.now()}.png`);
      const value = typeof uploaded === "string" ? uploaded : String(uploaded?.url || "");
      if (/^https?:\/\//i.test(value)) {
        logInfo(`\u7ED3\u679C\u56FE\u5DF2\u4E0A\u4F20 assets: ${value.slice(0, 80)}`);
        return value;
      }
      ctx.logger.warn(`assets \u8FD4\u56DE\u7684\u5730\u5740\u4E0D\u662F\u516C\u7F51\u94FE\u63A5\uFF0C\u4ECD\u7528\u539F\u94FE\u63A5: ${value.slice(0, 80)}`);
    } catch (error) {
      ctx.logger.warn(`\u7ED3\u679C\u56FE\u4E0A\u4F20 assets \u5931\u8D25\uFF0C\u4ECD\u7528\u539F\u94FE\u63A5: ${error}`);
    }
    return url;
  }
  async function sendResultImage(session, url, commandName) {
    const finalUrl = await resolveImageUrl(url, commandName);
    if (config.markdownImage !== false && supportsMarkdown(session.platform)) {
      try {
        await reply(session, [(0, import_koishi.h)("markdown", buildMarkdownImage(
          finalUrl,
          config.imageWidth || 1024,
          config.imageHeight || 1024
        ))]);
        return;
      } catch (error) {
        ctx.logger.warn(`markdown \u56FE\u7247\u53D1\u9001\u5931\u8D25\uFF0C\u9000\u56DE\u666E\u901A\u56FE\u7247\u6D88\u606F: ${error}`);
      }
    }
    await reply(session, [import_koishi.h.image(finalUrl)]);
  }
  async function sendBotMessage(bot, channelId, parts, guildId, messageId) {
    const body = parts.filter(Boolean);
    if (messageId) {
      try {
        await bot.sendMessage(channelId, [import_koishi.h.quote(messageId), ...body], guildId);
        return;
      } catch (error) {
        if (!isPassiveReplyError(error)) throw error;
        ctx.logger.warn("\u540E\u53F0\u901A\u77E5\u5F15\u7528\u56DE\u590D\u88AB\u62D2\uFF08\u88AB\u52A8\u56DE\u590D\u8D85\u65F6\uFF09\uFF0C\u6539\u4E3A\u666E\u901A\u6D88\u606F\u91CD\u53D1");
      }
    }
    await bot.sendMessage(channelId, body, guildId);
  }
  ctx.on("ready", () => {
    ctx.i18n.define("zh-CN", {
      [name]: {
        description: "\u5C06\u56FE\u7247\u8F6C\u6362\u4E3A\u7279\u5B9A\u98CE\u683C",
        messages: {
          waitprompt: "\u8BF7\u5728{0}\u79D2\u5185\u53D1\u9001\u4E00\u5F20\u56FE\u7247...",
          waitpromptmultiple: "\u8BF7\u5728{0}\u79D2\u5185\u53D1\u9001{1}\u5F20\u56FE\u7247...",
          customprompt: "\u8BF7\u5728{0}\u79D2\u5185\u8F93\u5165\u81EA\u5B9A\u4E49\u63D0\u793A\u8BCD...",
          invalidimage: "\u672A\u68C0\u6D4B\u5230\u6709\u6548\u7684\u56FE\u7247\uFF0C\u8BF7\u91CD\u65B0\u53D1\u9001\u5E26\u56FE\u7247\u7684\u6D88\u606F",
          processing: "\u6B63\u5728\u5904\u7406\u56FE\u7247\uFF0C\u8BF7\u7A0D\u5019...",
          failed: "\u56FE\u7247\u751F\u6210\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5",
          error: "\u5904\u7406\u8FC7\u7A0B\u4E2D\u53D1\u751F\u9519\u8BEF\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5",
          needprompt: "\u8BF7\u63D0\u4F9B\u81EA\u5B9A\u4E49\u63D0\u793A\u8BCD",
          needimages: "\u8BF7\u63D0\u4F9B\u81F3\u5C11\u4E00\u5F20\u56FE\u7247",
          selecting: "\u6B63\u5728\u667A\u80FD\u6311\u9009\u53C2\u8003\u56FE\u7247...",
          selectfailed: "AI \u9009\u56FE\u5931\u8D25\uFF08{0}\uFF09\uFF0C\u5DF2\u6539\u7528\u5168\u90E8\u5019\u9009\u53C2\u8003\u56FE\u7247",
          selectfailedNoFallback: "AI \u9009\u56FE\u5931\u8D25\uFF08{0}\uFF09\uFF0C\u672C\u6B21\u4E0D\u4F7F\u7528\u53C2\u8003\u56FE\u7247",
          selected: "\u5DF2\u4E3A\u4F60\u6311\u9009\u53C2\u8003\u56FE\u7247\uFF1A\n{0}",
          askimage: "{0}\n\u8BF7\u5728{1}\u79D2\u5185\u53D1\u9001\u56FE\u7247...",
          askimageDefault: "\u5019\u9009\u53C2\u8003\u56FE\u7247\u91CC\u6CA1\u6709\u5408\u9002\u7684\u56FE\u7247\uFF0C\u9700\u8981\u4F60\u8865\u5145\u4E00\u5F20\u53C2\u8003\u56FE",
          noask: "\u672A\u6536\u5230\u8865\u5145\u56FE\u7247\uFF0C\u5C06\u4F7F\u7528\u73B0\u6709\u56FE\u7247\u7EE7\u7EED\u5904\u7406",
          gotimage: "\u5DF2\u6536\u5230\u8865\u5145\u56FE\u7247\uFF0C\u7EE7\u7EED\u5904\u7406...",
          recalled: "\uFF08\u53C2\u8003\u56FE\u68C0\u7D22\uFF1A{0} \u5F20\u4E2D\u547D\u4E2D {1} \u5F20\u5019\u9009\uFF09",
          hintsingle: "\u53C2\u8003\u56FE\u5173\u952E\u7279\u5F81\uFF08\u52A1\u5FC5\u8FD8\u539F\uFF09\uFF1A{0}",
          hintscene: "\u753B\u9762\u7F16\u6392\uFF08\u52A1\u5FC5\u8FD8\u539F\uFF09\uFF1A{0}",
          optimizefailed: "\uFF08\u63D0\u793A\u8BCD\u878D\u5408\u5931\u8D25\uFF0C\u5DF2\u6539\u4E3A\u8FFD\u52A0\u6A21\u5F0F\uFF09",
          bgstart: "\u5DF2\u5F00\u59CB\u540E\u53F0\u7ED8\u56FE\uFF08{0} \u5F20\u56FE\uFF09\uFF0C\u753B\u597D\u540E\u4F1A\u5728\u8FD9\u91CC\u901A\u77E5\u4F60...",
          bgqueue: "\uFF08\u5F53\u524D\u6709 {0} \u4E2A\u4EFB\u52A1\u5728\u6392\u961F\uFF09",
          bgdone: "\u753B\u597D\u4E86\uFF1A",
          textrenderNopp: "\u6587\u5B57\u6E32\u67D3\u9700\u8981\u5B89\u88C5\u5E76\u542F\u7528 koishi-plugin-puppeteer\uFF08\u6D4F\u89C8\u5668\u670D\u52A1\uFF09",
          textrenderEmpty: "\u8BF7\u63D0\u4F9B\u8981\u6E32\u67D3\u7684\u6587\u5B57\uFF0C\u4F8B\u5982\uFF1A{0} \u4F60\u597D\u4E16\u754C",
          textrenderFailed: "\u6587\u5B57\u6E32\u67D3\u5931\u8D25\uFF1A{0}",
          textrenderOk: "\u6587\u5B57\u53C2\u8003\u56FE\u5DF2\u6E32\u67D3\uFF0C{0} \u79D2\u5185\u7684\u7ED8\u56FE\u6307\u4EE4\u4F1A\u81EA\u52A8\u5E26\u4E0A\u5B83",
          textrenderOkForever: "\u6587\u5B57\u53C2\u8003\u56FE\u5DF2\u6E32\u67D3\uFF0C\u4E0B\u6B21\u7ED8\u56FE\u4F1A\u81EA\u52A8\u5E26\u4E0A\u5B83",
          textrenderAttached: "\uFF08\u5DF2\u9644\u4E0A\u6587\u5B57\u53C2\u8003\u56FE\uFF1A{0}\uFF09",
          textrenderPreview: "\u6587\u5B57\u53C2\u8003\u56FE\uFF1A"
        }
      }
    });
    ctx.command(config.basename);
    void loadGallery();
    for (const cmdConfig of config.nested.commands) {
      if (!cmdConfig.enabled) continue;
      ctx.command(`${config.basename}/${cmdConfig.name} [message:text]`).usage(`\u4F7F\u7528 ${cmdConfig.name} \u98CE\u683C\u5904\u7406\u56FE\u7247`).action(async ({ session }, message) => {
        if (!isActive || !ctx.scope.isActive) {
          return;
        }
        if (!session) return;
        const quote = import_koishi.h.quote(session.messageId);
        const customCommand = cmdConfig.custom || false;
        const maxImages = cmdConfig.maxImages || 0;
        const waitTimeout = cmdConfig.waitTimeout || config.defaultWaitTimeout;
        const defaultImageUrls = cmdConfig.defaultImageUrls || [];
        let promptText = cmdConfig.prompt;
        let images = [];
        let userImages = [];
        const selector = config.aiSelector || {};
        const aiSelectOn = selector.enabled !== false && cmdConfig.aiSelect !== false;
        const aiMaxSelect = (cmdConfig.aiMaxSelect || 0) > 0 ? cmdConfig.aiMaxSelect : selector.maxSelect || 1;
        const aiAskOn = cmdConfig.aiAskUser !== false && selector.askUser !== false;
        const aiAskTimeout = selector.askTimeout || waitTimeout;
        let userInputText = "";
        if (message) userInputText = String(message).trim();
        if (!userInputText) {
          userInputText = stripCommandName(extractTextFromMessage(session.stripped.content), cmdConfig.name);
        }
        logInfo2(`\u7528\u6237\u9644\u52A0\u9700\u6C42: ${userInputText || "\uFF08\u65E0\uFF09"}`);
        const noticeLines = [];
        const notify = (text) => {
          const value = String(text ?? "").trim();
          if (value) noticeLines.push(value);
        };
        async function flushNotice() {
          if (!noticeLines.length) return;
          const lines = noticeLines.slice();
          noticeLines.length = 0;
          const md = supportsMarkdown(session.platform);
          const send = (text) => reply(session, [md ? (0, import_koishi.h)("markdown", text) : text]);
          const merged = lines.join("\n").trim();
          if (!merged) return;
          if (merged.length <= 4e3) {
            await send(merged);
            return;
          }
          const fenceAt = lines.findIndex((line) => line.includes("```"));
          if (fenceAt > 0) {
            const head = lines.slice(0, fenceAt).join("\n").trim();
            const tail = lines.slice(fenceAt).join("\n").trim();
            if (head) await send(head);
            await send(tail);
            return;
          }
          await send(merged);
        }
        if (defaultImageUrls.length > 0 && !(aiSelectOn && selector.includeCommandDefaults)) {
          images.push(...defaultImageUrls);
          logInfo2(`\u6DFB\u52A0 ${defaultImageUrls.length} \u5F20\u9ED8\u8BA4\u56FE\u7247`);
        }
        if (customCommand && !promptText && !userInputText) {
          const [msgId] = await session.send(session.text("image-prompt.messages.customprompt", [waitTimeout]));
          const userPrompt = await session.prompt(waitTimeout * 1e3);
          try {
            await session.bot.deleteMessage(session.channelId, msgId);
          } catch {
            ctx.logger.warn(`\u5728\u9891\u9053 ${session.channelId} \u5C1D\u8BD5\u64A4\u56DE\u6D88\u606FID ${msgId} \u5931\u8D25\u3002`);
          }
          if (userPrompt) {
            userInputText = extractTextFromMessage(userPrompt) || String(userPrompt).trim();
          } else {
            await reply(session, [session.text("image-prompt.messages.needprompt")]);
            return;
          }
        }
        let optimizeFailed = false;
        if (userInputText && config.appendUserInput !== false) {
          promptText = mergePrompt(promptText, userInputText, true);
          logInfo2(`\u5DF2\u5E76\u5165\u7528\u6237\u9644\u52A0\u9700\u6C42: ${userInputText}`);
          if (config.promptOptimize === "rewrite") {
            const optimized = await optimizePromptText(cmdConfig.prompt, userInputText);
            if (optimized) {
              promptText = optimized;
              logInfo2("\u63D0\u793A\u8BCD\u5DF2\u878D\u5408\u91CD\u5199");
            } else {
              ctx.logger.warn("\u63D0\u793A\u8BCD\u878D\u5408\u91CD\u5199\u5931\u8D25\uFF0C\u4FDD\u7559\u8FFD\u52A0\u540E\u7684\u63D0\u793A\u8BCD");
              optimizeFailed = true;
            }
          }
        }
        let selectionNote = "";
        let aiProvidedImages = 0;
        let aiRenderText = "";
        if (aiSelectOn) {
          const candidates = collectCandidates(cmdConfig, defaultImageUrls);
          const declaredGroups = (cmdConfig.referenceGroups || []).filter(Boolean);
          logInfo2(`AI \u9009\u56FE\u5019\u9009\u56FE\u7247\u6570\u91CF: ${candidates.length}`);
          if (candidates.length > 0) {
            if (config.mergeNotifications === false) {
              const [selMsgId] = await reply(session, [session.text("image-prompt.messages.selecting")]);
              try {
                await session.bot.deleteMessage(session.channelId, selMsgId);
              } catch {
                ctx.logger.warn(`\u5728\u9891\u9053 ${session.channelId} \u5C1D\u8BD5\u64A4\u56DE\u6D88\u606FID ${selMsgId} \u5931\u8D25\u3002`);
              }
            } else {
              notify(session.text("image-prompt.messages.selecting"));
            }
            let selection = await runAISelection(candidates, userInputText, cmdConfig, promptText, aiMaxSelect);
            if (selection.needUserImage && aiAskOn) {
              const askText = selection.askMessage || session.text("image-prompt.messages.askimageDefault");
              await flushNotice();
              const answer = await askUserForImage(session, quote, askText, aiAskTimeout);
              if (answer) {
                const extra = extractImagesFromMessage(answer);
                const extraText = extractTextFromMessage(answer);
                if (extra.length > 0) {
                  userImages.push(...extra);
                  notify(session.text("image-prompt.messages.gotimage"));
                }
                if (extraText) {
                  selection = await runAISelection(
                    candidates,
                    `${userInputText}
\u7528\u6237\u8865\u5145\u8BF4\u660E\uFF1A${extraText}`.trim(),
                    cmdConfig,
                    promptText,
                    aiMaxSelect
                  );
                }
              } else {
                notify(session.text("image-prompt.messages.noask"));
              }
            }
            if (selection.ok && selection.picked.length > 0) {
              images.push(...selection.picked.map((c) => c.url));
              aiProvidedImages += selection.picked.length;
              logInfo2(`AI \u9009\u4E2D\u53C2\u8003\u56FE\u7247: ${selection.picked.map((c) => c.url).join(" , ")} \u7406\u7531: ${selection.reason}`);
              if (selector.vision === true && selector.appendHint !== false && selection.hint) {
                const hintKey = selection.picked.length > 1 ? "hintscene" : "hintsingle";
                promptText = `${promptText}

${session.text(`image-prompt.messages.${hintKey}`, [selection.hint])}`;
                logInfo2(`AI \u770B\u56FE\u5F97\u5230\u7684${selection.picked.length > 1 ? "\u753B\u9762\u7F16\u6392" : "\u5173\u952E\u7279\u5F81"}: ${selection.hint}`);
              }
              if (selector.notify) {
                selectionNote = "\n" + session.text("image-prompt.messages.selected", [
                  selection.picked.map((c, i) => `${i + 1}. ${c.description || c.url}`).join("\n")
                ]);
                if (selection.recalled && selection.total) {
                  selectionNote += "\n" + session.text("image-prompt.messages.recalled", [selection.total, selection.recalled]);
                }
              }
              if (selection.renderText) {
                aiRenderText = selection.renderText;
                logInfo2(`\u9009\u56FE\u6A21\u578B\u7ED9\u51FA\u9700\u8981\u6E32\u67D3\u7684\u6587\u5B57: ${aiRenderText.replace(/\n/g, " / ")}`);
              }
            } else if (!selection.ok || selection.picked.length === 0) {
              if (!selection.ok) {
                ctx.logger.warn(`[${cmdConfig.name}] AI \u9009\u56FE\u5931\u8D25\uFF0CfallbackOnError=${selector.fallbackOnError}`);
              }
              if (selector.fallbackOnError) {
                images.push(...candidates.map((c) => c.url));
                aiProvidedImages += candidates.length;
              }
              if (selector.notify && !selection.ok) {
                selectionNote = "\n" + session.text(
                  selector.fallbackOnError ? "image-prompt.messages.selectfailed" : "image-prompt.messages.selectfailedNoFallback",
                  [selection.error || "\u672A\u77E5\u539F\u56E0"]
                );
              }
            }
          } else if (aiAskOn && declaredGroups.length > 0) {
            await flushNotice();
            const answer = await askUserForImage(
              session,
              quote,
              session.text("image-prompt.messages.askimageDefault"),
              aiAskTimeout
            );
            if (answer) {
              const extra = extractImagesFromMessage(answer);
              if (extra.length > 0) {
                userImages.push(...extra);
                notify(session.text("image-prompt.messages.gotimage"));
              }
            } else {
              notify(session.text("image-prompt.messages.noask"));
            }
          }
        }
        const sessionImages = extractImagesFromSession(session);
        const extractedImages = [...sessionImages, ...userImages];
        images.push(...extractedImages);
        const providedImages = extractedImages.length + aiProvidedImages;
        const remainingImages = Math.max(0, maxImages - providedImages);
        if (aiProvidedImages > 0 && remainingImages === 0) {
          logInfo2(`AI \u5DF2\u63D0\u4F9B ${aiProvidedImages} \u5F20\u53C2\u8003\u56FE\uFF0C\u4E0D\u518D\u8981\u6C42\u7528\u6237\u53D1\u9001\u56FE\u7247`);
        }
        if (remainingImages > 0) {
          await flushNotice();
          const [msgId] = await session.send(
            session.text("image-prompt.messages.waitpromptmultiple", [waitTimeout, remainingImages])
          );
          try {
            for (let i = 0; i < remainingImages; i++) {
              const promptContent = await session.prompt(waitTimeout * 1e3);
              if (promptContent !== void 0) {
                const newImages = extractImagesFromMessage(promptContent);
                images.push(...newImages);
              } else {
                break;
              }
            }
          } finally {
            try {
              await session.bot.deleteMessage(session.channelId, msgId);
            } catch {
              ctx.logger.warn(`\u5728\u9891\u9053 ${session.channelId} \u5C1D\u8BD5\u64A4\u56DE\u6D88\u606FID ${msgId} \u5931\u8D25\u3002`);
            }
          }
        }
        let textRef = null;
        if (config.textRender?.enabled) {
          textRef = await resolveTextReference(session, promptText, userInputText, aiRenderText);
          if (textRef) {
            const preview = textRef.text.length > 40 ? `${textRef.text.slice(0, 40)}\u2026` : textRef.text;
            selectionNote += "\n" + session.text("image-prompt.messages.textrenderAttached", [preview]);
            promptText = `${promptText}

Text in the image must be rendered exactly as shown in the attached text-reference image; copy the glyphs precisely, never distort or invent characters.`;
            logInfo2("\u5DF2\u9644\u52A0\u6587\u5B57\u6E32\u67D3\u53C2\u8003\u56FE");
            if (config.textRender?.sendPreview !== false) {
              await reply(session, [session.text("image-prompt.messages.textrenderPreview"), import_koishi.h.image(textRef.file.data, "image/png")]);
            }
          }
        }
        if (images.length === 0 && !textRef) {
          await reply(session, [session.text("image-prompt.messages.needimages")]);
          return;
        }
        logInfo2(images);
        const promptEcho = config.showPrompt === false ? "" : buildPromptBlock(promptText, config.promptMaxLength || 4e3);
        try {
          if (config.mergeNotifications === false) {
            await reply(session, [session.text("image-prompt.messages.processing") + selectionNote + (optimizeFailed ? "\n" + session.text("image-prompt.messages.optimizefailed") : "")]);
            if (promptEcho) {
              await session.send([supportsMarkdown(session.platform) ? (0, import_koishi.h)("markdown", promptEcho) : promptEcho]);
            }
          } else {
            notify(session.text("image-prompt.messages.processing") + selectionNote + (optimizeFailed ? "\n" + session.text("image-prompt.messages.optimizefailed") : ""));
            notify(promptEcho);
          }
          const files = await Promise.all(
            images.map((src) => ctx.http.file(src).catch((err) => {
              ctx.logger.error(`\u4E0B\u8F7D\u56FE\u7247\u5931\u8D25: ${src}`, err);
              return null;
            }))
          ).then((results) => results.filter(Boolean));
          if (textRef) files.push(textRef.file);
          if (files.length === 0) {
            await reply(session, [session.text("image-prompt.messages.invalidimage")]);
            return;
          }
          if (config.backgroundDrawing?.enabled) {
            const snapshot = {
              bot: session.bot,
              channelId: session.channelId,
              guildId: session.guildId,
              messageId: session.messageId,
              promptText,
              commandName: cmdConfig.name,
              texts: {
                done: session.text("image-prompt.messages.bgdone"),
                failed: session.text("image-prompt.messages.failed"),
                error: session.text("image-prompt.messages.error")
              }
            };
            const queued = enqueueDrawJob(snapshot, files);
            notify(`${session.text("image-prompt.messages.bgstart", [files.length])}${queued > 0 ? session.text("image-prompt.messages.bgqueue", [queued]) : ""}${selectionNote}`);
            notify(promptEcho);
            await flushNotice();
            return;
          }
          await flushNotice();
          const result = await generateFigureImage(files, promptText);
          if (result) {
            await saveToGallery(result, buildGalleryDescription(promptText, userInputText), cmdConfig.name);
            await sendResultImage(session, result, cmdConfig.name);
            return;
          } else {
            return session.text("image-prompt.messages.failed");
          }
        } catch (error) {
          ctx.logger.error(`[${cmdConfig.name}] \u5904\u7406\u56FE\u7247\u65F6\u53D1\u751F\u9519\u8BEF:`, error);
          return session.text("image-prompt.messages.error");
        }
      });
    }
    let runningJobs = 0;
    const pendingJobs = [];
    function enqueueDrawJob(snapshot, files) {
      const max = config.backgroundDrawing?.maxConcurrent || 3;
      if (runningJobs >= max) {
        pendingJobs.push(() => runDrawJob(snapshot, files));
        return pendingJobs.length;
      }
      runningJobs++;
      void runDrawJob(snapshot, files).finally(() => {
        runningJobs--;
        const next = pendingJobs.shift();
        if (next) {
          runningJobs++;
          void Promise.resolve(next()).finally(() => {
            runningJobs--;
          });
        }
      });
      return 0;
    }
    async function runDrawJob(snapshot, files) {
      const send = (parts) => sendBotMessage(snapshot.bot, snapshot.channelId, parts, snapshot.guildId, snapshot.messageId);
      try {
        if (!isActive || !ctx.scope.isActive) return;
        const result = await generateFigureImage(files, snapshot.promptText);
        if (!result) {
          await send([snapshot.texts.failed]);
          return;
        }
        await saveToGallery(result, buildGalleryDescription(snapshot.promptText, ""), snapshot.commandName);
        await send([`${snapshot.texts.done}
`, import_koishi.h.image(result)]);
      } catch (error) {
        ctx.logger.error(`[${snapshot.commandName}] \u540E\u53F0\u7ED8\u56FE\u5931\u8D25:`, error);
        try {
          await send([snapshot.texts.error]);
        } catch {
        }
      }
    }
    async function optimizePromptText(basePrompt, userInput) {
      const selector = config.aiSelector || {};
      const base = (basePrompt || "").trim();
      const input = (userInput || "").trim();
      if (!input) return null;
      const content = (config.optimizePrompt || DEFAULT_OPTIMIZE_PROMPT).replace(/\{prompt\}/g, base || "\uFF08\u65E0\uFF0C\u8FD9\u662F\u81EA\u5B9A\u4E49\u6307\u4EE4\uFF0C\u8BF7\u76F4\u63A5\u6839\u636E\u7528\u6237\u7684\u9700\u6C42\u6269\u5199\uFF09").replace(/\{userInput\}/g, input);
      const { raw, error } = await callSelectorModel(
        content,
        content,
        false,
        selector.optimizeMaxTokens || 8e3,
        "\u4F60\u662F\u8D44\u6DF1\u7684\u7ED8\u56FE\u63D0\u793A\u8BCD\u5DE5\u7A0B\u5E08\uFF0C\u53EA\u8F93\u51FA\u4F18\u5316\u540E\u7684\u63D0\u793A\u8BCD\u6B63\u6587\uFF0C\u4E0D\u8981\u8F93\u51FA JSON\u3001\u89E3\u91CA\u6216 Markdown \u4EE3\u7801\u5757\u3002",
        typeof selector.optimizeTemperature === "number" ? selector.optimizeTemperature : 0.7
      );
      if (!raw) {
        ctx.logger.warn(`\u63D0\u793A\u8BCD\u878D\u5408\u91CD\u5199\u5931\u8D25: ${error}`);
        return null;
      }
      let text = raw.trim();
      const fence = text.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);
      if (fence) text = fence[1].trim();
      text = text.replace(/^(优化后的提示词|提示词|Optimized Prompt|Prompt)[:：]\s*/i, "");
      text = text.trim();
      if (/^\{[\s\S]*\}$/.test(text)) {
        ctx.logger.warn("\u63D0\u793A\u8BCD\u4F18\u5316\u8FD4\u56DE\u4E86 JSON\uFF0C\u5224\u5B9A\u4E3A\u5931\u8D25\uFF0C\u4FDD\u7559\u8FFD\u52A0\u540E\u7684\u63D0\u793A\u8BCD");
        return null;
      }
      return text || null;
    }
    function buildGalleryDescription(promptText, userInput) {
      const gallery = config.resultGallery || {};
      const source = gallery.descriptionSource || "prompt";
      if (source === "userInput") return userInput || promptText;
      if (source === "both") return [userInput, promptText].filter(Boolean).join(" | ");
      return promptText;
    }
    const pendingTextRefs = /* @__PURE__ */ new Map();
    function textRefKey(session) {
      return `${session.platform}:${session.channelId || session.userId || ""}`;
    }
    function takePendingTextRef(session) {
      const cfg = config.textRender || {};
      const key = textRefKey(session);
      const item = pendingTextRefs.get(key);
      if (!item) return null;
      const ttl = (cfg.pendingTTL || 0) * 1e3;
      if (ttl > 0 && Date.now() - item.time > ttl) {
        pendingTextRefs.delete(key);
        return null;
      }
      pendingTextRefs.delete(key);
      return { file: item.file, text: item.text };
    }
    async function renderTextToImage(text) {
      const cfg = config.textRender || {};
      const lines = String(text || "").split("\n").map((line) => line.trim()).filter(Boolean);
      if (lines.length === 0) return null;
      const puppeteer = ctx.puppeteer;
      if (!puppeteer || typeof puppeteer.page !== "function") {
        ctx.logger.warn("\u6587\u5B57\u6E32\u67D3\u9700\u8981 koishi-plugin-puppeteer\uFF08\u6D4F\u89C8\u5668\u670D\u52A1\uFF09\uFF0C\u5F53\u524D\u4E0D\u53EF\u7528");
        return null;
      }
      const html = buildTextHtml(lines, cfg);
      let page;
      try {
        page = await puppeteer.page();
        await page.setViewport({
          width: cfg.width || 1024,
          height: 400,
          deviceScaleFactor: cfg.scale || 2
        });
        await page.setContent(html, { waitUntil: "load" });
        await page.evaluate(() => document.fonts?.ready).catch(() => {
        });
        const stage = await page.$("#stage");
        const clip = stage ? await stage.boundingBox() : null;
        const transparent = String(cfg.background || "").toLowerCase() === "transparent";
        const buffer = clip ? await page.screenshot({ clip, omitBackground: transparent }) : await page.screenshot({ omitBackground: transparent });
        const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
        logInfo2(`\u6587\u5B57\u6E32\u67D3\u5B8C\u6210: ${lines.length} \u884C, ${data.length} \u5B57\u8282`);
        return { data, mime: "image/png" };
      } catch (error) {
        ctx.logger.warn(`\u6587\u5B57\u6E32\u67D3\u5931\u8D25: ${error}`);
        return null;
      } finally {
        try {
          await page?.close();
        } catch {
        }
      }
    }
    async function resolveTextReference(session, promptText, userInput, modelText) {
      const cfg = config.textRender || {};
      if (!cfg.enabled || cfg.attachToDraw === false) return null;
      const pending = takePendingTextRef(session);
      if (pending) return pending;
      const fromModel = (modelText || "").trim();
      if (fromModel) {
        const file2 = await renderTextToImage(fromModel);
        if (file2) return { file: file2, text: fromModel };
      }
      if (cfg.autoDetect === false) return null;
      const found = [
        ...extractTextToRender(promptText, { loose: cfg.loose, maxChars: cfg.maxChars }),
        ...extractTextToRender(userInput, { loose: cfg.loose, maxChars: cfg.maxChars })
      ];
      const text = Array.from(new Set(found)).join("\n");
      if (!text) return null;
      logInfo2(`\u81EA\u52A8\u8BC6\u522B\u5230\u9700\u8981\u6E32\u67D3\u7684\u6587\u5B57: ${text}`);
      const file = await renderTextToImage(text);
      return file ? { file, text } : null;
    }
    const textCmdName = (config.textRender?.commandName || "\u6E32\u67D3\u6587\u5B57").trim() || "\u6E32\u67D3\u6587\u5B57";
    ctx.command(`${config.basename}/${textCmdName} [...text:text]`).usage("\u628A\u6587\u5B57\u6E32\u67D3\u6210\u56FE\u7247\uFF0C\u4F5C\u4E3A\u7ED8\u56FE\u53C2\u8003\u56FE\uFF08\u89E3\u51B3\u4E2D\u6587\u5D29\u5B57\uFF09").action(async ({ session }, ...args) => {
      if (!isActive || !ctx.scope.isActive) return;
      if (!session) return;
      const quote = import_koishi.h.quote(session.messageId);
      const cfg = config.textRender || {};
      const raw = args.filter(Boolean).join(" ").trim() || stripCommandName(extractTextFromMessage(session.stripped.content), textCmdName).trim();
      if (!raw) return `${quote}${session.text("image-prompt.messages.textrenderEmpty", [textCmdName])}`;
      const puppeteer = ctx.puppeteer;
      if (!puppeteer || typeof puppeteer.page !== "function") {
        return `${quote}${session.text("image-prompt.messages.textrenderNopp")}`;
      }
      const file = await renderTextToImage(raw);
      if (!file) return `${quote}${session.text("image-prompt.messages.textrenderFailed", ["\u6E32\u67D3\u5F02\u5E38"])}`;
      if (cfg.attachToDraw !== false) {
        pendingTextRefs.set(textRefKey(session), { file, text: raw, time: Date.now() });
      }
      const ttl = cfg.pendingTTL || 0;
      const tip = ttl > 0 ? session.text("image-prompt.messages.textrenderOk", [ttl]) : session.text("image-prompt.messages.textrenderOkForever");
      if (cfg.sendPreview !== false) {
        await reply(session, [import_koishi.h.image(file.data, "image/png"), tip]);
        return;
      }
      return `${quote}${tip}`;
    });
    const debugCmdName = (config.aiSelector?.debugCommand || "\u6D4B\u8BD5\u9009\u56FE").trim() || "\u6D4B\u8BD5\u9009\u56FE";
    ctx.command(`${config.basename}/${debugCmdName}`).usage("\u53D1\u4E00\u6B21\u9009\u56FE\u8BF7\u6C42\u5E76\u56DE\u663E\u6A21\u578B\u539F\u59CB\u8FD4\u56DE\uFF0C\u7528\u4E8E\u6392\u67E5\u300C\u54CD\u5E94\u4E2D\u6CA1\u6709\u6587\u672C\u5185\u5BB9\u300D").action(async ({ session }) => {
      if (!isActive || !ctx.scope.isActive) return;
      if (!session) return;
      const quote = import_koishi.h.quote(session.messageId);
      const selector = config.aiSelector || {};
      const model = selector.model || "Qwen/Qwen2.5-7B-Instruct";
      const url = selector.baseUrl || config.baseUrl;
      const param = resolveTokenParam(model, selector.maxTokensParam);
      await reply(session, [`\u6B63\u5728\u6D4B\u8BD5\u9009\u56FE\u6A21\u578B ${model} ...`]);
      const body = {
        model,
        messages: [
          { role: "system", content: "\u4F60\u662F\u4E00\u4E2A\u7CBE\u51C6\u7684\u53C2\u8003\u56FE\u7247\u9009\u62E9\u52A9\u624B\uFF0C\u53EA\u8F93\u51FA JSON\u3002" },
          { role: "user", content: "\u5019\u9009\u56FE\u7247\uFF1A\n[1] \u6240\u5C5E\u7EC4\uFF1A\u6D4B\u8BD5 | \u63CF\u8FF0\uFF1A\u7EA2\u53D1\u53CC\u9A6C\u5C3E\u3001\u767D\u8272\u6C34\u624B\u670D\u3001\u7AD9\u7ACB\u3001\u65E5\u7CFB\u539A\u6D82\n\n\u7528\u6237\u9700\u6C42\uFF1A\u6D4B\u8BD5\n\u6700\u591A\u9009\u62E9 1 \u5F20\u3002\u53EA\u8F93\u51FA JSON\u3002" }
        ],
        temperature: typeof selector.temperature === "number" ? selector.temperature : 0.2,
        max_tokens: 1e3
      };
      const apiKey = selector.apiKey || config.apiKey;
      const headers = { "Content-Type": "application/json" };
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      try {
        const response = await ctx.http.post(url, withTokenParam(body, param), {
          headers,
          timeout: (selector.timeout || 60) * 1e3
        });
        const { text, reason } = extractResponseText(response);
        const lines = [
          `\u63A5\u53E3\uFF1A${url}`,
          `\u6A21\u578B\uFF1A${model}`,
          `\u957F\u5EA6\u53C2\u6570\uFF1A${param}`,
          text ? `\u53D6\u5230\u5185\u5BB9\uFF1A${previewJson(text, 400)}` : `\u53D6\u4E0D\u5230\u5185\u5BB9\uFF1A${reason}`,
          text ? "" : `\u539F\u59CB\u8FD4\u56DE\uFF1A${previewJson(response, 1200)}`
        ].filter(Boolean);
        return `${quote}${lines.join("\n")}`;
      } catch (error) {
        const status = error?.response?.status ?? error?.status ?? error?.code;
        return `${quote}\u8BF7\u6C42\u5931\u8D25\uFF1A${describeSelectorError(status, extractServerMessage(error), String(error?.message || error))}`;
      }
    });
    let galleryRecords = [];
    let galleryLoaded = false;
    function galleryFilePath() {
      return nodePath.join(ctx.baseDir, "data", name, "gallery.json");
    }
    async function loadGallery() {
      if (galleryLoaded) return;
      galleryLoaded = true;
      try {
        const raw = await import_node_fs.promises.readFile(galleryFilePath(), "utf8");
        const data = JSON.parse(raw);
        if (Array.isArray(data?.items)) galleryRecords = data.items;
        logInfo2(`\u5DF2\u52A0\u8F7D\u56FE\u5E93 ${galleryRecords.length} \u6761`);
      } catch (error) {
        galleryRecords = [];
      }
    }
    async function persistGallery() {
      try {
        await import_node_fs.promises.mkdir(nodePath.dirname(galleryFilePath()), { recursive: true });
        await import_node_fs.promises.writeFile(galleryFilePath(), JSON.stringify({ items: galleryRecords }, null, 2), "utf8");
      } catch (error) {
        ctx.logger.warn(`\u5199\u5165\u56FE\u5E93\u6587\u4EF6\u5931\u8D25: ${error?.message || error}`);
      }
    }
    async function saveToGallery(imageUrl, description, commandName) {
      const gallery = config.resultGallery || {};
      if (!gallery.enabled || !imageUrl) return;
      await loadGallery();
      const groupName = (gallery.groupName || "\u751F\u6210\u7ED3\u679C").trim() || "\u751F\u6210\u7ED3\u679C";
      if (galleryRecords.some((r) => r.url === imageUrl)) return;
      galleryRecords.push({
        group: groupName,
        url: imageUrl,
        description: truncateText(description, gallery.maxLength || 120),
        command: commandName,
        time: Date.now()
      });
      galleryRecords = trimGallery(galleryRecords, gallery.capacity || 50);
      await persistGallery();
      logInfo2(`\u751F\u6210\u7ED3\u679C\u5DF2\u5165\u5E93: ${groupName} ${imageUrl}`);
    }
    const galleryCmdName = (config.resultGallery?.commandName || "\u56FE\u5E93").trim() || "\u56FE\u5E93";
    ctx.command(`${config.basename}/${galleryCmdName} [group:text]`).usage("\u67E5\u770B\u6216\u6E05\u7A7A\u81EA\u52A8\u5165\u5E93\u7684\u751F\u6210\u7ED3\u679C").action(async ({ session }, groupName) => {
      if (!isActive || !ctx.scope.isActive) return;
      if (!session) return;
      await loadGallery();
      const quote = import_koishi.h.quote(session.messageId);
      const keyword = (groupName || "").trim();
      if (keyword === "\u6E05\u7A7A" || keyword === "clear") {
        const count = galleryRecords.length;
        galleryRecords = [];
        await persistGallery();
        return `${quote}\u5DF2\u6E05\u7A7A\u56FE\u5E93\uFF08${count} \u6761\uFF09`;
      }
      const records = keyword ? galleryRecords.filter((r) => r.group.includes(keyword) || r.description.includes(keyword)) : galleryRecords;
      if (records.length === 0) {
        return `${quote}\u56FE\u5E93\u662F\u7A7A\u7684\uFF08\u751F\u6210\u7ED3\u679C\u5165\u5E93\u672A\u5F00\u542F\uFF0C\u6216\u8FD8\u6CA1\u6709\u751F\u6210\u8FC7\u56FE\u7247\uFF09`;
      }
      const lines = records.slice(-20).map((r, i) => `${i + 1}. [${r.group}] ${r.description || "\uFF08\u65E0\u63CF\u8FF0\uFF09"}`).join("\n");
      return `${quote}\u56FE\u5E93\u5171 ${records.length} \u6761${records.length > 20 ? "\uFF08\u663E\u793A\u6700\u8FD1 20 \u6761\uFF09" : ""}\uFF1A
${lines}

\u53D1\u9001\u300C${galleryCmdName} \u6E05\u7A7A\u300D\u53EF\u6E05\u7A7A`;
    });
    const captionCmdName = (config.aiSelector?.captionCommand || "\u751F\u6210\u63CF\u8FF0").trim() || "\u751F\u6210\u63CF\u8FF0";
    ctx.command(`${config.basename}/${captionCmdName} [group:text]`).usage("\u7528 AI \u8BC6\u522B\u53C2\u8003\u56FE\u7247\u5E76\u81EA\u52A8\u586B\u5199\u63CF\u8FF0\uFF08\u9700\u8981\u652F\u6301\u56FE\u7247\u8F93\u5165\u7684\u6A21\u578B\uFF09").action(async ({ session }, groupName) => {
      if (!isActive || !ctx.scope.isActive) return;
      if (!session) return;
      const quote = import_koishi.h.quote(session.messageId);
      const selector = config.aiSelector || {};
      const model = selector.captionModel || selector.model || "Qwen/Qwen2.5-7B-Instruct";
      const userImages = extractImagesFromSession(session);
      if (userImages.length > 0) {
        await reply(session, [`\u6B63\u5728\u8BC6\u522B ${userImages.length} \u5F20\u56FE\u7247...`]);
        const lines2 = [];
        for (const url of userImages.slice(0, selector.captionBatch || 8)) {
          const caption = await generateCaption(url, model);
          lines2.push(caption || `\uFF08\u8BC6\u522B\u5931\u8D25\uFF09${url}`);
        }
        return `${quote}\u8BC6\u522B\u7ED3\u679C\uFF1A
${lines2.join("\n")}`;
      }
      const groups = config.referenceGroups || [];
      if (groups.length === 0) {
        return `${quote}\u8FD8\u6CA1\u6709\u914D\u7F6E\u4EFB\u4F55\u53C2\u8003\u56FE\u7247\u7EC4\uFF0C\u8BF7\u5148\u5728\u300C\u53C2\u8003\u56FE\u7247\u7EC4\u300D\u91CC\u6DFB\u52A0\u56FE\u7247\u94FE\u63A5\u3002`;
      }
      const keyword = (groupName || "").trim();
      const targets = keyword ? groups.filter((g) => g.name === keyword || g.name.includes(keyword)) : groups.filter((g) => g.enabled !== false);
      if (targets.length === 0) {
        return `${quote}\u6CA1\u6709\u627E\u5230\u540D\u4E3A\u300C${keyword}\u300D\u7684\u53C2\u8003\u56FE\u7247\u7EC4\u3002`;
      }
      const pending = [];
      for (const group of targets) {
        for (const item of group.items || []) {
          if (item?.url && !(item.description || "").trim()) pending.push({ group, item });
        }
      }
      if (pending.length === 0) {
        return `${quote}\u8FD9\u4E9B\u7EC4\u91CC\u7684\u56FE\u7247\u90FD\u5DF2\u7ECF\u6709\u63CF\u8FF0\u4E86\u3002\u82E5\u8981\u91CD\u65B0\u751F\u6210\uFF0C\u8BF7\u5148\u6E05\u7A7A\u5BF9\u5E94\u56FE\u7247\u7684\u63CF\u8FF0\u3002`;
      }
      const batch = pending.slice(0, selector.captionBatch || 8);
      await reply(session, [`\u6B63\u5728\u4E3A ${batch.length} \u5F20\u53C2\u8003\u56FE\u7247\u751F\u6210\u63CF\u8FF0\uFF08\u5171 ${pending.length} \u5F20\u5F85\u5904\u7406\uFF09...`]);
      const lines = [];
      let success = 0;
      for (const { group, item } of batch) {
        const caption = await generateCaption(item.url, model);
        if (caption) {
          item.description = caption;
          success++;
          lines.push(`[${group.name}] ${caption}`);
        } else {
          lines.push(`[${group.name}] \u8BC6\u522B\u5931\u8D25\uFF1A${item.url}`);
        }
      }
      await reply(session, [`\u5DF2\u751F\u6210 ${success} \u6761\u63CF\u8FF0\uFF1A
${lines.join("\n")}`]);
      if (success > 0) {
        try {
          ctx.scope.update(config, true);
          logInfo2(`\u5DF2\u5199\u56DE ${success} \u6761\u56FE\u7247\u63CF\u8FF0\u5230\u63D2\u4EF6\u914D\u7F6E`);
        } catch (error) {
          ctx.logger.warn(`\u5199\u56DE\u63D2\u4EF6\u914D\u7F6E\u5931\u8D25: ${error?.message || error}`);
          await reply(session, ["\u81EA\u52A8\u5199\u5165\u914D\u7F6E\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u628A\u4E0A\u9762\u7684\u63CF\u8FF0\u586B\u5230\u63A7\u5236\u53F0\u7684\u300C\u53C2\u8003\u56FE\u7247\u7EC4\u300D\u91CC\u3002"]);
        }
      }
    });
    async function generateCaption(imageUrl, model) {
      const selector = config.aiSelector || {};
      const body = {
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: selector.captionPrompt || DEFAULT_CAPTION_PROMPT },
              { type: "image_url", image_url: { url: imageUrl } }
            ]
          }
        ],
        temperature: 0.3,
        max_tokens: 300
      };
      const url = selector.baseUrl || config.baseUrl;
      const apiKey = selector.apiKey || config.apiKey;
      const timeout = (selector.timeout || 60) * 1e3;
      const { raw, error } = await requestSelectorModel(url, apiKey, body, timeout);
      if (!raw) {
        ctx.logger.warn(`\u751F\u6210\u56FE\u7247\u63CF\u8FF0\u5931\u8D25: ${error}`);
        if (selector.vision !== true && !selector.captionModel) {
          ctx.logger.warn("\u751F\u6210\u63CF\u8FF0\u9700\u8981\u652F\u6301\u56FE\u7247\u8F93\u5165\u7684\u6A21\u578B\uFF1A\u8BF7\u52FE\u9009\u300C\u9009\u56FE\u6A21\u578B\u652F\u6301\u8BC6\u522B\u56FE\u7247\u300D\u6216\u5355\u72EC\u586B\u5199\u300C\u751F\u6210\u63CF\u8FF0\u7528\u7684\u6A21\u578B\u300D");
        }
        return null;
      }
      return sanitizeCaption(raw, 120) || null;
    }
    function collectCandidates(cmdConfig, defaultImageUrls) {
      const candidates = [];
      const groups = config.referenceGroups || [];
      const selector = config.aiSelector || {};
      const names = (cmdConfig.referenceGroups || []).filter(Boolean);
      const targets = names.length > 0 ? groups.filter((g) => g.enabled !== false && names.includes(g.name)) : selector.includeAllGroups ? groups.filter((g) => g.enabled !== false) : [];
      for (const group of targets) {
        for (const item of group.items || []) {
          if (!item || !item.url) continue;
          candidates.push({
            group: group.name,
            url: item.url,
            description: (item.description || "").trim()
          });
        }
      }
      if (selector.includeCommandDefaults) {
        for (const url of defaultImageUrls) {
          if (url) candidates.push({ group: "\u6307\u4EE4\u9ED8\u8BA4\u56FE\u7247", url, description: "" });
        }
      }
      const gallery = config.resultGallery || {};
      if (gallery.enabled && galleryRecords.length > 0) {
        const wanted = names.length > 0 ? names : selector.includeAllGroups ? null : [];
        const galleryGroup = (gallery.groupName || "\u751F\u6210\u7ED3\u679C").trim();
        for (const record of galleryRecords) {
          if (wanted && !wanted.includes(record.group) && !wanted.includes(galleryGroup)) continue;
          candidates.push({
            group: record.group,
            url: record.url,
            description: record.description
          });
        }
      }
      return candidates;
    }
    async function runAISelection(candidates, userInput, cmdConfig, promptText, max) {
      const selector = config.aiSelector || {};
      const threshold = selector.twoStageThreshold || 12;
      if (selector.twoStage !== false && candidates.length > threshold) {
        const result = await runTwoStageSelection(candidates, userInput, cmdConfig, promptText, max);
        if (result.ok || result.needUserImage) return result;
        ctx.logger.warn("\u4E24\u7EA7\u68C0\u7D22\u672A\u53EC\u56DE\u5019\u9009\uFF0C\u9000\u56DE\u5355\u9636\u6BB5\u5168\u91CF\u9009\u62E9");
      }
      return runSingleStageSelection(candidates, userInput, cmdConfig, promptText, max);
    }
    function buildIndexText(candidates) {
      return candidates.map((c, i) => `[${i + 1}] \u6240\u5C5E\u7EC4\uFF1A${c.group} | \u63CF\u8FF0\uFF1A${c.description || "\uFF08\u65E0\u63CF\u8FF0\uFF09"}`).join("\n");
    }
    async function runTwoStageSelection(candidates, userInput, cmdConfig, promptText, max) {
      const selector = config.aiSelector || {};
      const topK = selector.retrievalTopK || 12;
      const keywordContent = (selector.keywordPrompt || DEFAULT_KEYWORD_PROMPT).replace(/\{index\}/g, buildIndexText(candidates)).replace(/\{userInput\}/g, userInput || "\uFF08\u7528\u6237\u672A\u9644\u52A0\u8BF4\u660E\uFF09").replace(/\{topK\}/g, String(topK)).replace(/\{command\}/g, cmdConfig.name || "").replace(/\{prompt\}/g, promptText || "");
      const { raw, error } = await callSelectorModel(
        keywordContent,
        keywordContent,
        false,
        selector.keywordMaxTokens || 3e3
      );
      const first = parseSelection(raw, candidates, topK);
      logInfo2(`\u4E24\u7EA7\u68C0\u7D22\xB7\u5173\u952E\u8BCD: ${JSON.stringify(first.keywords || [])} \u7C97\u7B5B: ${first.picked.length}`);
      const matched = matchCandidatesByKeywords(candidates, first.keywords || [], topK);
      const shortlist = mergeCandidates(first.picked, matched).slice(0, topK);
      if (shortlist.length === 0) {
        const result = {
          picked: [],
          needUserImage: false,
          askMessage: "",
          reason: "",
          ok: false,
          error: error || "\u68C0\u7D22\u9636\u6BB5\u672A\u53EC\u56DE\u4EFB\u4F55\u5019\u9009\u56FE\u7247"
        };
        return result;
      }
      logInfo2(`\u4E24\u7EA7\u68C0\u7D22\u53EC\u56DE ${shortlist.length}/${candidates.length} \u5F20\u8FDB\u5165\u7CBE\u6392`);
      const final = await runSingleStageSelection(shortlist, userInput, cmdConfig, promptText, max);
      final.recalled = shortlist.length;
      final.total = candidates.length;
      return final;
    }
    async function runSingleStageSelection(candidates, userInput, cmdConfig, promptText, max) {
      const selector = config.aiSelector || {};
      const content = (selector.prompt || DEFAULT_SELECTOR_PROMPT).replace(/\{candidates\}/g, buildIndexText(candidates)).replace(/\{userInput\}/g, userInput || "\uFF08\u7528\u6237\u672A\u9644\u52A0\u8BF4\u660E\uFF09").replace(/\{max\}/g, String(max)).replace(/\{command\}/g, cmdConfig.name || "").replace(/\{prompt\}/g, promptText || "");
      const visionOn = selector.vision === true;
      const userContent = buildSelectorContent(content, candidates, visionOn, selector.visionMaxImages || 6);
      const { raw, error } = await callSelectorModel(
        userContent,
        content,
        visionOn,
        selector.selectMaxTokens || 8e3
      );
      logInfo2(`AI \u9009\u56FE\u539F\u59CB\u54CD\u5E94: ${raw}`);
      const result = parseSelection(raw, candidates, max);
      if (!result.ok) result.error = error || "\u6A21\u578B\u672A\u8FD4\u56DE\u53EF\u89E3\u6790\u7684\u9009\u62E9\u7ED3\u679C";
      return result;
    }
    async function callSelectorModel(content, plainText, visionOn, maxTokens, systemPrompt, temperature) {
      const selector = config.aiSelector || {};
      const sysText = systemPrompt || "\u4F60\u662F\u4E00\u4E2A\u7CBE\u51C6\u7684\u53C2\u8003\u56FE\u7247\u9009\u62E9\u52A9\u624B\uFF0C\u53EA\u8F93\u51FA JSON\u3002";
      const requestBody = {
        model: selector.model || "Qwen/Qwen2.5-7B-Instruct",
        messages: [
          { role: "system", content: sysText },
          { role: "user", content }
        ],
        temperature: typeof temperature === "number" ? temperature : typeof selector.temperature === "number" ? selector.temperature : 0.2,
        max_tokens: maxTokens
      };
      const url = selector.baseUrl || config.baseUrl;
      const apiKey = selector.apiKey || config.apiKey;
      const timeout = (selector.timeout || 60) * 1e3;
      logInfo2(`AI \u9009\u56FE\u8BF7\u6C42: ${url} \u6A21\u578B ${requestBody.model} \u8BC6\u522B\u56FE\u7247=${visionOn}`);
      let { raw, error } = await requestSelectorModel(url, apiKey, requestBody, timeout);
      if (!raw && visionOn && selector.visionFallback !== false) {
        ctx.logger.warn(
          `AI \u9009\u56FE\u5E26\u56FE\u7247\u8BF7\u6C42\u5931\u8D25\uFF08${error || "\u672A\u77E5\u539F\u56E0"}\uFF09\uFF0C\u9000\u56DE\u7EAF\u6587\u5B57\u63CF\u8FF0\u518D\u8BD5\u4E00\u6B21\u3002\u82E5\u8BE5\u6A21\u578B\u4E0D\u652F\u6301\u56FE\u7247\u8F93\u5165\uFF08DeepSeek \u7B49\u7EAF\u6587\u672C\u6A21\u578B\u4F1A\u8FD4\u56DE 400\uFF09\uFF0C\u8BF7\u5173\u95ED\u300C\u9009\u56FE\u6A21\u578B\u652F\u6301\u8BC6\u522B\u56FE\u7247\u300D`
        );
        const retry = await requestSelectorModel(url, apiKey, {
          ...requestBody,
          messages: [
            { role: "system", content: sysText },
            { role: "user", content: plainText }
          ]
        }, timeout);
        raw = retry.raw;
        error = retry.error;
      }
      return { raw, error };
    }
    async function requestSelectorModel(url, apiKey, body, timeout) {
      const selector = config.aiSelector || {};
      const maxRetry = typeof selector.maxRetries === "number" ? selector.maxRetries : 2;
      const baseInterval = selector.retryInterval || 3e3;
      const maxWaitMs = (typeof selector.retryMaxWait === "number" ? selector.retryMaxWait : 20) * 1e3;
      let lastError = "\u672A\u77E5\u9519\u8BEF";
      let tokenParam = resolveTokenParam(body?.model, selector.maxTokensParam);
      let tokenParamSwitched = false;
      let currentMaxTokens = body?.max_tokens ?? body?.max_completion_tokens;
      const maxTokensCeiling = selector.maxTokensCeiling || 32e3;
      for (let i = 0; i <= maxRetry; i++) {
        if (!isActive || !ctx.scope.isActive) return { raw: null, error: "\u63D2\u4EF6\u5DF2\u505C\u7528" };
        let emptyResponse = false;
        let truncated = false;
        try {
          const headers = { "Content-Type": "application/json" };
          if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
          const payload = withTokenParam(
            typeof currentMaxTokens === "number" ? { ...body, max_tokens: currentMaxTokens } : body,
            tokenParam
          );
          const response = await ctx.http.post(url, payload, { headers, timeout });
          const { text, reason, truncated: cut } = extractResponseText(response);
          if (text) return { raw: text, error: "" };
          emptyResponse = true;
          truncated = cut;
          lastError = reason;
          ctx.logger.warn(`AI \u9009\u56FE\u54CD\u5E94\u91CC\u53D6\u4E0D\u5230\u6587\u672C\uFF1A${reason}`);
          logInfo2(`AI \u9009\u56FE\u539F\u59CB\u8FD4\u56DE\uFF08\u622A\u65AD\uFF09\uFF1A${previewJson(response, 800)}`);
          throw new Error(`\u6A21\u578B\u6CA1\u6709\u8FD4\u56DE\u6587\u672C\u5185\u5BB9\uFF08${reason}\uFF09`);
        } catch (error) {
          const status = error?.response?.status ?? error?.status ?? error?.code;
          lastError = emptyResponse ? lastError : describeSelectorError(status, extractServerMessage(error), String(error?.message || error || ""));
          ctx.logger.warn(`AI \u9009\u56FE\u8BF7\u6C42\u5931\u8D25 (${i + 1}/${maxRetry + 1}): ${lastError}`);
          if (i >= maxRetry) break;
          if (truncated && typeof currentMaxTokens === "number" && currentMaxTokens < maxTokensCeiling) {
            const next = Math.min(Math.max(currentMaxTokens * 4, 4e3), maxTokensCeiling);
            ctx.logger.warn(`\u8F93\u51FA\u88AB max_tokens=${currentMaxTokens} \u622A\u65AD\uFF0C\u52A0\u5927\u5230 ${next} \u91CD\u8BD5`);
            currentMaxTokens = next;
            continue;
          }
          if (emptyResponse && !tokenParamSwitched) {
            tokenParam = tokenParam === "max_tokens" ? "max_completion_tokens" : "max_tokens";
            tokenParamSwitched = true;
            ctx.logger.warn(`\u4E0B\u6B21\u91CD\u8BD5\u6539\u7528 ${tokenParam} \u53C2\u6570\u540D`);
            continue;
          }
          if (!isRetryableStatus(status)) {
            ctx.logger.warn(`AI \u9009\u56FE\u8BF7\u6C42\u8FD4\u56DE ${status}\uFF0C\u5C5E\u4E8E\u4E0D\u53EF\u91CD\u8BD5\u7684\u9519\u8BEF\uFF0C\u505C\u6B62\u91CD\u8BD5`);
            break;
          }
          const delay = computeRetryDelay(status, parseRetryAfterHeader(error?.response?.headers), baseInterval, i);
          if (maxWaitMs > 0 && delay > maxWaitMs) {
            ctx.logger.warn(`AI \u9009\u56FE\u9700\u8981\u7B49\u5F85 ${Math.round(delay / 1e3)} \u79D2\uFF0C\u8D85\u8FC7\u8BBE\u5B9A\u7684 ${selector.retryMaxWait} \u79D2\uFF0C\u505C\u6B62\u91CD\u8BD5`);
            break;
          }
          logInfo2(`AI \u9009\u56FE\u5C06\u5728 ${delay}ms \u540E\u91CD\u8BD5`);
          await (0, import_koishi.sleep)(delay);
        }
      }
      return { raw: null, error: lastError };
    }
    function parseSelection(raw, candidates, max) {
      return parseSelectionResult(raw, candidates, max, (msg) => ctx.logger.warn(msg));
    }
    async function askUserForImage(session, quote, askText, timeoutSec) {
      const [msgId] = await reply(session, [
        session.text("image-prompt.messages.askimage", [askText, timeoutSec])
      ]);
      try {
        return await session.prompt(timeoutSec * 1e3);
      } finally {
        try {
          await session.bot.deleteMessage(session.channelId, msgId);
        } catch {
          ctx.logger.warn(`\u5728\u9891\u9053 ${session.channelId} \u5C1D\u8BD5\u64A4\u56DE\u6D88\u606FID ${msgId} \u5931\u8D25\u3002`);
        }
      }
    }
    function extractTextFromMessage(content) {
      if (!content) return "";
      return import_koishi.h.select(content, "text").map((el) => el.attrs.content || "").join(" ").trim();
    }
    function extractImagesFromSession(session) {
      const images = [];
      const currentImages = extractImagesFromMessage(session.stripped.content);
      images.push(...currentImages);
      if (session.quote) {
        const quoteImages = extractImagesFromMessage(session.quote.content);
        images.push(...quoteImages);
      }
      return images;
    }
    function extractImagesFromMessage(content) {
      const images = [];
      const imgElements = import_koishi.h.select(content, "img");
      for (const img of imgElements) {
        if (img.attrs.src) {
          images.push(img.attrs.src);
        }
      }
      const mfaceElements = import_koishi.h.select(content, "mface");
      for (const mface of mfaceElements) {
        if (mface.attrs.url) {
          images.push(mface.attrs.url);
        }
      }
      return images;
    }
    async function generateFigureImage(files, prompt) {
      try {
        const dataUrls = [];
        for (const file of files) {
          let processedImageData = file.data;
          let originalMimeType = file.mime || "image/jpeg";
          let finalMimeType = originalMimeType;
          let base64Image;
          if (Buffer.isBuffer(processedImageData)) {
            base64Image = processedImageData.toString("base64");
          } else if (processedImageData instanceof ArrayBuffer) {
            base64Image = Buffer.from(processedImageData).toString("base64");
          } else {
            base64Image = Buffer.from(processedImageData).toString("base64");
          }
          dataUrls.push(`data:${finalMimeType};base64,${base64Image}`);
        }
        const contentArray = [
          {
            type: "text",
            text: prompt
          }
        ];
        for (const dataUrl of dataUrls) {
          contentArray.push({
            type: "image_url",
            image_url: {
              url: dataUrl
            }
          });
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
        };
        logInfo2("\u8BF7\u6C42\u4F53\u7ED3\u6784:", JSON.stringify({
          ...requestBody,
          messages: [
            {
              ...requestBody.messages[0],
              content: [
                requestBody.messages[0].content[0],
                ...requestBody.messages[0].content.slice(1).map((item, index) => {
                  const originalUrl = item.image_url.url;
                  const mimeMatch = originalUrl.match(/^data:([^;]+);base64,/);
                  const mimeType = mimeMatch ? mimeMatch[1] : "image";
                  return {
                    type: "image_url",
                    image_url: {
                      url: `data:${mimeType};base64,[${originalUrl.length} chars]`
                    }
                  };
                })
              ]
            }
          ]
        }, null, 2));
        return await sendChatRequest(requestBody);
      } catch (error) {
        ctx.logger.error(`\u751F\u6210\u56FE\u7247\u65F6\u53D1\u751F\u9519\u8BEF: ${error}`);
        return null;
      }
    }
    async function sendChatRequest(requestBody) {
      let retryCount = 0;
      while (retryCount <= config.maxRetries) {
        if (!isActive || !ctx.scope.isActive) {
          ctx.logger.info("\u63D2\u4EF6\u5DF2\u5378\u8F7D\uFF0C\u505C\u6B62\u91CD\u8BD5");
          return null;
        }
        try {
          logInfo2(`\u53D1\u9001\u8BF7\u6C42\u5230 ${config.baseUrl}\uFF0C\u7B2C ${retryCount + 1} \u6B21\u5C1D\u8BD5`);
          const headers = {
            "Content-Type": "application/json"
          };
          if (config.apiKey) {
            headers["Authorization"] = `Bearer ${config.apiKey}`;
          }
          const response = await ctx.http.post(config.baseUrl, requestBody, { headers });
          if (response && response.choices && response.choices[0] && response.choices[0].message) {
            const message = response.choices[0].message;
            logInfo2(`\u54CD\u5E94\uFF1A${JSON.stringify(response)}`);
            if (message.content) {
              const markdownMatch = message.content.match(/!\[.*?\]\((https?:\/\/[^)]+)\)/);
              if (markdownMatch && markdownMatch[1]) {
                const imageUrl = markdownMatch[1];
                logInfo2(`\u6210\u529F\u83B7\u53D6\u56FE\u7247URL: ${imageUrl}`);
                return imageUrl;
              }
            }
          }
          const errorMsg = "\u54CD\u5E94\u4E2D\u672A\u627E\u5230\u56FE\u7247URL";
          throw new Error(errorMsg);
        } catch (error) {
          retryCount++;
          const errorMessage = error.message || error.toString();
          const statusCode = error.response?.status || 0;
          logInfo2(`\u8BF7\u6C42\u5931\u8D25 (${retryCount}/${config.maxRetries}): ${errorMessage}`);
          if (errorMessage.includes("insufficient_quota") || statusCode === 429) {
            ctx.logger.error("API \u914D\u989D\u4E0D\u8DB3\uFF0C\u505C\u6B62\u91CD\u8BD5");
            return null;
          }
          if (retryCount <= config.maxRetries) {
            logInfo2(`\u7B49\u5F85 ${config.retryInterval}ms \u540E\u91CD\u8BD5`);
            await (0, import_koishi.sleep)(config.retryInterval);
            if (!isActive || !ctx.scope.isActive) {
              ctx.logger.info("\u63D2\u4EF6\u5DF2\u5378\u8F7D\uFF0C\u505C\u6B62\u91CD\u8BD5");
              return null;
            }
          } else {
            ctx.logger.error(`\u8FBE\u5230\u6700\u5927\u91CD\u8BD5\u6B21\u6570 (${config.maxRetries})\uFF0C\u6700\u540E\u9519\u8BEF: ${errorMessage}`);
            return null;
          }
        }
      }
      return null;
    }
    function logInfo2(...args) {
      if (config.loggerinfo) {
        logger.info(...args);
      }
    }
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Config,
  apply,
  buildMarkdownImage,
  buildPromptBlock,
  buildPromptEcho,
  buildSelectorContent,
  buildTextHtml,
  computeRetryDelay,
  describeSelectorError,
  escapeHtml,
  extractResponseText,
  extractServerMessage,
  extractTextToRender,
  inject,
  isPassiveReplyError,
  isRetryableStatus,
  matchCandidatesByKeywords,
  mergeCandidates,
  mergePrompt,
  name,
  parseRetryAfterHeader,
  parseSelectionResult,
  previewJson,
  resolveTokenParam,
  sanitizeCaption,
  stripCommandName,
  stripThinkTags,
  supportsMarkdown,
  trimGallery,
  truncateText,
  usage,
  withTokenParam
});
