import { Context, Schema } from 'koishi';
export declare const name = "image-prompt";
/**
 * 依赖声明：http / logger / i18n 是必需的；
 * puppeteer 是**可选**的——只有开启「文字渲染参考图」时才需要浏览器服务，
 * 没装也能正常绘图（Koishi 会在它可用时把它注入进来，并等它就绪后再启动本插件）。
 */
export declare const inject: {
    required: string[];
    optional: string[];
};
export declare const usage = "\n---\n\n\u6B64\u63D2\u4EF6\u76F4\u63A5\u8C03\u7528 OpenAI \u517C\u5BB9\u7684 Chat Completions \u63A5\u53E3\u751F\u6210\u56FE\u7247\n\n\u8BF7\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u586B\u5199\uFF1A\n\n- API \u670D\u52A1\u5668\u5730\u5740\uFF08baseUrl\uFF09\n- \u4F7F\u7528\u7684\u6A21\u578B\uFF08model\uFF09\n- API \u5BC6\u94A5\uFF08apiKey\uFF09\n\n\u3010AI \u9009\u62E9\u53C2\u8003\u56FE\u7247\u3011\n\n1. \u5728\u300C\u53C2\u8003\u56FE\u7247\u7EC4\u300D\u4E2D\u6CE8\u518C\u5206\u7EC4\uFF1A\u6BCF\u7EC4\u586B\u5199\u82E5\u5E72\u5F20\u300C\u56FE\u7247\u94FE\u63A5 + \u63CF\u8FF0\u300D\uFF08\u63CF\u8FF0\u7528\u4E8E\u8BA9 AI \u5224\u65AD\u8BE5\u56FE\u7684\u7528\u9014\uFF09\u3002\n2. \u5728\u6307\u4EE4\u914D\u7F6E\u7684\u300C\u5F15\u7528\u7684\u53C2\u8003\u56FE\u7247\u7EC4\u540D\u79F0\u300D\u4E2D\u586B\u5165\u7EC4\u540D\uFF08\u53EF\u586B\u591A\u4E2A\uFF09\uFF0C\u8BE5\u6307\u4EE4\u6267\u884C\u65F6\u4F1A\u628A\u7EC4\u5185\u56FE\u7247\u5168\u90E8\u4EA4\u7ED9 AI \u6311\u9009\u3002\n3. \u300CAI \u9009\u56FE\u8BBE\u7F6E\u300D\u53EF\u4FEE\u6539\u5BF9\u8BDD\u6A21\u578B\uFF08\u9ED8\u8BA4 Qwen/Qwen2.5-7B-Instruct\uFF09\u3001\u9009\u62E9\u63D0\u793A\u8BCD\u6A21\u677F\u3001\u8D85\u65F6\u4E0E\u91CD\u8BD5\u7B49\uFF1B\n   \u63A5\u53E3\u5730\u5740/\u5BC6\u94A5\u7559\u7A7A\u65F6\u590D\u7528\u7ED8\u56FE\u63A5\u53E3\u7684\u914D\u7F6E\u3002\n4. \u5F53 AI \u5224\u5B9A\u5019\u9009\u56FE\u7247\u91CC\u6CA1\u6709\u5408\u9002\u7684\u53C2\u8003\u56FE\u65F6\uFF0C\u4F1A\u6309\u914D\u7F6E\u8BE2\u95EE\u7528\u6237\u8865\u5145\u53D1\u9001\u56FE\u7247\uFF08\u7528\u6237\u53D1\u9001\u540E\u4F1A\u88AB\u76F4\u63A5\u4F7F\u7528\uFF09\u3002\n   \u82E5\u9009\u56FE\u6A21\u578B\u652F\u6301\u8BC6\u522B\u56FE\u7247\uFF08\u591A\u6A21\u6001\uFF09\uFF0C\u53EF\u52FE\u9009\u300C\u9009\u56FE\u6A21\u578B\u652F\u6301\u8BC6\u522B\u56FE\u7247\u300D\uFF0C\u63D2\u4EF6\u4F1A\u628A\u5019\u9009\u56FE\u7247\u672C\u8EAB\u53D1\u7ED9\u6A21\u578B\uFF0C\n   \u6A21\u578B\u5BF9\u7740\u771F\u5B9E\u56FE\u7247\u6311\u9009\uFF1B\u5B83\u7ED9\u51FA\u7684\u5173\u952E\u89C6\u89C9\u7279\u5F81\u8FD8\u4F1A\u5E76\u5165\u7ED8\u56FE\u63D0\u793A\u8BCD\uFF0C\u8BA9\u51FA\u56FE\u66F4\u8FD8\u539F\u53C2\u8003\u56FE\u3002\n5. \u300C\u542F\u7528 AI \u667A\u80FD\u9009\u62E9\u53C2\u8003\u56FE\u7247\u300D\u9ED8\u8BA4\u5173\u95ED\uFF0C\u9700\u624B\u52A8\u5F00\u542F\uFF1B\u300CAI \u9009\u56FE\u5931\u8D25\u65F6\u56DE\u9000\u4E3A\u4F7F\u7528\u5019\u9009\u6C60\u5185\u5168\u90E8\u56FE\u7247\u300D\u9ED8\u8BA4\u5173\u95ED\uFF0C\n   \u5931\u8D25\u65F6\u672C\u6B21\u4E0D\u4F7F\u7528\u53C2\u8003\u56FE\u7247\uFF08\u5F00\u542F\u5219\u6539\u7528\u5019\u9009\u6C60\u5185\u5168\u90E8\u56FE\u7247\uFF09\u3002\n6. \u53C2\u8003\u56FE\u8F83\u591A\u65F6\uFF08\u8D85\u8FC7 12 \u5F20\uFF09\u81EA\u52A8\u8D70\u4E24\u7EA7\u68C0\u7D22\uFF1A\u5148\u8BA9\u6A21\u578B\u4EA7\u51FA\u68C0\u7D22\u5173\u952E\u8BCD\u3001\u672C\u5730\u5339\u914D\u53EC\u56DE\uFF0C\u518D\u5BF9\u53EC\u56DE\u7ED3\u679C\u7CBE\u6392\uFF1B\n   \u8BC6\u56FE\u6A21\u5F0F\u4E0B\u4E5F\u53EA\u53D1\u9001\u53EC\u56DE\u7684\u8FD9\u51E0\u5F20\u56FE\u7247\uFF0C\u907F\u514D\u6BCF\u6B21\u90FD\u628A\u6574\u4E2A\u56FE\u5E93\u53D1\u7ED9\u6A21\u578B\u3002\n7. \u63CF\u8FF0\u53EF\u4EE5\u7528\u300C\u751F\u6210\u63CF\u8FF0\u300D\u6307\u4EE4\u8BA9\u6A21\u578B\u770B\u56FE\u81EA\u52A8\u751F\u6210\u5E76\u5199\u56DE\u914D\u7F6E\uFF08\u9700\u8981\u652F\u6301\u56FE\u7247\u8F93\u5165\u7684\u6A21\u578B\uFF09\u3002\n8. \u751F\u6210\u7ED3\u679C\u53EF\u81EA\u52A8\u5165\u5E93\uFF08\u9ED8\u8BA4\u5173\u95ED\uFF09\uFF0C\u4E0B\u6B21\u80FD\u88AB\u81EA\u5DF1\u68C0\u7D22\u5230\u5E76\u590D\u7528\uFF0C\u5F62\u6210\u95ED\u73AF\uFF1B\n   \u5F00\u542F\u300C\u540E\u53F0\u7ED8\u56FE\u300D\u540E\u51FA\u56FE\u4E0D\u518D\u963B\u585E\uFF0C\u5148\u56DE\u300C\u6B63\u5728\u753B\u300D\uFF0C\u753B\u597D\u4E3B\u52A8\u63A8\u9001\u3002\n\n\u63D0\u793A\u8BCD\u6A21\u677F\u53EF\u7528\u5360\u4F4D\u7B26\uFF1A{candidates} \u5019\u9009\u56FE\u7247\u5217\u8868\u3001{userInput} \u7528\u6237\u9644\u52A0\u9700\u6C42\u3001{max} \u6700\u591A\u9009\u62E9\u6570\u91CF\u3001{command} \u6307\u4EE4\u540D\u3001{prompt} \u6307\u4EE4\u63D0\u793A\u8BCD\n\n---\n\u6B64\u9879\u76EE\u6240\u9700\u7684koishi\u670D\u52A1\uFF1A\u5FC5\u9700 'http', 'logger', 'i18n'\uFF1B\u53EF\u9009 'puppeteer'\uFF08\u4EC5\u300C\u6587\u5B57\u6E32\u67D3\u53C2\u8003\u56FE\u300D\u9700\u8981\uFF09\n\n---\n";
/**
 * 解析模型返回的 JSON 选择结果（纯函数，便于单独测试）
 * @param raw 模型的原始回复
 * @param candidates 候选图片列表（编号从 1 开始）
 * @param max 最多选取数量
 * @param warn 日志回调
 */
