---
name: Review Code
description: Spawn a reviewer subagent to analyze the current diff and provide feedback
trigger: review-code
steps:
  - prompt: "Get the current git diff of all modified files and compile the full diff output."
  - prompt: "Review the following diff for correctness, potential bugs, security issues, and style concerns. Provide structured feedback with specific suggestions.\n\nContext from previous step:\n{{previousOutput}}"
    agentType: reviewer
---

This skill retrieves the current code diff and delegates to a reviewer subagent for thorough code review.
