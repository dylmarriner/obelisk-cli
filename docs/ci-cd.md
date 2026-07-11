# CI/CD Engineering Handbook

This document is the operating contract for Obelisk's GitHub automation. It explains what runs, why it runs, and which checks are required before code can ship.

## Pipeline model

| Stage | Trigger | Purpose | Required to merge |
| --- | --- | --- | --- |
| Pull request validation | `pull_request` | Lint, typecheck, unit tests, generated-file checks, and focused integration gates | Yes |
| Browser validation | `pull_request` when app code changes | Build the web application and run Playwright coverage | Yes when applicable |
| Security validation | Pull requests, pushes, weekly schedule | CodeQL, dependency review, secret and workflow hygiene | Yes for blocking findings |
| Preview/deployment | Push to `dev` or `production` | Deploy the environment matching the branch | Environment approval as configured |
| Release | Maintainer-triggered workflow or approved release automation | Build, sign, attest, publish, and verify artifacts | Release approval |

The `dev` branch is the integration branch. `production` is the release branch. Feature branches must enter through pull requests; direct pushes to protected branches should be disabled in repository settings.

## Required checks

Every pull request must pass:

1. Formatting and lint checks.
2. TypeScript checks across affected workspaces.
3. Unit and contract tests on Linux.
4. Cross-platform smoke coverage on Windows where the affected package supports it.
5. Generated-client and schema checks when their inputs change.
6. Dependency and code-scanning checks with no unresolved high-severity finding.

Checks should be deterministic. Pin action references to full commit SHAs, use the repository's `packageManager` version, and install with the committed lockfile. A failed or cancelled required check must not be treated as a successful merge.

## Workflow design rules

- Give each job the smallest `permissions` block it needs. Read-only jobs use `contents: read`.
- Set a job timeout. No build, test, or deployment job may run indefinitely.
- Use workflow-level concurrency and cancel stale pull-request runs.
- Do not expose secrets to jobs that execute untrusted pull-request code. Use `pull_request_target` only for metadata-only operations with an explicit security review.
- Upload test reports and traces on failure, with a short retention period and no secrets in artifacts.
- Keep release credentials in protected GitHub Environments. Never put credentials in repository variables that are visible to forked pull requests.
- Prefer reusable local actions for toolchain setup so Node, Bun, caching, and install behavior stay consistent.

## Caching

The shared `setup-bun` action caches Bun's package cache using a key derived from `bun.lock`. Turbo and Playwright caches are separate because they have different invalidation rules. Caches are performance hints only; a cache miss must produce the same result as a cache hit.

## Failure handling

When a workflow fails:

1. Reproduce the failing command locally with the repository's pinned Bun version.
2. Check the workflow summary and uploaded artifacts before rerunning.
3. Rerun only after confirming the failure is transient or infrastructure-related.
4. Fix the source, workflow, or dependency; do not weaken a required check to make a run green.

Flaky tests must be tracked as defects with an owner and removal date for any temporary quarantine.

## Release integrity

Release jobs build from an immutable commit, produce checksums, and publish only after artifact verification. See [release.md](./release.md) for the full release runbook.

