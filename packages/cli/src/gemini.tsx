/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render } from 'ink';
import { AppWrapper } from './ui/App.js';
import { loadCliConfig } from './config/config.js';
import { readStdin } from './utils/readStdin.js';
import { basename } from 'node:path';
import v8 from 'node:v8';
import os from 'node:os';
import { execSync, spawn } from 'node:child_process';
import { start_sandbox } from './utils/sandbox.js';
import {
  LoadedSettings,
  loadSettings, SETTINGS_DIRECTORY_NAME,
  SettingScope,
} from './config/settings.js';
import { themeManager } from './ui/themes/theme-manager.js';
import { getStartupWarnings } from './utils/startupWarnings.js';
import { runNonInteractive } from './nonInteractiveCli.js';
import { loadExtensions, Extension } from './config/extension.js';
import { cleanupCheckpoints } from './utils/cleanup.js';
import {
  ApprovalMode,
  Config,
  EditTool,
  ShellTool,
  WriteFileTool,
  sessionId,
  logUserPrompt,
  AuthType,
} from '@google/gemini-cli-core';
import { validateAuthMethod } from './config/auth.js';
import { setMaxSizedBoxDebugging } from './ui/components/shared/MaxSizedBox.js';

import OpenAI from "openai";
async function testDashScope() {
  const openai = new OpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
  });

  try {
    const completion = await openai.chat.completions.create({
      model: "qwen-plus",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        {
          "role": "user",
          "content": "Okay, just setting up the context for our chat.\n  Today is 2025年6月30日星期一.\n  My operating system is: darwin\n  I'm currently working in the directory: /Users/anthony/Desktop/gemini-cli-main\n  Showing up to 200 items (files + folders). Folders or files indicated with ... contain more items not shown, were ignored, or the display limit (200 items) was reached.\n\n/Users/anthony/Desktop/gemini-cli-main/\n├───.gitattributes\n├───.gitignore\n├───.npmrc\n├───.prettierrc.json\n├───CONTRIBUTING.md\n├───debug-qwen.log\n├───debug.log\n├───Dockerfile\n├───esbuild.config.js\n├───eslint.config.js\n├───GEMINI.md\n├───index.js\n├───LICENSE\n├───Makefile\n├───package-lock.json\n├───package.json\n├───README.md\n├───tsconfig.json\n├───.gcp/\n│   ├───Dockerfile.gemini-code-builder\n│   ├───publish-dry-run.yaml\n│   └───release.yaml\n├───.gemini/\n├───.git/...\n├───.github/\n│   ├───CODEOWNERS\n│   ├───pull_request_template.md\n│   ├───actions/\n│   │   └───post-coverage-comment/\n│   │       └───action.yml\n│   ├───ISSUE_TEMPLATE/\n│   │   ├───bug_report.yml\n│   │   └───feature_request.yml\n│   └───workflows/\n│       ├───ci.yml\n│       └───e2e.yml\n├───.idea/...\n├───.vscode/\n│   ├───launch.json\n│   ├───settings.json\n│   └───tasks.json\n├───bundle/...\n├───docs/\n│   ├───architecture.md\n│   ├───checkpointing.md\n│   ├───deployment.md\n│   ├───extension.md\n│   ├───index.md\n│   ├───integration-tests.md\n│   ├───sandbox.md\n│   ├───telemetry.md\n│   ├───tos-privacy.md\n│   ├───troubleshooting.md\n│   ├───assets/\n│   │   ├───connected_devtools.png\n│   │   ├───gemini-screenshot.png\n│   │   ├───theme-ansi-light.png\n│   │   ├───theme-ansi.png\n│   │   ├───theme-atom-one.png\n│   │   ├───theme-ayu-light.png\n│   │   ├───theme-ayu.png\n│   │   ├───theme-default-light.png\n│   │   ├───theme-default.png\n│   │   ├───theme-dracula.png\n│   │   ├───theme-github-light.png\n│   │   ├───theme-github.png\n│   │   ├───theme-google-light.png\n│   │   └───theme-xcode-light.png\n│   ├───cli/\n│   │   ├───authentication.md\n│   │   ├───commands.md\n│   │   ├───configuration.md\n│   │   ├───index.md\n│   │   ├───themes.md\n│   │   ├───token-caching.md\n│   │   └───tutorials.md\n│   ├───core/\n│   │   ├───index.md\n│   │   └───tools-api.md\n│   └───tools/\n│       ├───file-system.md\n│       ├───index.md\n│       ├───mcp-server.md\n│       ├───memory.md\n│       ├───multi-file.md\n│       ├───shell.md\n│       ├───web-fetch.md\n│       └───web-search.md\n├───eslint-rules/\n│   └───no-relative-cross-package-imports.js\n├───integration-tests/\n│   ├───file-system.test.js\n│   ├───google_web_search.test.js\n│   ├───list_directory.test.js\n│   ├───read_many_files.test.js\n│   ├───replace.test.js\n│   ├───run_shell_command.test.js\n│   ├───run-tests.js\n│   ├───save_memory.test.js\n│   ├───simple-mcp-server.test.js\n│   ├───test-helper.js\n│   └───write_file.test.js\n├───node_modules/...\n├───packages/\n│   ├───cli/\n│   │   ├───index.ts\n│   │   ├───package.json\n│   │   ├───tsconfig.json\n│   │   ├───vitest.config.ts\n│   │   ├───dist/...\n│   │   ├───node_modules/...\n│   │   └───src/\n│   │       ├───gemini.test.tsx\n│   │       ├───gemini.tsx\n│   │       ├───nonInteractiveCli.test.ts\n│   │       ├───nonInteractiveCli.ts\n│   │       ├───config/\n│   │       │   ├───auth.ts\n│   │       │   ├───config.integration.test.ts\n│   │       │   ├───config.test.ts\n│   │       │   ├───config.ts\n│   │       │   ├───extension.test.ts\n│   │       │   ├───extension.ts\n│   │       │   ├───sandboxConfig.ts\n│   │       │   ├───settings.test.ts\n│   │       │   └───settings.ts\n│   │       ├───generated/\n│   │       ├───ui/\n│   │       │   ├───App.test.tsx\n│   │       │   ├───App.tsx\n│   │       │   ├───colors.ts\n│   │       │   ├───constants.ts\n│   │       │   ├───types.ts\n│   │       │   ├───components/\n│   │       │   ├───contexts/\n│   │       │   ├───editors/\n│   │       │   ├───hooks/\n│   │       │   ├───themes/\n│   │       │   └───utils/\n│   │       └───utils/\n│   │           ├───cleanup.ts\n│   │           ├───package.ts\n│   │           ├───readStdin.ts\n│   │           ├───sandbox-macos-permissive-closed.sb\n│   │           ├───sandbox-macos-permissive-open.sb\n│   │           ├───sandbox-macos-permissive-proxied.sb\n│   │           ├───sandbox-macos-restrictive-closed.sb\n│   │           ├───sandbox-macos-restrictive-open.sb\n│   │           ├───sandbox-macos-restrictive-proxied.sb\n│   │           ├───sandbox.ts\n│   │           ├───startupWarnings.test.ts\n│   │           ├───startupWarnings.ts\n│   │           └───version.ts\n│   └───core/\n│       ├───index.ts\n│       ├───package-lock.json\n│       ├───package.json\n│       ├───test-setup.ts\n│       ├───tsconfig.json\n│       ├───vitest.config.ts\n│       ├───dist/...\n│       ├───node_modules/...\n│       └───src/\n│           ├───index.test.ts\n│           ├───index.ts\n│           ├───__mocks__/\n│           │   └───fs/\n│           ├───code_assist/\n│           │   ├───codeAssist.ts\n│           │   └───converter.test.ts\n│           │   └───...\n│           ├───config/\n│           ├───core/\n│           ├───services/\n│           ├───telemetry/\n│           ├───tools/\n│           └───utils/\n└───scripts/\n    ├───bind_package_dependencies.js\n    ├───bind_package_version.js\n    ├───build_package.js\n    ├───build_sandbox.js\n    ├───build.js\n    ├───check-build-status.js\n    ├───clean.js\n    ├───copy_bundle_assets.js\n    ├───copy_files.js\n    ├───create_alias.sh\n    ├───esbuild-banner.js\n    ├───example-proxy.js\n    ├───generate-git-commit-info.js\n    ├───local_telemetry.js\n    ├───prepare-cli-packagejson.js\n    ├───publish-sandbox.js\n    ├───sandbox_command.js\n    ├───sandbox.js\n    ├───setup-dev.js\n    ├───start.js\n    ├───telemetry_gcp.js\n    ├───telemetry_utils.js\n    └───telemetry.js"
        },
        {
          "role": "user",
          "content": "你是谁？要回答出具体的模型版本"
        }
      ],
      temperature : 0,
      top_p: 1,
      // stream: true,
      // enable_thinking : true
    });
    return completion.choices[0].message.content;
  } catch (error) {
    console.error("DashScope error:", error);
    return null;
  }
}


