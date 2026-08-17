# Ledger Stage 1A — Context Contract

Status: architecture/specification only  
Scope: current Ledger repository; no implementation decisions are applied by this document

This contract defines how Ledger objects relate, which existing storage mechanism is authoritative, how backlinks are derived, and when provenance must be preserved.

The contract strengthens the existing architecture. It does not replace the current schema with a universal graph and does not make every object linkable to every other object.

## 1. Current relationship architecture

### 1.1 Workspace boundary

`workspace_id` is the security and visibility boundary for persistent product data. The backend resolves the active workspace and validates access before reading or mutating workspace records. Cross-workspace relationships are invalid even where the underlying tables could technically contain both IDs.

Workspace membership and teams are specialized structures:

- `workspaces`
- `workspace_members`
- `workspace_teams`
- `workspace_team_members`

People are users/members, not generic graph nodes. Team membership and assignment remain specialized relationships.

### 1.2 Structural Ledger objects

The current structural relationships are represented primarily by foreign keys:

- `projects.workspace_id`
- `tasks.workspace_id`, `tasks.project_id`, `tasks.assigned_to`
- `notes.workspace_id`, `notes.user_id`, `notes.parent_id`, `notes.section_id`
- `calendars.workspace_id`, `calendars.owner_id`
- `events.workspace_id`, `events.calendar_id`, `events.project_id`, `events.note_id`, and legacy `linked_project_id` / `linked_task_id`
- `reminders.workspace_id`, `reminders.calendar_id`, `reminders.project_id`, `reminders.note_id`
- `project_milestones.workspace_id`, `project_milestones.project_id`, and optional linked note/reminder/event IDs

These are not generic context links. They define ownership, containment, or a first-class product association and should remain authoritative.

### 1.3 Specialized join tables

The repository contains specialized joins for relationships with their own semantics:

- `project_note_links`: Project ↔ Note
- `note_person_links`: Note ↔ person
- `workspace_team_members`: Team ↔ person
- GitHub project/repository links: Project ↔ GitHub repository
- `meeting_note_metadata`: Meeting-note Note ↔ calendar identity/event
- `meeting_transcript_links`: transcript segment ↔ Ledger item
- Google Drive connected sources and source relationships: Project/source-folder context
- Slack context links and activity context links: Slack context/activity ↔ Ledger target

These tables should not be duplicated into `ledger_context_links` merely to make the data look uniform.

### 1.4 General internal context links

`ledger_context_links` currently supports these object types:

- `note`
- `project`
- `task`
- `event`
- `reminder`
- `intake`

It is appropriate for optional contextual relationships that are not structural and do not already have a better specialized authority. It is not currently the authority for Project ↔ Task, Project ↔ Note, Event ↔ Project, Event ↔ Note, or Reminder ↔ Project/Note where direct fields or specialized joins already exist.

The backend already reads this table from either endpoint and returns the other resource. That read behavior is the foundation for the canonical related-context read contract defined below.

### 1.5 External references

`external_references` stores a workspace-scoped provider identity, normalized URL, external type, metadata, access state, and timestamps. `external_reference_links` connects a reference to a supported Ledger target and records link sources such as:

- `manual`
- `embed`
- `conversion`
- `integration`

This remains the authority for external resource identity and external-resource ↔ Ledger-target relationships.

External references are distinct from internal context links because they have provider identity, access, refresh, preview, and change-awareness semantics.

### 1.6 Intake and provenance fields

`inbox_items` stores captured material and conversion state, including:

- `source`
- `source_id`
- `source_url`
- `source_provider` where present in the extended contract
- raw payload/content
- suggested destination fields
- `converted_type`
- `converted_id`

Tasks, reminders, events, and notes also have source/source-platform fields. These labels are useful indexing and display metadata, but they are not sufficient provenance unless the original source can be resolved and revisited.

### 1.7 Implemented conversion and integration paths

Relevant existing API paths include:

- `/api/inbox/:id/convert`
- `/api/inbox/:id/place-resource`
- `/api/external-references/:id/links`
- `/api/integrations/github/references/:id/task`
- `/api/meeting-notes/from-calendar`
- `/api/notes/:id/transcript-segments/:segmentId/links`
- `/api/context-links`
- `/api/projects/:id/note-links`
- `/api/projects/:id/github-repositories`
- Slack context/activity linking and promotion-to-Intake endpoints

