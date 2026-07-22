# GitHub Phase 3.8 manual QA

This checklist validates the read-only GitHub workflow in a real Ledger workspace. Use a disposable GitHub account and repositories where possible. Record the Ledger workspace, GitHub account, repository selection mode, delivery ID, and UTC time for each test. Never paste tokens, private keys, webhook signatures, or full provider payloads into a ticket.

## Before testing

1. Apply migrations 095 through 102 in order.
2. Confirm the backend has `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_WEBHOOK_SECRET`, and `GITHUB_API_VERSION` configured.
3. Confirm the App has only read permissions for Metadata, Issues, Pull requests, Checks, and Commit statuses.
4. Confirm the App subscribes to Installation, Installation repositories, Issues, Pull request, Pull request review, Check run, Check suite, Status, and Repository.
5. Open browser developer tools and verify no response contains an installation token or credential.

## Connection and health

1. In a personal workspace, connect GitHub as the owner. Install once for a personal account and once for an organization where available. Verify the compact Settings → Integrations row shows the account, repository count, selection mode, and a successful-sync time.
2. In a team workspace, repeat as owner and admin. Verify members and viewers can see status and approved repositories but cannot connect, refresh, disconnect, or edit capture rules.
3. Test both All repositories and Selected repositories. Add a repository to selected access in GitHub, refresh Ledger, and verify it appears only after access is granted.
4. Use Refresh access. Verify repository metadata and last-sync time update without any token being persisted.
5. Suspend the GitHub App installation. Verify Ledger shows Suspended, keeps safe metadata, and does not process item events. Unsuspend and refresh; verify the connection recovers.
6. Delete the installation from GitHub, verify Ledger shows the unavailable/disconnected state, then reconnect and verify approved access can be restored.
7. Disconnect from Ledger. Verify the Ledger association and local repository metadata are removed, GitHub is not uninstalled, and reconnect works.

## Repository lifecycle

For a synchronized repository, create/access it as supported by the installation and verify one bounded notification where the rule is enabled. Rename, transfer, archive, unarchive, delete, remove access, and restore access. Verify immutable repository identity preserves links, names and canonical URLs update, archived repositories remain visible but cannot be newly linked, deleted/access-removed repositories preserve last safe metadata and show unavailable state, and restoration resolves the warning.

## Issues

1. Enable an issue-opened capture rule for one approved repository and leave another approved repository unselected.
2. Open an issue, assign it, add/remove a label, edit its title, reopen it, and close it. Verify only configured events notify/capture, label filters work, retries do not duplicate Intake items, and an unapproved public repository never appears.
3. Convert the captured issue to a task. Attach the task to a project and link the repository as primary. Verify the same GitHub reference appears in Intake provenance, Task Linked work, Project Development, Notes when attached, search, and Quick capture.
4. Close and reopen the issue from GitHub. Verify the linked metadata and task mismatch attention update and resolve without changing the Ledger task automatically.

## Pull requests

Open a PR, mark it draft, make it ready, request a review, submit approval and changes requested, run pending/failing/passing checks, close without merge, reopen, and merge. Verify compact cards show the current state, review summary, and checks summary. Verify only meaningful review/check/merge/closed events notify or create attention; no Intake item is created unless a capture rule explicitly enables it.

## Notes, project, task, Intake, and search

1. Paste canonical repository, issue, and PR URLs into a note and Quick capture. Verify plain-text paste is never blocked, approved URLs resolve to compact embeds, unsupported URLs remain links, and refresh/open/remove actions work.
2. Use the shared resource picker from a note, project, task, and Intake item. Verify it searches synchronized approved repositories only, supports repository/issue/PR filters, keyboard navigation, Escape, and duplicate-link prevention.
3. From a GitHub card choose Create Ledger task. Verify the existing task flow is prefilled, active duplicate tasks are detected, creating another task requires explicit confirmation, and no GitHub write occurs.
4. Attach a captured Intake reference to an existing project without converting it. Convert the Intake item to task, note, and project in separate tests and verify the existing reference is preserved exactly once.
5. Search Ledger for repository names, issue/PR numbers and titles. Verify results stay inside the active workspace and normal search does not call GitHub.
6. Verify Overview shows only linked-work attention and normal Ledger tasks; it must not show a repository-wide activity feed or call GitHub directly.

## Notifications and permissions

Verify in-app notifications and desktop/push delivery where enabled. Test correct workspace routing, task/project/Intake deep links, GitHub secondary links, delivery preferences, retry deduplication, check-suite/check-run deduplication, and no notification to a removed workspace member. Repeat as owner, admin, member, viewer, a user without project access, and a user without note edit access.

## Failure and retry tests

Using mocked or controlled provider responses, test GitHub 403, 404, 429, timeout, token-generation failure, partial repository sync, temporary Supabase failure, malformed payload, invalid/missing signature, duplicate delivery, out-of-order delivery, and unknown action. Existing safe metadata must remain visible; retries must be bounded and idempotent; no transient error may silently disconnect a workspace.

## Release evidence

Attach screenshots of connected, syncing, delayed, suspended, and action-required Settings states; counts of webhook deliveries and duplicate deliveries; one issue-to-task conversion; one project repository link; one notification deep link; and the command results listed in `GITHUB_RELEASE_CHECKLIST.md`.
