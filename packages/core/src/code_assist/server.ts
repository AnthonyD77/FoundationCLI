/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { AuthClient } from 'google-auth-library';
import {
  LoadCodeAssistResponse,
  LoadCodeAssistRequest,
  OnboardUserRequest,
  LongrunningOperationResponse,
} from './types.js';
import {
  GenerateContentResponse,
  GenerateContentParameters,
  CountTokensParameters,
  EmbedContentResponse,
  CountTokensResponse,
  EmbedContentParameters, ToolListUnion,
} from '@google/genai';
import * as readline from 'readline';
import { ContentGenerator, ContentGeneratorConfig } from '../core/contentGenerator.js';
import {
  CaGenerateContentResponse,
  toGenerateContentRequest,
  fromGenerateContentResponse,
  toCountTokenRequest,
  fromCountTokenResponse,
  CaCountTokenResponse, CAGenerateContentRequest,
} from './converter.js';
import { PassThrough } from 'node:stream';

import OpenAI from "openai";
import fs from 'fs';
import { FinishReason } from '@google/genai';

// 环境变量缓存和配置读取
let ENV_CACHE: {
  CUSTOM_API_KEY: string;
  CUSTOM_BASE_URL: string;
  CUSTOM_MODEL_NAME: string;
  DEBUG_ENABLED: boolean;
} | null = null;

function getEnvCache() {
  if (!ENV_CACHE) {
    // 尝试从配置文件读取
    let configData: any = {};
    try {
      const configPath = './custom-model-config.json';
      const fs = require('fs');
      if (fs.existsSync(configPath)) {
        configData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      }
    } catch (error) {
      console.warn('Failed to read custom-model-config.json:', error);
    }

    ENV_CACHE = {
      CUSTOM_API_KEY: process.env.CUSTOM_API_KEY || configData.apiKey || "",
      CUSTOM_BASE_URL: process.env.CUSTOM_BASE_URL || configData.baseUrl || "",
      CUSTOM_MODEL_NAME: process.env.CUSTOM_MODEL_NAME || configData.model || "",
      DEBUG_ENABLED: process.env.DEBUG_ENABLED === 'true'
    };
  }
  return ENV_CACHE;
}

// 异步调试日志函数
function writeDebugLog(message: string): void {
  const cache = getEnvCache();
  if (cache.DEBUG_ENABLED) {
    fs.appendFile('debug-llm-api.log', `[${new Date().toISOString()}] ${message}\n`, (err) => {
      if (err) console.error('Debug log write error:', err);
    });
  }
}

/** HTTP options to be used in each of the requests. */
export interface HttpOptions {
  /** Additional HTTP headers to be sent with the request. */
  headers?: Record<string, string>;
}

// TODO: Use production endpoint once it supports our methods.
export const CODE_ASSIST_ENDPOINT =
  process.env.CODE_ASSIST_ENDPOINT ?? 'https://cloudcode-pa.googleapis.com';
export const CODE_ASSIST_API_VERSION = 'v1internal';

import { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

function convertGeminiToolsToOpenAI(geminiTools: ToolListUnion | undefined): OpenAI.Chat.Completions.ChatCompletionTool[] {
  const openAITools: OpenAI.Chat.Completions.ChatCompletionTool[] = [];

  if (geminiTools) {
    for (const toolUnion of geminiTools) {
      if ('functionDeclarations' in toolUnion && toolUnion.functionDeclarations) {
        for (const funcDecl of toolUnion.functionDeclarations) {
          openAITools.push({
            type: 'function',
            function: {
              name: funcDecl.name!,
              description: funcDecl.description,
              parameters: funcDecl.parameters as any
            }
          });
        }
      }
    }
  }
  return openAITools;
}

function convertGeminiRequestToOpenAI(req: CAGenerateContentRequest): ChatCompletionMessageParam[] {
  const messages: ChatCompletionMessageParam[] = [];

  // 1. 处理系统指令
  const systemText = req.request.systemInstruction?.parts
    ?.filter(p => p.text)
    .map(p => p.text)
    .join('');

  if (systemText) {
    messages.push({ role: "system", content: systemText });
  }

  // 2. 处理对话历史 - 需要收集所有的 tool responses
  const allToolResponses = collectAllToolResponses(req.request.contents);

  req.request.contents.forEach((content) => {
    const { role, parts = [] } = content;

    if (role === "user") {
      processUserContent(parts, messages);
    } else if (role === "model") {
      processModelContent(parts, messages, allToolResponses);
    }
  });

  return messages;
}

// 收集所有的 tool responses
function collectAllToolResponses(contents: any[]): Set<string> {
  const responseIds = new Set<string>();

  contents.forEach(content => {
    if (content.role === "user" && content.parts) {
      content.parts
        .filter((p: { functionResponse: { id: any; }; }) => p.functionResponse?.id)
        .forEach((p: { functionResponse: { id: string; }; }) => responseIds.add(p.functionResponse.id));
    }
  });

  return responseIds;
}

// 处理用户消息 - 优化版本
function processUserContent(parts: any[], messages: ChatCompletionMessageParam[]): void {
  let textContent = '';
  const toolResponses: any[] = [];

  // 单次遍历处理所有parts
  for (const part of parts) {
    if (part.text) {
      textContent += part.text;
    } else if (part.functionResponse?.id) {
      toolResponses.push({
        role: 'tool',
        content: JSON.stringify(part.functionResponse.response || {}),
        tool_call_id: part.functionResponse.id,
      });
    }
  }

  if (textContent) {
    messages.push({ role: "user", content: textContent });
  }
  messages.push(...toolResponses);
}

// 处理模型消息 - 优化版本
function processModelContent(
  parts: any[],
  messages: ChatCompletionMessageParam[],
  allToolResponses: Set<string>
): void {
  let textContent = '';
  const toolCalls: any[] = [];
  const otherParts: any[] = [];

  // 单次遍历处理所有parts
  for (const part of parts) {
    if (part.text) {
      textContent += part.text;
    } else if (part.functionCall?.name) {
      const toolCall = {
        id: part.functionCall.id || `call_${Date.now()}_${toolCalls.length}`,
        type: "function",
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args || {})
        }
      };
      if (allToolResponses.has(toolCall.id)) {
        toolCalls.push(toolCall);
      }
    } else if (!part.functionResponse) {
      otherParts.push(part);
    }
  }

  // 处理文本和/或工具调用
  if (textContent || toolCalls.length > 0) {
    messages.push({
      role: 'assistant',
      content: textContent || null,
      ...(toolCalls.length > 0 && { tool_calls: toolCalls })
    });
  }

  // 处理其他类型的 parts
  processOtherParts(otherParts, messages);
}


// 处理其他类型的 parts - 优化版本
function processOtherParts(otherParts: any[], messages: ChatCompletionMessageParam[]): void {
  for (const part of otherParts) {
    let content: string | null = null;

    if (part.thought) {
      content = `[Thought: ${part.thoughtSignature || 'Processing...'}]`;
    } else if (part.codeExecutionResult) {
      content = `[Code Execution Result: ${JSON.stringify(part.codeExecutionResult)}]`;
    } else if (part.executableCode) {
      content = `[Executable Code: ${JSON.stringify(part.executableCode)}]`;
    }

    if (content) {
      messages.push({ role: "assistant", content });
    }
  }
}





