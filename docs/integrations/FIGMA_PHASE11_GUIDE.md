# Figma integration: change awareness

Ledger stores Figma previews as historical snapshots. When Ledger confirms
that the source file has a newer version, it shows `Design updated` while
keeping the active preview unchanged.

Users can choose `Check for updates` from an embed or Linked designs menu, or
use the Ledger Figma plugin. A successful check reads Figma metadata through
Ledger’s connected workspace account; it does not upload an image or replace a
preview.

Choose `Refresh preview` only when the newer design should become the active
snapshot. The existing preview remains available if the refresh fails. Preview
sharing consent and the connected Figma account still apply.

Workspace administrators can open Settings → Integrations → Figma →
Automation to enable change checking, linked-work notifications, Intake
creation, or automatic preview refresh. Notifications, Intake creation, and
automatic refresh are off by default. Automatic refresh requires an explicit
confirmation and is not configurable from the plugin.

Disconnecting Figma preserves saved previews and relationships. Future checks
and refreshes stop until the connection is restored. Removing stored Figma data
also removes the associated change state and automation configuration.

The plugin stores only compact relationship identifiers in Figma private plugin
data. Source versions, statuses, preview images, titles, credentials, and
notifications remain canonical Ledger data.
