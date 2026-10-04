#!/usr/bin/env bun
// aidlc-antigravity-adapter.ts — Google Antigravity hook shim (AUTHORED shell file;
// the aidlc-*.ts hook bodies beside it are PACKAGED core, byte-shared across harnesses).
//
// Normalizes Antigravity tool and lifecycle hook payloads to ClaudeCodeHookInput
// and subprocess-pipes into the core hook implementations.

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HOOKS_DIR = dirname(fileURLToPath(import.meta.url));

export interface AntigravityHookInput {
  conversationId?: string;
  session_id?: string;
  workspacePaths?: string[];
  cwd?: string;
  transcriptPath?: string;
  artifactDirectoryPath?: string;
  modelName?: string;
  stepIdx?: number;
  invocationNum?: number;
  initialNumSteps?: number;
  toolCall?: {
    name?: string;
    args?: Record<string, unknown>;
  };
  // Fallbacks / direct properties
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: unknown;
  tool_response?: unknown;
  tool_use_id?: string;
  agent_type?: string;
  agent_name?: string;
  prompt?: string;
  user_prompt?: string;
  message?: string;
  stop_hook_active?: boolean;
}

export function extractLastUserPromptFromTranscript(transcriptPath?: string): string | undefined {
  if (!transcriptPath || !existsSync(transcriptPath)) return undefined;
  try {
    const content = readFileSync(transcriptPath, "utf-8");
    const lines = content.trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as {
          type?: string;
          source?: string;
          content?: string;
        };
        if (
          (parsed.type === "USER_INPUT" || parsed.source === "USER_EXPLICIT") &&
          typeof parsed.content === "string"
        ) {
          const raw = parsed.content;
          const match = raw.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
          return (match ? match[1] : raw).trim();
        }
      } catch {}
    }
  } catch {}
  return undefined;
}

export function normalizeToolCall(
  payload: AntigravityHookInput,
  projectDir: string,
): { tool_name: string; tool_input: Record<string, unknown> } {
  if (payload.toolCall?.name) {
    const name = payload.toolCall.name;
    const args = (payload.toolCall.args ?? {}) as Record<string, unknown>;
    if (name === "run_command") {
      return {
        tool_name: "Bash",
        tool_input: {
          command: typeof args.CommandLine === "string" ? args.CommandLine : "",
          cwd: typeof args.Cwd === "string" ? args.Cwd : projectDir,
        },
      };
    }
    if (name === "write_to_file") {
      return {
        tool_name: "Write",
        tool_input: {
          file_path: typeof args.TargetFile === "string" ? args.TargetFile : "",
          content: typeof args.CodeContent === "string" ? args.CodeContent : "",
        },
      };
    }
    if (name === "replace_file_content" || name === "multi_replace_file_content") {
      return {
        tool_name: "Edit",
        tool_input: {
          file_path: typeof args.TargetFile === "string" ? args.TargetFile : "",
        },
      };
    }
    if (name === "view_file") {
      return {
        tool_name: "Read",
        tool_input: {
          file_path: typeof args.AbsolutePath === "string" ? args.AbsolutePath : "",
        },
      };
    }
    if (name === "grep_search") {
      return {
        tool_name: "Grep",
        tool_input: {
          path: typeof args.SearchPath === "string" ? args.SearchPath : "",
          pattern: typeof args.Query === "string" ? args.Query : "",
        },
      };
    }
    if (name === "list_dir") {
      return {
        tool_name: "LS",
        tool_input: {
          path: typeof args.DirectoryPath === "string" ? args.DirectoryPath : "",
        },
      };
    }
    if (name === "ask_question") {
      const rawArgs = args as Record<string, unknown>;
      const questions = Array.isArray(rawArgs.questions)
        ? (rawArgs.questions as Record<string, unknown>[]).map((q) => ({
            ...q,
            multiSelect: q.multiSelect ?? q.is_multi_select ?? false,
          }))
        : rawArgs.questions;
      return {
        tool_name: "ask_question",
        tool_input: {
          ...rawArgs,
          questions,
        },
      };
    }
    return {
      tool_name: name,
      tool_input: args,
    };
  }

  const rawToolName = payload.tool_name ?? "";
  const rawParams =
    payload.tool_input ??
    ((payload as Record<string, unknown>).parameters as Record<string, unknown>) ??
    {};
  if (rawToolName === "ask_question") {
    const questions = Array.isArray(rawParams.questions)
      ? (rawParams.questions as Record<string, unknown>[]).map((q) => ({
          ...q,
          multiSelect: q.multiSelect ?? q.is_multi_select ?? false,
        }))
      : rawParams.questions;
    return {
      tool_name: "ask_question",
      tool_input: {
        ...rawParams,
        questions,
      },
    };
  }
  if (rawToolName === "run_command") {
    return {
      tool_name: "Bash",
      tool_input: {
        command: typeof rawParams.CommandLine === "string" ? rawParams.CommandLine : (typeof rawParams.command === "string" ? rawParams.command : ""),
        cwd: typeof rawParams.Cwd === "string" ? rawParams.Cwd : projectDir,
      },
    };
  }
  if (rawToolName === "write_to_file") {
    return {
      tool_name: "Write",
      tool_input: {
        file_path: typeof rawParams.TargetFile === "string" ? rawParams.TargetFile : (typeof rawParams.file_path === "string" ? rawParams.file_path : ""),
        content: typeof rawParams.CodeContent === "string" ? rawParams.CodeContent : (typeof rawParams.content === "string" ? rawParams.content : ""),
      },
    };
  }
  if (rawToolName === "replace_file_content" || rawToolName === "multi_replace_file_content") {
    return {
      tool_name: "Edit",
      tool_input: {
        file_path: typeof rawParams.TargetFile === "string" ? rawParams.TargetFile : (typeof rawParams.file_path === "string" ? rawParams.file_path : ""),
      },
    };
  }
  if (rawToolName === "view_file") {
    return {
      tool_name: "Read",
      tool_input: {
        file_path: typeof rawParams.AbsolutePath === "string" ? rawParams.AbsolutePath : (typeof rawParams.file_path === "string" ? rawParams.file_path : ""),
      },
    };
  }
  return {
    tool_name: rawToolName,
    tool_input: rawParams,
  };
}

