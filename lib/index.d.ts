import { Context, Schema } from 'koishi';
export declare const name = "image-prompt";
export declare const inject: string[];
export declare const usage = "\n---\n\n\u6B64\u63D2\u4EF6\u76F4\u63A5\u8C03\u7528 OpenAI \u517C\u5BB9\u7684 Chat Completions \u63A5\u53E3\u751F\u6210\u56FE\u7247\uFF0C\u65E0\u9700\u90E8\u7F72\u672C\u5730\u540E\u7AEF\u3002\n\n\u8BF7\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u586B\u5199\uFF1A\n\n- API \u670D\u52A1\u5668\u5730\u5740\uFF08baseUrl\uFF09\n- \u4F7F\u7528\u7684\u6A21\u578B\uFF08model\uFF09\n- API \u5BC6\u94A5\uFF08apiKey\uFF09\n\n---\n\u6B64\u9879\u76EE\u6240\u9700\u7684koishi\u670D\u52A1\uFF1A 'http', 'logger', 'i18n'\n\n---\n";
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
        }[];
    };
    defaultWaitTimeout: number;
    baseUrl: string;
    model: string;
    maxRetries: number;
    retryInterval: number;
    apiKey?: string;
    loggerinfo: boolean;
}
export declare const Config: Schema;
export declare function apply(ctx: Context, config: CommandConfig): void;
export {};
