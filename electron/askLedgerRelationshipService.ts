import type {
  AskLedgerContextItem,
  AskLedgerRelationship,
  AskLedgerRelationshipType,
  AskLedgerResourceType,
} from '../src/types/askLedgerContext.ts';
import type { AskLedgerGraphExpansionDiagnostics } from '../src/types/askLedgerResourceContract.ts';

export type AskLedgerRelationshipLimits = {
  maxTotal?: number;
  maxPerResourceType?: number;
  maxPerRelationshipType?: number;
};

export type AskLedgerRelationshipPath = {
  resourceType: AskLedgerResourceType;
  resourceId: string;
  depth: number;
  path: string[];
};

export type AskLedgerGraphExpansionResult = {
  items: AskLedgerContextItem[];
  diagnostics: AskLedgerGraphExpansionDiagnostics;
};

export type AskLedgerExpandRelatedContextOptions = {
  workspaceId: string;
  seeds: AskLedgerContextItem[];
  corpus: AskLedgerContextItem[];
  maxDepth?: number;
  allowedRelationshipTypes?: readonly AskLedgerRelationshipType[];
  limits?: AskLedgerRelationshipLimits;
};

type GraphEdge = {
  from: string;
  to: string;
  relationshipType: AskLedgerRelationshipType;
};

const keyFor = (item: Pick<AskLedgerContextItem, 'resourceType' | 'resourceId'>) => `${item.resourceType}:${item.resourceId}`;

const inverseType = (relationshipType: AskLedgerRelationshipType, sourceType: AskLedgerResourceType): AskLedgerRelationshipType => {
  if (relationshipType === 'belongs_to_project') {
    return sourceType === 'task' ? 'has_task'
      : sourceType === 'milestone' ? 'has_milestone'
        : sourceType === 'note' ? 'has_note'
          : sourceType === 'event' ? 'has_event'
            : sourceType === 'reminder' ? 'has_reminder'
              : sourceType === 'external' ? 'has_external_resource'
                : 'linked_project';
  }
  if (relationshipType === 'belongs_to_milestone') return 'has_task';
  if (relationshipType === 'belongs_to_note') return sourceType === 'transcript' ? 'has_transcript' : 'linked_event';
  if (relationshipType === 'member_of_team') return 'has_person';
  if (relationshipType === 'linked_resource') return sourceType === 'external' ? 'has_external_resource' : 'linked_resource';
  if (relationshipType === 'has_transcript') return 'belongs_to_note';
  if (relationshipType === 'has_task') return 'belongs_to_project';
  if (relationshipType === 'has_milestone') return 'belongs_to_project';
  if (relationshipType === 'has_note') return 'linked_project';
  if (relationshipType === 'has_event') return 'linked_project';
  if (relationshipType === 'has_reminder') return 'linked_project';
  if (relationshipType === 'has_external_resource') return 'belongs_to_project';
  if (relationshipType === 'has_person') return 'member_of_team';
  if (relationshipType === 'linked_notification') return 'has_notification';
  if (relationshipType === 'has_notification') return 'linked_notification';
  if (relationshipType === 'linked_activity') return 'has_activity';
  if (relationshipType === 'has_activity') return 'linked_activity';
  if (relationshipType === 'belongs_to_team') return 'has_activity';
  if (relationshipType === 'has_meeting_note') return 'linked_event';
  if (relationshipType === 'created_from_meeting') return 'linked_task';
  return relationshipType;
};

const fallbackRelationships = (item: AskLedgerContextItem, byId: Map<string, AskLedgerContextItem>): AskLedgerRelationship[] => {
  const relationships: AskLedgerRelationship[] = [];
  if (item.projectId && byId.has(`project:${item.projectId}`)) relationships.push({ relationshipType: 'belongs_to_project', resourceType: 'project', resourceId: item.projectId });
  if (item.milestoneId && byId.has(`milestone:${item.milestoneId}`)) relationships.push({ relationshipType: 'belongs_to_milestone', resourceType: 'milestone', resourceId: item.milestoneId });
  if (item.taskId && byId.has(`task:${item.taskId}`)) relationships.push({ relationshipType: 'linked_task', resourceType: 'task', resourceId: item.taskId });
  if (item.noteId && byId.has(`note:${item.noteId}`)) relationships.push({ relationshipType: 'linked_note', resourceType: 'note', resourceId: item.noteId });
  if (item.teamId && byId.has(`team:${item.teamId}`)) relationships.push({ relationshipType: 'belongs_to_team', resourceType: 'team', resourceId: item.teamId });
  if (item.parentResourceId) {
    const parent = [...byId.values()].find((candidate) => candidate.resourceId === item.parentResourceId);
    if (parent) relationships.push({
      relationshipType: item.resourceType === 'transcript' ? 'belongs_to_note' : item.resourceType === 'event' ? 'has_meeting_note' : 'linked_resource',
      resourceType: parent.resourceType,
      resourceId: parent.resourceId,
    });
  }
  return relationships;
};