Global search currently searches notes, projects, tasks, events, reminders, Intake, people, teams, meeting metadata, transcript segments, and GitHub external references. It does not yet provide a complete provider-neutral search of all related context.

## 2. Canonical relationship matrix

| Relationship | Authority | Direction | Backlink | Provenance | Notes |
| --- | --- | --- | --- | --- | --- |
| Workspace ↔ Project | `projects.workspace_id` | Project → Workspace | Derived by workspace query | No | Structural ownership boundary. |
| Workspace ↔ Task | `tasks.workspace_id` | Task → Workspace | Derived by workspace query | No | Structural ownership boundary. |
| Workspace ↔ Note | `notes.workspace_id` | Note → Workspace | Derived by workspace query | No | `user_id` remains note creator/owner metadata. |
| Workspace ↔ Calendar/Event/Reminder | Each object’s `workspace_id`; event/reminder also retain calendar FK | Object → Workspace/Calendar | Derived | No | All related IDs must belong to the same workspace. |
| Project ↔ Task | `tasks.project_id` | Task → Project | Derived by task query | No | Existing FK remains authoritative. Do not duplicate in generic context links. |
| Project ↔ Note | `project_note_links` | Bidirectional read of specialized join | Derived from same join | Usually no | Existing join remains authoritative. |
| Project ↔ Milestone | `project_milestones.project_id` | Milestone → Project | Derived by milestone query | No | Milestone-linked note/event/reminder fields remain separate associations. |
| Project ↔ Event | `events.project_id`; reconcile legacy `linked_project_id` | Event → Project | Derived by project event query | No unless event is created from another source | Direct project association remains authoritative after legacy-field resolution. |
| Project ↔ Reminder | `reminders.project_id` | Reminder → Project | Derived by project reminder query | No | Do not duplicate solely into `ledger_context_links`. |
| Project ↔ External resource | `external_reference_links`; GitHub repository join; Drive connected-source relationships | Bidirectional read | Derived from provider-specific authority | Yes when created by integration/conversion | Keep provider-specific metadata and lifecycle. |
| Project ↔ Person | `projects.lead_id` and `projects.owner_team_id` where present; assignment structures for work | Project → Lead/Team | Derived from lead/team queries | No | Do not generalize all people into context links. |
| Task ↔ Note | `ledger_context_links` when contextual; task `notes` text remains task-local detail | Bidirectional read | Derived | No, unless created from note | A task note field is not a Note relationship. |
| Task ↔ Event | Existing event/task FK only where populated; otherwise contextual link if explicitly supported | Bidirectional read | Derived | Yes for event follow-up | Do not infer a relationship from matching dates. |
| Task ↔ Reminder | `ledger_context_links` only when explicitly linked | Bidirectional read | Derived | No | Keep reminders distinct from tasks. |
| Task ↔ Meeting/transcript | `meeting_transcript_links` for transcript provenance; optional contextual link for broader meeting context | Transcript segment → Task | Derived from transcript links | Required | Segment identity, quote, timestamp, speaker, and meeting note must remain available. |
| Task ↔ Intake | `inbox_items.converted_type` + `converted_id`; retain a navigable provenance relationship | Intake → converted Task | Derived from conversion record | Required | `source` alone is insufficient. |
| Task ↔ External resource | `external_reference_links`; GitHub task conversion path | Bidirectional read | Derived | Required for conversion | Preserve the existing external reference; do not create a duplicate reference. |
| Note ↔ Note | `notes.parent_id`, `note_sections`, and note tree ordering | Child → Parent/Section | Derived | No | Structural hierarchy, not generic related context. |
| Note ↔ Event | `events.note_id`; meeting metadata may additionally use `calendar_event_id` | Event → Note | Derived | Required when note is created from event | Event note attachment and meeting-note provenance must remain distinguishable. |
| Note ↔ Reminder | `reminders.note_id` | Reminder → Note | Derived | No unless created from note | Existing FK remains authoritative. |
| Note ↔ Person | `note_person_links`; smart-person editor links are content references | Bidirectional read | Derived | No | Keep explicit person links distinct from inline editor mentions. |
| Note ↔ External resource | `external_reference_links` and embedded external-reference node | Note → External reference | Derived | Yes for imported/embedded references | Embed source is recorded as `embed`; target link remains provider-aware. |
| Meeting note ↔ Calendar event | `meeting_note_metadata.calendar_event_id` plus provider/key fields | Meeting note → Calendar identity/event | Derived | Required | Provider/key fields support Google, Apple, and Ledger events. |
| Meeting note ↔ Transcript segment | `meeting_note_transcript_segments.note_id` | Segment → Meeting note | Derived | No | Transcript is part of the meeting-note record. |
| Meeting note ↔ Ledger action | `meeting_transcript_links` | Transcript segment → action | Derived | Required | Link types distinguish action item, decision, key point, and Ledger item. |
| Event ↔ Reminder | `event_reminders` only for reminders attached to an event; standalone reminders remain separate | Reminder → Event | Derived | No | Do not treat all reminders as event children. |
| Event/Reminder ↔ Person/Team | Assignment fields and team-member tables | Object → assignee/team | Derived | No | Assignment is operational, not generic context. |
| Intake ↔ source | Intake source fields and raw payload; external-reference link where applicable | Source → Intake | Derived | Required | Original URL/provider identity must remain revisitable. |
| Intake ↔ destination | `converted_type` + `converted_id`; contextual placement links where applicable | Intake → destination | Derived | Required | Conversion and attachment are different actions. Preserve both meanings. |
| Slack context/activity ↔ Ledger object | Slack-specific context-link tables/endpoints | Slack → Ledger target | Derived by Slack link query | Required | Destination should expose Slack origin through canonical related-context reads. |
| GitHub resource ↔ Ledger object | `external_references` + `external_reference_links` | External resource → target | Derived | Required | GitHub-specific repository/project joins remain for repository semantics. |
| Figma resource ↔ Ledger object | `external_references` + links/embeds | External resource → target | Derived | Required | Preview/change-awareness remains provider-specific. |
| Google Drive source/item ↔ Project/Intake | Connected-source relationship tables and Intake capture fields | Drive → Project/Intake | Derived | Required | Preserve Drive identity and source folder metadata. |
| MCP ↔ created/read object | Existing object source fields plus explicit source identity where available | MCP → Ledger object | Derived | Required for writes | Workspace, connection, scope, and operation identity should be available to provenance reads without exposing secrets. |

