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
export declare const usage = "\n---\n\n\u6B64\u63D2\u4EF6\u76F4\u63A5\u8C03\u7528 OpenAI \u517C\u5BB9\u7684 Chat Completions \u63A5\u53E3\u751F\u6210\u56FE\u7247\n\n\u8BF7\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u586B\u5199\uFF1A\n\n- API \u670D\u52A1\u5668\u5730\u5740\uFF08baseUrl\uFF09\n- \u4F7F\u7528\u7684\u6A21\u578B\uFF08model\uFF09\n- API \u5BC6\u94A5\uFF08apiKey\uFF09\n\n\u3010Agent \u6A21\u5F0F\uFF08\u9ED8\u8BA4\uFF0C\u63A8\u8350\uFF09\u3011\n\n\u6307\u4EE4\u4E00\u89E6\u53D1\uFF0C\u63D2\u4EF6\u5C31\u628A\u300C\u7528\u6237\u8BF4\u4E86\u4EC0\u4E48 + \u6307\u4EE4\u63D0\u793A\u8BCD + \u53EF\u7528\u7684\u53C2\u8003\u56FE\u300D\u5168\u90E8\u4EA4\u7ED9**\u5BF9\u8BDD\u6A21\u578B**\uFF0C\n\u7531\u6A21\u578B\u81EA\u5DF1\u51B3\u5B9A\u4E0B\u4E00\u6B65 \u2014\u2014 \u8DDF NeoBot \u4E00\u4E2A\u5957\u8DEF\uFF1A\n\n- **gallery_search**\uFF1A\u6A21\u578B\u81EA\u5DF1\u6309\u5173\u952E\u8BCD\u641C\u53C2\u8003\u56FE\u5E93\uFF08\u5173\u952E\u8BCD\u7531\u5B83\u81EA\u5DF1\u62DF\uFF0C\u4E0D\u7528\u4F60\u5728\u914D\u7F6E\u91CC\u5199\u89C4\u5219\uFF09\n- **ask_user**\uFF1A\u95EE\u9898\u4E0D\u6E05\u695A\u3001\u7F3A\u53C2\u8003\u56FE\u3001\u5F00\u753B\u524D\u8981\u786E\u8BA4\uFF0C\u6A21\u578B\u81EA\u5DF1\u5F00\u53E3\u95EE\uFF0C\u5E76\u7B49\u7528\u6237\u56DE\u8BDD\n- **draw**\uFF1A\u628A prompt \u548C\u5B83\u6311\u4E2D\u7684\u53C2\u8003\u56FE\u7F16\u53F7\u4EA4\u51FA\u53BB\uFF0C\u771F\u6B63\u5F00\u59CB\u753B\n\n\u4E5F\u5C31\u662F\u8BF4\uFF1A**\u53C2\u8003\u56FE\u9009\u8C01\u3001\u8981\u4E0D\u8981\u8FFD\u95EE\u3001\u4EC0\u4E48\u65F6\u5019\u5F00\u753B\uFF0C\u5168\u90E8\u662F\u6A21\u578B\u81EA\u5DF1\u51B3\u5B9A\u7684**\uFF0C\n\u63D2\u4EF6\u4E0D\u518D\u5199\u6B7B\u300C\u6253\u5206 \u2192 \u9608\u503C \u2192 \u4E0D\u591F\u5C31\u95EE\u7528\u6237\u300D\u8FD9\u5957\u6D41\u7A0B\u3002\n\u6A21\u578B\u60F3\u641C\u51E0\u6B21\u56FE\u5E93\u3001\u60F3\u548C\u7528\u6237\u6765\u56DE\u51E0\u8F6E\u90FD\u884C\uFF0C\u76F4\u5230\u5B83\u8BA4\u4E3A\u53EF\u4EE5\u753B\u4E86\u3002\n\n\u8981\u6C42\uFF1A\u586B\u5199\u7684\u5BF9\u8BDD\u6A21\u578B\u5FC5\u987B**\u652F\u6301 function calling\uFF08\u5DE5\u5177\u8C03\u7528\uFF09**\u3002\n\u4E0D\u652F\u6301\u4E5F\u6CA1\u5173\u7CFB \u2014\u2014 \u63D2\u4EF6\u5185\u7F6E\u4E86\u300C\u53EA\u7528\u4E00\u884C JSON \u8C03\u7528\u5DE5\u5177\u300D\u7684\u515C\u5E95\u534F\u8BAE\uFF0C\u6A21\u578B\u7167\u6837\u80FD\u8DD1\u6D41\u7A0B\u3002\n\n\u76F8\u5173\u5F00\u5173\uFF1A\n- \u300C\u542F\u7528 Agent \u6A21\u5F0F\u300D\u9ED8\u8BA4\u5F00\u3002\u5173\u6389\u5C31\u9000\u5316\u6210\u300C\u6307\u4EE4\u63D0\u793A\u8BCD + \u7528\u6237\u9644\u52A0\u9700\u6C42\u76F4\u63A5\u753B\u300D\uFF0C\u4E0D\u67E5\u56FE\u5E93\u4E5F\u4E0D\u8FFD\u95EE\u3002\n- \u300C\u5F00\u753B\u524D\u5148\u95EE\u4E00\u53E5\u300D\u9ED8\u8BA4\u5F00\uFF1A\u6A21\u578B\u753B\u4E4B\u524D\u4F1A\u5148\u7528 ask_user \u628A\u300C\u672C\u6B21\u53C2\u8003\u54EA\u51E0\u5F20\u56FE + \u5927\u81F4\u753B\u9762\u300D\u544A\u8BC9\u4F60\uFF0C\u4F60\u70B9\u5934\u5B83\u624D\u753B\u3002\n- \u300C\u6700\u591A\u53C2\u8003\u56FE\u6570\u91CF\u300D\u300C\u5355\u6B21\u641C\u7D22\u8FD4\u56DE\u6761\u6570\u300D\u300C\u8BE2\u95EE\u7B49\u5F85\u65F6\u95F4\u300D\u300C\u6700\u591A\u6765\u56DE\u8F6E\u6570\u300D\u90FD\u5728 agent \u914D\u7F6E\u91CC\u8C03\u3002\n\n\u3010\u53C2\u8003\u56FE\u7247\u7EC4 / \u56FE\u5E93\u3011\n\n1. \u5728\u300C\u53C2\u8003\u56FE\u7247\u7EC4\u300D\u91CC\u6CE8\u518C\u5206\u7EC4\uFF1A\u6BCF\u7EC4\u586B\u300C\u56FE\u7247\u94FE\u63A5 + \u63CF\u8FF0\u300D\u3002**\u63CF\u8FF0\u8981\u5199\u5177\u4F53**\uFF08\u53D1\u8272\u53D1\u578B\u3001\u670D\u88C5\u3001\u52A8\u4F5C\u3001\u753B\u98CE\uFF09\uFF0C\n   \u6A21\u578B\u5C31\u662F\u9760\u8FD9\u53E5\u63CF\u8FF0\u641C\u5230\u5B83\u7684\u3002\n2. \u5728\u6307\u4EE4\u914D\u7F6E\u7684\u300C\u5F15\u7528\u7684\u53C2\u8003\u56FE\u7247\u7EC4\u540D\u79F0\u300D\u91CC\u586B\u7EC4\u540D\uFF08\u53EF\u591A\u4E2A\uFF09\uFF1B\u6A21\u578B\u53EA\u4F1A\u5728\u8FD9\u4E2A\u8303\u56F4\u5185\u641C\u3002\n   \u7559\u7A7A\u4E14\u5F00\u542F\u300C\u5141\u8BB8\u641C\u7D22\u5168\u90E8\u7EC4\u300D\u65F6\uFF0C\u6240\u6709\u7EC4\u90FD\u80FD\u641C\u5230\u3002\n3. \u300C\u751F\u6210\u63CF\u8FF0\u300D\u6307\u4EE4\u53EF\u4EE5\u8BA9\u6A21\u578B\u770B\u56FE\u81EA\u52A8\u5199\u63CF\u8FF0\u5E76\u5199\u56DE\u914D\u7F6E\uFF08\u9700\u8981\u652F\u6301\u56FE\u7247\u8F93\u5165\u7684\u6A21\u578B\uFF09\u3002\n4. \u751F\u6210\u7ED3\u679C\u53EF\u81EA\u52A8\u5165\u5E93\uFF08\u9ED8\u8BA4\u5173\u95ED\uFF09\uFF0C\u4E0B\u6B21\u80FD\u88AB\u81EA\u5DF1\u641C\u5230\u5E76\u590D\u7528\uFF0C\u5F62\u6210\u95ED\u73AF\u3002\n\n\u3010\u5176\u5B83\u3011\n\n- \u300C\u6536\u5230\u63D0\u793A\u300D\u9ED8\u8BA4\u5F00\uFF1A\u6307\u4EE4\u89E6\u53D1\u7ACB\u523B\u56DE\u4E00\u6761\u300C\u6536\u5230\uFF0C\u6B63\u5728\u51C6\u5907...\u300D\uFF0C\u4E0D\u8BA9\u7528\u6237\u4EE5\u4E3A\u5361\u4F4F\u3002\n- \u300C\u540E\u53F0\u7ED8\u56FE\u300D\u5F00\u542F\u540E\u51FA\u56FE\u4E0D\u963B\u585E\uFF0C\u5148\u56DE\u300C\u6B63\u5728\u753B\u300D\uFF0C\u753B\u597D\u4E3B\u52A8\u63A8\u9001\u3002\n- \u300C\u6587\u5B57\u6E32\u67D3\u53C2\u8003\u56FE\u300D\u628A\u753B\u9762\u4E0A\u7684\u6587\u5B57\uFF08\u53F0\u8BCD/\u62DB\u724C\uFF09\u5148\u6E32\u67D3\u6210\u56FE\u7247\u4E00\u8D77\u53D1\u7ED9\u7ED8\u56FE\u6A21\u578B\uFF0C\u89E3\u51B3\u4E2D\u6587\u5D29\u5B57\u3002\n- \u56DE\u663E\u63D0\u793A\u8BCD\u3001\u7ED3\u679C\u56FE\u5C3A\u5BF8/\u8D70 assets \u7B49\u90FD\u5728\u300C\u6D88\u606F\u53D1\u9001\u300D\u91CC\u3002\n\nAgent \u6307\u4EE4\u6A21\u677F\u53EF\u7528\u5360\u4F4D\u7B26\uFF1A{command} \u6307\u4EE4\u540D\u3001{prompt} \u6307\u4EE4\u63D0\u793A\u8BCD\u3001{userInput} \u7528\u6237\u9644\u52A0\u9700\u6C42\u3001{imageCount} \u7528\u6237\u968F\u6D88\u606F\u53D1\u7684\u56FE\u6570\u91CF\u3001{refCount} \u53EF\u68C0\u7D22\u7684\u53C2\u8003\u56FE\u6570\u91CF\n\n---\n\u6B64\u9879\u76EE\u6240\u9700\u7684koishi\u670D\u52A1\uFF1A\u5FC5\u9700 'http', 'logger', 'i18n'\uFF1B\u53EF\u9009 'puppeteer'\uFF08\u4EC5\u300C\u6587\u5B57\u6E32\u67D3\u53C2\u8003\u56FE\u300D\u9700\u8981\uFF09\n\n---\n";
/**
 * 计算重试等待时间（毫秒）：限流类错误优先用 Retry-After，否则指数退避
 * @param status HTTP 状态码
 * @param retryAfter 响应头 Retry-After 解析出的毫秒数
 * @param baseInterval 基础间隔（毫秒）
 * @param attempt 第几次重试（从 0 开始）
 */
