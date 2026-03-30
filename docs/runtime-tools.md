# Runtime Tools Guide

This document explains how the GSD/pi runtime exposes tools to the model, how tool usage guidance reaches the model, and when to use background-job tools vs the managed background shell.

## Overview

The runtime knows about tools through each tool's definition. A tool can provide:

- `name` — tool call name
- `label` — human-readable UI label
- `description` — base description for the model
- `promptSnippet` — short one-line summary shown in the system prompt's available-tools section
- `promptGuidelines` — extra bullet-point guidance appended to the system prompt
- `parameters` — JSON schema for arguments
- `execute(...)` — tool implementation
- `renderCall` / `renderResult` — optional custom UI rendering

Relevant runtime code:

- `packages/pi-coding-agent/src/core/extensions/types.ts`
- `packages/pi-coding-agent/src/core/agent-session.ts`
- `packages/pi-coding-agent/src/core/system-prompt.ts`

## How the model learns tool usage

Tool awareness happens in two stages:

1. **Tool registration**
   - Built-in tools and extension tools are registered into the active tool registry.
   - `AgentSession` gathers each tool's description, prompt snippet, and prompt guidelines.

2. **System prompt construction**
   - `AgentSession._rebuildSystemPrompt(...)` passes selected tool snippets and guidelines into `buildSystemPrompt(...)`.
   - `buildSystemPrompt(...)` adds:
     - an **Available tools** section
     - tool-specific **Guidelines**

This means the runtime is aware not just of which tools exist, but also of *how they should be used* — **if** the tool definition includes strong prompt metadata.

## Important limitation

Not all tools are equally well-described.

If a tool only has a short `description` and no `promptGuidelines`, the model technically knows the tool exists, but may not understand:

- when to prefer it
- when not to use it
- what other tool should be preferred instead

In practice, good tool choice depends heavily on the quality of `promptGuidelines`.

---

## Background execution: `async_bash` / `await_job` vs `bg_shell`

The runtime currently exposes **two different patterns** for long-running shell work.

### 1. `async_bash` + `await_job`

This is the lightweight background-job system.

#### What `async_bash` does

- Starts a bash command in the background
- Returns a job ID immediately
- Lets the agent continue doing other work
- Emits a follow-up message when the job eventually completes

#### What `await_job` does

- Waits for one or more existing background jobs to complete
- Returns when:
  - a watched job completes, or
  - the timeout expires
- Returns completed job output and lists jobs still running

#### Important semantic detail

`await_job` is **not** a fire-and-forget subscription call.

It is a **foreground waiting tool**. Once invoked, the current tool call stays open until:

- a job finishes, or
- timeout is reached

So although the original command is backgrounded, `await_job` itself still blocks the current tool call.

This is intentional in the current implementation.

Relevant code:

- `src/resources/extensions/async-jobs/async-bash-tool.ts`
- `src/resources/extensions/async-jobs/await-tool.ts`
- `src/resources/extensions/async-jobs/await-tool.test.ts`

#### UX consequence

In Studio/TUI, `await_job` may look like a still-running tool call because the runtime has not emitted `tool_execution_end` yet. That can feel like "streaming" or "blocking" even though the original process is backgrounded.

#### Best use cases

Use `async_bash` + `await_job` for:

- quick background builds/tests where live output is not important
- simple "start now, collect result later" workflows
- bounded polling with a timeout

Avoid it when you need:

- live terminal-style output
- incremental stdout/stderr inspection
- interactive sessions
- readiness checks for servers/watchers

---

### 2. `bg_shell`

This is the managed background process runtime.

It is the preferred tool family when terminal/process visibility matters.

#### What `bg_shell` provides

- `start` — launch a background process
- `digest` — compact status summary
- `highlights` — only significant output lines
- `output` — raw incremental output since last check
- `wait_for_ready` — wait until readiness condition is met
- `send` — write to stdin
- `send_and_wait` — interactive expect-style flow
- `run` — execute commands on a persistent shell session
- `env` — inspect shell cwd/env
- `signal` / `kill` / `restart` — lifecycle control
- `group_status` — inspect related processes

Relevant code:

- `src/resources/extensions/bg-shell/bg-shell-tool.ts`
- `src/resources/extensions/bg-shell/output-formatter.ts`
- `src/resources/extensions/bg-shell/process-manager.ts`
- `src/resources/extensions/bg-shell/interaction.ts`

#### Why `bg_shell` is better for terminal output

`bg_shell` maintains a managed output buffer and supports:

- incremental reads
- stdout/stderr separation
- filtering
- tailing
- readiness detection
- interactive shell sessions

This makes it a much better fit than `await_job` for:

- dev servers
- watchers
- long-running builds
- interactive CLIs
- anything where you want terminal-like visibility

#### Best use cases

Use `bg_shell` when:

- you care about ongoing process output
- you need to inspect logs incrementally
- you want readiness detection
- you need an interactive shell-like session
- the process may run for a long time

---

## Recommended decision guide

### Use `async_bash`

When you want:

- a command to start in the background immediately
- a lightweight job ID
- eventual completion handling
- no need for ongoing terminal output

Typical examples:

- long install where you will check back later
- non-interactive background test run
- one-off long command where final result is enough

### Use `await_job`

When you want:

- to wait for an existing `async_bash` job
- a bounded timeout
- final completed output, not a live log stream

Do **not** use `await_job` when the goal is to inspect live terminal output.

### Use `bg_shell`

When you want:

- proper terminal/process output
- incremental log inspection
- readiness tracking
- shell persistence
- interactive command flows
- process management rather than just job completion

Typical examples:

- `npm run dev`
- `vite`, `next dev`, `webpack --watch`
- persistent test/watch sessions
- servers that need `ready_port` or `ready_pattern`
- REPLs and interactive CLIs

---

## Why models may still choose the wrong tool

Even though the runtime supports all of these tools, model behavior depends on the prompt metadata exposed by each tool.

Today:

- `bg_shell` has strong `promptGuidelines`
- `async_bash` has good `promptGuidelines`
- `await_job` has only a basic description and parameter schema

That means the runtime is aware of `await_job`, but not strongly guided about **when not to use it**.

If model behavior is suboptimal, the fix is usually not in the agent loop itself, but in tool metadata:

- strengthen `promptSnippet`
- add `promptGuidelines`
- explicitly describe preferred alternatives

---

## Documentation recommendations for tool authors

When adding a new tool, include:

1. A precise `description`
2. A concise `promptSnippet`
3. Strong `promptGuidelines` that explain:
   - when to use it
   - when not to use it
   - what competing tool to prefer in adjacent cases
4. Good custom rendering if the tool has unusual runtime behavior

For example, if a tool only returns final output but not live output, say so explicitly.

---

## Suggested future improvements

Potential runtime/documentation improvements:

- Add explicit `promptGuidelines` to `await_job` saying:
  - use for waiting on existing async jobs
  - prefer `bg_shell` when live output or process management is needed
- Improve Studio/TUI rendering for `await_job` so it appears as "waiting for background jobs" instead of generic streaming
- Consider a separate non-blocking subscription tool if needed in future

---

## Summary

- The runtime **is aware** of tools and can pass usage guidance to the model.
- That awareness depends on each tool's `description`, `promptSnippet`, and `promptGuidelines`.
- `await_job` is intentionally a **foreground wait tool**, not a live-output process monitor.
- `bg_shell` is the correct runtime primitive for **proper terminal-style output and process management**.
- If tool choice is poor, improving tool prompt metadata is often the right fix.
