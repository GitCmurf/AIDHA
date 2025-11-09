# Quick Contribution Guide

This guide is for contributors who want to skip the heavy governance and just get
started with a simple bug fix or feature.

## 5-Minute Setup

1. **Clone and Install**:
   ```bash
   git clone https://github.com/GitCmurf/AIDHA.git
   cd AIDHA
   pnpm install
   ```

2. **Basic Config**:
   ```bash
   mkdir -p ~/.aidha
   cp examples/config.example.yaml ~/.aidha/config.yaml
   ```

3. **Verify Build**:
   ```bash
   pnpm build
   ```

## Workflow

1. **Create Branch**: `git checkout -b fix/my-bug`
2. **Make Changes**: Add your code and a test in the same directory.
3. **Run Tests**: `pnpm test`
4. **Lint**: `pnpm lint`
5. **Submit PR**: Push to your fork and open a PR against `main`.

## Fast Feedback

If you're not sure about the DocOps process or ADRs, don't worry! Open a PR with
your changes, and a maintainer will help you navigate the documentation
requirements.

For more detailed information, see the full [CONTRIBUTING.md](./CONTRIBUTING.md).