export declare function computeRetryDelay(status: any, retryAfter: number | undefined, baseInterval: number, attempt: number): number;
/** 从任意文本里挖出第一个 JSON 对象（容忍代码块围栏和前后废话） */
export declare function extractJsonObject(raw: string | null | undefined): any | null;
/**
 * gallery_search 工具的检索实现：关键词由**模型**自己拟，这里只做文本匹配排序。
 * 多关键词空格分隔，全部命中的排最前（参考 NeoBot 的 gallery_search）。
 */
export declare function searchGallery(items: CandidateImage[], keyword: string, limit: number): CandidateImage[];
/**
 * 把模型给的 references 解析成登记表里的编号。
 * 兼容 `ref3` / `gallery:ref3` / 裸编号 `3` / `url:https://...` / 直接写链接。
 * 认不出来的进 unknown，让模型知道它编了个不存在的 id。
 */
export declare function resolveReferences(refs: any[], registry: Map<string, {
    url: string;
}>): {
    ids: string[];
    unknown: string[];
};
/** agent 可用的工具名（JSON 兜底协议只对这几个名字生效，避免把正常回复当工具调用） */
export declare const AGENT_TOOL_NAMES: string[];
/** OpenAI function-calling 格式的工具定义 */
export declare function buildAgentTools(): any[];
/**
 * 从模型返回里取出助手消息，以及它想调用的工具。
 * 兼容：原生 tool_calls、老式 function_call、中转站把正文塞进奇怪字段。
 */
