---
name: Generate Tests
description: Generate unit and integration tests for the specified file or function
trigger: test
steps:
  - prompt: "Read the file or function specified in the user's request: {{input}}. Understand its behavior, inputs, outputs, and edge cases."
  - prompt: "Generate comprehensive unit tests for the code analyzed in the previous step. Include happy path, edge cases, and error scenarios. Write the tests to an appropriate test file.\n\nContext: {{previousOutput}}"
---

This skill analyzes code and generates thorough unit and integration tests covering the main behaviors and edge cases.
