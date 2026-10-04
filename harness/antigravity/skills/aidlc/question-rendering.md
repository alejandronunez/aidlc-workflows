# Question Rendering — Antigravity harness annex

This file defines how THIS harness renders the structured questions that
`aidlc-common/protocols/stage-protocol.md` § "Structured questions" requires.
The protocol and stage files are harness-neutral: they say *present a
structured question* and carry a fenced ` ```question ` spec block. This annex
is the one place that binds that contract to a concrete mechanism.

## Never echo the spec (non-negotiable)

A ` ```question ` fenced block is **INPUT to this annex's rendering, never
output to paste**. The orchestrator MUST render every ` ```question ` spec as
an interactive `ask_question` tool call (or numbered prose when the tool is
unavailable), and MUST NEVER echo, print, paste, or "quote back" the fenced
block, or any of its field lines (`prompt:`, `header:`, `multiSelect:`,
`options:`, `label:`, `description:`), into the chat transcript. The user must
never see the raw fence.

Echoing the fence as literal text is a **protocol violation**, not a stylistic
choice. It:

- produces an unanswerable block instead of a clickable UI modal or numbered options;
- drops the built-in write-in / "Other" escape;
- is inconsistent with every correct rendering elsewhere in the same session.

If you find yourself about to write a triple-backtick `question` block into your
reply, STOP: that content is a spec to render through this annex.

This applies to **every** structured-question site, including but not limited to:

- approval gates (every stage completion);
- the questions interaction-mode choice (Guide me / I'll edit the file / Chat);
- the ladder prompt (autonomy mode after the walking skeleton);
- halt-and-ask on Bolt failure (Retry / Skip / Abort);
- consolidated-summary confirmation before artifact generation;
- the §13 learnings gate (keep / heading / promote-to-team).

## Mechanism (two-track)

Antigravity has a first-class interactive tool — `ask_question` — that renders
a native UI modal with selectable options and write-in support. It is the
PRIMARY track. Numbered chat prose is the permanent floor for environments
where the tool is unavailable (e.g. headless runs).

### Track 1 — ask_question (Primary / IDE interactive track)

When the `ask_question` tool is available in your declared tool list, call it
instead of printing text options into the chat. Execution blocks until the user
selects their answer in the modal.

Map the spec fields 1:1:

| Spec field | ask_question field |
|------------|--------------------|
| `header` + `prompt` | `questions[0].question`: `"**[header]** — [prompt]"` |
| `multiSelect` | `questions[0].is_multi_select` |
| `options[]` | `questions[0].options[]`: `"[label] — [description]"` (or `"[label]"` if no description) |
| brief action / summary | `toolAction`: `"Asking question"`, `toolSummary`: `"Stage question"` |

Rules for `ask_question`:

- When a question has a recommended option, list it FIRST and prefix its option
  text with `(Recommended) ` (e.g. `"(Recommended) Approve — Continue to [next stage]"`).
- The `ask_question` UI automatically includes a default write-in / Other option
  with a text box — do **NOT** add an explicit "Other" option to the `options` array
  (questions *files* still end with `Other (please specify)` per protocol §3 as the
  neutral file record).
- Do not add numbers ("1.", "2.") to the option strings; the UI enumerates them.
- Format options as the user's direct choice rather than describing your own actions.
- On an approval question, render `Continue to [next stage]` using the run-stage
  directive's `next_stage` field verbatim; render `Complete workflow` when `next_stage`
  is null.
- **Answer capture**: The selection returns as the chosen option string. Record
  the matching option label verbatim in question files and log receipts (protocol:
  never summarize User Input).

Example — this spec:

```question
prompt: "[Stage Name] complete. How would you like to proceed?"
header: Approval
multiSelect: false
options:
  - label: Approve
    description: Continue to [next stage]
  - label: Request Changes
    description: Provide revision feedback
```

becomes this tool call:

```json
{
  "name": "ask_question",
  "args": {
    "questions": [
      {
        "question": "**Approval** — [Stage Name] complete. How would you like to proceed?",
        "options": [
          "(Recommended) Approve — Continue to [next stage]",
          "Request Changes — Provide revision feedback"
        ],
        "is_multi_select": false
      }
    ],
    "toolAction": "Requesting stage approval",
    "toolSummary": "Stage approval question"
  }
}
```

### Track 2 — numbered prose (the floor)

If `ask_question` is not in your tool list or the environment is headless,
render the spec as numbered prose options in chat and let the user answer with
a number or free text:

```question
prompt: "[Stage Name] complete. How would you like to proceed?"
header: Approval
multiSelect: false
options:
  - label: Approve
    description: Continue to [next stage]
  - label: Request Changes
    description: Provide revision feedback
```

becomes:

```
**Approval** — [Stage Name] complete. How would you like to proceed?

1. **Approve** — Continue to [next stage]
2. **Request Changes** — Provide revision feedback
3. **Other** — describe what you want instead

Reply with a number (or just tell me).
```

## Mandatory consolidated-summary checkpoint

This checkpoint applies only when `directive.ceremony.summary_confirmation === "on"`. When it is `"off"`, generate directly from the answers: no summary-confirmation prompt, confirmation entry, or receipt. Required stage questions and other human decisions, including Plan Approval and the stage approval gate, are unchanged.

After guided or chat file-backed Q&A (and whenever a stage definition requires
it explicitly, such as Requirements Analysis), the stage protocol requires a
separate confirmation before any stage artifact is generated. Append or update
`## Consolidated Summary Confirmation` in the questions file with the summary,
the prompt, both options without A/B file-letter prefixes, and a blank
`[Answer]:` tag, then render this numbered question in chat:

```
**Confirm** — Does this all look correct before I generate the artifact?

1. **Looks correct** — Generate the artifact from these answers
2. **Request changes** — Revise one or more answers before generation
3. **Other** — describe what you want instead

Reply with a number (or just tell me).
```

Rules:

- **Approval gate `[next stage]`**: on an approval question, render the
  `Continue to [next stage]` placeholder from the run-stage directive's
  `next_stage` field verbatim (e.g. `Continue to NFR Requirements`); render
  `Complete workflow` when `next_stage` is null. Never guess the next stage.
- **Bold the header**, then the prompt, then the numbered options in spec
  order. When a question has a recommended option, list it FIRST and append
  "(Recommended)" to its label.
- **Fresh local numbering**: start every question at `1`, independent of
  numbered content earlier in the message or another question in the batch.
  Use unordered bullets for immediately preceding summaries. Visible `1` maps
  to the first source option label, `2` to the second, and so on.
- **Always append an "Other" escape** as the final number — the spec's
  options never include one.
- **multiSelect: true** → say "Reply with all numbers that apply (e.g. 1, 3)."
- **Answer capture**: map the user's number back to the exact option `label`
  and record that label verbatim (protocol: never summarize User Input). A
  free-text reply that clearly matches an option counts as that option;
  anything else is an "Other" answer — treat it per the protocol (discuss,
  then re-ask for a final pick).
- **Batching**: no harness limit on options per question, but keep batches
  readable — at most ~4 questions per message, and for 5+ options prefer one
  message per question. The questions FILE remains the authoritative record.
- **No emergent options**: render exactly the spec's options (+ Other). The
  NO EMERGENT BEHAVIOR rule applies to the rendering, not just the spec.
