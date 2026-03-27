---
name: Refactor
description: Spawn a worker subagent to refactor the specified code for clarity and maintainability
trigger: refactor
steps:
  - prompt: "Analyze the code that needs to be refactored based on the user's request: {{input}}. Identify the target files and the specific refactoring goals."
  - prompt: "Refactor the identified code to improve clarity, reduce duplication, and follow best practices. Make the changes, then report a summary of what was changed and why.\n\nContext: {{previousOutput}}"
    agentType: worker
---

This skill delegates code refactoring to a worker subagent with isolated context for targeted improvements.