export declare function parseSelectionResult(raw: string | null, candidates: CandidateImage[], max: number, warn?: (msg: string) => void): SelectionResult;
/**
 * 计算重试等待时间（毫秒）：限流类错误优先用 Retry-After，否则指数退避
 * @param status HTTP 状态码
 * @param retryAfter 响应头 Retry-After 解析出的毫秒数
 * @param baseInterval 基础间隔（毫秒）
 * @param attempt 第几次重试（从 0 开始）
 */
export declare function computeRetryDelay(status: any, retryAfter: number | undefined, baseInterval: number, attempt: number): number;
/**
 * 第一级检索：按关键词在候选池里做文本匹配召回（纯本地，不发请求）
 * 支持中文子串匹配 + 2-gram 部分命中，关键词可含空格/顿号（会自动拆分）
 */
export declare function matchCandidatesByKeywords(candidates: CandidateImage[], keywords: string[], topK: number): CandidateImage[];
/** 去重合并候选（按 url 判重） */
export declare function mergeCandidates(...lists: CandidateImage[][]): CandidateImage[];
/**
 * 图库容量裁剪：超出容量时淘汰最旧的（按 time 升序），只保留每个组最近 capacity 条
 */
export declare function trimGallery(records: GalleryRecord[], capacity: number): GalleryRecord[];
/**
 * 去掉文本开头可能残留的指令名（例如从整条消息里取文本时会带出「手办化」）
 */
