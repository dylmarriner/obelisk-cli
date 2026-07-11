# Release Runbook

This is the maintainer procedure for publishing Obelisk CLI and its supported packages.

## Before release

- Confirm the release commit is on `dev` and all required checks are green.
- Review the changelog for breaking changes, migrations, security fixes, and operator action.
- Confirm package versions, generated clients, lockfile, and release notes agree.
- Confirm the release environment has the required signing, registry, and cloud credentials.
- Announce the release window when downstream consumers need notice.

## Build and verify

Run the same commands used by CI from a clean checkout:

```bash
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun turbo test
bun run --cwd packages/obelisk build -- --single
```

Release artifacts must include the supported operating-system and architecture variants produced by the release workflow. Verify each native binary with `--version`, record SHA-256 checksums, and inspect the archive contents before publishing.

## Publish

1. Create or approve the release through the protected release workflow.
2. Build from the exact release tag or immutable commit SHA.
3. Sign platform artifacts using the protected signing environment.
4. Upload artifacts, checksums, provenance, and release notes to the GitHub release.
5. Publish package registries only after the GitHub release assets are complete.
6. Update deployment environments through their protected deployment jobs.

No release job should publish from a mutable branch name alone. Tag and commit identity must be recorded in the workflow summary.

## After release

- Install the published artifact in a clean environment and run `obelisk --version`, `obelisk doctor`, and a no-provider help command.
- Exercise the web dashboard health endpoint and one authenticated path.
- Monitor error reporting, download failures, registry publication, and deployment health for at least one release window.
- If rollback is necessary, prefer reverting the deployment or publishing a patched release. Do not delete an artifact that users may already have downloaded.

## Rollback

Document the incident, affected versions, decision owner, and recovery commands. Security fixes must follow [SECURITY.md](../SECURITY.md) and should include a coordinated disclosure plan.