async function* convertToGeminiStream(
  completion: AsyncIterable<any>
): AsyncGenerator<GenerateContentResponse> {
  const toolCallAccumulator: Map<number, {
    id: string;
    name: string;
    arguments: string;
  }> = new Map();
  let hasContent = false;
  let lastChunk: any = null;
  let openAIFinishReason: string | undefined;

  // 处理流式数据
  for await (const chunk of completion) {
    lastChunk = chunk;
    const choice = chunk.choices?.[0];
    if (!choice) continue;

    // 记录 OpenAI 的 finish reason
    if (choice.finish_reason) {
      openAIFinishReason = choice.finish_reason;
    }

    // 直接流式输出文本内容，不再累积
    if (choice.delta?.content) {
      hasContent = true;
      yield createTextResponse(choice.delta.content, chunk);
    }

    // 累积工具调用
    if (choice.delta?.tool_calls) {
      for (const toolCall of choice.delta.tool_calls) {
        const index = toolCall.index || 0;

        if (!toolCallAccumulator.has(index)) {
          toolCallAccumulator.set(index, {
            id: '',
            name: '',
            arguments: ''
          });
        }

        const accumulated = toolCallAccumulator.get(index)!;
        if (toolCall.id) accumulated.id = toolCall.id;
        if (toolCall.function?.name) accumulated.name = toolCall.function.name;
        if (toolCall.function?.arguments) {
          accumulated.arguments += toolCall.function.arguments;
        }
      }
    }
  }

  // 如果有工具调用，生成工具调用响应
  if (toolCallAccumulator.size > 0) {
    for (const [_, toolCall] of toolCallAccumulator) {
      let args = {};
      try {
        args = JSON.parse(toolCall.arguments);
      } catch (e) {
        console.error('Failed to parse tool arguments:', e);
        continue;
      }

      yield createToolCallResponse(toolCall, args, lastChunk);
    }
  }

  // 如果只有结束信号，生成结束响应
  if (!hasContent && toolCallAccumulator.size === 0 && openAIFinishReason) {
    yield createEndResponse(openAIFinishReason, lastChunk);
  }
}

// 辅助函数：创建文本响应
function createTextResponse(content: string, chunk: any): GenerateContentResponse {
  const response = new GenerateContentResponse();
  response.candidates = [{
    content: {
      parts: [{ text: content }],
      role: 'model'
    },
    index: 0,
    finishReason: chunk.choices?.[0]?.finish_reason ? mapFinishReason(chunk.choices[0].finish_reason) : undefined,
    safetyRatings: []
  }];
  response.createTime = new Date().toISOString();
  response.responseId = chunk.id || '';
  response.modelVersion = chunk.model || '';
  return response;
}

// 辅助函数：创建工具调用响应
function createToolCallResponse(toolCall: any, args: any, lastChunk: any): GenerateContentResponse {
  const response = new GenerateContentResponse();
  response.candidates = [{
    content: {
      role: 'model',
      parts: [{
        functionCall: {
          id: toolCall.id,
          name: toolCall.name,
          args: args
        }
      }]
    },
    finishReason: mapFinishReason('tool_calls'),
    index: 0,
    safetyRatings: []
  }];
  response.createTime = new Date().toISOString();
  response.responseId = lastChunk?.id || `response-${Date.now()}`;
  response.modelVersion = lastChunk?.model || 'qwen-plus-latest';
  return response;
}

// 辅助函数：创建结束响应
function createEndResponse(finishReason: string, lastChunk: any): GenerateContentResponse {
  const response = new GenerateContentResponse();
  response.candidates = [{
    content: {
      parts: [],
      role: 'model'
    },
    index: 0,
    finishReason: mapFinishReason(finishReason),
    safetyRatings: []
  }];
  response.createTime = new Date().toISOString();
  response.responseId = lastChunk?.id || `response-${Date.now()}`;
  response.modelVersion = lastChunk?.model || 'qwen-plus-latest';
  return response;
}

function mapFinishReason(openAIReason: string): FinishReason | undefined {
  switch (openAIReason) {
    case 'stop':
      return FinishReason.STOP;
    case 'length':
      return FinishReason.MAX_TOKENS;
    case 'tool_calls':
    case 'function_call':
      return FinishReason.STOP;  // Gemini 没有专门的 tool_calls 结束原因
    case 'content_filter':
      return FinishReason.SAFETY;
    default:
      return FinishReason.OTHER;
  }
}


