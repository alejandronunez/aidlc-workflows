// harness/antigravity/emit.ts — Google Antigravity per-shell emission plugin.
//
// The unified packager copies core/ → dist/antigravity/.aidlc/ and runs graph
// compile there, then calls this emit() for the .agents/ workspace shell:
//   - .agents/hooks.json — hook wiring pointing to aidlc-antigravity-adapter.ts
//   - .agents/skills/ — the COMPLETE skill tree (orchestrator + generated
//     stage/scope runners + session skills)
//   - Project-root AGENTS.md skill path adjustment.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { EmitContext } from "../../scripts/manifest-types.ts";

function emitHooksJson(harnessDir: string, substituteToken: (v: string) => string): string {
  const runner = (target: string) =>
    `bun -e 'const r=await Bun.stdin.text(),t=process.argv[1]||"${target}";let ws=process.cwd();try{const p=JSON.parse(r);if(p.workspacePaths?.[0])ws=p.workspacePaths[0];}catch{}const fs=require("fs"),path=require("path");let s=path.join(ws,"${harnessDir}/hooks/aidlc-antigravity-adapter.ts");if(!fs.existsSync(s)&&fs.existsSync("${harnessDir}/hooks/aidlc-antigravity-adapter.ts"))s=path.resolve("${harnessDir}/hooks/aidlc-antigravity-adapter.ts");try{const{run}=await import(s);await run(t,r);}catch(e){if(t==="guard-tool-call"||t==="pre-tool")console.log(JSON.stringify({decision:"deny",reason:"AI-DLC adapter failed: "+e.message}));else console.log("{}");}' ${target}`;

  const hooks = {
    "aidlc-pre-tool": {
      "PreToolUse": [
        {
          "matcher": "*",
          "hooks": [
            {
              "type": "command",
              "command": substituteToken(runner("guard-tool-call")),
              "timeout": 30,
            },
          ],
        },
      ],
    },
    "aidlc-post-tool": {
      "PostToolUse": [
        {
          "matcher": "*",
          "hooks": [
            {
              "type": "command",
              "command": substituteToken(runner("post-tool")),
              "timeout": 30,
            },
          ],
        },
      ],
    },
    "aidlc-pre-invocation": {
      "PreInvocation": [
        {
          "type": "command",
          "command": substituteToken(runner("pre-invocation")),
          "timeout": 30,
        },
      ],
    },
    "aidlc-stop": {
      "Stop": [
        {
          "type": "command",
          "command": substituteToken(runner("continue-workflow")),
          "timeout": 60,
        },
      ],
    },
  };
  return `${JSON.stringify(hooks, null, 2)}\n`;
}

export default function emit(ctx: EmitContext): void {
  const { coreRoot, harnessRoot, distRoot, harnessDir, substituteToken } = ctx;
  const SHELL = join(distRoot, ".agents");
  const SKILLS_DST = join(SHELL, "skills");

  process.env.AIDLC_HARNESS_DIR = harnessDir;
  process.env.AIDLC_HARNESS_NAME = "antigravity";
  const gen = require(join(distRoot, harnessDir, "tools", "aidlc-runner-gen.ts")) as {
    runnableStages: () => Array<{ slug: string }>;
    renderStageRunner: (node: { slug: string }) => string;
    renderInitRunner: () => string;
    renderComposeRunner: () => string;
    defaultScopeBatch: (
      discovered?: Record<string, { name: string; description: string }>,
    ) => string[];
    discoverScopes: () => Record<string, { name: string; description: string }>;
    renderRunner: (scope: string, description: string) => string;
  };

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...walk(full));
      else out.push(full);
    }
    return out;
  }

  const emissions: Array<{ path: string; content: () => string }> = [];

  const agentsMdPath = join(distRoot, "AGENTS.md");
  if (existsSync(agentsMdPath)) {
    emissions.push({
      path: agentsMdPath,
      content: () =>
        readFileSync(agentsMdPath, "utf-8").replaceAll(
          `${harnessDir}/skills/`,
          ".agents/skills/",
        ),
    });
  }

  // Hook wiring
  emissions.push({
    path: join(SHELL, "hooks.json"),
    content: () => emitHooksJson(harnessDir, substituteToken),
  });

  // (a) Authored orchestrator shell
  for (const f of ["SKILL.md", "question-rendering.md"]) {
    emissions.push({
      path: join(SKILLS_DST, "aidlc", f),
      content: () => substituteToken(readFileSync(join(harnessRoot, "skills", "aidlc", f), "utf-8")),
    });
  }

  // (b) Stage runners + init + compose
  for (const node of gen.runnableStages()) {
    emissions.push({
      path: join(SKILLS_DST, `aidlc-${node.slug}`, "SKILL.md"),
      content: () => gen.renderStageRunner(node),
    });
  }
  emissions.push({
    path: join(SKILLS_DST, "aidlc-init", "SKILL.md"),
    content: () => gen.renderInitRunner(),
  });
  emissions.push({
    path: join(SKILLS_DST, "aidlc-compose", "SKILL.md"),
    content: () => gen.renderComposeRunner(),
  });

  // (c) Default-batch scope runners
  const scopes = gen.discoverScopes();
  for (const scope of gen.defaultScopeBatch(scopes).filter((s) => s in scopes)) {
    emissions.push({
      path: join(SKILLS_DST, `aidlc-${scope}`, "SKILL.md"),
      content: () => gen.renderRunner(scope, scopes[scope].description),
    });
  }

  // (d) Standalone session skills
  for (const skill of ["aidlc-session-cost", "aidlc-replay", "aidlc-outcomes-pack", "aidlc-knowledge"]) {
    const srcDir = join(coreRoot, "skills", skill);
    if (!existsSync(srcDir)) continue;
    for (const file of walk(srcDir)) {
      const rel = relative(srcDir, file);
      emissions.push({
        path: join(SKILLS_DST, skill, rel),
        content: () => substituteToken(readFileSync(file, "utf-8")),
      });
    }
  }

  // Clean-sweep the shell and write files
  rmSync(SHELL, { recursive: true, force: true });
  for (const { path, content } of emissions) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content(), "utf-8");
  }
}
