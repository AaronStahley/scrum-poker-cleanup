# scrum-poker-cleanup

Firebase scheduled Cloud Function that sweeps Firestore and Firebase Auth on a daily schedule to delete stale anonymous users, orphaned player documents, and inactive rooms.

## Overview

Anonymous users accumulate in Firebase Auth and Firestore indefinitely without any expiry mechanism. This service runs once daily at 2am UTC to identify and delete stale data, keeping the database clean and costs predictable.

All thresholds are configurable via environment variables. The service defaults to **dry-run mode** — it will log what it would delete without actually deleting anything until `DRY_RUN=false` is explicitly set.

## What Gets Cleaned Up

| Entity | Deleted When | Protected If |
|---|---|---|
| Firebase Auth anonymous user (with player doc) | `lastJoinedAt` in Firestore > `USER_STALE_DAYS` | Account was upgraded to a named provider |
| Firebase Auth anonymous user (no player doc) | Auth `lastSignInTime` > `ORPHAN_USER_STALE_DAYS` | Created recently |
| Firestore `players` document | `lastJoinedAt` > `PLAYER_STALE_DAYS` and not in a room | Player is currently in a room |
| Firestore `rooms` document | `lastActivity` > `ROOM_STALE_DAYS` | Contains any active named (non-anonymous) player |
| Empty room (0 members) | Older than `EMPTY_ROOM_STALE_DAYS` | — |

## Prerequisites

- Firebase project on the **Blaze (pay-as-you-go) plan** — required for Cloud Functions.
- Node.js 22 (matches the Cloud Functions runtime in `functions/package.json`)

## Setup

### 1. Link your Firebase project

`.firebaserc` points at the maintainer's project (`thescrumpoker`). To deploy to your own project, switch to it:

```bash
firebase use <your-firebase-project-id>
```

### 2. Install dependencies

```bash
cd functions && npm install
```

### 3. Configure local environment

Copy or edit `functions/.env.local` (already present, gitignored) and adjust thresholds as needed. `DRY_RUN=true` is the default.

## Configuration

All configuration is read from environment variables. For local runs use `functions/.env.local`. For the deployed function, place a `functions/.env` file alongside the source before deploying — Firebase Functions v2 picks it up automatically.

| Variable | Default | Description |
|---|---|---|
| `DRY_RUN` | `true` | Log what would be deleted without deleting anything |
| `USER_STALE_DAYS` | `30` | Days since `lastJoinedAt` before an anonymous user (with a player doc) is eligible |
| `ORPHAN_USER_STALE_DAYS` | `7` | Days since last sign-in before an anonymous user with no player doc is eligible |
| `PLAYER_STALE_DAYS` | `30` | Days since `lastJoinedAt` before a player doc is eligible |
| `ROOM_STALE_DAYS` | `7` | Days since `lastActivity` before a room is eligible |
| `EMPTY_ROOM_STALE_DAYS` | `1` | Days before an empty room (0 members) is eligible |
| `ENABLE_USER_CLEANUP` | `true` | Toggle anonymous auth user deletion |
| `ENABLE_PLAYER_CLEANUP` | `true` | Toggle Firestore player doc deletion |
| `ENABLE_ROOM_CLEANUP` | `true` | Toggle Firestore room deletion |

## Local Dry Run

Run against the live Firebase project without deleting anything:

```bash
cd functions
npm run run:local
```

Requires a Google service account key with Firestore and Auth access. Set the path via:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
```

The script uses the project from `FIREBASE_PROJECT_ID` if set, otherwise the default project in `.firebaserc`.

Pass a room ID as an argument to inspect its members alongside the run:

```bash
npm run run:local -- <room-id>
```

## Deployment

### Manual deploy

```bash
cd functions && npm run build
firebase deploy --only functions
```

### Via GitHub Actions

Push to `main` — the workflow in `.github/workflows/deploy.yml` handles the build and deploy automatically.

**Required GitHub Actions secret:**

| Secret | Description |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | Firebase service account JSON with `Cloud Datastore User` and `Firebase Authentication Admin` roles |

## Testing

```bash
cd functions && npm test
```

Pull requests to `main` and `develop` run the tests and build in `.github/workflows/ci.yml`.

## Log Output

Each run emits a structured JSON summary visible in Google Cloud Logging (Firebase Console → Functions → Logs):

```json
{
  "dryRun": false,
  "duration_ms": 1842,
  "staleAuthUsers": { "identified": 14, "deleted": 14, "errors": 0 },
  "stalePlayers": { "identified": 22, "deleted": 22, "errors": 0 },
  "staleRooms": { "identified": 8, "deleted": 8, "errors": 0 },
  "errors": []
}
```

## Rollout Guide

1. Deploy with `DRY_RUN=true` (the default)
2. Monitor the first few dry-run logs — validate the identified counts look reasonable
3. Set `DRY_RUN=false` in `functions/.env` and redeploy
4. Monitor the first live run log — confirm deletion counts and zero errors

## Project Structure

```
functions/src/
├── index.ts          — scheduled function entry point (2am UTC daily)
├── cleanup.ts        — orchestrator, runs phases in dependency-safe order
├── users.ts          — collect stale anonymous Firebase Auth users
├── players.ts        — collect stale Firestore player documents
├── rooms.ts          — collect stale Firestore room documents
├── config.ts         — environment variable config with defaults
├── run-local.ts      — local dry-run script with human-readable output
├── test-helpers.ts   — shared Jest test utilities
└── *.test.ts         — unit tests for each collector and the orchestrator
```

## Related Repositories

- [scrum-poker-frontend](https://github.com/AaronStahley/scrum-poker-frontend): the Next.js app whose rooms, players and anonymous users this function cleans up.

## License

Copyright 2026 Aaron Stahley. Licensed under the [Apache License 2.0](./LICENSE).
