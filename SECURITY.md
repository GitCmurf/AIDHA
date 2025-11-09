# Security Policy

## Supported Versions

AIDHA is in **pre-alpha** stage. Only the latest commit on the main branch is supported.

## Reporting a Vulnerability

If you find a security vulnerability in AIDHA, please report it by:

1. **Using GitHub Security Advisories** (private reporting flow for this repository)
2. If Security Advisories are unavailable for your environment, open a **minimal-detail** GitHub
   issue that includes **no vulnerability details** and asks maintainers to provide a private
   handoff channel.

Do not open public issues with security vulnerability details.

Please include:
- A clear description of the vulnerability
- Steps to reproduce
- Potential impact
- Any known workarounds

If private advisory submission is unavailable in your environment, send only minimal details
initially and request a secure handoff channel from maintainers.

## Vulnerability Response Process

1. **Acknowledgment**: You will receive an acknowledgment within 48 hours
2. **Investigation**: The issue will be investigated within 7 days
3. **Fix**: A fix will be developed and tested
4. **Release**: The fix will be included in the next version
5. **Disclosure**: A security advisory will be published on GitHub

## Secret Management Practices

AIDHA follows strict secret management practices:

- No hardcoded credentials in source code
- All secrets are read from environment variables
- Configuration schema annotates secret fields with `x-aidha-secret: true`
- Secrets are redacted from logs and output
- `.gitignore` properly excludes sensitive files

## Secret Annotation Reference

The authoritative schema for secret-field annotation is:
`packages/aidha-config/schema/config.schema.json`.

Fields marked with `x-aidha-secret: true` are treated as sensitive by config tooling and are
redacted in normal CLI display flows.

Example schema fragment:

```json
{
  "api_key": {
    "type": "string",
    "x-aidha-secret": true
  }
}
```

## Environment Variables

AIDHA requires the following environment variables for operation:

- `AIDHA_LLM_API_KEY` - LLM API key
- `YOUTUBE_COOKIE` - YouTube authentication cookie (high-risk credential)
- `YOUTUBE_INNERTUBE_API_KEY` - YouTube InnerTube API key (unofficial integration credential)

## YouTube Credential Compliance Checklist

Before enabling flows that use `YOUTUBE_COOKIE` or `YOUTUBE_INNERTUBE_API_KEY`:

- Confirm legal/ToS compliance for your usage context with YouTube terms and applicable policy.
- Prefer official APIs (YouTube Data API v3) when practical over unofficial credential paths.
- Document approval/risk acceptance for production usage.
- If compliance cannot be confirmed, disable related features and rotate/remove these secrets.

These credentials can carry account-lock, access-ban, and legal/compliance risk if misused.

## Security Measures

- Pre-commit hooks with secret detection
- GitHub Actions workflows with secret scanning (`detect-secrets` + `gitleaks`)
- Comprehensive `.gitignore` file
- Configuration validation and redaction

## Contributions

Contributors are expected to follow security best practices. Please:

- Never commit secrets or sensitive information
- Use environment variables for configuration
- Add secret detection to your local development setup
- Report any security issues you encounter