export declare function stripCommandName(text: string, commandName: string): string;
/**
 * 把用户随指令发的附加需求并入绘图提示词。
 * 自定义指令、普通指令都适用——之前只有 custom 指令会合并，
 * 导致「手办化 xxx 在偷吃白饭被发现的表情」这种用法里，需求只被用来选图、画图时被丢掉。
 */
export declare function mergePrompt(basePrompt: string, userInput: string, enabled: boolean): string;
/** 把长文本截断成适合做描述的一行 */
export declare function truncateText(text: string, maxLength: number): string;
/**
 * 哪些平台能发 markdown 元素。
 * 只认官方 QQ（`qq` / `qq-xxx` / `qqbot`）——markdown 是官方机器人能力，
 * `qqguild`（频道）走另一套编码器，md 元素会被当纯文本原样发出去，所以排除。
 */
export declare function supportsMarkdown(platform: string): boolean;
/**
 * 把优化后的提示词按平台格式化：
 * - 支持 markdown 的平台（官方 QQ）返回 `markdown` **元素**，由适配器走 QQ 的 markdown API，
 *   直接塞 ``` 围栏的字符串是没有用的，客户端只会当成普通文本
 * - 其它平台返回纯文本
 */
export declare function buildPromptEcho(promptText: string, platform: string, maxLength?: number): string | any;
/**
 * 提示词块的**纯文本**版（用于和其它提示合并进同一条 markdown 消息）。
 * 围栏必须独占一行，否则 QQ 不会把它渲染成代码块。
 */
export declare function buildPromptBlock(promptText: string, maxLength?: number): string;
/**
 * 生成结果的 markdown 图片写法。
 * QQ 官方语法是 `![#宽px #高px](url)`——**必须带尺寸，否则手机端 QQ 不渲染**。
 */
export declare function buildMarkdownImage(url: string, width?: number, height?: number): string;
/**
 * 清洗模型生成的描述：去代码块围栏、去引号、压平换行、去掉「描述：」前缀、限长
 */
export declare function sanitizeCaption(text: string, maxLen?: number): string;
/**
 * 判断该状态码是否值得重试：429 限流 / 5xx / 网络超时重试，
 * 其它 4xx（400 参数错误、401 鉴权、404 地址错）重试无意义，直接失败
 */
export declare function isRetryableStatus(status: any): boolean;
/**
 * 从响应体里取服务端给的具体原因（OpenAI 兼容接口一般是 {error:{message}}）
 */
export declare function extractServerMessage(error: any): string;
/**
 * 把请求错误整理成一句人话（带上服务端原因，方便定位模型名错/不支持识图等问题）
 */
