# Preparing a public release

## Prefer a fresh repository

Older commits can contain former operator details even after the working tree is cleaned. Commit author and committer names/emails are public too. Keep the deployed private repository intact and publish a reviewed source snapshot in a new repository with new history.

1. Choose a license and add its full text as `LICENSE` before publishing. Public visibility alone is not an open-source license. Use a copyright attribution you are comfortable publishing.
2. Review the files, documentation, screenshots, test fixtures, package metadata, and all commit messages. Search for personal names, usernames, email addresses, account IDs, deployment URLs, reel URLs, tokens, and passwords. Inspect Git author/committer metadata and every branch/tag if retaining history. A secret scanner complements manual review; neither guarantees anonymity.
3. Export only approved source files, without `.git`, `.env*` except `.env.example`, `LOCAL_ACCESS.md`, databases, logs, generated test artifacts, dependencies, or hosting account metadata. Do not zip the entire working directory. Do not use a GitHub fork if the goal is to discard private history.
4. Run setup and tests in that fresh directory. It must generate its own password and secrets and start with an empty database. Remove generated runtime files from any release archive.
5. Initialize a new Git repository in the clean directory. Set its local `user.name` and `user.email` to the intended public identity before the first commit. A GitHub noreply address hides your email, but the GitHub account/organization publishing the repository remains visible. Existing signed commits may also identify their signer.
6. Create the new remote initially private, inspect its full file list and first commit, then publish it when ready. Do not copy old branches, tags, issues, Actions logs, releases, or deployment settings without reviewing them.

If a real credential was ever committed, rotate/revoke it even if the affected history is discarded. `.gitignore` does not untrack an existing file or erase history.

## Separate source releases from the running service

Publishing code does not require publishing a database or opening the admin interface. Do not put real passwords in examples or distribute the maintainer's Meta app/token. Each installation must create its own credentials and authorize its own Instagram account.

Before deploying the configurable privacy pages to an existing service, set `PRIVACY_CONTACT` and `PRIVACY_PROVIDERS` to the service's actual public information. Review the policy text against actual operations and retention. Shipping the template is not a claim of legal compliance or Meta approval.

## Release checks

- An explicit license is present.
- A clean install passes `npm run check` and `npm test`.
- The README describes a fresh installation and clearly distinguishes migration.
- Docker/Vercel instructions identify the required external services and manual Meta steps.
- Secrets, live account data, personal references, and unintended commit attribution are absent from the release.
- Report which deployment paths were actually tested; do not imply a cloud deployment was tested by local checks.
