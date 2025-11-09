# Engineering Principles

(GitCmurf v.1.0 2025-02-18)

> **Audience**: AI agentic coding assistants (Claude, Codex, Gemini, etc.) and human contributors.
> **Scope**: Universal engineering standards. For repo-specific rules (DocOps, governance, CLI workflows), see [`AGENTS.md`](AGENTS.md).

These principles apply to **every** code change. If a principle conflicts with a project-specific rule in `AGENTS.md`, the project-specific rule takes precedence.

---

## 1. The Atomic Unit of Work

A change is **not complete** unless it includes all three:

| ✅ Required       | What it means                                                   |
| ----------------- | --------------------------------------------------------------- |
| **Code**          | The implementation itself                                       |
| **Tests**         | Automated proof that the code works — and keeps working         |
| **Documentation** | Updated comments, docstrings, and/or docs reflecting the change |

Do not submit one without the others. Partial deliveries create drift.

## 2. Architecture & Design

- **Separation of concerns**: isolate API/transport, business logic, and data access into distinct modules. A database import in a route handler is a code smell.
- **SOLID**: apply pragmatically, not dogmatically. Prefer small, focused interfaces (ISP) and constructor injection (DIP) over over-abstracted hierarchies.
- **DRY**: extract shared logic into well-named helpers. Tolerate _minor_ repetition when the alternative is a premature abstraction.
- **KISS**: choose the simplest solution that meets the requirements. If a design needs a diagram to explain, it may be too complex.
- **Backwards compatibility**: do not break public APIs, CLI interfaces, or configuration file formats without explicit approval and a migration path.
- **Data modelling**: get the schema right first — it is the hardest thing to change later. Normalise appropriately, avoid stringly-typed fields, and define constraints at the schema level, not only in application code.

## 3. Code Quality

- **Write for the reader**: code is read 10–100× more often than it is written. Every naming, structural, and formatting decision should optimise for the _next person reading this_ — who may be you in six months, with no context.
- **Naming**: use descriptive, unambiguous names. `retry_count` over `rc`; `fetch_user_by_email()` over `get()`. Naming is documentation.
- **Function size**: aim for ≤ 40 lines per function. If a function needs a comment to explain a section, that section is a candidate for extraction.
- **Type safety**: use type annotations (Python type hints, TypeScript strict mode). Prefer `mypy` / `tsc --strict` compliance.
- **Comments**: explain _why_, never _what_. The code should explain _what_. Delete stale comments rather than leaving them to mislead.
- **Style**: follow the project's configured formatters and linters (`black`, `isort`, `flake8`, `ruff`, Prettier). Do not fight the formatter. Respect `.editorconfig` settings.

## 4. Testing

- **Test-first when possible**: write a failing test, make it pass, then refactor (red → green → refactor).
- **Test pyramid**: prefer fast unit tests; use integration tests for boundaries (DB, HTTP, file I/O); use E2E tests sparingly and only for critical paths.
- **Test quality**:
  - Each test should verify **one behaviour**.
  - Use descriptive test names that read as specifications: `test_expired_token_returns_401`, not `test_auth`.
  - No logic in tests — no loops, no conditionals. If you need them, you need separate test cases.
  - Tests must be deterministic. No reliance on wall-clock time, network, or uncontrolled randomness.
- **Coverage**: aim for meaningful coverage, not a number. 80% that tests the right paths beats 95% that tests getters.

## 5. Error Handling & Reliability

- **Think failure-first**: for every operation, ask _"what happens when this fails?"_ before writing the happy path. If you cannot answer that question, you do not yet understand the problem.
- **Fail explicitly**: raise or return specific errors — never silently swallow exceptions. `except Exception: pass` is forbidden.
- **Design for debuggability**: error messages must include _context_ — what was being attempted, with what inputs, and why it failed. Not `"Error occurred"` but `"Failed to parse config file '{path}': expected 'sources' key"`. When something breaks at 2 AM, your error messages are your only voice.
- **Validate at the boundary**: validate all external inputs (user input, API responses, file contents) at the point of entry. Trust nothing from outside the process.
- **Idempotency**: design operations so they can be safely retried. This is especially critical for anything involving I/O or state mutation.
- **Retry with backoff**: for transient failures against external services, use exponential backoff with jitter. Do not retry indefinitely.
- **Graceful degradation**: when a dependency is unavailable, degrade — don't crash. If the network is down, can you still do local operations? If an optional enrichment step fails, does the core pipeline still produce output?
- **Structured logging**: use levelled logging (`debug` / `info` / `warning` / `error`). Include correlation IDs where applicable. Never log secrets or PII.

## 6. Security

- **No hardcoded secrets**: use environment variables or a secrets manager. Never commit `.env` files, API keys, tokens, or passwords.
- **Input sanitisation**: defend against injection (SQL, command, template) at every external interface.
- **Least privilege**: request only the permissions required. Avoid running as root or with wildcard IAM policies.
- **Dependency vigilance**: do not introduce packages without checking maintenance status (recent commits, open security advisories, licence compatibility).

## 7. Dependencies & Tooling

- **Prefer established libraries**: choose well-maintained, widely-adopted packages over obscure alternatives. Check commit activity, issue responsiveness, and download counts.
- **Pin versions**: use lockfiles (`uv.lock`, `package-lock.json`) and pin direct dependencies to compatible ranges. Avoid unpinned `latest`.
- **Minimise dependency surface**: each new dependency is a liability. If the functionality is < 50 lines to implement correctly, consider owning it.
- **Keep dependencies current**: outdated dependencies accumulate security risk. Flag and remediate known vulnerabilities.

## 8. Concurrency & Performance

- **Optimise after measuring**: do not guess at bottlenecks. Profile first, optimise second.
- **Avoid premature concurrency**: use async/threading only when there is a demonstrated need (I/O-bound workloads, parallelisable tasks). Concurrency adds complexity.
- **Protect shared state**: if concurrency is required, use appropriate synchronisation primitives. Prefer message-passing over shared mutable state.
- **Disposability**: processes must start fast and shut down gracefully. Handle `SIGTERM`; drain in-flight work before exiting. Never leave resources (file handles, connections, temp files) dangling on shutdown.

## 9. Version Control Discipline

- **Atomic commits**: one logical change per commit. If the commit message needs "and", it may be two commits.
- **Descriptive messages**: use imperative mood ("Add retry logic") with enough context that the commit is useful without reading the diff.
- **No generated artefacts**: do not commit build outputs, cached files, or lockfiles that are in `.gitignore`.
- **Feature branches**: develop on branches; merge via PR with review.

## 10. Working With Existing Code

- **Read before you write**: before modifying code, read enough to understand _why_ it was written that way. Check git history, read related tests, trace call paths. The previous author may have known something you don't. Rewriting code you don't understand is how bugs are born.
- **Make the smallest change that works**: deliver incrementally. A focused, reviewable change that solves the immediate problem is worth more than a sweeping refactor that _also_ solves it — but introduces risk across five files. Build confidence, then iterate.
- **Preserve intent**: when refactoring, ensure the _behaviour_ doesn't change. Run existing tests before and after. If there are no tests, write them first — for the current behaviour — then refactor.

## 11. When In Doubt

- **Ask**: if a requirement is ambiguous, ask the user before guessing.
- **Choose boring technology**: default to the most conservative, battle-tested approach.
- **Leave the codebase better than you found it**: fix obvious issues (typos, dead imports, missing type hints) when you encounter them, but do not refactor unrelated code without permission.

---

_These principles are a living document. If a principle is consistently wrong for this project, propose a change — don't silently ignore it._
