# LOCAL DOCUMENT STANDARDS

**Implementing DocOps Constitution v2.0 for [Repo Name]**

---

**Document ID:** [repo]-doc-standards  
**Owner:** Repo Maintainers  
**Status:** approved  
**Version:** 1.0  
**Last Updated:** 2025-01-15  
**Type:** governance  
**DocOps Version:** 2.0  

---

## 1. Tier Declaration

This repository follows **DocOps Tier [1|2|3]**.

**Rationale:** [Explain why this tier fits your team size and needs]

Examples:
- *Tier 1*: Solo project, focusing on code velocity
- *Tier 2*: Small team (3-5), need shared decision tracking
- *Tier 3*: Large team/org, formal processes required

---

## 2. Repository Configuration

### Repository Prefix
All document IDs in this repo begin with: **`[repo-prefix]`**

Example document IDs:
- `[repo-prefix]-adr-database-choice`
- `[repo-prefix]-design-api-architecture`
- `[repo-prefix]-runbook-deployment`

### Repository Name
**Full name:** [Full Repository Name]  
**Short name:** [repo-prefix]  
**Primary language:** [e.g., Python, TypeScript, Go]

---

## 3. Area Registry (Tier 2+ only)

Valid area identifiers for document IDs:

| Area Code | Description | Examples |
|-----------|-------------|----------|
| `api` | API layer and contracts | `myapp-api-design-rest` |
| `data` | Data models and persistence | `myapp-data-spec-schema` |
| `ui` | User interface | `myapp-ui-design-components` |
| `infra` | Infrastructure and operations | `myapp-infra-runbook-deploy` |

**Add areas as needed.** Keep them coarse-grained (5-10 max).

---

## 4. Document Types Supported

This repository uses these document types:

| Type | Purpose | Location | Example |
|------|---------|----------|---------|
| `adr` | Architecture Decision Record | `docs/10-decisions/` | `myapp-adr-use-postgres` |
| `design` | System/feature design | `docs/20-design/` | `myapp-design-auth-flow` |
| `spec` | API/interface specification | `docs/20-design/` | `myapp-spec-rest-api` |
| `runbook` | Operational procedures | `docs/30-runbooks/` | `myapp-runbook-deploy` |
| `prd` | Product requirements | `docs/10-prd/` | `myapp-prd-user-auth` |
| `strategy` | Strategic direction | `docs/00-governance/` | `myapp-strategy-2025` |
| `governance` | Process and standards | `docs/00-governance/` | This document |

**Tier 1 repos:** Use minimal types (`decision`, `design`, `runbook`)

---

## 5. Directory Structure

### Current Structure

```
docs/
  00-governance/
    LOCAL_STANDARDS.md      ← This file
    CONTRIBUTING.md
  10-decisions/              ← ADRs, tech decisions
  20-design/                 ← Architecture, system design
  30-runbooks/               ← Operations, deployment
  99-archive/                ← Superseded docs
  README.md                  ← Index of all docs
```

**Tier 1 repos:** Just use `docs/` and `docs/archive/`  
**Tier 3 repos:** Add subdirectories as needed (see Constitution Article V)

---

## 6. Metadata Requirements

### Required Fields (All Documents)

```yaml
---
document_id: [repo]-[type]-[descriptive-name]
owner: @github-handle or Role Name
status: draft|review|approved|superseded
version: MAJOR.MINOR
last_updated: YYYY-MM-DD
type: adr|design|spec|runbook|prd|strategy|governance
docops_version: "2.0"
---
```

### Optional Fields (Use When Relevant)

```yaml
approvers: [@person1, @person2]  # Tier 2+
superseded_by: document-id       # When status is superseded
tags: [security, api, cloud]     # For categorization
related: [doc-id-1, doc-id-2]    # Links to related docs
```

### Metadata Validation

**Tier 1:** Manual review during PR  
**Tier 2+:** Automated via CI (see scripts/ directory)

---

## 7. Versioning Rules

### When to Bump Version

**Bump MAJOR (x.0):**
- Change in scope or purpose
- Breaking change to design/decision
- Change in approvers or status (draft → approved)
- Restructuring document

**Bump MINOR (x.y):**
- Adding new sections
- Clarifications
- Correcting errors
- Updating examples
- Minor metadata changes

**Don't bump for:**
- Typo fixes in established docs
- Formatting changes
- Link updates

### Version History

**Tier 1:** Link to Git history at document end:
```markdown
## History
[Full change history](../../commits/main/docs/path/to/doc.md)
```

**Tier 2+:** Include summary table:
```markdown
## Version History

| Version | Date | Author | Summary |
|---------|------|--------|---------|
| 1.0 | 2025-01-15 | @alice | Initial approval |
| 1.1 | 2025-02-03 | @bob | Added security section |

[Full history](../../commits/main/docs/path/to/doc.md)
```

---

## 8. Review & Approval Workflow

### Draft → Review → Approved

1. **Create** document with `status: draft`
2. **Submit PR** with `status: review` + assign reviewers
3. **Tag approvers** in PR (listed in document metadata)
4. **Approval** requires:
   - [ ] All approvers sign off
   - [ ] CI passes (if Tier 2+)
   - [ ] Linked code PR merged (if applicable)
5. **Merge** and update `status: approved`

### Who Can Approve What

| Document Type | Approvers |
|---------------|-----------|
| `adr` | Tech lead + 1 senior engineer |
| `design` | Owner + domain expert |
| `spec` | API owner + 1 consumer team |
| `runbook` | DevOps lead + on-call engineer |
| `prd` | Product owner + engineering lead |
| `governance` | Repo maintainers |

