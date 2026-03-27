---
name: Commit
description: Stage all changes and create a git commit with a descriptive message
trigger: commit
steps:
  - prompt: "Review the current git status and diff. Stage all changes using git add -A, then create a descriptive commit message based on the changes, and run git commit with that message. Report what was committed."
---

This skill stages all modified and untracked files, generates a commit message based on the diff, and creates a git commit.
