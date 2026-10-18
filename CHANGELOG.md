# Changelog

## [1.1.1] - 2026-10-18

### Added
- `SECURITY.md` explaining how to report vulnerabilities privately
- Weekly Dependabot update PRs for npm and GitHub Actions, targeting `develop`

### Changed
- GitHub Actions moved off the deprecated Node 20 runtime: `actions/checkout` v7, `actions/setup-node` v7, `google-github-actions/auth` v3

## [1.1.0] - 2026-10-18

### Security
- Deploys authenticate with Workload Identity Federation instead of a long-lived service-account key. The identity provider only accepts this repository (by ID) on `main`, and the workflow requests only `contents: read` and `id-token: write`
- Upgraded `firebase-admin` to 13 and patched vulnerable dependencies; production audit goes from 16 issues (1 critical, 4 high) to 9 moderate

### Added
- CI workflow that builds and runs the tests on pull requests to `main` and `develop`
- Apache 2.0 license

### Changed
- Cloud Functions runtime upgraded to Node.js 22 and `firebase-functions` to v7
- Live cleanup enabled (`DRY_RUN=false`) with explicit 256MiB memory
- `run-local.ts` reads the project ID from `FIREBASE_PROJECT_ID`, `GOOGLE_CLOUD_PROJECT` or `.firebaserc` instead of hardcoding it
- README updated for Node 22, project setup, CI and the new deploy authentication, and links to the frontend repo

### Fixed
- Flaky threshold boundary test in `users.test.ts`; the test now freezes `Date` so the test data and the threshold read the same instant

## [1.0.0] - 2026-06-20

### Added
- Scheduled Firebase Cloud Function (`cleanupStaleData`) running daily at 2am UTC
- `users.ts` — identifies stale anonymous Firebase Auth users; uses `lastJoinedAt` from Firestore player docs as the primary staleness signal rather than Auth `lastSignInTime` (which reflects account creation, not subsequent visits)
- `players.ts` — identifies stale Firestore `players` documents; full collection scan to catch both explicit `null` and absent `currentRoom` fields (Firestore `== null` filter silently omits docs where the field was never written)
- `rooms.ts` — identifies stale Firestore `rooms` documents; checks both `players` and `spectators` arrays; falls back to `createdAt` for rooms predating the `lastActivity` field; filters out legacy `"anonymous"` placeholder strings that predate real UID tracking
- `cleanup.ts` — orchestrator running collection and deletion phases in dependency-safe order with phase gating: Phase 4c (player doc deletion) skipped if Phase 4a (room patching) fails to prevent dangling room references; Phase 4d (auth deletion) skipped if Phase 4c fails to prevent orphan player docs
- `config.ts` — all thresholds and feature flags read from environment variables with `parseIntEnv` helper guarding against blank values producing `NaN`
- `run-local.ts` — local dry-run script with human-readable output: shows username alongside each UID, separates stale-with-doc users from orphan users, supports per-room inspection via CLI argument
- Orphan user detection — anonymous users with no player doc use a shorter `ORPHAN_USER_STALE_DAYS` threshold against Auth `lastSignInTime`
- Phase 1 failure gate — room cleanup skipped if auth user collection fails to avoid running with an empty `allAnonUids` set
- Independent enable/disable toggles per cleanup phase (`ENABLE_USER_CLEANUP`, `ENABLE_PLAYER_CLEANUP`, `ENABLE_ROOM_CLEANUP`)
- Firestore batch writes chunked at 500 operations and Firebase Auth batch deletes chunked at 1000 UIDs to respect API limits
- Unit test suite (Jest + ts-jest) with 37 tests covering all collectors and the orchestrator; mocks Firebase Admin SDK
- GitHub Actions workflow for automated build and deployment to Firebase on push to `main`; service account key passed via masked environment variable
- Structured JSON summary log emitted at the end of each run