export async function run(
  target: string,
  input: string,
  _extraArgs: string[] = [],
): Promise<number> {
  let payload: AntigravityHookInput = {};
  if (input.trim().length > 0) {
    try {
      payload = JSON.parse(input) as AntigravityHookInput;
    } catch {
      if (target !== "continue-workflow" && target !== "stop") {
        if (target === "guard-tool-call" || target === "pre-tool") {
          process.stdout.write(`${JSON.stringify({ decision: "allow" })}\n`);
        } else {
          process.stdout.write("{}\n");
        }
        return 0;
      }
    }
  }

  const projectDirRaw =
    payload.workspacePaths?.[0] ??
    process.env.AIDLC_PROJECT_DIR ??
    payload.cwd ??
    process.cwd();
  const projectDir = isAbsolute(projectDirRaw)
    ? projectDirRaw
    : resolve(process.cwd(), projectDirRaw);

  const sessionId =
    payload.conversationId ??
    payload.session_id ??
    "antigravity-session";

  const projectEnv = {
    ...process.env,
    AIDLC_PROJECT_DIR: projectDir,
    CLAUDE_PROJECT_DIR: projectDir,
    AIDLC_ANTIGRAVITY_SESSION_ID: sessionId,
  };

  function runCore(hookFile: string, stdinText: string): { stdout: string; code: number } {
    const executable = process.env.AIDLC_COMPILED_EXECUTABLE;
    const hook = hookFile.replace(/^aidlc-|\.ts$/g, "");
    const authorityToken = hook === "record-human-turn" ? randomUUID() : "";
    const command = executable
      ? authorityToken
        ? [executable, "--internal-aidlc-record-human-turn", join(HOOKS_DIR, hookFile)]
        : [executable, "engine", "hook", hook]
      : authorityToken
        ? [
            process.execPath,
            join(HOOKS_DIR, "..", "tools", "aidlc.ts"),
            "--internal-aidlc-record-human-turn",
            join(HOOKS_DIR, hookFile),
          ]
        : [process.execPath, join(HOOKS_DIR, hookFile)];

    const r = Bun.spawnSync(command, {
      stdin: Buffer.from(stdinText, "utf-8"),
      stdout: "pipe",
      stderr: "ignore",
      cwd: projectDir,
      env: authorityToken
        ? { ...projectEnv, AIDLC_INTERNAL_HUMAN_TURN_TOKEN: authorityToken }
        : projectEnv,
    });
    return { stdout: r.stdout?.toString() ?? "", code: r.exitCode ?? 0 };
  }

  function runCoreWithStderr(
    hookFile: string,
    stdinText: string,
  ): { stdout: string; stderr: string; code: number } {
    const executable = process.env.AIDLC_COMPILED_EXECUTABLE;
    const hook = hookFile.replace(/^aidlc-|\.ts$/g, "");
    const authorityToken = hook === "record-human-turn" ? randomUUID() : "";
    const command = executable
      ? authorityToken
        ? [executable, "--internal-aidlc-record-human-turn", join(HOOKS_DIR, hookFile)]
        : [executable, "engine", "hook", hook]
      : authorityToken
        ? [
            process.execPath,
            join(HOOKS_DIR, "..", "tools", "aidlc.ts"),
            "--internal-aidlc-record-human-turn",
            join(HOOKS_DIR, hookFile),
          ]
        : [process.execPath, join(HOOKS_DIR, hookFile)];

    const r = Bun.spawnSync(command, {
      stdin: Buffer.from(stdinText, "utf-8"),
      stdout: "pipe",
      stderr: "pipe",
      cwd: projectDir,
      env: authorityToken
        ? { ...projectEnv, AIDLC_INTERNAL_HUMAN_TURN_TOKEN: authorityToken }
        : projectEnv,
    });
    return {
      stdout: r.stdout?.toString() ?? "",
      stderr: r.stderr?.toString() ?? "",
      code: r.exitCode ?? 0,
    };
  }

  const { tool_name, tool_input } = normalizeToolCall(payload, projectDir);

  function makeCorePayload(eventName: string): string {
    const userPrompt =
      payload.prompt ??
      payload.user_prompt ??
      payload.message ??
      extractLastUserPromptFromTranscript(payload.transcriptPath);

    return JSON.stringify({
      hook_event_name: eventName,
      session_id: sessionId,
      conversation_id: sessionId,
      cwd: projectDir,
      tool_name,
      tool_input,
      tool_response: payload.tool_response ?? payload.tool_output,
      tool_use_id: payload.tool_use_id ?? "",
      agent_type: payload.agent_type ?? payload.agent_name,
      prompt: userPrompt,
      step_idx: payload.stepIdx,
      transcript_path: payload.transcriptPath ?? null,
      stop_hook_active: payload.stop_hook_active,
    });
  }

  switch (target) {
    case "pre-tool":
    case "guard-tool-call": {
      const corePayload = makeCorePayload("PreToolUse");
      const guards = [
        "aidlc-state-transition-guard.ts",
        "aidlc-plan-approval-guard.ts",
        "aidlc-review-freeze.ts",
        "aidlc-reviewer-scope.ts",
      ];
      for (const guard of guards) {
        const { stderr, code } = runCoreWithStderr(guard, corePayload);
        if (code !== 0 && stderr.trim().length > 0) {
          process.stdout.write(`${JSON.stringify({
            decision: "deny",
            reason: stderr.trim(),
          })}\n`);
          return 0;
        }
      }
      process.stdout.write(`${JSON.stringify({ decision: "allow" })}\n`);
      return 0;
    }
    case "post-tool":
    case "audit-and-sensors": {
      const corePayload = makeCorePayload("PostToolUse");
      if (tool_name === "ask_question") {
        runCore("aidlc-record-human-turn.ts", corePayload);
      }
      runCore("aidlc-write-audit-log.ts", corePayload);
      runCore("aidlc-run-sensors.ts", corePayload);
      runCore("aidlc-rebuild-stage-graph.ts", corePayload);
      process.stdout.write("{}\n");
      return 0;
    }
    case "pre-invocation": {
      const isFirstStep = (payload.initialNumSteps ?? 0) === 0 || (payload.invocationNum ?? 1) === 1;
      let injectedContext = "";
      if (isFirstStep) {
        const res = runCore("aidlc-session-start.ts", makeCorePayload("SessionStart"));
        if (res.stdout.trim().length > 0) {
          try {
            const parsed = JSON.parse(res.stdout) as { additionalContext?: string };
            if (parsed.additionalContext) {
              injectedContext = parsed.additionalContext;
            }
          } catch {
            injectedContext = res.stdout.trim();
          }
        }
      }
      runCore("aidlc-record-human-turn.ts", makeCorePayload("UserPromptSubmit"));
      if (injectedContext) {
        process.stdout.write(`${JSON.stringify({
          injectSteps: [
            { ephemeralMessage: injectedContext }
          ]
        })}\n`);
      } else {
        process.stdout.write(`${JSON.stringify({ injectSteps: [] })}\n`);
      }
      return 0;
    }
    case "session-start": {
      const res = runCore("aidlc-session-start.ts", makeCorePayload("SessionStart"));
      if (res.stdout.trim().length > 0) {
        process.stdout.write(res.stdout);
      }
      return 0;
    }
    case "record-human-turn": {
      runCore("aidlc-record-human-turn.ts", makeCorePayload("UserPromptSubmit"));
      return 0;
    }
    case "validate-state": {
      runCore("aidlc-validate-state.ts", makeCorePayload("PreCompact"));
      return 0;
    }
    case "rebuild-stage-graph": {
      runCore("aidlc-rebuild-stage-graph.ts", makeCorePayload("PostToolUse"));
      return 0;
    }
    case "log-subagent": {
      runCore("aidlc-log-subagent.ts", makeCorePayload("SubagentStop"));
      return 0;
    }
    case "stop":
    case "continue-workflow": {
      const res = runCore("aidlc-continue-workflow.ts", makeCorePayload("Stop"));
      if (res.stdout.trim().length > 0) {
        try {
          const parsed = JSON.parse(res.stdout) as { decision?: string; reason?: string };
          if (parsed.decision === "block") {
            process.stdout.write(`${JSON.stringify({
              decision: "continue",
              reason: parsed.reason || "An active AI-DLC workflow directive is still in flight.",
            })}\n`);
            return 0;
          }
        } catch {
          // ignore parse error and proceed
        }
      }
      process.stdout.write("{}\n");
      return 0;
    }
    default:
      process.stdout.write("{}\n");
      return 0;
  }
}

if (import.meta.main) {
  let stdinData = "";
  if (!process.stdin.isTTY) {
    stdinData = await Bun.stdin.text();
  }

  const target = process.argv[2] ?? "guard-tool-call";
  const code = await run(target, stdinData, process.argv.slice(3));
  process.exit(code);
}