export declare function describeSelectorError(status: any, serverMessage: string, rawMessage: string): string;
/**
 * 解析响应头里的 Retry-After（秒数或 HTTP 日期），返回毫秒
 */
export declare function parseRetryAfterHeader(headers: any): number | undefined;
/** 去掉模型输出里的思维链标签，只保留正式回答 */
export declare function stripThinkTags(text: string): string;
/** 把响应体裁成一小段，方便打日志定位 */
export declare function previewJson(value: any, maxLength?: number): string;
/**
 * 从各种「OpenAI 兼容」接口的返回里取文本。
 * 兼容：推理模型的 reasoning_content、SSE 流式响应、中转站把结构塞进 data 里、Anthropic 风格的 content 数组。
 */
export declare function extractResponseText(response: any): {
    text: string;
    reason: string;
    truncated: boolean;
};
/**
 * 判断是不是 QQ 官方机器人的「被动回复超时/超次」错误（错误码 40034128）。
 * 引用用户消息属于被动回复：有 5 分钟时效 + 次数上限，超了就必须降级为普通主动消息。
 */
export declare function isPassiveReplyError(error: any): boolean;
/**
 * 决定用哪个参数名限制输出长度。
 * o1/o3/gpt-5/reasoner 这类模型只认 max_completion_tokens，传 max_tokens 会返回空内容。
 */
export declare function resolveTokenParam(model: string, mode?: string): string;
/** 用指定参数名重建请求体（避免同时存在两个长度参数被接口拒绝） */
export declare function withTokenParam(body: any, param: string): any;
/**
 * 构造发给选图模型的 user 消息内容。
 * 未开启识别图片时返回纯文本；开启时按「编号文字 + 图片」交替排列，让模型把编号和图片对上。
 * @param text 提示词正文（含 {candidates} 文本列表）
 * @param candidates 候选图片
 * @param vision 是否附带图片
 * @param visionMaxImages 最多附带多少张图片
 */
export declare function buildSelectorContent(text: string, candidates: CandidateImage[], vision: boolean, visionMaxImages: number): string | any[];
/** HTML 转义，避免渲染时把文字当标签吃掉 */
export declare function escapeHtml(text: string): string;
/** 把要渲染的文字拼成一份 HTML（供无头浏览器截图） */
export declare function buildTextHtml(lines: string[], cfg?: Partial<TextRenderConfig>): string;
/**
 * 从提示词/用户输入里提取「需要在画面上真实出现的文字」
 * 只提取含中日韩文字的片段——纯英文/数字一般不会因为渲染而崩字
 */
