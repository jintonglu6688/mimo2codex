---
name: pr-review
description: Review GitHub pull requests for the mimo2codex project. Fetch PR details, analyze code changes, assess merge-worthiness, check for issues, and provide feedback. Use when the user shares a PR URL or asks to review a pull request.
---

# PR Review Skill

Review GitHub pull requests systematically for the mimo2codex project.

## When to use

Trigger this skill when:
- User shares a GitHub PR URL (e.g., `https://github.com/7as0nch/mimo2codex/pull/XX`)
- User asks "看看这个PR" / "review this PR" / "值得合并吗"
- User wants to assess merge-worthiness of a contribution
- User asks to check a PR for issues before merging

## Workflow

### 1. Fetch PR Information

```bash
# Get PR details
gh pr view <PR_NUMBER> --json title,body,state,author,additions,deletions,changedFiles,mergeable,reviewDecision

# Get PR diff
gh pr diff <PR_NUMBER>

# Get PR comments/reviews
gh api repos/7as0nch/mimo2codex/pulls/<PR_NUMBER>/comments
```

### 2. Analyze Code Changes

Review the diff for:
- **Code quality**: naming, structure, error handling
- **Security**: credentials, injection, unsafe operations
- **Compatibility**: breaking changes, API changes
- **Tests**: adequate coverage, test quality
- **Documentation**: README updates, comments

### 3. Assess Merge-Worthiness

Check:
- Does it solve a real problem?
- Is the approach sound?
- Are there simpler alternatives?
- Will it break existing functionality?
- Does it follow project conventions?

### 4. Provide Feedback Structure

```
## PR #XX: [Title]

**Author**: @username
**Status**: [Open/Merged/Closed]
**Changes**: +XX / -XX lines across XX files

### Summary
[One-paragraph overview of what this PR does]

### Assessment
- **Merge-worthiness**: ✅ Recommended / ⚠️ Needs changes / ❌ Not recommended
- **Quality**: [High/Medium/Low]
- **Risk**: [Low/Medium/High]

### Strengths
- [Positive aspects]

### Issues Found
- [List any issues, concerns, or suggestions]

### Recommendation
[Clear recommendation with reasoning]
```

### 5. If Merging

When the user decides to merge:
1. Preserve author's commit history
2. Create a new branch if needed
3. Merge to main with proper commit message
4. Verify the merge didn't break anything

## Example Usage

```
User: https://github.com/7as0nch/mimo2codex/pull/68 ，你看一下这个pr，值得合并不，有问题没，有的话怎么回复作者

Agent workflow:
1. gh pr view 68 --json title,body,state,author,additions,deletions,changedFiles,mergeable
2. gh pr diff 68
3. Analyze the changes
4. Provide structured assessment
5. If user wants to merge: preserve author commits, merge to main
```

## Key Commands Reference

```bash
# View PR
gh pr view <NUMBER>

# Get PR diff
gh pr diff <NUMBER>

# List PR files
gh pr files <NUMBER>

# Check PR checks/status
gh pr checks <NUMBER>

# Merge PR (preserving author commits)
gh pr merge <NUMBER> --merge

# Or merge locally
git fetch origin pull/<NUMBER>/head:pr-<NUMBER>
git checkout pr-<NUMBER>
git checkout main
git merge pr-<NUMBER> --no-ff -m "Merge PR #<NUMBER>: <title>"
```

## Don't Use This Skill For

- General code review (not tied to a PR)
- Issues (use issue-investigation skill instead)
- Non-GitHub code review