**Tier 1:** Owner approval is sufficient

---

## 9. Code-Documentation Coupling

### When Docs Must Update

PRs **must** update docs when changing:

✅ API endpoints, parameters, or responses  
✅ Configuration options or environment variables  
✅ User-facing behavior or UI  
✅ Deployment procedures  
✅ Security assumptions or threat model  
✅ Performance characteristics or SLOs  

❌ Internal refactors (no external impact)  
❌ Test changes only  
❌ Dependency version bumps  

### PR Checklist

```markdown
## Documentation
- [ ] No documentation needed (internal change only)
- [ ] Updated existing doc: [link]
- [ ] Created new doc: [link]
- [ ] Updated API spec
- [ ] Updated runbook
```

### Enforcement

**Tier 1:** Manual review  
**Tier 2+:** CI fails if code/ changes but docs/ unchanged (with escape hatch)

---

## 10. Supersession Process

When replacing a document:

1. **Create new document** with new `document_id`
2. **Update old document:**
   - Change `status: superseded`
   - Add `superseded_by: new-document-id`
   - Add note at top:
     ```markdown
     > ⚠️ **SUPERSEDED**  
     > This document has been replaced by [`new-doc-id`](../path/to/new-doc.md).  
     > Kept for historical reference only.
     ```
3. **Move to archive:**
   - `git mv docs/10-decisions/old.md docs/99-archive/old.md`
4. **Update links** in other docs to point to new document

---

## 11. File Naming Conventions

### Markdown Files
- Use kebab-case: `database-architecture.md`
- Include type prefix when useful: `adr-001-database-choice.md`
- Avoid dates in filename (use metadata)
- American spelling: `color-system.md` not `colour-system.md`

### Non-Markdown Files
- Diagrams: `system-architecture.drawio`, `api-flow.png`
- Specs: `openapi.yaml`, `schema.json`
- Include sidecar metadata: `diagram.drawio.meta.yaml`

### Examples
✅ `api-authentication-flow.md`  
✅ `adr-use-postgres-over-mysql.md`  
✅ `deployment-runbook.md`  
❌ `2025-01-15-new-feature-doc.md` (date in name)  
❌ `Architecture_Document_Final_v2_UPDATED.md` (chaos)  

---

## 12. Spelling & Language

### Filenames and Identifiers
- **American English** required
- Examples: `color`, `behavior`, `analyze`

### Document Content
- **Your choice** of British or American English
- **Be consistent** within each document
- Declare project preference: [American|British|Either]

### Technical Terms
Maintain a glossary for project-specific terms in: `docs/01-indices/GLOSSARY.md`

---

## 13. Tools & Automation

### Validation Script
Location: `scripts/validate_docs.py`

```bash
# Run locally
python scripts/validate_docs.py docs/**/*.md

# Run in CI (Tier 2+)
# See .github/workflows/validate-docs.yml
```

### Editor Integration
Recommended VS Code extensions:
- `yzhang.markdown-all-in-one` - Markdown support
- `esbenp.prettier-vscode` - Formatting
- `streetsidesoftware.code-spell-checker` - Spell check

### Templates
Create new docs from templates:
```bash
# Copy template
cp .github/templates/ADR_TEMPLATE.md docs/10-decisions/adr-my-decision.md

# Or use script
./scripts/new_doc.sh adr "my-decision"
```

---

## 14. Migration Guide

### Adding DocOps to Existing Docs

**Phase 1: Tag living documents** (Week 1)
- Add metadata to actively-used docs (5-10 most important)
- Don't worry about version history yet
- Focus on `document_id`, `owner`, `status`

**Phase 2: Organize structure** (Week 2)
- Create directory structure (start with Tier 1)
- Move docs to appropriate folders
- Update internal links

**Phase 3: Archive the dead** (Week 3)
- Identify unmaintained docs
- Mark as superseded or move to archive
- Update any referencing docs

**Phase 4: Add automation** (Week 4+)
- Set up CI validation (Tier 2+)
- Create templates
- Write contribution guide

**Don't try to migrate everything at once.** Start with high-value documents.

---

## 15. Local Exceptions & Extensions

### Exceptions to DocOps Constitution

*List any necessary deviations from the Constitution with rationale:*

Example:
> **Exception:** We don't version our weekly meeting notes in `docs/meetings/`.  
> **Rationale:** These are ephemeral records, not authoritative documentation.  
> **Applies to:** Files in `docs/meetings/*.md`

### Custom Extensions

*Project-specific additions:*

Example:
> **Extension:** All `spec` documents must include an OpenAPI schema.  
> **Rationale:** We auto-generate client libraries from these specs.  
> **Validation:** CI checks for `openapi.yaml` alongside spec docs.

---

## 16. Getting Help

### Questions?
- **General DocOps:** See [DocOps Constitution v2.0](./DOCOPS_CONSTITUTION.md)
- **Repo-specific:** Ask in [#documentation](https://slack.com/documentation)
- **Meta-docs:** Propose changes via PR to this file

### Contributing
See [CONTRIBUTING.md](./CONTRIBUTING.md) for:
- How to write different document types
- Templates for each type
- Review process details
- Style guide

---

## Version History

| Version | Date | Author | Summary |
|---------|------|--------|---------|
| 1.0 | 2025-01-15 | @repo-maintainer | Initial standards (DocOps v2.0) |

[Full history](../../commits/main/docs/00-governance/LOCAL_STANDARDS.md)

---

**End of Local Document Standards v1.0**

*Review this document quarterly. Update as practices evolve.*