export declare function pickAgentMessage(response: any): {
    message: any;
    content: string;
    toolCalls: {
        id?: string;
        name: string;
        args: any;
    }[];
};
/**
 * 「一行 JSON」兜底协议：模型所在接口不支持 function calling 时，
 * 它只要输出 {"tool":"draw","args":{...}} 我们照样能执行。
 * 只有 tool 名字命中 AGENT_TOOL_NAMES 才当工具调用，避免把正常回复误判。
 */
export declare function parseJsonToolCall(content: string, names?: string[]): {
    id?: string;
    name: string;
    args: any;
}[];
/** 渲染 agent 指令模板：把 {xxx} 占位符换成实际值 */
export declare function renderAgentInstructions(template: string, vars: Record<string, string | number>): string;
/**
 * 洗一下 ask_user 的提问文案。
 * 模型偶尔会在问句后面顺带聊别的（实测出现过「能发一张参考图吗？顺便说说 XX 可以吗？」），
 * 这里压成一行、去掉 markdown 记号和包裹引号、限长，让它永远是「对用户说的一句话」。
 */
export declare function cleanAskMessage(raw: any, max?: number): string;
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
 * 从图片字节里读真实宽高（只看文件头，不解码整张图）。
 * 支持 PNG / JPEG / GIF / WebP。
 */
