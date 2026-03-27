---
name: Explain
description: Explain the selected file or code selection in plain language
trigger: explain
steps:
  - prompt: "Read the file or code selection specified by the user and provide a clear, detailed explanation of what it does, how it works, and any notable patterns or decisions. If no specific file is mentioned, explain the most recently discussed code.\n\nUser context: {{input}}"
---

This skill reads a file or selection and explains it in plain language, suitable for code review or onboarding.
