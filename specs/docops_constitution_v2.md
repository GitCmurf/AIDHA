# DOCOPS CONSTITUTION v2.0

**Pragmatic governance for technical documentation**

---

**Document ID:** ORG-DOCOPS-CONSTITUTION  
**Owner:** DocOps Working Group  
**Status:** Draft  
**Version:** 2.0  
**Last Updated:** 2025-01-15  

---

## Preamble

This Constitution defines **mandatory, organization-wide rules** for technical documentation. It balances rigor with practicality, ensuring documentation is discoverable, maintainable, and valuable.

**Design Principles:**
1. **Progressive disclosure**: Start minimal, scale as needed
2. **Tool-friendly**: Leverage Git, don't duplicate it
3. **Human-readable first**: Metadata serves humans, then machines
4. **Fail gracefully**: Missing metadata is better than wrong metadata

---

## Article I — Maturity Tiers

Not all repositories need the same rigor. Choose your tier:

### Tier 1: Lightweight (Solo/Small Teams)
- Required: Basic front matter (id, owner, status, version)
- Optional: Everything else
- Directory structure: Minimal (just `docs/` and `archive/`)

### Tier 2: Standard (Growing Teams)
- Required: Full front matter + version history
- Directory structure: Core directories (governance, decisions, design, archive)
- Review process: Defined approvers

### Tier 3: Enterprise (Large Organizations)
- Required: All Tier 2 + detailed metadata
- Directory structure: Full hierarchy (13+ directories)
- Automation: Linting, validation, CI/CD integration

**Default tier for new repos: Tier 1** (upgrade when pain points emerge)

---

## Article II — Required Metadata (All Tiers)

Every governed document must include YAML front matter:

```yaml
---
document_id: <id>
owner: <person or role>
status: <draft|review|approved|superseded>
version: <MAJOR.MINOR>
last_updated: <YYYY-MM-DD>
type: <prd|adr|spec|design|runbook|...>
docops_version: "2.0"
---
```

### Field Definitions

- **document_id**: Unique identifier (format: `<repo>-<type>-<name>`)
  - Example: `billing-adr-payment-gateway`, `auth-spec-oauth2`
  - Keep it short, memorable, kebab-case
  - No need for sequential numbers unless truly needed
  
- **owner**: Person responsible for keeping this current (GitHub handle or role)

- **status**: Lifecycle stage
  - `draft` → `review` → `approved` → `superseded`
  - Use `superseded` when replaced (note replacement in doc body)
  
- **version**: Semantic versioning (MAJOR.MINOR)
  - Bump MAJOR for breaking changes (scope, structure, decisions)
  - Bump MINOR for clarifications, additions, fixes
  
- **type**: Document category (lowercase)
  - Common: `prd`, `adr`, `spec`, `design`, `runbook`, `strategy`, `index`
  - Define project-specific types in LOCAL_STANDARDS.md

### Tier 2+ Additional Fields

```yaml
approvers: [person1, person2]  # or "—" if none needed
superseded_by: <document_id>   # if status is superseded
tags: [api, security, cloud]   # optional categorization
```

---

## Article III — Document Identification

### Format Rules

Document IDs must:
- Be unique within the organization
- Use kebab-case (lowercase, hyphens only)
- Follow pattern: `<repo-prefix>-<type>-<descriptive-name>`
- Avoid sequential numbers unless tracking iterations (e.g., ADRs)

**Good Examples:**
- `payments-adr-gateway-selection`
- `auth-spec-oauth2-impl`
- `platform-design-event-bus`

**Bad Examples:**
- `PAYMENTS-ADR-001` (too rigid, unmemorable)
- `oauth2_spec` (missing repo context)
- `the-new-auth-thing` (missing type)

### When to Use Sequential Numbers

Use sequential ADR numbering (`adr-001`, `adr-002`) **only if**:
- You need chronological ordering
- Team is already accustomed to this pattern
- You have tooling that depends on it

Otherwise, descriptive names are superior: `adr-database-choice` beats `adr-003`.

---

## Article IV — Version History

### Tier 1: Use Git
- Git commits ARE your version history
- Put a link to the file's Git history in the README or doc footer

### Tier 2+: Summary Table Required

Include at the end of the document:

```markdown
## Version History

| Version | Date       | Author   | Summary                          |
|---------|------------|----------|----------------------------------|
| 1.0     | 2025-01-15 | @alice   | Initial approval                 |
| 1.1     | 2025-02-03 | @bob     | Added security considerations    |
```

**Don't** record every typo fix. Track:
- Status changes (draft → approved)
- Major/minor version bumps
- Significant content changes

Link to Git for full details: `[Full history](../../commits/main/path/to/doc.md)`

---

## Article V — Directory Structure

### Tier 1: Minimal

```
docs/
  README.md              # Index of all docs
  <topic-name>.md        # Flat structure, no subdirs
  archive/               # Old/superseded docs
```

### Tier 2: Core Directories

```
docs/
  00-governance/         # Standards, policies, how we work
  10-decisions/          # ADRs, tech decisions
  20-design/             # Architecture, system design
  30-runbooks/           # Operations, how-to guides
  99-archive/            # Superseded documents
  README.md              # Index with links to key docs
```

### Tier 3: Full Hierarchy

```
docs/
  00-governance/
  01-indices/
  02-strategy/
  05-planning/
  10-prd/
  20-specs/
  30-design/
  40-decisions/
  45-adr/
  50-fdd/
  55-testing/
  60-runbooks/
  70-devex/
  99-archive/
```

Choose the structure that **serves your team size and complexity**, not what looks impressive.

---

## Article VI — Linking Standards

