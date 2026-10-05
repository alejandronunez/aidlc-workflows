// t346-antigravity-adapter: the Antigravity stdin shim normalizes payloads into core hooks contract.
//
// covers: file:harness/antigravity/hooks/aidlc-antigravity-adapter.ts

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "../harness/fixtures.ts";
import { normalizeToolCall } from "../../harness/antigravity/hooks/aidlc-antigravity-adapter.ts";

const ADAPTER = join(REPO_ROOT, "dist", "antigravity", ".aidlc", "hooks", "aidlc-antigravity-adapter.ts");

function runAdapter(subcommand: string, input: unknown, cwd: string) {
  return spawnSync(
    process.execPath,
    [ADAPTER, subcommand],
    {
      cwd,
      input: typeof input === "string" ? input : JSON.stringify(input),
      encoding: "utf8",
      env: { ...process.env, AIDLC_RECORD_DIR: cwd },
    }
  );
}

describe("t346 Antigravity Hook Adapter", () => {
  test("1: session-start handles empty / valid payload gracefully", () => {
    const tmp = mkdtempSync(join(tmpdir(), "agy-test-"));
    try {
      const res = runAdapter("session-start", { session_id: "s-123", cwd: tmp }, tmp);
      expect(res.status).toBe(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("2: guard-tool-call normalizes Antigravity toolCall and outputs allow decision", () => {
    const tmp = mkdtempSync(join(tmpdir(), "agy-test-"));
    try {
      const payload = {
        toolCall: {
          name: "write_to_file",
          args: { TargetFile: join(tmp, "test.txt"), CodeContent: "hello" },
        },
        conversationId: "conv-123",
        workspacePaths: [tmp],
      };
      const res = runAdapter("guard-tool-call", payload, tmp);
      expect(res.status).toBe(0);
      const parsed = JSON.parse(res.stdout || "{}");
      expect(parsed.decision).toBe("allow");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("3: malformed JSON input fails open with exit 0 and valid json", () => {
    const tmp = mkdtempSync(join(tmpdir(), "agy-test-"));
    try {
      const res = runAdapter("guard-tool-call", "not-valid-json", tmp);
      expect(res.status).toBe(0);
      const parsed = JSON.parse(res.stdout || "{}");
      expect(parsed.decision).toBe("allow");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("4: normalizeToolCall maps Antigravity tools to canonical core tools", () => {
    const projectDir = "/workspace/project";

    // run_command -> Bash
    const bash = normalizeToolCall(
      { toolCall: { name: "run_command", args: { CommandLine: "echo test", Cwd: projectDir } } },
      projectDir,
    );
    expect(bash.tool_name).toBe("Bash");
    expect(bash.tool_input.command).toBe("echo test");

    // write_to_file -> Write
    const write = normalizeToolCall(
      { toolCall: { name: "write_to_file", args: { TargetFile: "foo.txt", CodeContent: "abc" } } },
      projectDir,
    );
    expect(write.tool_name).toBe("Write");
    expect(write.tool_input.file_path).toBe("foo.txt");
    expect(write.tool_input.content).toBe("abc");

    // replace_file_content -> Edit
    const edit = normalizeToolCall(
      { toolCall: { name: "replace_file_content", args: { TargetFile: "foo.txt" } } },
      projectDir,
    );
    expect(edit.tool_name).toBe("Edit");
    expect(edit.tool_input.file_path).toBe("foo.txt");

    // view_file -> Read
    const read = normalizeToolCall(
      { toolCall: { name: "view_file", args: { AbsolutePath: "/workspace/foo.txt" } } },
      projectDir,
    );
    expect(read.tool_name).toBe("Read");
    expect(read.tool_input.file_path).toBe("/workspace/foo.txt");

    // grep_search -> Grep
    const grep = normalizeToolCall(
      { toolCall: { name: "grep_search", args: { SearchPath: "/workspace", Query: "fn" } } },
      projectDir,
    );
    expect(grep.tool_name).toBe("Grep");
    expect(grep.tool_input.path).toBe("/workspace");
    expect(grep.tool_input.pattern).toBe("fn");

    // list_dir -> LS
    const ls = normalizeToolCall(
      { toolCall: { name: "list_dir", args: { DirectoryPath: "/workspace" } } },
      projectDir,
    );
    expect(ls.tool_name).toBe("LS");
    expect(ls.tool_input.path).toBe("/workspace");
  });

  test("5: pre-invocation returns injectSteps structure", () => {
    const tmp = mkdtempSync(join(tmpdir(), "agy-test-"));
    try {
      const payload = {
        conversationId: "conv-456",
        workspacePaths: [tmp],
        initialNumSteps: 1,
        invocationNum: 2,
      };
      const res = runAdapter("pre-invocation", payload, tmp);
      expect(res.status).toBe(0);
      const parsed = JSON.parse(res.stdout || "{}");
      expect(Array.isArray(parsed.injectSteps)).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("6: stop responds with valid JSON", () => {
    const tmp = mkdtempSync(join(tmpdir(), "agy-test-"));
    try {
      const payload = {
        conversationId: "conv-789",
        workspacePaths: [tmp],
      };
      const res = runAdapter("stop", payload, tmp);
      expect(res.status).toBe(0);
      const parsed = JSON.parse(res.stdout || "{}");
      expect(typeof parsed).toBe("object");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("7: guard-tool-call denies forbidden state mutation with exit 0 and structured JSON", () => {
    const tmp = mkdtempSync(join(tmpdir(), "agy-test-"));
    try {
      cpSync(join(REPO_ROOT, "dist", "antigravity", ".aidlc"), join(tmp, ".aidlc"), { recursive: true });
      spawnSync(
        process.execPath,
        [join(tmp, ".aidlc", "tools", "aidlc.ts"), "engine", "intent", "create", "--scope", "enterprise", "--label", "strict-test"],
        { cwd: tmp, encoding: "utf-8" },
      );

      const payload = {
        toolCall: {
          name: "run_command",
          args: {
            CommandLine: "bun .aidlc/tools/aidlc-state.ts advance requirements-analysis",
            Cwd: tmp,
          },
        },
        conversationId: "conv-deny-test",
        workspacePaths: [tmp],
      };
      const res = runAdapter("guard-tool-call", payload, tmp);
      expect(res.status).toBe(0);
      const parsed = JSON.parse(res.stdout || "{}");
      expect(parsed.decision).toBe("deny");
      expect(typeof parsed.reason).toBe("string");
      expect(parsed.reason).toContain("aidlc-state.ts advance");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("8: CWD independence — hook resolves workspacePaths when CWD is outside workspace", () => {
    const tmp = mkdtempSync(join(tmpdir(), "agy-test-"));
    const outsideCwd = tmpdir();
    try {
      cpSync(join(REPO_ROOT, "dist", "antigravity", ".aidlc"), join(tmp, ".aidlc"), { recursive: true });
      const payload = {
        toolCall: {
          name: "view_file",
          args: { AbsolutePath: join(tmp, "package.json") },
        },
        conversationId: "conv-cwd-test",
        workspacePaths: [tmp],
      };
      const res = runAdapter("guard-tool-call", payload, outsideCwd);
      expect(res.status).toBe(0);
      const parsed = JSON.parse(res.stdout || "{}");
      expect(parsed.decision).toBe("allow");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("9: Antigravity directives stay strictly below 7500 bytes with chunked steering", () => {
    const tmp = mkdtempSync(join(tmpdir(), "agy-test-"));
    try {
      cpSync(join(REPO_ROOT, "dist", "antigravity", ".aidlc"), join(tmp, ".aidlc"), { recursive: true });
      spawnSync(
        process.execPath,
        [join(tmp, ".aidlc", "tools", "aidlc.ts"), "engine", "intent", "create", "--scope", "express", "--label", "chunk-test"],
        { cwd: tmp, encoding: "utf-8" },
      );

      const runEngine = (args: string[]) => {
        return spawnSync(process.execPath, [join(tmp, ".aidlc", "tools", "aidlc-orchestrate.ts"), ...args], {
          cwd: tmp,
          encoding: "utf-8",
          env: { ...process.env, AIDLC_HARNESS_NAME: "antigravity" },
        });
      };

      let res = runEngine(["next"]);
      expect(res.status).toBe(0);
      expect(Buffer.byteLength(res.stdout, "utf-8")).toBeLessThanOrEqual(7500);

      let directive = JSON.parse(res.stdout);
      expect(directive.kind).toBe("load-steering");

      while (directive.kind === "load-steering") {
        expect(Buffer.byteLength(JSON.stringify(directive), "utf-8")).toBeLessThanOrEqual(7500);
        const nextArgs = (directive.next as string).replace(/^aidlc\s+/, "").split(" ");
        res = runEngine(nextArgs.slice(2));
        expect(res.status).toBe(0);
        directive = JSON.parse(res.stdout);
      }

      expect(directive.kind).toBe("run-stage");
      expect(Buffer.byteLength(JSON.stringify(directive), "utf-8")).toBeLessThanOrEqual(7500);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("10: guard-tool-call denies writes to .agents/hooks.json and aidlc.settings.local.json", () => {
    const tmp = mkdtempSync(join(tmpdir(), "agy-test-"));
    try {
      cpSync(join(REPO_ROOT, "dist", "antigravity", ".aidlc"), join(tmp, ".aidlc"), { recursive: true });
      const hooksPayload = {
        toolCall: {
          name: "write_to_file",
          args: { TargetFile: join(tmp, ".agents", "hooks.json"), CodeContent: "{}" },
        },
        conversationId: "conv-deny-test",
        workspacePaths: [tmp],
      };
      const res1 = runAdapter("guard-tool-call", hooksPayload, tmp);
      expect(res1.status).toBe(0);
      const parsed1 = JSON.parse(res1.stdout || "{}");
      expect(parsed1.decision).toBe("deny");

      const settingsPayload = {
        toolCall: {
          name: "write_to_file",
          args: { TargetFile: join(tmp, "aidlc.settings.local.json"), CodeContent: "{}" },
        },
        conversationId: "conv-deny-test",
        workspacePaths: [tmp],
      };
      const res2 = runAdapter("guard-tool-call", settingsPayload, tmp);
      expect(res2.status).toBe(0);
      const parsed2 = JSON.parse(res2.stdout || "{}");
      expect(parsed2.decision).toBe("deny");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("11: pre-invocation mints HUMAN_TURN and extracts prompt from transcriptPath", () => {
    const tmp = mkdtempSync(join(tmpdir(), "agy-test-"));
    try {
      cpSync(join(REPO_ROOT, "dist", "antigravity", ".aidlc"), join(tmp, ".aidlc"), { recursive: true });
      spawnSync(
        process.execPath,
        [join(tmp, ".aidlc", "tools", "aidlc.ts"), "engine", "intent", "create", "--scope", "express", "--label", "turn-test"],
        { cwd: tmp, encoding: "utf-8" },
      );

      const transcriptFile = join(tmp, "transcript.jsonl");
      writeFileSync(
        transcriptFile,
        JSON.stringify({ type: "USER_INPUT", source: "USER_EXPLICIT", content: "Nothing to add" }) + "\n",
      );

      const payload = {
        conversationId: "conv-turn-test",
        workspacePaths: [tmp],
        transcriptPath: transcriptFile,
        initialNumSteps: 1,
        invocationNum: 2,
      };

      const res = runAdapter("pre-invocation", payload, tmp);
      expect(res.status).toBe(0);

      const auditDir = join(tmp, "aidlc", "spaces", "default", "intents");
      const intentDir = readdirSync(auditDir).find(
        (d) => statSync(join(auditDir, d)).isDirectory() && existsSync(join(auditDir, d, "audit")),
      );
      expect(intentDir).toBeDefined();
      const auditFiles = readdirSync(join(auditDir, intentDir!, "audit"));
      expect(auditFiles.length).toBeGreaterThan(0);
      const auditContent = readFileSync(join(auditDir, intentDir!, "audit", auditFiles[0]), "utf-8");
      expect(auditContent).toContain("**Event**: HUMAN_TURN");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("12: post-tool with ask_question mints HUMAN_TURN and forwards user answer", () => {
    const tmp = mkdtempSync(join(tmpdir(), "agy-test-"));
    try {
      cpSync(join(REPO_ROOT, "dist", "antigravity", ".aidlc"), join(tmp, ".aidlc"), { recursive: true });
      spawnSync(
        process.execPath,
        [join(tmp, ".aidlc", "tools", "aidlc.ts"), "engine", "intent", "create", "--scope", "express", "--label", "ask-tool-test"],
        { cwd: tmp, encoding: "utf-8" },
      );

      const payload = {
        conversationId: "conv-ask-tool-test",
        workspacePaths: [tmp],
        toolCall: {
          name: "ask_question",
          args: {
            questions: [
              {
                question: "**Approval** — Stage complete. How would you like to proceed?",
                options: [
                  "Approve — Continue to next stage",
                  "Request Changes — Provide feedback",
                ],
                is_multi_select: false,
              },
            ],
          },
        },
        tool_response: {
          answers: ["Approve — Continue to next stage"],
        },
      };

      const res = runAdapter("post-tool", payload, tmp);
      expect(res.status).toBe(0);

      const auditDir = join(tmp, "aidlc", "spaces", "default", "intents");
      const intentDir = readdirSync(auditDir).find(
        (d) => statSync(join(auditDir, d)).isDirectory() && existsSync(join(auditDir, d, "audit")),
      );
      expect(intentDir).toBeDefined();
      const auditFiles = readdirSync(join(auditDir, intentDir!, "audit"));
      expect(auditFiles.length).toBeGreaterThan(0);
      const auditContent = readFileSync(join(auditDir, intentDir!, "audit", auditFiles[0]), "utf-8");
      expect(auditContent).toContain("**Event**: HUMAN_TURN");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("13: post-tool with invoke_subagent logs subagent completion", () => {
    const tmp = mkdtempSync(join(tmpdir(), "aidlc-adapter-subagent-"));
    try {
      cpSync(join(REPO_ROOT, "dist", "antigravity", ".aidlc"), join(tmp, ".aidlc"), { recursive: true });
      spawnSync(
        process.execPath,
        [join(tmp, ".aidlc", "tools", "aidlc.ts"), "engine", "intent", "create", "--scope", "express", "--label", "subagent-test"],
        { cwd: tmp, encoding: "utf-8" },
      );
      const payload = {
        session_id: "test-session-subagent",
        workspacePaths: [tmp],
        toolCall: {
          name: "invoke_subagent",
          args: {
            Subagents: JSON.stringify([{
              TypeName: "aidlc-developer-agent",
              Role: "Developer Link 1",
              Prompt: "Scan codebase",
            }]),
          },
        },
        tool_response: {
          success: true,
        },
      };

      const res = runAdapter("post-tool", payload, tmp);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("{}");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

