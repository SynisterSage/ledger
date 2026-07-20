# Figma embed surface rollout

Phase 4 extracts the Notes Figma embed into `src/components/ExternalEmbeds/ExternalEmbedNode.tsx`.
The node keeps the Phase 3 `figma-embed` serialization name for backward compatibility, while its
provider context and preview/link operations are target-aware (`note` or `meetingNote`).

Notes is currently the only Ledger surface with the stable Lexical rich-text editor required for
the embed block. Meeting notes that are stored as Notes use the same editor and can identify their
relationship as `meetingNote` from the note source. Tasks, Projects, and Intake currently persist
descriptions as plain text or textarea values; they are intentionally not enabled until those
surfaces adopt a compatible rich-text serialization and save lifecycle. This avoids introducing
raw HTML or a second Figma-specific editor path and leaves their existing behavior unchanged.

The backend preview routes accept a generic `{ target_type, target_id }` context and revalidate the
target at every read/write boundary. Saved previews remain reference-scoped and reusable across
targets; refresh is still explicit and server-side.