function getNodeMemoryArgs(config: Config): string[] {
  const totalMemoryMB = os.totalmem() / (1024 * 1024);
  const heapStats = v8.getHeapStatistics();
  const currentMaxOldSpaceSizeMb = Math.floor(
    heapStats.heap_size_limit / 1024 / 1024,
  );

  // Set target to 50% of total memory
  const targetMaxOldSpaceSizeInMB = Math.floor(totalMemoryMB * 0.5);
  if (config.getDebugMode()) {
    console.debug(
      `Current heap size ${currentMaxOldSpaceSizeMb.toFixed(2)} MB`,
    );
  }

  if (process.env.GEMINI_CLI_NO_RELAUNCH) {
    return [];
  }

  if (targetMaxOldSpaceSizeInMB > currentMaxOldSpaceSizeMb) {
    if (config.getDebugMode()) {
      console.debug(
        `Need to relaunch with more memory: ${targetMaxOldSpaceSizeInMB.toFixed(2)} MB`,
      );
    }
    return [`--max-old-space-size=${targetMaxOldSpaceSizeInMB}`];
  }

  return [];
}

async function relaunchWithAdditionalArgs(additionalArgs: string[]) {
  const nodeArgs = [...additionalArgs, ...process.argv.slice(1)];
  const newEnv = { ...process.env, GEMINI_CLI_NO_RELAUNCH: 'true' };

  const child = spawn(process.execPath, nodeArgs, {
    stdio: 'inherit',
    env: newEnv,
  });

  await new Promise((resolve) => child.on('close', resolve));
  process.exit(0);
}

