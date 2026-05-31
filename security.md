## Ledger Security Audit — Fix Common Vibe-Coded Security Risks

Do a security-focused audit of the Ledger app.

Goal:
Find and fix common security flaws that happen in fast-built apps, especially around workspaces, shared notes, integrations, browser extension tokens, file uploads, Electron IPC, and Supabase/RLS.

Do not redesign UI.
Do not add new product features.
Focus on security, authorization, data integrity, and safe defaults.

---

## High-Priority Areas

Audit and fix these areas:

1. Workspace access checks
2. Supabase RLS policies
3. API route authorization
4. Service role / secret exposure
5. Integration webhook verification
6. Browser extension token security
7. Invite link security
8. Rich text / HTML sanitization
9. File upload/storage security
10. Electron IPC safety
11. Deep link validation
12. Stale shared-note overwrite protection
13. CORS configuration
14. Rate limiting for public endpoints
15. Safe error messages

---

## 1. Workspace Access Checks. (Done)

Every workspace-scoped object must verify the current user has access to its workspace.

Objects include:
- notes
- projects
- tasks
- events
- reminders
- inbox items
- notifications
- files/images
- workspace invites
- integrations
- browser extension captures

Do not trust workspace_id from the client.

For every route or IPC/API action:
- authenticate user
- resolve object by id
- verify object.workspace_id belongs to a workspace the user can access
- verify action permission if roles exist

Examples:
- user cannot update a note from a workspace they are not a member of
- user cannot create a task in a workspace they do not belong to
- user cannot read inbox items from another workspace
- user cannot convert/archive inbox items they do not have access to

Add helper functions if missing:
- requireAuth()
- requireWorkspaceMember(userId, workspaceId)
- requireObjectWorkspaceAccess(userId, objectType, objectId)

---

## 2. Supabase RLS (Done)

Audit Supabase RLS policies.

Make sure RLS is enabled for:
- workspaces
- workspace_members
- notes
- note_versions / note_revisions
- projects
- tasks
- events
- reminders
- inbox_items
- notification_events
- notification_preferences
- workspace_invites
- integration tables
- extension_tokens
- storage.objects if using Supabase Storage

Policies should not allow all authenticated users.

Policies should check workspace membership where relevant.

Bad:
USING (auth.uid() IS NOT NULL)

Good:
USING (
  EXISTS (
    SELECT 1 FROM workspace_members wm
    WHERE wm.workspace_id = table.workspace_id
    AND wm.user_id = auth.uid()
  )
)

For user-specific tables, ensure:
user_id = auth.uid()

---

## 3. API Route Authorization (Done)

Audit every backend API route.

For each route:
- verify auth
- verify workspace membership
- verify object ownership/access
- validate request body
- avoid trusting client IDs

Especially check:
- PATCH/DELETE routes
- conversion endpoints
- invite accept endpoints
- Slack integration routes
- browser extension endpoints
- notification preference updates
- file/image upload endpoints

Do not only protect GET routes.
Mutations are often the riskiest.

---

## 4. Secret Exposure (Done)

Search for exposed secrets.

Look for:
- SUPABASE_SERVICE_ROLE_KEY
- SLACK_CLIENT_SECRET
- SLACK_SIGNING_SECRET
- ZOOM_CLIENT_SECRET
- extension token secrets
- API keys
- private webhook secrets
- tokens in VITE_ env vars
- secrets in renderer/client code
- secrets in browser extension code

Rules:
- service role key only on backend
- Slack/Zoom client secrets only on backend
- signing secrets only on backend
- browser extension must never contain private backend secrets
- VITE_ env vars must only contain public values

If any secret was exposed, rotate it and update env vars.

---

## 5. Integration Webhook Verification

Audit integration endpoints.

Slack:
- verify Slack signing secret
- check timestamp replay window
- reject invalid signatures
- return 200 quickly after validation
- do not trust payloads without verification

Future integrations:
- Zoom webhooks must verify Zoom signature/secret
- GitHub webhooks must verify HMAC signature
- browser extension captures must verify extension token

Do not use deprecated Slack verification token as the main security method.

---

## 6. Browser Extension Token Security

Audit browser extension token system.

Requirements:
- raw token shown only once
- store token hash in database, not raw token
- token can be revoked
- token can be regenerated
- last_used_at updates
- token maps to a specific user
- token may have default workspace_id
- backend validates workspace access on every capture
- backend does not trust workspace_id sent by extension
- payload size limits exist
- title/body/source_url length limits exist

If extension token is missing or revoked:
- reject with 401
- do not create inbox item

Suggested limits:
- title max 300 chars
- body max 20,000 chars
- source_url max 2,000 chars

---

## 7. Invite Link Security

Audit workspace invites.

Requirements:
- invite tokens are random and unguessable
- invite tokens expire
- invites can be revoked
- accepted_at / accepted_by are tracked if supported
- invite cannot be reused if single-use
- invite belongs to a specific workspace
- accepting invite verifies the token
- accepting invite adds authenticated user only after validation
- invite link generation uses stable production base URL:
  https://ledgerworkspace.com/invite/{token}
- production should not use window.location.origin for invite links

Verify live table is:
workspace_invites

