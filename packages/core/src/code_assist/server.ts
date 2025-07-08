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

// 处理用户消息
function processUserContent(parts: any[], messages: ChatCompletionMessageParam[]): void {
  // 处理文本消息
  const textContent = parts
    .filter(p => p.text)
    .map(p => p.text)
    .join('');

  if (textContent) {
    messages.push({ role: "user", content: textContent });
  }

  // 处理函数响应
  parts
    .filter(p => p.functionResponse?.id)
    .forEach(({ functionResponse }) => {
      messages.push({
        role: 'tool',
        content: JSON.stringify(functionResponse.response || {}),
        tool_call_id: functionResponse.id,
      });
    });
}

// 处理模型消息 - 添加 allToolResponses 参数
function processModelContent(
  parts: any[],
  messages: ChatCompletionMessageParam[],
  allToolResponses: Set<string>
): void {
  const textParts = parts.filter(p => p.text);
  const functionCalls = parts.filter(p => p.functionCall);
  const otherParts = parts.filter(p => !p.text && !p.functionCall && !p.functionResponse);

  const textContent = textParts.map(p => p.text).join('');
  const toolCalls = createToolCalls(functionCalls);

  // 过滤掉没有对应响应的 tool calls
  const validToolCalls = toolCalls.filter(tc => allToolResponses.has(tc.id));

  // 如果有些 tool calls 没有响应，记录警告
  if (toolCalls.length > validToolCalls.length) {
    const missingIds = toolCalls
      .filter(tc => !allToolResponses.has(tc.id))
      .map(tc => tc.id);
    console.warn('Tool calls without responses:', missingIds);
  }

  // 处理文本和/或工具调用
  if (textContent || validToolCalls.length > 0) {
    messages.push({
      role: 'assistant',
      content: textContent || null,
      ...(validToolCalls.length > 0 && { tool_calls: validToolCalls })
    });
  }

  // 处理其他类型的 parts
  processOtherParts(otherParts, messages);
}

// 创建工具调用数组
function createToolCalls(functionCalls: any[]): any[] {
  return functionCalls
    .filter(fc => fc.functionCall?.name)
    .map((fc, index) => ({
      id: fc.functionCall.id || `call_${Date.now()}_${index}`,
      type: "function",
      function: {
        name: fc.functionCall.name,
        arguments: JSON.stringify(fc.functionCall.args || {})
      }
    }));
}

// 处理其他类型的 parts
function processOtherParts(otherParts: any[], messages: ChatCompletionMessageParam[]): void {
  otherParts.forEach(part => {
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
  });
}



// function convertGeminiRequestToOpenAI(req: CAGenerateContentRequest): ChatCompletionMessageParam[] {
//   const messages: ChatCompletionMessageParam[] = [];
//
//   // 1. 处理系统指令
//   const systemText = req.request.systemInstruction?.parts
//     ?.filter(p => p.text)
//     .map(p => p.text)
//     .join('');
//
//   if (systemText) {
//     messages.push({ role: "system", content: systemText });
//   }
//
//   // 2. 处理对话历史
//   req.request.contents.forEach((content) => {
//     const { role, parts = [] } = content;
//
//     if (role === "user") {
//       processUserContent(parts, messages);
//     } else if (role === "model") {
//       processModelContent(parts, messages);
//     }
//   });
//
//   return messages;
// }
//
// // 处理用户消息
// function processUserContent(parts: any[], messages: ChatCompletionMessageParam[]): void {
//   // 处理文本消息
//   const textContent = parts
//     .filter(p => p.text)
//     .map(p => p.text)
//     .join('');
//
//   if (textContent) {
//     messages.push({ role: "user", content: textContent });
//   }
//
//   // 处理函数响应
//   parts
//     .filter(p => p.functionResponse?.id)
//     .forEach(({ functionResponse }) => {
//       messages.push({
//         role: 'tool',
//         content: JSON.stringify(functionResponse.response || {}),
//         tool_call_id: functionResponse.id,
//       });
//     });
// }
//
// // 处理模型消息
// function processModelContent(parts: any[], messages: ChatCompletionMessageParam[]): void {
//   const textParts = parts.filter(p => p.text);
//   const functionCalls = parts.filter(p => p.functionCall);
//   const otherParts = parts.filter(p => !p.text && !p.functionCall && !p.functionResponse);
//
//   const textContent = textParts.map(p => p.text).join('');
//   const toolCalls = createToolCalls(functionCalls);
//
//   // 处理文本和/或工具调用
//   if (textContent || toolCalls.length > 0) {
//     messages.push({
//       role: 'assistant',
//       content: textContent || null,
//       ...(toolCalls.length > 0 && { tool_calls: toolCalls })
//     });
//   }
//
//   // 处理其他类型的 parts
//   processOtherParts(otherParts, messages);
// }
//
// // 创建工具调用数组
// function createToolCalls(functionCalls: any[]): any[] {
//   return functionCalls
//     .filter(fc => fc.functionCall?.name)
//     .map((fc, index) => ({
//       id: fc.functionCall.id || `call_${Date.now()}_${index}`,
//       type: "function",
//       function: {
//         name: fc.functionCall.name,
//         arguments: JSON.stringify(fc.functionCall.args || {})
//       }
//     }));
// }
//
// function processOtherParts(otherParts: any[], messages: ChatCompletionMessageParam[]): void {
//   otherParts.forEach(part => {
//     let content: string | null = null;
//
//     if (part.thought) {
//       content = `[Thought: ${part.thoughtSignature || 'Processing...'}]`;
//     } else if (part.codeExecutionResult) {
//       content = `[Code Execution Result: ${JSON.stringify(part.codeExecutionResult)}]`;
//     } else if (part.executableCode) {
//       content = `[Executable Code: ${JSON.stringify(part.executableCode)}]`;
//     }
//
//     if (content) {
//       messages.push({ role: "assistant", content });
//     }
//   });
// }


