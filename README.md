# Internal Tools Platform (prototype)

A code-first replacement for the Microsoft Power Apps setup our ops, compliance, and support teams use today. Power Apps gives us a shared platform layer (identity and roles, an audit trail, approvals, data access), and we want 10+ more internal apps on top of it. This repo builds that layer **once, in code, with tests that enforce it**, and puts two real apps on it: a **Refunds dashboard** with maker-checker approvals and a **KYC review queue** with a server-enforced state machine and PII masking. New apps follow [`docs/NEW_APP_PLAYBOOK.md`](docs/NEW_APP_PLAYBOOK.md), and CI guardrails fail any API route that skips authorization or auditing.

## Run it

Requires Node 20+.

```bash
npm install && npm run db:seed && npm run dev
```

Open http://localhost:3000 and pick a user from the **Signed in as** switcher in the header.

`npm run db:seed` deletes `prisma/dev.db`, applies the migrations, and loads fake data. Re-run it at any time to start fresh.

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run db:seed` | Reset the SQLite DB and seed it |
| `npm test` | Vitest: unit, route, and guardrail tests (uses a separate `prisma/test.db`) |
| `npm run lint` / `npm run typecheck` | ESLint / `tsc --noEmit` |

## Seeded users

| User | Roles | Try this |
| --- | --- | --- |
| Alice Chen | reviewer | Request refunds, claim and work KYC cases. Sees masked SSNs. |
| Bob Martinez | reviewer | A second maker. |
| Carol Okafor | approver | Approve or reject $500+ refunds, resolve escalated KYC cases. Sees full SSNs. |
| Dave Singh | approver | A second checker. |
| Frank Weber | reviewer, approver | Request a $600 refund, then see that you **cannot** approve it yourself. |
| Erin Park | admin | The `/audit` page. Admin is *not* a superuser, so Erin sees masked PII and can't approve. |

**Acceptance walkthrough:** as Frank, request a $600 refund. Click Approve and you get a maker-checker error. Switch to Carol, approve it, and it executes. Switch to Erin and open `/audit` to see `refund.requested`, `approval.requested`, `approval.approved`, and `refund.executed`. On `/apps/kyc`, Alice sees `•••-••-1234` and Carol sees the full SSN.

## Architecture

```
lib/platform/        PLATFORM CORE: built once, apps never modify it
  auth.ts            mock identity: user id in a cookie -> CurrentUser {id, roles}
  rbac.ts            requireRole(user, roles[]): the single authorization gate
  audit.ts           audit(): append-only AuditLog writes (no update/delete API)
  approvals.ts       generic maker-checker: createApprovalRequest / decideApproval
  http.ts, errors.ts route() wrapper, typed HTTP errors, zod body parsing
  page.ts, apps.ts   page access check, AppManifest type
lib/integrations/    stubbed external clients (payments.ts, kyc.ts)
lib/apps/<id>/       APP CODE: service.ts (logic), manifest.ts (nav + approval handlers)
lib/apps/registry.ts the one place apps are registered (nav, home, approval routing)
app/api/...          thin route handlers: requireRole -> validate -> $transaction(service + audit)
app/apps/<id>/       app pages (server components; masking happens before render)
app/audit, app/approvals   platform pages
tests/               Vitest, incl. guardrails.test.ts
```

**Platform core vs apps.** The platform owns the cross-cutting concerns that Power Apps gave us implicitly: who you are, what you may do, what happened, and who signed off. Apps own their data model and business rules, and plug into the platform through three seams:

1. `requireRole()` + `audit()` called from their route handlers.
2. `createApprovalRequest()` plus an `ApprovalHandler` registered in their manifest. The platform enforces *approver ≠ requester*, the approver role, and decide-exactly-once. The app only says what happens on approve or reject. One `/api/approvals/:id` endpoint and one `/approvals` inbox serve every app.
3. An `AppManifest` entry in `lib/apps/registry.ts`, which drives the left nav and home page.

**How the rules are enforced:**

- `tests/guardrails.test.ts` parses every `app/**/route.ts` with the TypeScript compiler API. It fails if any handler doesn't call `requireRole` first, if any write handler doesn't call `audit()`, if those functions aren't imported from the platform, or if any Server Action (`"use server"`) exists, since Server Actions would bypass the routes. It includes negative-control fixtures so the analyzer itself is tested.
- AuditLog is append-only in two layers: the module has no update/delete functions, and SQLite triggers (in the init migration) reject `UPDATE`/`DELETE`. `tests/audit.test.ts` proves both, and also scans the source for any mutating `auditLog.*` call.
- Writes and their audit entries happen in the same DB transaction, so an action can't succeed without being audited.
- KYC transitions come from an explicit table and are checked on the server, with conditional updates to prevent races. PII is masked in `lib/apps/kyc/present.ts` before data leaves the service, and audit snapshots exclude PII.

## Known gaps vs production

- **Real SSO.** Auth is a cookie holding a user id that anyone can set. Replace it with OIDC/SAML (Okta/Entra ID), signed sessions, group-to-role mapping, MFA, and session expiry. `getUserFromRequest` / `getCurrentUser` are the only functions that need to change.
- **Immutable / WORM audit storage.** SQLite triggers stop the app from tampering, but not a DB admin or someone with file access. In production: stream audit events to WORM storage (S3 Object Lock / a ledger DB), hash-chain the entries, set retention policies, and alert on gaps.
- **Real integrations.** `lib/integrations/payments.ts` and `kyc.ts` are in-memory stubs that always succeed. Real clients need retries, timeouts, webhooks/reconciliation, and an outbox pattern so external calls aren't made inside DB transactions.
- **Deployment.** SQLite and `next dev` only. Production needs Postgres, migrations in CI/CD, environments, backups, observability (logs/metrics/tracing), and rate limiting.
- **Secrets management.** None needed yet. `.env` holds only a local SQLite path. Real API keys must come from a secrets manager (AWS Secrets Manager / Vault), never from the repo.
- Also: no CSRF tokens beyond `SameSite=Lax` cookies, no pagination, no field-level access logging (who viewed unmasked PII), and PII is stored in plaintext rather than with field-level encryption or tokenization.
