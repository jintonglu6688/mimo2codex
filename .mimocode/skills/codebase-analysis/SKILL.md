---
name: codebase-analysis
description: Analyze a codebase and create CLAUDE.md/AGENTS.md files for future AI instances. Use when the user asks to analyze a project, create agent instructions, or understand a codebase structure.
---

# Codebase Analysis Skill

Analyze codebases systematically and create comprehensive CLAUDE.md/AGENTS.md files that help future AI instances understand the project.

## When to use

Trigger this skill when:
- User asks "analyze this codebase" / "创建CLAUDE.md" / "create AGENTS.md"
- User wants to understand a project's structure and conventions
- User asks to create documentation for AI agents
- User says "Please analyze this codebase and create a CLAUDE.md file"

## Workflow

### 1. Project Discovery

```bash
# List root directory
ls -la

# Check for existing docs
cat README.md
cat package.json
cat go.mod
cat Cargo.toml

# Find source directories
find . -type f -name "*.ts" -o -name "*.js" -o -name "*.go" -o -name "*.py" | head -20
```

### 2. Architecture Analysis

Identify:
- **Language(s)**: TypeScript, Go, Python, etc.
- **Framework(s)**: React, Express, Gin, etc.
- **Structure**: monorepo, single package, microservices
- **Entry points**: main files, CLI entry, API routes
- **Key directories**: src/, lib/, cmd/, internal/, tests/

### 3. Codebase Map

Create a mental map of:
- Core modules and their responsibilities
- Data flow (API → Service → Database)
- Configuration files and env vars
- Build/test/deploy pipeline
- Dependencies and their purposes

### 4. Conventions Detection

Look for:
- **Naming**: camelCase, snake_case, kebab-case
- **Imports**: relative, absolute, barrel files
- **Error handling**: try/catch, error boundaries, custom errors
- **Testing**: framework, patterns, coverage expectations
- **Git**: commit message format, branch naming

### 5. Create CLAUDE.md / AGENTS.md

Structure the file as:

```markdown
# [Project Name]

[One-paragraph description]

## Quick Start

[How to run the project]

## Architecture

[High-level structure]

## Key Files

[Important files and their roles]

## Conventions

[Code style, naming, patterns]

## Common Tasks

[How to add features, fix bugs, etc.]

## Environment

[Required env vars, config files]

## Testing

[How to run tests, test conventions]

## Deployment

[How to deploy, CI/CD]
```

### 6. Validation

After creating the file:
- Verify all referenced paths exist
- Check that commands actually work
- Ensure examples are accurate
- Test any code snippets

## Example Usage

```
User: Please analyze this codebase and create a CLAUDE.md file, which will be given to future instances of Codex working on this codebase.

Agent workflow:
1. ls -la (discover project structure)
2. cat package.json / go.mod (identify language/framework)
3. Find key source files
4. Analyze architecture
5. Create comprehensive CLAUDE.md
6. Validate references
```

## Output Format

The CLAUDE.md should be:
- **Concise**: 200-500 lines max
- **Actionable**: Focus on what agents need to know
- **Accurate**: Only include verified information
- **Bilingual**: English primary, Chinese comments if helpful

## Key Analysis Points

### For TypeScript/Node.js Projects
- Check `package.json` for scripts, dependencies
- Look for `tsconfig.json` configuration
- Identify build output (`dist/`, `build/`)
- Check for monorepo (lerna, nx, turborepo)

### For Go Projects
- Check `go.mod` for module name and dependencies
- Look for `cmd/` directory structure
- Identify internal packages
- Check for Makefile or build scripts

### For Python Projects
- Check `pyproject.toml` or `setup.py`
- Look for `requirements.txt` or `poetry.lock`
- Identify package structure
- Check for virtual environments

## Don't Use This Skill For

- Modifying code (use other skills)
- Deploying (use deployment workflows)
- PR review (use pr-review skill)
- Issue investigation (use issue-investigation skill)