interface CustomConfig {
  model: string;
  baseUrl: string;
  apiKey: string;
}

import fs from "fs";
import path from 'path';

export async function main() {

  const workspaceRoot = process.cwd();
  const settings = loadSettings(workspaceRoot);


  const customModelConfigPath = path.join(
    workspaceRoot,
    'custom-model-config.json',
  );
  const configContent = await fs.promises.readFile(customModelConfigPath, 'utf-8');
  const customConfig = await JSON.parse(configContent) as CustomConfig;

  process.env.CUSTOM_API_KEY = customConfig.apiKey;
  process.env.CUSTOM_BASE_URL = customConfig.baseUrl;
  process.env.CUSTOM_MODEL_NAME = customConfig.model;

  console.log(`Welcome to Foundation CLI!`)

  await cleanupCheckpoints();
  if (settings.errors.length > 0) {
    for (const error of settings.errors) {
      let errorMessage = `Error in ${error.path}: ${error.message}`;
      if (!process.env.NO_COLOR) {
        errorMessage = `\x1b[31m${errorMessage}\x1b[0m`;
      }
      console.error(errorMessage);
      console.error(`Please fix ${error.path} and try again.`);
    }
    process.exit(1);
  }

  const extensions = loadExtensions(workspaceRoot);
  const config = await loadCliConfig(settings.merged, extensions, sessionId);

  // set default fallback to gemini api key
  // this has to go after load cli because thats where the env is set
  // if (!settings.merged.selectedAuthType && process.env.GEMINI_API_KEY) {
  //   settings.setValue(
  //     SettingScope.User,
  //     'selectedAuthType',
  //     AuthType.USE_GEMINI,
  //   );
  // }

  setMaxSizedBoxDebugging(config.getDebugMode());

  // Initialize centralized FileDiscoveryService
  config.getFileService();
  if (config.getCheckpointingEnabled()) {
    try {
      await config.getGitService();
    } catch {
      // For now swallow the error, later log it.
    }
  }

  if (settings.merged.theme) {
    if (!themeManager.setActiveTheme(settings.merged.theme)) {
      // If the theme is not found during initial load, log a warning and continue.
      // The useThemeCommand hook in App.tsx will handle opening the dialog.
      console.warn(`Warning: Theme "${settings.merged.theme}" not found.`);
    }
  }

  const memoryArgs = settings.merged.autoConfigureMaxOldSpaceSize
    ? getNodeMemoryArgs(config)
    : [];

  // not sandbox !!!
  // hop into sandbox if we are outside and sandboxing is enabled
  // if (!process.env.SANDBOX) {
  //   const sandboxConfig = config.getSandbox();
  //   if (sandboxConfig) {
  //     if (settings.merged.selectedAuthType) {
  //       // Validate authentication here because the sandbox will interfere with the Oauth2 web redirect.
  //       const err = validateAuthMethod(settings.merged.selectedAuthType);
  //       if (err) {
  //         console.error(err);
  //         process.exit(1);
  //       }
  //       await config.refreshAuth(settings.merged.selectedAuthType);
  //     }
  //     await start_sandbox(sandboxConfig, memoryArgs);
  //     process.exit(0);
  //   } else {
  //     // Not in a sandbox and not entering one, so relaunch with additional
  //     // arguments to control memory usage if needed.
  //     if (memoryArgs.length > 0) {
  //       await relaunchWithAdditionalArgs(memoryArgs);
  //       process.exit(0);
  //     }
  //   }
  // }
  let input = config.getQuestion();
  const startupWarnings = await getStartupWarnings();

  // Render UI, passing necessary config values. Check that there is no command line question.
  if (process.stdin.isTTY && input?.length === 0) {
    setWindowTitle(basename(workspaceRoot), settings);
    // const response = await testDashScope();
    // if (response) {
    //   console.log(`INTRO: ${response}`);
    // }
    render(
      <React.StrictMode>
        <AppWrapper
          config={config}
          settings={settings}
          startupWarnings={startupWarnings}
        />
      </React.StrictMode>,
      { exitOnCtrlC: false },
    );
    return;
  }
  // If not a TTY, read from stdin
  // This is for cases where the user pipes input directly into the command
  if (!process.stdin.isTTY) {
    input += await readStdin();
  }
  if (!input) {
    console.error('No input provided via stdin.');
    process.exit(1);
  }

  logUserPrompt(config, {
    'event.name': 'user_prompt',
    'event.timestamp': new Date().toISOString(),
    prompt: input,
    prompt_length: input.length,
  });

  // Non-interactive mode handled by runNonInteractive
  const nonInteractiveConfig = await loadNonInteractiveConfig(
    config,
    extensions,
    settings,
  );

  await runNonInteractive(nonInteractiveConfig, input);
  process.exit(0);
}