const edgeSort = (left: GraphEdge, right: GraphEdge) => left.to.localeCompare(right.to) || left.relationshipType.localeCompare(right.relationshipType);

export const expandRelatedContext = ({
  workspaceId,
  seeds,
  corpus,
  maxDepth = 2,
  allowedRelationshipTypes,
  limits = {},
}: AskLedgerExpandRelatedContextOptions): AskLedgerGraphExpansionResult => {
  const boundedDepth = Math.max(0, Math.min(8, Math.floor(maxDepth)));
  const maxTotal = Math.max(0, limits.maxTotal ?? 40);
  const maxPerResourceType = Math.max(1, limits.maxPerResourceType ?? 12);
  const maxPerRelationshipType = Math.max(1, limits.maxPerRelationshipType ?? 20);
  const allowed = allowedRelationshipTypes ? new Set(allowedRelationshipTypes) : undefined;
  const eligibleCorpus = corpus.filter((item) => !item.workspaceId || item.workspaceId === workspaceId);
  const byId = new Map(eligibleCorpus.map((item) => [keyFor(item), item]));
  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();
  const addEdge = (from: string, to: string, relationshipType: AskLedgerRelationshipType) => {
    if (from === to || !byId.has(to)) return;
    const edgeKey = `${from}|${to}|${relationshipType}`;
    if (edgeKeys.has(edgeKey)) return;
    edgeKeys.add(edgeKey);
    edges.push({ from, to, relationshipType });
  };

  for (const item of eligibleCorpus) {
    const from = keyFor(item);
    const relationships = [...(item.relationships ?? []), ...fallbackRelationships(item, byId)];
    for (const relationship of relationships) {
      const to = `${relationship.resourceType}:${relationship.resourceId}`;
      const reverseRelationshipType = inverseType(relationship.relationshipType, item.resourceType);
      if (!allowed || allowed.has(relationship.relationshipType)) addEdge(from, to, relationship.relationshipType);
      if (!allowed || allowed.has(reverseRelationshipType)) addEdge(to, from, reverseRelationshipType);
    }
  }

  const adjacency = new Map<string, GraphEdge[]>();
  for (const edge of edges) adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge]);
  adjacency.forEach((value, key) => adjacency.set(key, value.sort(edgeSort)));

  const seedItems = seeds.filter((item) => byId.has(keyFor(item)));
  const seedKeys = new Set(seedItems.map(keyFor));
  const visited = new Set(seedKeys);
  const queue: Array<{ key: string; depth: number; path: string[] }> = seedItems
    .sort((left, right) => keyFor(left).localeCompare(keyFor(right)))
    .map((item) => ({ key: keyFor(item), depth: 0, path: [keyFor(item)] }));
  const selected: AskLedgerContextItem[] = [];
  const selectedByType: Record<string, number> = {};
  const selectedByRelationship: Record<string, number> = {};
  const depthCounts: Record<string, Record<string, number>> = {};
  const paths: AskLedgerRelationshipPath[] = [];
  let deduplicated = 0;
  let cyclePrevented = 0;
  let truncated = 0;

  while (queue.length) {
    const current = queue.shift();
    if (!current || current.depth >= boundedDepth) continue;
    for (const edge of adjacency.get(current.key) ?? []) {
      const target = byId.get(edge.to);
      if (!target) continue;
      const nextDepth = current.depth + 1;
      if (visited.has(edge.to)) {
        if (current.path.includes(edge.to)) cyclePrevented += 1;
        else deduplicated += 1;
        continue;
      }
      if (selected.length >= maxTotal || (selectedByType[target.resourceType] ?? 0) >= maxPerResourceType || (selectedByRelationship[edge.relationshipType] ?? 0) >= maxPerRelationshipType) {
        truncated += 1;
        continue;
      }
      visited.add(edge.to);
      selected.push(target);
      selectedByType[target.resourceType] = (selectedByType[target.resourceType] ?? 0) + 1;
      selectedByRelationship[edge.relationshipType] = (selectedByRelationship[edge.relationshipType] ?? 0) + 1;
      depthCounts[String(nextDepth)] ??= {};
      depthCounts[String(nextDepth)][target.resourceType] = (depthCounts[String(nextDepth)][target.resourceType] ?? 0) + 1;
      const path = [...current.path, edge.to];
      paths.push({ resourceType: target.resourceType, resourceId: target.resourceId, depth: nextDepth, path });
      queue.push({ key: edge.to, depth: nextDepth, path });
    }
  }

  return {
    items: selected,
    diagnostics: {
      seedResources: [...seedKeys].sort(),
      depthCounts,
      deduplicated,
      cyclePrevented,
      truncated,
      paths,
    },
  };
};