function convertToGeminiResponse(completion: any): GenerateContentResponse {
  const response = new GenerateContentResponse();
  const choice = completion.choices?.[0];

  if (!choice) {
    throw new Error('No choices in OpenAI response');
  }

  response.createTime = new Date().toISOString();
  response.responseId = completion.id || `response-${Date.now()}`;
  response.modelVersion = completion.model;

  if (choice.message?.content) {
    response.candidates = [{
      content: {
        parts: [{ text: choice.message.content }],
        role: 'model'
      },
      index: 0,
      finishReason: mapFinishReason(choice.finish_reason),
      safetyRatings: []
    }];
  }

  if (choice.message?.tool_calls && choice.message.tool_calls.length > 0) {
    const parts: any[] = [];

    for (const toolCall of choice.message.tool_calls) {
      let args = {};
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch (e) {
        console.error('Failed to parse tool arguments:', e);
        args = { error: 'Failed to parse arguments' };
      }

      parts.push({
        functionCall: {
          id: toolCall.id,
          name: toolCall.function.name,
          args: args
        }
      });
    }

    response.candidates = [{
      content: {
        role: 'model',
        parts: parts
      },
      index: 0,
      finishReason: mapFinishReason(choice.finish_reason),
      safetyRatings: []
    }];
  }

  if (completion.usage) {
    response.usageMetadata = {
      promptTokenCount: completion.usage.prompt_tokens,
      candidatesTokenCount: completion.usage.completion_tokens,
      totalTokenCount: completion.usage.total_tokens
    };
  }

  if (!choice.message?.content && !choice.message?.tool_calls) {
    response.candidates = [{
      content: {
        parts: [{ text: '' }],
        role: 'model'
      },
      index: 0,
      finishReason: mapFinishReason(choice.finish_reason),
      safetyRatings: []
    }];
  }

  return response;
}




export class CodeAssistServer implements ContentGenerator {

  constructor(
    readonly auth?: AuthClient,
    readonly projectId?: string,
    readonly httpOptions: HttpOptions = {},
  ) {}

  // async generateContentStream(
  //   req: GenerateContentParameters,
  // ): Promise<AsyncGenerator<GenerateContentResponse>> {
  //   const resps = await this.streamEndpoint<CaGenerateContentResponse>(
  //     'streamGenerateContent',
  //     toGenerateContentRequest(req, this.projectId),
  //     req.config?.abortSignal,
  //   );
  //   return (async function* (): AsyncGenerator<GenerateContentResponse> {
  //     for await (const resp of resps) {
  //       yield fromGenerateContentResponse(resp);
  //     }
  //   })();
  // }