function setWindowTitle(title: string, settings: LoadedSettings) {
  if (!settings.merged.hideWindowTitle) {
    process.stdout.write(`\x1b]2; Gemini - ${title} \x07`);

    process.on('exit', () => {
      process.stdout.write(`\x1b]2;\x07`);
    });
  }
}

// --- Global Unhandled Rejection Handler ---
process.on('unhandledRejection', (reason, _promise) => {
  // Log other unexpected unhandled rejections as critical errors
  console.error('=========================================');
  console.error('CRITICAL: Unhandled Promise Rejection!');
  console.error('=========================================');
  console.error('Reason:', reason);
  console.error('Stack trace may follow:');
  if (!(reason instanceof Error)) {
    console.error(reason);
  }
  // Exit for genuinely unhandled errors
  process.exit(1);
});

async function loadNonInteractiveConfig(
  config: Config,
  extensions: Extension[],
  settings: LoadedSettings,
) {
  let finalConfig = config;
  if (config.getApprovalMode() !== ApprovalMode.YOLO) {
    // Everything is not allowed, ensure that only read-only tools are configured.
    const existingExcludeTools = settings.merged.excludeTools || [];
    const interactiveTools = [
      ShellTool.Name,
      EditTool.Name,
      WriteFileTool.Name,
    ];

    const newExcludeTools = [
      ...new Set([...existingExcludeTools, ...interactiveTools]),
    ];

    const nonInteractiveSettings = {
      ...settings.merged,
      excludeTools: newExcludeTools,
    };
    finalConfig = await loadCliConfig(
      nonInteractiveSettings,
      extensions,
      config.getSessionId(),
    );
  }

  return await validateNonInterActiveAuth(
    settings.merged.selectedAuthType,
    finalConfig,
  );
}

async function validateNonInterActiveAuth(
  selectedAuthType: AuthType | undefined,
  nonInteractiveConfig: Config,
) {
  // making a special case for the cli. many headless environments might not have a settings.json set
  // so if GEMINI_API_KEY is set, we'll use that. However since the oauth things are interactive anyway, we'll
  // still expect that exists
  if (!selectedAuthType && !process.env.GEMINI_API_KEY) {
    console.error(
      'Please set an Auth method in your .gemini/settings.json OR specify GEMINI_API_KEY env variable file before running',
    );
    process.exit(1);
  }

  selectedAuthType = selectedAuthType || AuthType.USE_GEMINI;
  const err = validateAuthMethod(selectedAuthType);
  if (err != null) {
    console.error(err);
    process.exit(1);
  }

  await nonInteractiveConfig.refreshAuth(selectedAuthType);
  return nonInteractiveConfig;
}
