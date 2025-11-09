# AIDHA Workspace

This repository hosts automation templates and prompts for Specify-style feature development. Start by reading `AGENTS.md` for workflow guidance and the `.specify/templates/` directory for DocOps source files.

## Quick Start
1. Run `bash .specify/scripts/bash/check-prerequisites.sh` to verify tooling.
2. Create a spec branch with `bash .specify/scripts/bash/create-new-feature.sh "Describe feature" --short-name feature-name`.
3. Populate the generated `specs/<number>-<short-name>/` folder before implementing code.

## Repository Hygiene
- `.gitignore` tracks common build artifacts, language dependencies, and spec-specific outputs.
- `.gitattributes` enforces LF line endings and provides better diffs for Markdown and shell scripts.
- Consider enabling a CI pipeline that runs linting plus tests for every push to reinforce the TDD approach described in `AGENTS.md`.
