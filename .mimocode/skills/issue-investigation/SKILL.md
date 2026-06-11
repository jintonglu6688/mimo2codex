---
name: issue-investigation
description: Investigate GitHub issues for the mimo2codex project. Fetch issue details, reproduce problems, analyze root causes, and provide solutions. Use when the user reports a bug, shares an issue URL, or asks to investigate a problem.
---

# Issue Investigation Skill

Investigate GitHub issues systematically for the mimo2codex project.

## When to use

Trigger this skill when:
- User shares a GitHub issue URL (e.g., `https://github.com/7as0nch/mimo2codex/issues/XX`)
- User reports a bug or error
- User asks "看看这个issue" / "investigate this issue" / "怎么解决"
- User pastes an error message

## Workflow

### 1. Fetch Issue Information

```bash
# Get issue details
gh issue view <ISSUE_NUMBER> --json title,body,state,author,labels,comments

# Get issue comments
gh api repos/7as0nch/mimo2codex/issues/<ISSUE_NUMBER>/comments
```

### 2. Understand the Problem

From the issue, extract:
- **Symptoms**: What's happening?
- **Expected behavior**: What should happen?
- **Reproduction steps**: How to trigger it?
- **Environment**: OS, Node version, etc.
- **Error messages**: Exact error text

### 3. Reproduce the Issue

```bash
# Check if you can reproduce locally
# Run the relevant commands from the issue

# Check logs
# Look for error patterns in codebase

# Search for related code
grep -r "error_message" src/
grep -r "function_name" src/
```

### 4. Analyze Root Cause

Trace the issue through:
- **Entry point**: Where does the error originate?
- **Call stack**: What functions are involved?
- **Data flow**: What data triggers the issue?
- **Edge cases**: When does it happen vs. when doesn't it?

### 5. Develop Solution

Consider:
- **Quick fix**: Can we patch it minimally?
- **Proper fix**: What's the right solution?
- **Trade-offs**: Performance, complexity, side effects
- **Testing**: How to verify the fix works?

### 6. Provide Investigation Report

```
## Issue #XX: [Title]

**Status**: [Open/Closed]
**Reporter**: @username
**Priority**: [Critical/High/Medium/Low]

### Summary
[One-paragraph overview of the issue]

### Reproduction
[Steps to reproduce, or "Unable to reproduce locally"]

### Root Cause
[Technical explanation of why this happens]

### Solution
[Proposed fix with code changes]

### Testing
[How to verify the fix]

### Additional Notes
[Any related issues, workarounds, or context]
```

## Example Usage

```
User: 有新issue提出：跟着文档的代理教程操作后，魔法上网的时候反代会出问题 #38

Agent workflow:
1. gh issue view 38 --json title,body,state,author,labels
2. Analyze the issue description
3. Check related code in src/
4. Reproduce if possible
5. Provide investigation report with solution
```

## Common Issue Types

### Network/Proxy Issues
- Check proxy configuration
- Verify network connectivity
- Look for firewall/VPN interference
- Check DNS resolution

### API Compatibility Issues
- Verify API endpoint URLs
- Check request/response formats
- Validate authentication
- Look for rate limiting

### Build/Deployment Issues
- Check Node.js version compatibility
- Verify npm/yarn dependencies
- Look for environment variable issues
- Check Docker configuration

### Performance Issues
- Profile slow operations
- Check memory usage
- Look for N+1 queries
- Verify caching

## Key Commands Reference

```bash
# View issue
gh issue view <NUMBER>

# Get issue comments
gh api repos/7as0nch/mimo2codex/issues/<NUMBER>/comments

# Search issues
gh issue list --search "keyword"

# Close issue (after fixing)
gh issue close <NUMBER> --comment "Fixed in PR #XX"

# Reference issue in PR
gh pr create --body "Fixes #<NUMBER>"
```

## Investigation Checklist

- [ ] Read the full issue description
- [ ] Check all comments for additional context
- [ ] Search for related issues
- [ ] Identify the relevant code paths
- [ ] Try to reproduce locally
- [ ] Analyze root cause
- [ ] Propose solution
- [ ] Estimate effort

## Don't Use This Skill For

- PR review (use pr-review skill)
- Codebase analysis (use codebase-analysis skill)
- Feature requests (different workflow)
- General questions (answer directly)