## 3. Relationship vocabulary

Use the smallest vocabulary that explains current behavior:

### Structural

- `belongs_to`: containment or ownership, such as Task → Project or Note → Workspace.
- `contains`: the inverse read label for a structural relationship; not a separately stored edge.

### Contextual

- `related_to`: an explicit, optional relationship between existing Ledger objects when no structural FK or specialized join is appropriate.
- `references`: an object points to an external resource or provider object.
- `supports`: a note, resource, meeting, or other context materially supports a project/task. Use only when the UI needs a meaningful semantic distinction from `related_to`.

### Provenance

- `created_from`: a new object was created from a source object while preserving the source.
- `converted_from`: an Intake item became a Ledger object.
- `captured_from`: Ledger stored an external/provider source without necessarily converting it yet.

Recommended rule: use `belongs_to` for existing structural fields, `related_to` for generic internal context links, `references` for external references, and the three provenance terms only for source-preserving creation/conversion flows. Do not store inverse edges separately.

## 4. Provenance contract

### Required provenance

Ledger must preserve a navigable source relationship when:

1. A source is transformed into a new Ledger object.
2. A user would reasonably ask why the object exists.
3. The source contains a provider identity, URL, message, event, transcript segment, or external record that can be revisited.
4. The source can change independently of the Ledger object.

### Required cases

#### Intake → destination

Keep the Intake item as the source of truth for capture history. `converted_type` and `converted_id` remain the conversion index, but the destination must be discoverable from Intake and the Intake source must be discoverable from the destination through the canonical related-context read.

#### Meeting/transcript → task

Preserve:

- Meeting note ID
- Transcript segment ID
- Quoted text
- Timestamp
- Speaker/audio source
- Created Ledger task ID

The meeting note must show the task, and the task must show the meeting segment as provenance.

#### Calendar event → meeting note

`meeting_note_metadata` remains authoritative. Preserve the internal event ID when available and provider/key/source fields for Google or Apple events. Do not replace provider identity with a Ledger-only event ID.

#### Calendar event → follow-up task

Preserve the originating event as `created_from`. If the event has project/note context, retain those contextual relationships independently. Do not infer provenance only from the task’s project ID.

