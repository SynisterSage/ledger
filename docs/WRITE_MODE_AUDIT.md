# Write mode editor audit

Phase 1 scope: document the existing Write mode foundation without changing
the user-facing editor, persistence format, or available actions.

## Existing features

- Rich text editing backed by Lexical.
- Paragraphs, H1/H2/H3 headings, quotes, bold, italic, underline, inline code,
  ordered and unordered lists, links, automatic URL linking, Markdown shortcuts,
  tab indentation, undo, redo, and select all.
- Pasted/dropped images uploaded to the `note-images` Supabase Storage bucket,
  then represented in the document by a custom image node.
- Pasted Figma and supported external URLs can create linked external references
  and embeds.
- Smart dates and smart people are represented as custom semantic nodes in
  ordinary notes.
- Selection context-menu actions can create tasks, reminders, and events, send
  content to Intake, link projects or people, search selected text, and perform
  normal clipboard/editing actions.
- Auto-correct can replace the current note title/content through the existing
  NotesWindow flow.
- Meeting notes reuse the Write editor for manually written notes, but disable
  smart date/person transformations while transcript content remains separate.

## Custom nodes

- `ImageNode`: stable image metadata and storage-backed rendering.
- `SmartDateNode`: Ledger date semantics and date popover behavior.
- `SmartPersonNode`: Ledger person semantics and person actions.
- `ExternalEmbedNode`: linked external reference/embed metadata.
- Lexical-provided rich-text, link, list, code, heading, quote, and horizontal
  rule nodes.

## Plugin groups

### Core editor behavior

`LoadHtmlPlugin`, `RichTextBehaviorPlugin`, `HistoryPlugin`, `OnChangePlugin`,
`LinkPlugin`, `AutoLinkPlugin`, `MarkdownShortcutPlugin`, `TabIndentationPlugin`,
`ListPlugin`, and link interaction handling.

### Formatting

`ToolbarPlugin` owns formatting commands and active selection state.

### Semantic behavior

`SmartDatePlugin`, `SmartPersonPlugin`, and `LinkScanPlugin`.

### Media and embeds

`ImagePasteDropPlugin`, `ResizableImagePlugin`, `ImageCopyPlugin`, and
`FigmaPastePlugin`.

### Ledger actions

`EditorContextMenuPlugin` detects selection/context and emits typed
`SelectedContentPayload` callbacks. NotesWindow owns the resulting modal/API
actions.

## Persistence and lifecycle

1. NotesWindow hydrates a selected note into draft state.
2. `editorKey` identifies the selected note/editor lifecycle.
3. LoadHtmlPlugin converts `content_html` into Lexical nodes.
4. Lexical changes are serialized back to HTML and passed to NotesWindow.
5. NotesWindow marks the draft dirty and autosaves after its existing delay.
6. Autosave uses `content_html`, preserves `mode`/mind-map data, checks the
   current note and hydration identity, detects remote updates, and creates
   revision checkpoints.

## Phase 2 additions

- Native checklist lists and table nodes from Lexical.
- Persisted toggle and callout element nodes with HTML import/export.
- Storage-backed file attachment nodes with parent-owned upload flow.
- A compact Insert menu for the Phase 2 blocks.

## Phase 3 additions

- `SlashCommandPlugin` owns searchable slash insertion, aliases, keyboard
  navigation, and the remaining checklist shortcut.
- `BlockHandlePlugin` owns subtle top-level handles, block menus, and
  undoable vertical drag reordering.
- `MarkdownShortcutPlugin` remains the source of truth for standard heading,
  list, quote, and code shortcuts; Phase 3 only fills the custom checklist
  path and keeps divider behavior in the editor layer.

## Phase 4 additions

- The persistent toolbar keeps document-level style, list, checklist, undo,
  redo, insert, and secondary actions only.
- `SelectionFormattingPlugin` owns selection-aware inline formatting, link
  editing, restrained color/highlight styles, paste-to-link, and clear
  formatting.
- `BlockHandlePlugin` remains the owner of block-level actions so inline and
  structural menus do not overlap.

## Phase 5 additions

- `WriteActionPayload` is the shared serializable boundary for selection and
  block actions, including the originating note, block key, source kind, and
  semantic Smart Date nodes.
- Selection and block Ledger menus route task, reminder, event, Intake, and
  context-link actions through RichTextEditor callbacks into NotesWindow.
- Existing NotesSelectionComposerModal, Intake creation, project linking, and
  person linking remain parent-owned; editor plugins do not call APIs.

## Planned later phases

- Block-level Ledger references and richer inline actions.
- More deliberate document schema/versioning if HTML is no longer sufficient.

These are intentionally not part of Phase 1.

## Duplicate or conflicting logic

- Selected text was previously passed as raw strings across several callbacks;
  Phase 1 standardizes the boundary without changing action behavior.
- Lexical plugin code and editor composition currently live in one large file;
  Phase 1 adds a shared editor types/utilities boundary but does not perform a
  risky wholesale plugin split.
- NotesWindow owns both draft hydration and autosave, which is correct for the
  current architecture but makes note-switch lifecycle checks sensitive.

## Risky areas

- Loading HTML is a programmatic Lexical update and must not become a user edit.
- Smart date/person scanners perform programmatic updates and must remain
  excluded from the normal autosave change path.
- The old editor can emit a final change during unmount; selected-note and
  hydration identity checks must remain in place.
- Async image and external-reference work must not persist temporary data URLs
  or save into a different note after navigation.
- Meeting transcripts are separate records and must not be transformed through
  the Write editor's semantic scanners.
- Any custom node added later needs stable HTML import/export behavior or an
  explicit migration strategy.