export declare function readImageSize(input: any): {
    width: number;
    height: number;
} | null;
/** 按真实比例算 markdown 显示尺寸（等比缩放到宽度上限） */
export declare function fitImageSize(size: {
    width: number;
    height: number;
} | null, maxWidth: number, fallback: {
    width: number;
    height: number;
}): {
    width: number;
    height: number;
};
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
            /** 该指令是否走 agent（默认跟随全局 agent.enabled） */
            agent?: 'follow' | 'on' | 'off' | boolean;
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
    agent?: AgentConfig;
    showPrompt?: boolean;
    promptMaxLength?: number;
    appendUserInput?: boolean;
    promptOptimize?: 'off' | 'merge' | 'rewrite';
    optimizePrompt?: string;
    resultGallery?: ResultGalleryConfig;
    backgroundDrawing?: BackgroundDrawingConfig;
    textRender?: TextRenderConfig;
    /** 指令一触发就立刻回一条「收到」，避免用户以为卡住 */
    ackOnStart?: boolean;
    /** 结果图用 markdown 的 ![](url) 单独发一条（支持的平台） */
    markdownImage?: boolean;
    /** 结果图先经 assets 服务上传再发（外链在手机端 QQ 可能拉不到） */
    imageViaAssets?: boolean;
    /** 自动按图片真实比例生成 markdown 尺寸（关掉则用下面固定的宽高） */
    autoImageSize?: boolean;
    /** 自动尺寸时的显示宽度上限 */
    imageMaxWidth?: number;
    /** 固定宽/高（QQ 要求带尺寸，否则手机端不渲染） */
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
/** AI 对话模型接口配置（agent 循环、提示词优化、生成描述都用它） */
interface AISelectorConfig {
    baseUrl: string;
    apiKey?: string;
    model: string;
    temperature: number;
    timeout: number;
    maxRetries: number;
    retryInterval: number;
    retryMaxWait: number;
    includeAllGroups: boolean;
    includeCommandDefaults: boolean;
    captionModel: string;
    captionPrompt: string;
    captionBatch: number;
    captionCommand: string;
    /** 提示词优化（融合/扩写）用的采样温度，默认 0.7，比选图更有创造性 */
    optimizeTemperature?: number;
    /** 输出长度参数名：auto / max_tokens / max_completion_tokens */
    maxTokensParam?: 'auto' | 'max_tokens' | 'max_completion_tokens';
    /** 提示词优化（融合/扩写）的输出长度上限 */
    optimizeMaxTokens?: number;
    /** 输出被截断时自动加大，最多加到这个值 */
    maxTokensCeiling?: number;
    /** 诊断指令名：发一次模型请求并回显原始返回 */
    debugCommand?: string;
}
/** Agent 配置：把「要不要查图库 / 要不要追问 / 什么时候开画」全部交给模型自己决定 */
interface AgentConfig {
    /** 是否启用 agent 模式；关掉就退化成「指令提示词 + 用户附加需求直接画」 */
    enabled: boolean;
    /** agent 用的模型，留空则用 aiSelector.model */
    model: string;
    baseUrl?: string;
    apiKey?: string;
    /** 驱动 agent 行为的系统提示词（可参考 NeoBot 的 skill instructions 写法） */
    instructions?: string;
    /** 最多来回几轮（每轮 = 一次模型请求 + 它要调的工具） */
    maxIterations: number;
    /** 一次绘图最多用几张参考图 */
    maxSelect: number;
    /** gallery_search 单次最多返回多少条 */
    searchLimit: number;
    /** ask_user 等待用户回复的秒数 */
    askTimeout: number;
    /** 开画前是否要求模型先问一句（写进提示词，由模型执行） */
    confirmBeforeDraw: boolean;
    /** 单次模型请求的超时（秒） */
    timeout: number;
    temperature: number;
    /** 单次回复的输出长度上限。推理模型会把额度耗在思考上，太小会一个字都生成不出来 */
    maxTokens: number;
    /** 记住当前频道最近几轮对话（0 = 不记忆） */
    historyTurns: number;
    /** 把每一轮的工具调用打到日志里，方便排查 */
    debugLog: boolean;
}
/** agent 参考图登记表里的一条 */
export interface RefEntry {
    id: string;
    url: string;
    description: string;
    group: string;
    source: 'gallery' | 'user' | 'cmd';
}
/** 交给 AI 挑选的候选图片 */
interface CandidateImage {
    group: string;
    url: string;
    description: string;
}
export declare const Config: Schema;
export declare function apply(ctx: Context, config: CommandConfig): void;
export {};