export declare function extractTextToRender(text: string, options?: {
    loose?: boolean;
    maxChars?: number;
}): string[];
interface CommandConfig {
    basename: string;
    nested: {
        commands: {
            name: string;
            prompt: string;
            enabled: boolean;
            custom: boolean;
            maxImages: number;
            waitTimeout: number;
            defaultImageUrls: string[];
            referenceGroups?: string[];
            aiSelect?: boolean;
            aiMaxSelect?: number;
            aiAskUser?: boolean;
        }[];
    };
    defaultWaitTimeout: number;
    baseUrl: string;
    model: string;
    maxRetries: number;
    retryInterval: number;
    apiKey?: string;
    loggerinfo: boolean;
    referenceGroups?: ReferenceGroup[];
    aiSelector?: AISelectorConfig;
    showPrompt?: boolean;
    promptMaxLength?: number;
    appendUserInput?: boolean;
    promptOptimize?: 'off' | 'merge' | 'rewrite';
    optimizePrompt?: string;
    resultGallery?: ResultGalleryConfig;
    backgroundDrawing?: BackgroundDrawingConfig;
    textRender?: TextRenderConfig;
    /** 把处理过程中的多条提示合并成一条消息发出（省被动消息额度） */
    mergeNotifications?: boolean;
    /** 结果图用 markdown 的 ![](url) 单独发一条（支持的平台） */
    markdownImage?: boolean;
    /** 结果图先经 assets 服务上传再发（外链在手机端 QQ 可能拉不到） */
    imageViaAssets?: boolean;
    /** markdown 图片的宽/高（QQ 要求带尺寸，否则手机端不渲染） */
    imageWidth?: number;
    imageHeight?: number;
}
/** 文字渲染参考图配置（把要在画面上出现的文字先渲染成图片，避免中文崩字） */
interface TextRenderConfig {
    enabled: boolean;
    /** 自动从提示词里识别需要出现在画面上的文字并渲染 */
    autoDetect: boolean;
    /** 引号内没有其它线索时，也允许直接提取中文片段 */
    loose: boolean;
    /** 手动渲染指令名 */
    commandName: string;
    /** 手动渲染后，多少秒内的绘图指令自动带上它 */
    pendingTTL: number;
    /** 渲染后先把参考图发出来给用户看 */
    sendPreview: boolean;
    /** 渲染结果并入绘图参考图 */
    attachToDraw: boolean;
    width: number;
    fontSize: number;
    lineHeight: number;
    padding: number;
    background: string;
    color: string;
    fontFamily: string;
    align: 'center' | 'left';
    bold: boolean;
    strokeWidth: number;
    strokeColor: string;
    maxChars: number;
    scale: number;
}
/** 生成结果入库（图库）配置 */
interface ResultGalleryConfig {
    enabled: boolean;
    groupName: string;
    descriptionSource: 'prompt' | 'userInput' | 'both';
    maxLength: number;
    capacity: number;
    commandName: string;
}
/** 后台绘图配置 */
interface BackgroundDrawingConfig {
    enabled: boolean;
    maxConcurrent: number;
    queueNotify: boolean;
}
/** 图库里的一条记录 */
interface GalleryRecord {
    group: string;
    url: string;
    description: string;
    command: string;
    time: number;
}
/** 参考图片组中的一张图片（链接 + 描述） */
interface ReferenceImageItem {
    url: string;
    description: string;
}
/** 参考图片组 */
interface ReferenceGroup {
    name: string;
    enabled: boolean;
    items: ReferenceImageItem[];
}
/** AI 选图配置 */
interface AISelectorConfig {
    enabled: boolean;
    baseUrl: string;
    apiKey?: string;
    model: string;
    prompt: string;
    maxSelect: number;
    temperature: number;
    timeout: number;
    maxRetries: number;
    retryInterval: number;
    retryMaxWait: number;
    askUser: boolean;
    askTimeout: number;
    includeAllGroups: boolean;
    includeCommandDefaults: boolean;
    fallbackOnError: boolean;
    notify: boolean;
    vision: boolean;
    visionMaxImages: number;
    visionFallback: boolean;
    appendHint: boolean;
    twoStage: boolean;
    twoStageThreshold: number;
    retrievalTopK: number;
    keywordPrompt: string;
    captionModel: string;
    captionPrompt: string;
    captionBatch: number;
    captionCommand: string;
    /** 提示词优化（融合/扩写）用的采样温度，默认 0.7，比选图更有创造性 */
    optimizeTemperature?: number;
    /** 输出长度参数名：auto / max_tokens / max_completion_tokens */
    maxTokensParam?: 'auto' | 'max_tokens' | 'max_completion_tokens';
    /** 选图（精排）的输出长度上限。推理模型会把额度耗在思考上，太小会导致正文一个字都生成不出来 */
    selectMaxTokens?: number;
    /** 两级检索「关键词」阶段的输出长度上限 */
    keywordMaxTokens?: number;
    /** 提示词优化（融合/扩写）的输出长度上限 */
    optimizeMaxTokens?: number;
    /** 输出被截断时自动加大，最多加到这个值 */
    maxTokensCeiling?: number;
    /** 诊断指令名：发一次选图请求并回显模型原始返回 */
    debugCommand?: string;
}
/** 交给 AI 挑选的候选图片 */
interface CandidateImage {
    group: string;
    url: string;
    description: string;
}
/** AI 选择结果 */
interface SelectionResult {
    picked: CandidateImage[];
    needUserImage: boolean;
    askMessage: string;
    reason: string;
    ok: boolean;
    /** 失败原因（如 429 限流），供回显给用户 */
    error?: string;
    /** 模型看到图片后给出的关键视觉特征描述（开启识别图片时才有），可并入绘图提示词 */
    hint?: string;
    /** 第一阶段产出的检索关键词 */
    keywords?: string[];
    /** 两级检索时从多少张里召回了多少张，用于回显 */
    recalled?: number;
    total?: number;
    /** 模型认为「画面上需要出现的文字」（台词/标题/字幕），交给浏览器渲染成参考图 */
    renderText?: string;
}
export declare const Config: Schema;
export declare function apply(ctx: Context, config: CommandConfig): void;
export {};
