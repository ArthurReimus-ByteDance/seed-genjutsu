# Future database and authentication

Decision recorded on 2026-11-05: Seed Genjutsu is a local, single-user studio. Keep it account-free and database-free until the product needs shared or remotely hosted workspaces.

## Current boundary

The Next.js web server and a separate Node worker share MEDIA_ROOT/workspace.json and local media. JsonFileStore validates state, holds an inter-process lock and publishes synced atomic writes. Jobs retain provider IDs, approval, cancellation, events and submission markers. Native BytePlus TOS remains available for provider-readable media; it does not require a metadata database.

The local API has no identity or session abstraction. It accepts requests on loopback and rejects foreign origins, cross-site requests and foreign Host headers. Those request checks support local use and do not establish user identity.

## When to add these systems

Add authentication before allowing other people or network clients to access uploads or paid generation. Add a database when introducing multiple users/workspaces, multiple hosts/workers, concurrent editing, or a library large enough that full JSON-index writes become inconvenient. Revisit both together before deploying a shared service.

Do not provision a database, choose an auth vendor, or retain a dormant account system for the current local mode.

## Repository boundary

Preserve the public upload/job DTOs and UUIDs so the studio components and TanStack cache do not need a broad rewrite. Extract storage operations behind an explicit repository interface when a second implementation is actually needed:

```ts
interface WorkspaceRepository {
  listJobs(workspaceId: string): Promise<Job[]>;
  getJob(workspaceId: string, jobId: string): Promise<Job>;
  createJob(workspaceId: string, input: CreateJob): Promise<Job>;
  approveJob(workspaceId: string, jobId: string): Promise<Job>;
  cancelJob(workspaceId: string, jobId: string): Promise<Job>;
  claimJob(workerId: string): Promise<StoredJob | null>;
}
```

Uploads, media access and provider asset-group lookup need the same workspace scope. Resolve workspaceId from a server-verified session and membership, never a client-supplied owner field. Keep a file-backed implementation as an explicit local-mode adapter only if it remains useful.

## Suggested relational model

| Entity            | Important fields and constraints                                                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| users             | Stable id and profile; credentials or provider identities managed by the chosen auth library                                                         |
| sessions/accounts | Library-managed sessions, expiry, revocation and external identity bindings                                                                          |
| workspaces        | id, name, created_at, provider asset-group reference                                                                                                 |
| memberships       | workspace_id, user_id, role; unique membership                                                                                                       |
| uploads           | Existing UUID, workspace_id, kind, object key, MIME, dimensions, duration and poster reference                                                       |
| jobs              | Existing UUID, workspace_id, input references/config, status/stage, cancellation, provider IDs, submission marker, next-run time, lease owner/expiry |
| job_events        | job_id, ordered event id, stage, message, timestamp                                                                                                  |
| usage_limits      | Per-workspace counters with atomic reservations, if shared budgets are introduced                                                                    |

PostgreSQL is a reasonable later target. Use foreign keys and workspace-scoped indexes. Reserve generation capacity and insert the job/event in one transaction. Claim queued work atomically, for example with FOR UPDATE SKIP LOCKED and a lease update. Preserve the rule that an uncertain paid submission stops for inspection instead of being automatically retried.

Retain explicit reference approval. Put tenant ownership checks on source images, videos, prepared references, result delivery, approval and cancellation, not only the history list.

## Authentication

Select a maintained auth framework after deciding whether shared access needs email/password, passkeys or OAuth/SSO. Prefer the framework's session and credential handling over rebuilding the earlier custom password implementation. Record the selected framework and its boundaries in a new decision at that time.

Use opaque, revocable server sessions with HttpOnly cookies, Secure on HTTPS and an appropriate SameSite policy. Keep mutations protected against cross-site requests, require valid membership, and clear client queries during account/workspace changes. Decide invitation/registration policy, account recovery and administrative access before opening a shared service.

Keep Meta, ModelArk, Virtual Portrait and TOS secrets on the server. If credentials become tenant-specific, store references to encrypted secrets and audit their use. Avoid exposing provider keys or signed media URLs in client logs.

## Import the local workspace safely

1. Stop web and worker; back up the complete local directory and any TOS objects.
2. Read the versioned JSON index. Validate reference UUIDs, media availability, event ordering and provider identifiers before writing.
3. Assign the imported catalog to one explicit workspace and owner. Preserve UUIDs, timestamps, statuses and storage keys; map relationships transactionally.
4. Keep terminal jobs terminal. Put interrupted or unconfirmed submissions into needs_attention. Do not replay approved or partially submitted jobs during import.
5. Perform a dry run and compare job/media/event counts and file checksums. Import idempotently using stable UUIDs and a migration manifest.
6. Start the new worker only after validating membership, quotas, approval and provider-submission recovery in the new store.
7. Retain the local backup until the imported library is reviewed. Legacy PostgreSQL data from the first prototype requires a separate explicit import decision; it is not automatically combined with this JSON catalog.

## Acceptance checks before shared hosting

- Two users cannot read, download, approve, cancel or reference each other's workspace data.
- Sessions expire and revoke correctly; account/workspace switches do not retain another user's cached media.
- Concurrent creates obey capacity limits, and two workers cannot claim the same lease.
- A process restart preserves cancellation and uncertain-submission markers without duplicating paid tasks.
- The importer is repeatable, detects missing files and preserves UUIDs and relationships.
- The studio retains its upload, review, comparison and download flows on mobile.
- Real TOS and model calls are verified independently of the illustrative preview.

## Sources

- [Next.js route handlers](https://nextjs.org/docs/app/getting-started/route-handlers): the current HTTP boundary.
- [proper-lockfile](https://github.com/moxystudio/node-proper-lockfile): inter-process locking used by the current local store.