  async generateContentStream(
    req: GenerateContentParameters,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {

    const cache = getEnvCache();
    const openai = new OpenAI({
      apiKey: cache.CUSTOM_API_KEY,
      baseURL: cache.CUSTOM_BASE_URL
    });

    const openApiReq = toGenerateContentRequest(req, this.projectId);
    openApiReq.model = cache.CUSTOM_MODEL_NAME;

    writeDebugLog(`Raw RequestParams ${JSON.stringify(openApiReq)}`);

    const tools = convertGeminiToolsToOpenAI(openApiReq.request.tools);
    const requestParams: any = {
      model: cache.CUSTOM_MODEL_NAME,
      messages: convertGeminiRequestToOpenAI(openApiReq),
      ...(tools && tools.length > 0 && { tools }),
      temperature: openApiReq.request.generationConfig?.temperature,
      top_p: openApiReq.request.generationConfig?.topP,
      stream: true,
    };

    writeDebugLog(`RequestParams ${JSON.stringify(requestParams)}`);

    const completion = await openai.chat.completions.create(requestParams);
    // @ts-ignore
    return convertToGeminiStream(completion);
  }


  // async generateContent(
  //   req: GenerateContentParameters,
  // ): Promise<GenerateContentResponse> {
  //   const resp = await this.callEndpoint<CaGenerateContentResponse>(
  //     'generateContent',
  //     toGenerateContentRequest(req, this.projectId),
  //     req.config?.abortSignal,
  //   );
  //   return fromGenerateContentResponse(resp);
  // }

  async generateContent(
    req: GenerateContentParameters,
  ): Promise<GenerateContentResponse> {

    const cache = getEnvCache();
    const openai = new OpenAI({
      apiKey: cache.CUSTOM_API_KEY,
      baseURL: cache.CUSTOM_BASE_URL
    });

    const openApiReq = toGenerateContentRequest(req, this.projectId);

    writeDebugLog(`[generateContent] Raw RequestParams ${JSON.stringify(openApiReq)}`);

    const tools = convertGeminiToolsToOpenAI(openApiReq.request.tools);
    const requestParams: any = {
      model: cache.CUSTOM_MODEL_NAME,
      messages: convertGeminiRequestToOpenAI(openApiReq),
      ...(tools && tools.length > 0 && { tools }),
      temperature: openApiReq.request.generationConfig?.temperature,
      top_p: openApiReq.request.generationConfig?.topP,
      stream: false,
    };

    writeDebugLog(`[generateContent] RequestParams ${JSON.stringify(requestParams)}`);

    try {
      const completion = await openai.chat.completions.create(requestParams);

      writeDebugLog(`[generateContent] OpenAI Response ${JSON.stringify(completion)}`);

      return convertToGeminiResponse(completion);
    } catch (error) {
      writeDebugLog(`[generateContent] Error: ${error}`);
      throw error;
    }
  }


  async onboardUser(
    req: OnboardUserRequest,
  ): Promise<LongrunningOperationResponse> {
    return await this.callEndpoint<LongrunningOperationResponse>(
      'onboardUser',
      req,
    );
  }

  async loadCodeAssist(
    req: LoadCodeAssistRequest,
  ): Promise<LoadCodeAssistResponse> {
    return await this.callEndpoint<LoadCodeAssistResponse>(
      'loadCodeAssist',
      req,
    );
  }

  async countTokens(req: CountTokensParameters): Promise<CountTokensResponse> {
    const resp = await this.callEndpoint<CaCountTokenResponse>(
      'countTokens',
      toCountTokenRequest(req),
    );
    return fromCountTokenResponse(resp);
  }

  async embedContent(
    _req: EmbedContentParameters,
  ): Promise<EmbedContentResponse> {
    throw Error();
  }

  async callEndpoint<T>(
    method: string,
    req: object,
    signal?: AbortSignal,
  ): Promise<T> {
    const res = await this.auth?.request({
      url: `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.httpOptions.headers,
      },
      responseType: 'json',
      body: JSON.stringify(req),
      signal,
    });
    return res?.data as T;
  }

  async streamEndpoint<T>(
    method: string,
    req: object,
    signal?: AbortSignal,
  ): Promise<AsyncGenerator<T>> {
    const res = await this.auth?.request({
      url: `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:${method}`,
      method: 'POST',
      params: {
        alt: 'sse',
      },
      headers: {
        'Content-Type': 'application/json',
        ...this.httpOptions.headers,
      },
      responseType: 'stream',
      body: JSON.stringify(req),
      signal,
    });

    return (async function* (): AsyncGenerator<T> {
      const rl = readline.createInterface({
        input: res?.data as PassThrough,
        crlfDelay: Infinity, // Recognizes '\r\n' and '\n' as line breaks
      });

      let bufferedLines: string[] = [];
      for await (const line of rl) {
        // blank lines are used to separate JSON objects in the stream
        if (line === '') {
          if (bufferedLines.length === 0) {
            continue; // no data to yield
          }
          yield JSON.parse(bufferedLines.join('\n')) as T;
          bufferedLines = []; // Reset the buffer after yielding
        } else if (line.startsWith('data: ')) {
          bufferedLines.push(line.slice(6).trim());
        } else {
          throw new Error(`Unexpected line format in response: ${line}`);
        }
      }
    })();
  }
}
