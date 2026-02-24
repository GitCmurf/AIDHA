# Contributing to AIDHA

First off, thank you for considering contributing to AIDHA! This guide outlines the process for contributing to the project.

## Code of Conduct

By participating, you are expected to uphold the Code of Conduct in `CODE_OF_CONDUCT.md`.
Report unacceptable behavior through a private maintainer contact path on GitHub.

## How Can I Contribute?

### Reporting Bugs

- Open an issue on GitHub
- Clearly describe the bug and steps to reproduce
- Include relevant information like OS, Node.js version, and error messages

### Suggesting Enhancements

- Open an issue on GitHub
- Clearly describe the enhancement and why it would be useful
- Include any relevant examples or mockups

### Pull Requests

1. Fork the repository
2. Create a new branch for your change
3. Make your changes with tests
4. Ensure all tests pass
5. Submit a pull request

## Development Process

### Prerequisites

- Node.js 18+
- pnpm (install with `npm install -g pnpm`)
- Python 3.12+ (for documentation)

### Setup

```bash
# Clone the repository
git clone https://github.com/GitCmurf/AIDHA.git
cd AIDHA

# Install dependencies
pnpm install

# Set up pre-commit hooks
pip install pre-commit
pre-commit install

# Create a local YAML config file with required variables
mkdir -p ~/.aidha
cp examples/config.example.yaml ~/.aidha/config.yaml
# Edit the config file with your values
```

### Security Baseline Maintenance

When secret-scanning rules or findings change, refresh the repository baseline:

```bash
bash scripts/security/refresh-secrets-baseline.sh
```

This command regenerates and stages `.secrets.baseline` using the hook-pinned
`detect-secrets` version.

### Development Workflow

1. **Build packages**: `pnpm build`
2. **Run tests**: `pnpm test`
3. **Run CLI**: `pnpm -C packages/praecis/youtube cli help`
4. **Preview docs**: `pnpm docs:serve`

### Documentation

Documentation is built with MkDocs. To contribute to documentation:

```bash
# Preview changes
pnpm docs:serve

# Build and validate
pnpm docs:build
```

## Coding Guidelines

### Code Style

- Use TypeScript with strict type checking
- Follow ESLint rules (run `pnpm lint`)
- Use meaningful variable and function names
- Write clear comments for complex logic

### Git Commit Messages

- Use conventional commits (e.g., `feat: add new feature`, `fix: resolve bug`)
- Keep messages concise and descriptive
- Reference issues with `#issue-number`

### Testing

- Write tests for all new functionality
- Test files should be in the same directory as the source file with `.test.ts` extension
- Use Vitest for testing
- Run tests with `pnpm test`

## License

By contributing to AIDHA, you agree that your contributions will be licensed under the Apache License 2.0.

## Security

Please see [SECURITY.md](./SECURITY.md) for security guidelines.
