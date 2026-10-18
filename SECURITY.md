# Security Policy

## Reporting a vulnerability

Please report security issues privately through GitHub's
[private vulnerability reporting](https://github.com/AaronStahley/scrum-poker-cleanup/security/advisories/new),
not in a public issue or pull request.

Include what you found, how to reproduce it, and what an attacker could do with it.
This is a personal project, so responses are best effort; you can expect an
acknowledgement within a week.

## Supported versions

Only the latest release on `main`, which is what's deployed, receives fixes.

## Scope

In scope:
- The Cloud Function code in `functions/src/`
- The GitHub Actions workflows in `.github/workflows/`, including the deploy's
  Workload Identity Federation setup

Out of scope:
- The Firebase project ID in `.firebaserc` and the cleanup thresholds in
  `functions/.env`. They aren't secrets
- Issues in Firebase, Google Cloud or GitHub themselves; report those to the provider

For the web app and its Firestore security rules, see
[scrum-poker-frontend](https://github.com/AaronStahley/scrum-poker-frontend/security/policy).
