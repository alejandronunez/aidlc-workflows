// covers: file:skills/aidlc/SKILL.md
//
// t-run-antigravity-status.serial.test.ts — drive `/aidlc --status` through the
// Google Antigravity CLI's headless surface (`agy -p`) against the SHIPPED
// dist/antigravity tree, and assert on the engine's real outputs.
//
// SCOPE: the no-state case ONLY (status with no workflow = print-directive
// terminal arm — turn-stable). With an ACTIVE workflow the conductor may
// legitimately resume it inside the same run turn (the forwarding loop lives
// in-turn), so a with-state "status is read-only" assert is not turn-stable
// here — same carve-out as the cursor/codex/opencode twins.
//
// What this proves on the SHIPPED tree, structurally:
//   - the /aidlc skill entry (.agents/skills/aidlc/SKILL.md) resolves in a
//     print-mode run and forwards the flag text;
//   - the engine's print-directive terminal arm (status names no workflow);
//   - the engine at .aidlc/ runs via the shell tool;
//   - nothing is scaffolded by a read-only utility.
//
// LIVE GATE: requires AIDLC_ANTIGRAVITY_EXEC_LIVE=1 + an agy binary
// (AIDLC_ANTIGRAVITY_BIN or `agy` on PATH) + an authenticated account or key
// (GEMINI_API_KEY or AIDLC_ANTIGRAVITY_ASSUME_AUTH=1). Skips cleanly otherwise.

import { liveCaseTimeoutMs, LIVE_LONG_OPERATION_TIMEOUT_MS, remainingOperationTimeoutMs, fileCleanupReserveMs, NATIVE_STARTUP_TIMEOUT_MS } from "../harness/test-budget.ts";
import { beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  runAntigravity,
  setupAntigravityProject,
} from "../harness/exec-drive.ts";
import { REPO_ROOT } from "../harness/fixtures.ts";

function completedStartupProbe<T extends { error?: Error }>(result: T): T {
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT") throw result.error;
  return result;
}

const ANTIGRAVITY_DIST = join(REPO_ROOT, "dist", "antigravity");
const ANTIGRAVITY_BIN = process.env.AIDLC_ANTIGRAVITY_BIN ?? "agy";

const TIMEOUT_S = Number(process.env.AIDLC_TEST_TIMEOUT);
const TEST_TIMEOUT_MS = Number.isSafeInteger(TIMEOUT_S) && TIMEOUT_S > 0
  ? TIMEOUT_S * 1000
  : liveCaseTimeoutMs(LIVE_LONG_OPERATION_TIMEOUT_MS);
let caseDeadlineMs: number;
beforeEach(() => { caseDeadlineMs = Date.now() + TEST_TIMEOUT_MS; });
function remainingWorkMs(): number {
  return remainingOperationTimeoutMs(TEST_TIMEOUT_MS, {
    deadlineMs: caseDeadlineMs,
    reserveMs: fileCleanupReserveMs(TEST_TIMEOUT_MS),
    phase: "E2E live work",
  })!;
}

function skipReason(): string | null {
  if (process.env.AIDLC_ANTIGRAVITY_EXEC_LIVE !== "1") {
    return "set AIDLC_ANTIGRAVITY_EXEC_LIVE=1 to run the live Antigravity journey (uses your account/provider)";
  }
  const which = completedStartupProbe(
    spawnSync(ANTIGRAVITY_BIN, ["--version"], {
      timeout: remainingOperationTimeoutMs(NATIVE_STARTUP_TIMEOUT_MS),
      encoding: "utf-8",
    }),
  );
  if (which.status !== 0) return `Antigravity CLI not found (AIDLC_ANTIGRAVITY_BIN=${ANTIGRAVITY_BIN})`;
  if (
    !process.env.GEMINI_API_KEY &&
    !process.env.ANTIGRAVITY_API_KEY &&
    process.env.AIDLC_ANTIGRAVITY_ASSUME_AUTH !== "1"
  ) {
    return "no Antigravity credentials visible (set GEMINI_API_KEY or AIDLC_ANTIGRAVITY_ASSUME_AUTH=1 for logged-in CLI)";
  }
  if (!existsSync(ANTIGRAVITY_DIST)) return `distributable missing: ${ANTIGRAVITY_DIST}`;
  return null;
}
const SKIP_REASON = skipReason();

describe("t-run-antigravity-status — /aidlc --status on the shipped dist/antigravity via agy -p", () => {
  test.skipIf(SKIP_REASON !== null)(
    `no-state: status renders 'no active workflow' and scaffolds nothing${SKIP_REASON ? ` [SKIP: ${SKIP_REASON}]` : ""}`,
    () => {
      const { proj, root } = setupAntigravityProject();
      try {
        const r = runAntigravity(proj, "/aidlc --status", remainingWorkMs());
        // rc is 0 on EVERY outcome on some headless CLIs — surface the output
        // tail on any assert failure instead of trusting rc alone.
        expect({ rc: r.rc, tail: r.rc === 0 ? "" : r.out.slice(-2000) }).toEqual({
          rc: 0,
          tail: "",
        });
        // An auth/credential failure must refuse to call that green.
        expect(r.out).not.toContain("Authentication required");
        expect(r.out).not.toContain("API key not valid");
        // The engine's no-workflow status text, surfaced verbatim by the
        // print-directive terminal arm.
        expect(r.out.toLowerCase()).toContain("no active");
        // A read-only utility scaffolds nothing: no intent record, no
        // workflow state anywhere under the workspace tree.
        expect(existsSync(join(proj, "aidlc", "spaces", "default", "intents", "intents.json"))).toBe(
          false,
        );
        expect(existsSync(join(proj, "aidlc-docs"))).toBe(false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );
});