### Between Documents
- Reference by document_id in prose: "See `auth-spec-oauth2` for details"
- Use relative markdown links for navigation: `[OAuth2 Spec](../20-specs/oauth2.md)`
- When superseding, link forward: "Superseded by `auth-spec-oauth2-v2`"

### External References
- Use full URLs with link text: `[OpenAPI Spec](https://spec.openapis.org/oas/v3.1.0)`
- Capture date accessed for critical references

---

## Article VII — Code-Documentation Coupling

**Rule:** PRs that change behavior must update relevant docs in the same PR.

"Behavior changes" include:
- API modifications (endpoints, parameters, responses)
- Configuration changes
- User-facing features
- Operational procedures

**Enforcement (Tier 2+):**
- PR template includes "Documentation updated: [ ] Yes [ ] N/A"
- CI checks for docs/ changes when code/ changes
- Reviewers verify before approval

**Exemptions:**
- Internal refactors with no external impact
- Test-only changes
- Dependency bumps

---

## Article VIII — Status Transitions

### Allowed Flows

```
draft → review → approved → superseded
  ↓                 ↓
[abandoned]    [published]
```

- **draft**: Work in progress, not authoritative
- **review**: Ready for feedback, assigned to approvers
- **approved**: Accepted, can be implemented/followed
- **published**: (Tier 2+) Externally shared or officially released
- **superseded**: Replaced by another document (link to successor)

### Tier 1: Just Use Draft/Approved
- Skip "review" and "published" if they add no value

---

## Article IX — File Naming & Orthography

### Filenames
- Use ASCII characters only (a-z, 0-9, hyphen, underscore)
- Kebab-case preferred: `oauth2-implementation.md`
- American English spelling in filenames: `color-palette.md`, not `colour-palette.md`

### Content Spelling
- British or American English is allowed in document content
- Be consistent within each document
- Declare preference in LOCAL_STANDARDS.md if it matters

### Exceptions
- Standard files keep their names: `README.md`, `LICENSE`, `CONTRIBUTING.md`
- Configuration files follow tool conventions: `.github/`, `package.json`

---

## Article X — Local Standards

Each repository may extend (but not contradict) this Constitution via:

**`docs/00-governance/LOCAL_STANDARDS.md`**

Required sections:
1. **Tier Declaration**: Which tier this repo follows
2. **Repository Prefix**: Used in all document IDs
3. **Area Registry**: Valid area names (Tier 2+)
4. **Custom Types**: Any project-specific document types
5. **Workflow**: Review/approval process specific to this repo
6. **Exceptions**: Any necessary deviations with justification

See Template below.

---

## Article XI — Metadata for Non-Markdown Files

For files that can't have front matter (diagrams, CSVs, binaries):

Create a sidecar file: `<filename>.meta.yaml`

```yaml
document_id: platform-design-system-arch
owner: @platform-team
status: approved
version: 2.1
type: design
docops_version: "2.0"
source_file: system-architecture.drawio
```

**Exemptions:** Ephemeral build outputs, generated files, vendor dependencies

---

## Article XII — Governance

### Amendment Process
1. Propose changes via RFC (write a draft ADR)
2. Socialize with documentation owners across repos
3. Get approval from at least 2 repo maintainers from different teams
4. Bump Constitution version (MAJOR for breaking, MINOR for additions)
5. Announce with migration guidance

### Conflict Resolution
- This Constitution overrides local standards
- Tool-specific constitutions (e.g., SpecKit) govern their domain, DocOps governs docs
- When in doubt, favor practicality over purity

---

## Appendix A: Quick Start Guide

### For a New Project

1. **Choose your tier** (start with Tier 1 unless you know you need more)
2. **Copy LOCAL_STANDARDS.md template** to `docs/00-governance/`
3. **Create your first doc** with proper front matter
4. **Test the system**: Can you find docs? Are IDs memorable? Is maintenance low-friction?
5. **Iterate**: Upgrade tier only when current structure becomes painful

### Migrating Existing Docs

1. **Don't boil the ocean**: Prioritize living documents (actively maintained)
2. **Add metadata incrementally**: Start with just `document_id`, `owner`, `status`
3. **Archive the dead**: Move unused docs to `archive/` with a note
4. **Automated linting**: Use scripts to validate metadata (see Appendix C)

---

## Appendix B: Why This System?

### Problems We're Solving
1. **Discovery**: "Where did we document X?" → Consistent IDs and structure
2. **Staleness**: Docs out of sync with code → Coupling rule + status tracking
3. **Ownership**: "Who maintains this?" → Required owner field
4. **Supersession**: Old docs mislead → Clear status + archival process

### Problems We're NOT Solving
- Perfect compliance (aim for 80%)
- Replacing Git or wikis (complement, don't compete)
- Generating docs from code (orthogonal concern)

---

## Appendix C: Validation Tools

### Basic Linter (Python)
```python
# validate_docops.py
import yaml
import sys
from pathlib import Path

def validate_frontmatter(file_path):
    content = Path(file_path).read_text()
    if not content.startswith('---'):
        return f"Missing front matter: {file_path}"
    
    try:
        _, fm, _ = content.split('---', 2)
        meta = yaml.safe_load(fm)
        required = ['document_id', 'owner', 'status', 'version', 'type']
        missing = [f for f in required if f not in meta]
        if missing:
            return f"Missing fields {missing}: {file_path}"
    except Exception as e:
        return f"Invalid YAML: {file_path}: {e}"
    
    return None

# Usage: python validate_docops.py docs/**/*.md
```

### GitHub Action (Tier 2+)
```yaml
# .github/workflows/validate-docs.yml
name: Validate Documentation
on: [pull_request]
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Check doc metadata
        run: python scripts/validate_docops.py docs/**/*.md
```

---

**End of DocOps Constitution v2.0**

*This is a living document. Propose improvements via ADR.*