#### Slack → Intake → destination

Keep the Slack message/context identity and URL on the Intake/source relationship. Conversion must retain the Slack source after the Intake item becomes a task, note, reminder, event, or project.

#### GitHub/Figma/Drive → Ledger object

`external_references` remains the provider identity authority. `external_reference_links` remains the target relationship authority. Conversions and embeds must reuse the existing external reference and record the link source instead of creating duplicate provider records.

#### Browser capture → Intake/destination

The browser capture should remain traceable to its original URL, capture source, and Intake item even after conversion.

#### MCP-created objects

Retain that the object was created through MCP, but do not treat `source: 'mcp'` as sufficient provenance. Where available, preserve a non-secret connection/client and operation identity that can support audit and source display.

### Source labels versus provenance

Fields such as `source = 'slack'`, `source_platform = 'mcp'`, or `source = 'browser'` are classification metadata. They are not provenance unless they resolve to a source identity and support reciprocal discovery.

## 5. Conversion contract

Every supported conversion should follow this sequence:

1. Validate source access and workspace ownership.
2. Create the destination with normal object-specific validation.
3. Preserve the source identity and source metadata.
4. Create the appropriate relationship using the existing authoritative mechanism.
5. Avoid duplicating existing structural or provider relationships.
6. Return destination type, ID, title, workspace, route information, and source relationship metadata.
7. Make the source visible from the destination through related-context reads.
8. Make the destination visible from the source through conversion/source reads.
9. Make the relationship searchable without requiring provider-specific knowledge in the caller.
10. Keep conversion idempotent where provider retries or webhook retries are possible.

Conversion is distinct from placement:

- Conversion creates a new Ledger object from a source.
- Placement/attachment links an existing source or reference to an existing object.

The API and UI should preserve that distinction.

## 6. Canonical related-context read contract

Ledger should expose one backend-owned read contract conceptually equivalent to:

```text
getRelatedContext(workspaceId, resourceType, resourceId, options)
```

This is a specification, not an instruction to implement it in Stage 1A.

### Responsibilities

The read contract should:

- Validate workspace access and resource membership.
- Load structural relationships from their authoritative FKs.
- Load specialized joins such as project-note, milestones, meeting metadata, Slack links, GitHub repository links, and Drive sources where relevant.
- Load generic `ledger_context_links` only for relationships that belong there.
- Load external-reference links and provider metadata.
- Load provenance relationships for converted or source-derived objects.
- Deduplicate the same logical relationship when it appears through a legacy and current representation.
- Omit deleted, inaccessible, cross-workspace, or unresolved targets while retaining safe source metadata where appropriate.
- Return stable route/deep-link information without coupling the caller to Electron.

### Expected response shape

Conceptually:

```ts
type RelatedContextResponse = {
  resource: {
    type: ResourceType;
    id: string;
    workspace_id: string;
  };
  items: Array<{
    relationship: 'belongs_to' | 'related_to' | 'created_from' | 'converted_from' | 'captured_from' | 'references' | 'supports';
    direction: 'outgoing' | 'incoming';
    source: 'foreign_key' | 'join' | 'context_link' | 'external_reference' | 'integration' | 'provenance';
    target: {
      type: ResourceType | 'external_reference' | 'person' | 'team';
      id: string;
      title: string;
      preview?: string | null;
      workspace_id: string;
      provider?: string | null;
      url?: string | null;
    };
    provenance?: {
      source_type?: string | null;
      source_id?: string | null;
      source_url?: string | null;
      source_label?: string | null;
      captured_at?: string | null;
    } | null;
    route?: {
      kind: string;
      workspace_id: string;
      resource_type: string;
      resource_id: string;
    } | null;
    created_at?: string | null;
  }>;
  counts?: Record<string, number>;
};
```

The exact TypeScript/API shape is intentionally deferred to Stage 1B approval. The important contract is that callers receive normalized related resources, relationship semantics, source authority, provenance, and navigation data without knowing the underlying table.

### Boundaries

The read contract should not:

- Mutate links.
- Infer relationships from text, dates, matching titles, or provider similarity.
- Replace specialized provider payloads.
- Return inaccessible cross-workspace records.
- Become a universal search endpoint.
- Replace object-specific detail APIs.

## 7. Existing systems that should remain untouched