async function* convertToGeminiStream(
  completion: AsyncIterable<any>
): AsyncGenerator<GenerateContentResponse> {
  // 收集数据
  let accumulatedText = '';
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

    // 累积文本内容
    if (choice.delta?.content) {
      accumulatedText += choice.delta.content;
      hasContent = true;

      // 流式输出文本
      const response = new GenerateContentResponse();
      response.candidates = [{
        content: {
          parts: [{ text: choice.delta.content }],
          role: 'model'
        },
        index: 0,
        // 流式输出时不设置 finishReason，除非这是最后一个 chunk
        finishReason: choice.finish_reason ? mapFinishReason(choice.finish_reason) : undefined,
        safetyRatings: []
      }];
      response.createTime = new Date().toISOString();
      response.responseId = chunk.id || ``;
      response.modelVersion = chunk.model || '';

      yield response;
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

      yield response;
    }
  }

  // 如果只有结束信号，生成结束响应
  if (!hasContent && toolCallAccumulator.size === 0 && openAIFinishReason) {
    const response = new GenerateContentResponse();
    response.candidates = [{
      content: {
        parts: [],
        role: 'model'
      },
      index: 0,
      finishReason: mapFinishReason(openAIFinishReason),
      safetyRatings: []
    }];

    response.createTime = new Date().toISOString();
    response.responseId = lastChunk?.id || `response-${Date.now()}`;
    response.modelVersion = lastChunk?.model || 'qwen-plus-latest';

    yield response;
  }
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

    const openai = new OpenAI({
      apiKey: process.env.CUSTOM_API_KEY || "",
      baseURL: process.env.CUSTOM_BASE_URL || ""
    });

    const openApiReq = toGenerateContentRequest(req, this.projectId);
    const messages: Array<ChatCompletionMessageParam> = [];

    openApiReq.model = process.env.CUSTOM_MODEL_NAME || ""

    fs.appendFileSync('debug-llm-api.log', `[${new Date().toISOString()}] Raw RequestParams ${JSON.stringify(openApiReq)}\n`);

    openApiReq.request.contents.forEach((content) => {
      if (content.role === "user") {
        messages.push({
          role: "user",
          content: content.parts?.map(p => p.text).join('\n') || ''
        });
      }
    })

    const tools = convertGeminiToolsToOpenAI(openApiReq.request.tools)
    const requestParams: any = {
      model: process.env.CUSTOM_MODEL_NAME,
      messages: convertGeminiRequestToOpenAI(openApiReq),
      ...(tools && tools.length > 0 && { tools }),
      temperature : openApiReq.request.generationConfig?.temperature,
      top_p : openApiReq.request.generationConfig?.topP,
      stream : true,
    };

    fs.appendFileSync('debug-llm-api.log', `[${new Date().toISOString()}] RequestParams ${JSON.stringify(requestParams)}\n`);

    const completion = await openai.chat.completions.create(requestParams);
    // @ts-ignore
    return  convertToGeminiStream(completion);
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

    const openai = new OpenAI({
      apiKey: process.env.CUSTOM_API_KEY || "",
      baseURL: process.env.CUSTOM_BASE_URL || ""
    });

    const openApiReq = toGenerateContentRequest(req, this.projectId);
    const messages: Array<ChatCompletionMessageParam> = [];

    fs.appendFileSync('debug-llm-api.log', `[${new Date().toISOString()}] [generateContent] Raw RequestParams ${JSON.stringify(openApiReq)}\n`);

    // 转换消息历史
    openApiReq.request.contents.forEach((content) => {
      if (content.role === "user") {
        messages.push({
          role: "user",
          content: content.parts?.map(p => p.text).join('') || ''
        });
      } else if (content.role === "model") {
        messages.push({
          role: "assistant",
          content: content.parts?.map(p => p.text).join('') || ''
        });
      }
    });

    const tools = convertGeminiToolsToOpenAI(openApiReq.request.tools)
    const requestParams: any = {
      model: process.env.CUSTOM_MODEL_NAME,
      messages: convertGeminiRequestToOpenAI(openApiReq),
      ...(tools && tools.length > 0 && { tools }),
      temperature: openApiReq.request.generationConfig?.temperature,
      top_p: openApiReq.request.generationConfig?.topP,
      stream: false,
    };

    fs.appendFileSync('debug-llm-api.log', `[${new Date().toISOString()}] [generateContent] RequestParams ${JSON.stringify(requestParams)}\n`);

    try {
      const completion = await openai.chat.completions.create(requestParams);

      fs.appendFileSync('debug-llm-api.log', `[${new Date().toISOString()}] [generateContent] OpenAI Response ${JSON.stringify(completion)}\n`);

      // 转换非流式响应到 Gemini 格式
      return convertToGeminiResponse(completion);
    } catch (error) {
      fs.appendFileSync('debug-llm-api.log', `[${new Date().toISOString()}] [generateContent] Error: ${error}\n`);
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
