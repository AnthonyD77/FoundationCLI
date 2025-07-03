/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CountTokensResponse,
  GenerateContentResponse,
  GenerateContentParameters,
  CountTokensParameters,
  EmbedContentResponse,
  EmbedContentParameters,
  GoogleGenAI,
} from '@google/genai';
import { createCodeAssistContentGenerator } from '../code_assist/codeAssist.js';
import { DEFAULT_GEMINI_MODEL } from '../config/models.js';
import { getEffectiveModel } from './modelCheck.js';

/**
 * Interface abstracting the core functionalities for generating content and counting tokens.
 */
export interface ContentGenerator {
  generateContent(
    request: GenerateContentParameters,
  ): Promise<GenerateContentResponse>;

  generateContentStream(
    request: GenerateContentParameters,
  ): Promise<AsyncGenerator<GenerateContentResponse>>;

  countTokens(request: CountTokensParameters): Promise<CountTokensResponse>;

  embedContent(request: EmbedContentParameters): Promise<EmbedContentResponse>;
}

export enum AuthType {
  LOGIN_WITH_GOOGLE_PERSONAL = 'oauth-personal',
  USE_GEMINI = 'gemini-api-key',
  USE_VERTEX_AI = 'vertex-ai',
  USE_CUSTOM_MODEL = 'custom-model',
}

export type ContentGeneratorConfig = {
  model: string;
  apiKey?: string;
  vertexai?: boolean;
  authType?: AuthType | undefined;
  apiBaseUrl ?: string;
};

export async function createContentGeneratorConfig(
  model: string | undefined,
  authType: AuthType | undefined,
  config?: { getModel?: () => string },
): Promise<ContentGeneratorConfig> {
  const geminiApiKey = process.env.GEMINI_API_KEY || "";
  const googleApiKey = process.env.GOOGLE_API_KEY || "";
  const googleCloudProject = process.env.GOOGLE_CLOUD_PROJECT || "";
  const googleCloudLocation = process.env.GOOGLE_CLOUD_LOCATION || "";

  // Use runtime model from config if available, otherwise fallback to parameter or default
  const effectiveModel = config?.getModel?.() || model || DEFAULT_GEMINI_MODEL;

  const contentGeneratorConfig: ContentGeneratorConfig = {
    model: effectiveModel,
    authType,
  };

  // if we are using google auth nothing else to validate for now
  if (authType === AuthType.LOGIN_WITH_GOOGLE_PERSONAL || authType === AuthType.USE_CUSTOM_MODEL) {
    return contentGeneratorConfig;
  }

  //
  if (authType === AuthType.USE_GEMINI && geminiApiKey) {
    contentGeneratorConfig.apiKey = geminiApiKey;
    contentGeneratorConfig.model = await getEffectiveModel(
      contentGeneratorConfig.apiKey,
      contentGeneratorConfig.model,
    );

    return contentGeneratorConfig;
  }

  if (
    authType === AuthType.USE_VERTEX_AI &&
    !!googleApiKey &&
    googleCloudProject &&
    googleCloudLocation
  ) {
    contentGeneratorConfig.apiKey = googleApiKey;
    contentGeneratorConfig.vertexai = true;
    contentGeneratorConfig.model = await getEffectiveModel(
      contentGeneratorConfig.apiKey,
      contentGeneratorConfig.model,
    );

    return contentGeneratorConfig;
  }

  // // custom settings
  // const customApiKey = process.env.CUSTOM_API_KEY || process.env.OPENAI_API_KEY;
  // const customApiBaseUrl = process.env.CUSTOM_API_BASE_URL || 'https://api.openai.com/v1';
  //
  // if (authType === AuthType.USE_CUSTOM_MODEL && customApiKey) {
  //   contentGeneratorConfig.apiKey = customApiKey;
  //   contentGeneratorConfig.apiBaseUrl = customApiBaseUrl;
  //   // 不需要检查模型可用性，直接使用配置的模型
  //   return contentGeneratorConfig;
  // }

  return contentGeneratorConfig;
}

export async function createContentGenerator(
  config: ContentGeneratorConfig,
): Promise<ContentGenerator> {
  const version = process.env.CLI_VERSION || process.version;
  const httpOptions = {
    headers: {
      'User-Agent': `FoundationCLI/${version} (${process.platform}; ${process.arch})`,
    },
  };
  if (config.authType === AuthType.LOGIN_WITH_GOOGLE_PERSONAL || config.authType === AuthType.USE_CUSTOM_MODEL) {
    return createCodeAssistContentGenerator(httpOptions, config.authType);
  }

  if (
    config.authType === AuthType.USE_GEMINI ||
    config.authType === AuthType.USE_VERTEX_AI
  ) {
    const googleGenAI = new GoogleGenAI({
      apiKey: config.apiKey === '' ? undefined : config.apiKey,
      vertexai: config.vertexai,
      httpOptions,
    });

    return googleGenAI.models;
  }

  // if (config.authType === AuthType.USE_CUSTOM_MODEL) {
  //   const { CustomModelGenerator } = await import('/customModelGenerator.js');
  //   return new CustomModelGenerator({
  //     apiKey: config.apiKey!,
  //     model: config.model,
  //     apiBaseUrl: config.apiBaseUrl,
  //   });
  // }

  throw new Error(
    `Error creating contentGenerator: Unsupported authType: ${config.authType}`,
  );
}