Do not accidentally use legacy:
workspace_invitations

---

## 8. Rich Text / HTML Sanitization

Audit Notes and Inbox rendering.

Risk:
User-provided text/HTML can become XSS.

Check:
- Lexical content rendering
- content_html rendering
- pasted rich text
- Slack message text
- browser selected text
- future email/Zoom content
- note image HTML
- exported/imported HTML

Requirements:
- sanitize HTML before rendering with dangerouslySetInnerHTML
- strip script tags
- strip event handlers like onclick/onerror
- block javascript: URLs
- allow only safe tags/attributes
- render integration text as plain text unless intentionally sanitized

If possible, use a trusted sanitizer like DOMPurify in renderer for display and backend sanitization where appropriate.

---

## 9. File Upload / Storage Security

Audit image paste/drop and storage.

Requirements:
- allowed MIME types only:
  image/png
  image/jpeg
  image/jpg
  image/webp
  image/gif
- max file size enforced client-side and server-side if possible
- file path is workspace/note scoped:
  workspaces/{workspaceId}/notes/{noteId}/images/{imageId}.{ext}
- user must be workspace member before upload
- do not allow arbitrary file names/path traversal
- do not store base64 images in note HTML
- avoid public buckets for production workspace notes
- use private bucket + signed URLs when ready
- storage policies check workspace membership

If bucket is public for MVP, add explicit TODO and production warning.

---

## 10. Electron IPC Safety

Audit Electron IPC handlers.

Common risks:
- overly broad IPC channels
- renderer can call powerful main-process functions
- no payload validation
- file paths not validated
- arbitrary URLs opened
- arbitrary shell commands
- unsafe window bounds
- unsafe deep links

Requirements:
- contextIsolation true
- nodeIntegration false
- no enableRemoteModule
- narrow preload bridge
- validate every IPC payload
- allowlist IPC channel names/actions
- validate URLs before shell.openExternal
- do not allow arbitrary command execution
- do not expose filesystem unless absolutely needed
- validate window bounds for move/resize actions
- validate module names before opening popouts

---

## 11. Deep Link Validation

Audit ledger:// deep links.

Requirements:
- allowlist deep link actions
- validate token/id formats
- require auth before accepting workspace invite
- do not execute commands from deep links
- do not open arbitrary local files
- do not blindly redirect to external URLs
- sanitize/validate all URL params

Valid actions might include:
- ledger://invite/{token}
- ledger://open/inbox
- ledger://open/notifications
- ledger://open/workspace/{id}

Anything else should be rejected.

---

## 12. Shared Notes Stale Save Protection

Audit shared note autosave.

Current risk:
Two users can edit same note. One user may overwrite the other with stale content.

Requirements:
- notes have updated_at or version
- client sends last_known_updated_at or last_known_version when saving
- backend rejects stale updates with 409 Conflict
- client shows “New version available” toast when remote update arrives
- client does not silently overwrite newer server content
- version history captures meaningful revisions

Do not build full collaborative editing yet.
Just prevent silent overwrites.

---

## 13. CORS

Audit backend CORS config.

Allowed origins should be explicit.

Allow:
- https://ledgerworkspace.com
- https://www.ledgerworkspace.com
- local dev origins intentionally
- desktop app origin if applicable

Avoid:
Access-Control-Allow-Origin: *
with credentials.

Do not accidentally allow all origins on authenticated routes.

---

## 14. Rate Limiting

Add basic rate limiting to public/sensitive endpoints.

Prioritize:
- auth/login/signup if backend-controlled
- invite accept/verify
- browser extension capture endpoint
- Slack/Zoom webhook endpoints
- token generation/regeneration
- file upload endpoints
- notification endpoints if publicly callable

Use reasonable limits and clean error:
Too many requests. Try again soon.

Do not break local development.

---

## 15. Safe Error Messages

Audit error responses.

Do not expose:
- stack traces
- SQL errors
- Supabase internals
- token hashes
- secrets
- full webhook payloads
- whether private resources exist

Use clean client messages:
- Not authorized.
- Invalid or expired invite.
- Could not save capture.
- Could not load note.

Log detailed errors server-side only.

---

## 16. Audit Checklist Output

After audit, provide a concise report:

For each issue found:
- severity: high / medium / low
- file(s)
- risk
- fix made
- remaining TODO if any

Do not just say “looks good.”
Actually inspect and verify.

---

## Acceptance Criteria

This pass is successful if:

- workspace-scoped routes verify membership
- Supabase RLS is enabled and not overly permissive
- no secrets are exposed in client/renderer/extension
- Slack requests verify signatures
- extension tokens are hashed/revocable
- invite links are secure and stable
- rich text rendering is sanitized
- file uploads are constrained and workspace-scoped
- Electron IPC is narrowed/validated
- deep links are allowlisted/validated
- shared notes cannot silently overwrite newer versions
- CORS is not overly permissive
- sensitive endpoints have basic rate limits
- error messages do not leak internals

---

## Out of Scope

Do not:
- redesign UI
- add AI security features
- build a permission management admin panel
- rewrite the whole backend
- migrate the whole app architecture
- add enterprise SSO
- build full collaborative editing

Focus on practical security hardening for Ledger’s current app.