The following systems already express important semantics and should remain authoritative:

- Workspace membership and RLS/access checks
- `tasks.project_id`
- Note hierarchy through `parent_id` and section fields
- `project_note_links`
- `project_milestones`
- Calendar ownership and `calendar_id`
- Event/reminder project and note fields after legacy-field reconciliation
- `meeting_note_metadata`
- Transcript segment storage and `meeting_transcript_links`
- `external_references` and `external_reference_links`
- GitHub repository/project relationships
- Slack context/activity link tables
- Google Drive connected-source and source-item tables
- Team membership and assignment fields
- Platform route serialization and Electron/Web navigation boundary
- MCP authorization, scopes, and workspace binding

Stage 1B should add aggregation and consistency around these systems, not replace them.

## 8. Conflicts and duplication requiring resolution

### Event project identity

Events contain both legacy `linked_project_id` and newer `project_id`. A single read rule must define precedence and migration/runtime reconciliation.

### Event task identity

The original calendar schema includes `linked_task_id`, while newer task relationships may be represented through other paths. This needs an explicit authority decision before adding more links.

### Direct fields versus `ledger_context_links`

The context-link table contains relationships that overlap with event/reminder direct fields. The canonical reader must deduplicate them, and writes must not create a second representation where the direct FK is authoritative.

### Project ↔ Note duplication risk

`project_note_links` is already a complete specialized join. It should not also be written to `ledger_context_links`.

### External references versus internal context links

External resources are not internal Ledger objects. They should remain in the external-reference system and be projected into related context at read time.

### Intake conversion versus Intake placement

`converted_id` represents transformation. `place-resource` and context links represent attachment/placement. These must not be collapsed into one ambiguous relationship.

### Source fields versus source relationships

Source labels on tasks, events, reminders, and notes are useful metadata but cannot substitute for a navigable provenance relationship.

### Meeting note versus separate Meeting entity

Meeting notes are already implemented as a note mode with metadata and transcript children. Stage 1B should not introduce a separate Meeting object unless a concrete limitation cannot be solved through the existing note-plus-metadata model.

### Navigation metadata

Some flows use shared platform routes while others still use direct Electron module focus calls. Related-context responses should return platform-neutral route intent; Stage 1B should not create a second navigation system.

## 9. Recommended Stage 1B implementation scope

Stage 1B should be a narrow normalization pass:

1. Write and approve the authority/precedence table for overlapping legacy and current fields.
2. Implement one read-only backend related-context aggregator behind existing workspace access rules.
3. Make it read structural FKs, specialized joins, generic context links, external links, and provenance without changing storage.
4. Add deduplication and workspace-safety tests for overlapping relationships.
5. Define and test a stable normalized response shape.
6. Apply the reader to one high-value surface first: Project context.
7. Add reciprocal reads for Intake conversion and meeting transcript action items.
8. Normalize route intent returned by related-context results for Electron and Web.
9. Leave new relationship writes, schema migrations, UI redesign, and broad search changes for later stages unless required to prove the read contract.

Stage 1B should not include:

- A new universal relationship table
- Replacing existing foreign keys
- Migrating all specialized joins
- Universal object linking
- New AI behavior
- Provider-specific UI rewrites
- A full activity/event redesign

## Decisions requiring approval before implementation

1. Should `ledger_context_links` remain limited to optional internal contextual relationships, with foreign keys and specialized joins authoritative everywhere else?
2. What is the precedence between `events.project_id` and legacy `events.linked_project_id`?
3. Is `events.linked_task_id` still an active relationship, and if so, should it remain authoritative for Event ↔ Task?
4. Should Intake conversion provenance be represented by the existing `converted_type`/`converted_id` pair plus a read-time provenance projection, or should Stage 1B propose a minimal durable source-link extension?
5. Should meeting transcript action links be the sole authority for Meeting segment ↔ action provenance?
6. Should external references remain outside the internal graph and be aggregated only at read time?
7. Which resource types are approved for the first canonical related-context reader: internal six types only, or also people, teams, and external references?
8. Should the first Stage 1B consumer be Project context, Intake detail, or meeting-note detail?
9. Should the normalized related-context response include platform-neutral route descriptors, or should callers continue deriving routes locally?
10. What minimum provenance metadata must be visible to users: source label, source title, source URL, source object route, timestamp, and/or provider status?

