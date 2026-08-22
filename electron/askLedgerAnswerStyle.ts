import type { AskLedgerExecutionMode } from '../src/types/askLedgerResponseMode.ts';
import type { AskLedgerPresentationProfile } from '../src/types/askLedgerSkills.ts';
import type { AskLedgerContextItem } from '../src/types/askLedgerContext.ts';
import { formatAskLedgerStructuredValues, type AskLedgerStructuredValueOptions } from './askLedgerStructuredValues.ts';

type AnswerStyleInput = {
  executionMode?: AskLedgerExecutionMode;
  profile?: AskLedgerPresentationProfile;
};

export type AskLedgerPresentationProfileContract = {
  preferredSections: string[];
  optionalSections: string[];
  sectionOrder: string[];
  preferredListType: 'paragraphs' | 'bullets' | 'numbered_actions' | 'mixed';
  density: 'natural' | 'compact' | 'moderate' | 'deep_compact';
  emojiHints: string[];
  conclusionBehavior: string;
  compositionRules: string[];
};

export const ASK_LEDGER_PRESENTATION_PROFILES: Record<AskLedgerPresentationProfile, AskLedgerPresentationProfileContract> = {
  default: {
    preferredSections: ['Main takeaway', 'Next steps'],
    optionalSections: ['Key points'],
    sectionOrder: ['Main takeaway', 'Key points', 'Next steps'],
    preferredListType: 'mixed',
    density: 'natural',
    emojiHints: [],
    conclusionBehavior: 'Lead with a short conclusion; use headings only when they improve scanning.',
    compositionRules: ['Do not force a template onto ordinary conversation or simple lookups.'],
  },
  weekly_plan: {
    preferredSections: ['🎯 Focus this week', '📅 Deadlines & commitments', '⚠️ Watchouts', '✅ Next steps'],
    optionalSections: ['⚠️ Watchouts'],
    sectionOrder: ['🎯 Focus this week', '📅 Deadlines & commitments', '⚠️ Watchouts', '✅ Next steps'],
    preferredListType: 'mixed',
    density: 'compact',
    emojiHints: ['🎯 focus', '📅 deadlines', '⚠️ risks', '✅ actions'],
    conclusionBehavior: 'Prioritize and group related work; do not inventory every task.',
    compositionRules: ['Omit Watchouts without meaningful risks.', 'Use numbered Next steps when order matters.', 'Group similar deliverables and avoid repeating the same task.'],
  },
  meeting_summary: {
    preferredSections: ['📝 Summary', '✅ Decisions', '📌 Action items', '❓ Open questions'],
    optionalSections: ['✅ Decisions', '📌 Action items', '❓ Open questions'],
    sectionOrder: ['📝 Summary', '✅ Decisions', '📌 Action items', '❓ Open questions'],
    preferredListType: 'mixed',
    density: 'compact',
    emojiHints: ['📝 summary', '✅ decisions', '📌 actions', '❓ unresolved'],
    conclusionBehavior: 'Summarize meaning first; include only evidenced decisions, owners, actions, and questions.',
    compositionRules: ['Keep Summary to 2–4 sentences.', 'Omit unsupported Decisions, Action items, and Open questions.', 'Avoid a long chronological transcript recap.'],
  },
  project_status: {
    preferredSections: ['📍 Where things stand', '🔄 Recent progress', '⚠️ Blockers', '✅ Next moves'],
    optionalSections: ['🔄 Recent progress', '⚠️ Blockers'],
    sectionOrder: ['📍 Where things stand', '🔄 Recent progress', '⚠️ Blockers', '✅ Next moves'],
    preferredListType: 'mixed',
    density: 'moderate',
    emojiHints: ['📍 current state', '🔄 progress', '⚠️ blockers', '✅ actions'],
    conclusionBehavior: 'Interpret the current state and recommend next moves; do not dump linked resource rows.',
    compositionRules: ['Omit Blockers when the project is healthy.', 'Use Recent progress for meaningful changes, not a resource inventory.', 'Use numbered Next moves when sequence or priority matters.'],
  },
  research_analysis: {
    preferredSections: ['💡 What stands out', '🔎 What’s driving it', '⚠️ Risks or tradeoffs', '✅ What I’d do next'],
    optionalSections: ['🔎 What’s driving it', '⚠️ Risks or tradeoffs', '✅ What I’d do next'],
    sectionOrder: ['💡 What stands out', '🔎 What’s driving it', '⚠️ Risks or tradeoffs', '✅ What I’d do next'],
    preferredListType: 'mixed',
    density: 'deep_compact',
    emojiHints: ['💡 insight', '🔎 analysis', '⚠️ risks', '✅ recommendations'],
    conclusionBehavior: 'Give the main interpretation first; keep reasoning, risks, and recommendations compact and visible.',
    compositionRules: ['Keep analysis evidence-backed and compact.', 'Omit Risks or tradeoffs when none are supported.', 'Do not expose reasoning process, retrieval strategy, or confidence machinery.'],
  },
};

const modeGuidance: Record<AskLedgerExecutionMode, string> = {
  conversation: 'Conversation: natural, usually 1–3 short paragraphs; add structure only when useful.',
  ledger_product_help: 'Ledger product help: give a specific product-level explanation from authoritative knowledge. Prefer a clear takeaway followed by Markdown headings, **bold feature names**, and concise bullets. For broad questions, explain Capture → Plan → Execute → Review and connect the major surfaces to it. Be honest when detailed knowledge is unavailable, and do not cite workspace records.',
  workspace_lookup: 'Lookup: one concise sentence or short paragraph; no headings for a simple fact.',
  workspace_synthesis: 'Synthesis: lead with the conclusion, then use only useful sections and next steps.',
  workspace_research: 'Research: use a concise takeaway, risks/meaning, and next steps only when useful.',
  skills: 'Skill: follow the selected skill contract and supplied Ledger context; do not execute a skill merely because its name appears in a question.',
};

const profileGuidance: Partial<Record<AskLedgerPresentationProfile, string>> = Object.fromEntries(
  (Object.entries(ASK_LEDGER_PRESENTATION_PROFILES) as Array<[AskLedgerPresentationProfile, AskLedgerPresentationProfileContract]>)
    .filter(([profile]) => profile !== 'default')
    .map(([profile, contract]) => [profile, `${contract.sectionOrder.join(' → ')}. Omit optional sections without supporting signals. ${contract.conclusionBehavior} ${contract.compositionRules.join(' ')}`])
) as Partial<Record<AskLedgerPresentationProfile, string>>;

export type AskLedgerPresentationSignals = {
  overdueItems: number;
  upcomingMeetings: number;
  blockersPresent: boolean;
  actionItemsPresent: boolean;
  decisionsPresent: boolean;
  openQuestionsPresent: boolean;
  progressPresent: boolean;
  datedItems: number;
  resourceCount: number;
};

export const deriveAskLedgerPresentationSignals = (items: AskLedgerContextItem[], options?: AskLedgerStructuredValueOptions): AskLedgerPresentationSignals => {
  const displays = items.map((item) => ({ item, display: formatAskLedgerStructuredValues(item, options) }));
  const content = items.map((item) => `${item.title} ${item.content}`).join(' ');
  return {
    overdueItems: displays.filter(({ display }) => display.dueStatus === 'overdue').length,
    upcomingMeetings: displays.filter(({ item, display }) => item.resourceType === 'event' && Boolean(display.displayTimestamp) && ['due_today', 'due_tomorrow', 'upcoming'].includes(display.dueStatus ?? '')).length,
    blockersPresent: items.some((item) => /\bblocked|blocker|stuck|dependency|at risk\b/i.test(`${item.status ?? ''} ${item.content}`)),
    actionItemsPresent: items.some((item) => ['task', 'reminder', 'milestone'].includes(item.resourceType) || /\baction item|follow[- ]?up|next step|todo\b/i.test(`${item.title} ${item.content}`)),
    decisionsPresent: /\bdecision|decided|agreed|approved\b/i.test(content),
    openQuestionsPresent: /\?|\bopen question|unresolved|question for\b/i.test(content),
    progressPresent: items.some((item) => Boolean(item.updatedAt) || /\bcompleted|finished|progress|changed|updated\b/i.test(`${item.status ?? ''} ${item.content}`)),
    datedItems: displays.filter(({ display }) => display.displayDueDate || display.displayTimestamp).length,
    resourceCount: items.length,
  };
};

export const formatAskLedgerPresentationSignals = (signals: AskLedgerPresentationSignals) => [
  'PRESENTATION SIGNALS',
  `overdueItems: ${signals.overdueItems}`,
  `upcomingMeetings: ${signals.upcomingMeetings}`,
  `blockersPresent: ${signals.blockersPresent}`,
  `actionItemsPresent: ${signals.actionItemsPresent}`,
  `decisionsPresent: ${signals.decisionsPresent}`,
  `openQuestionsPresent: ${signals.openQuestionsPresent}`,
  `progressPresent: ${signals.progressPresent}`,
  `datedItems: ${signals.datedItems}`,
  `resourceCount: ${signals.resourceCount}`,
].join('\n');

/** Compact, shared presentation guidance for the first and only answer generation pass. */
export const buildAskLedgerAnswerStyleContract = ({ executionMode = 'workspace_synthesis', profile = 'default' }: AnswerStyleInput = {}) => `
ANSWER STYLE
- Write for the user: clear, concise, conversational, actionable; lead with the conclusion.
- Use short paragraphs; bullets for 2–5 related items; numbered lists for ordered actions; sections for distinct topics. Do not bullet every sentence.
- Compose bullets as bold subject → concise detail; keep them to 1–2 lines. Group similar records and call out only important individual items instead of reciting an inventory.
- Use 2–4 sections when helpful. Prefer ##; use ### only for a real subsection. Never repeat headings or leave an empty section.
- Bold important entities, deadlines, and conclusions selectively, never whole paragraphs.
- Use at most one meaningful emoji per heading (🎯📅✅⚠️📌💡📝🔄); no decorative or casual emoji spam.
- State results directly. Never mention evidence, retrieval, context, resources, prompts, analysis, reasoning, or internal instructions; avoid phrases like “the evidence suggests” or “based on the retrieved context.”
- Use the human-readable dates, times, statuses, and due states provided. Do not rewrite dates as ISO or infer overdue/upcoming status.
- Use plain Markdown only: headings, bold, bullets, numbered lists, and paragraphs. No tables, HTML, nested callouts, or complex Markdown.
- Follow the mode and profile below; omit anything that adds no value.
- ${modeGuidance[executionMode]}
${profileGuidance[profile] ? `- ${profileGuidance[profile]}` : ''}`.trim();

export type AskLedgerAnswerStyleDiagnostics = {
  largeParagraphDetected: boolean;
  redundantHeadingDetected: boolean;
  excessiveHeadingCount: boolean;
  usefulBulletStructure: boolean;
  appropriateBoldUsage: boolean;
  internalLanguageDetected: boolean;
  excessiveEmojiUsage: boolean;
  actionableConclusion: boolean;
  profileMatchedRequest: boolean;
  expectedSectionMissing: string[];
  emptySectionDetected: boolean;
  duplicateSectionDetected: boolean;
  overlongBulletDetected: boolean;
  excessiveListLength: boolean;
  inventoryDumpDetected: boolean;
  actionListProperlyOrdered: boolean;
};

type LayoutDiagnosticInput = {
  profile?: AskLedgerPresentationProfile;
  signals?: AskLedgerPresentationSignals;
};

const normalizedHeading = (value: string) => value.replace(/[🎯📅✅⚠️📌💡📝🔄🔎❓📍]/gu, '').replace(/[*_:#]/g, '').trim().toLowerCase();
const sectionPresent = (headings: string[], section: string) => {
  const target = normalizedHeading(section);
  return headings.some((heading) => normalizedHeading(heading) === target || normalizedHeading(heading).includes(target) || target.includes(normalizedHeading(heading)));
};

const expectedSectionsFor = (profile: AskLedgerPresentationProfile, signals?: AskLedgerPresentationSignals) => {
  const contract = ASK_LEDGER_PRESENTATION_PROFILES[profile];
  if (profile === 'default' || !signals) return [];
  const present = (name: string) => name.includes('Focus') || name.includes('Summary') || name.includes('Where things') || name.includes('What stands out') || (name.includes('Deadlines') && signals.datedItems > 0) || (name.includes('Watchouts') && (signals.overdueItems > 0 || signals.blockersPresent)) || (name.includes('Decisions') && signals.decisionsPresent) || (name.includes('Action items') && signals.actionItemsPresent) || (name.includes('Open questions') && signals.openQuestionsPresent) || (name.includes('Recent progress') && signals.progressPresent) || (name.includes('Blockers') && signals.blockersPresent) || (name.includes('What’s driving') && signals.resourceCount > 1) || (name.includes('Risks') && signals.blockersPresent) || (name.includes('Next') && signals.actionItemsPresent);
  return contract.preferredSections.filter(present);
};

export const diagnoseAskLedgerLayout = (answer: string, input: LayoutDiagnosticInput = {}) => {
  const profile = input.profile ?? 'default';
  const headings = [...answer.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => match[1].trim());
  const lines = answer.split('\n');
  const bullets = lines.filter((line) => /^\s*[-*•]\s+/.test(line));
  const numbered = lines.filter((line) => /^\s*\d+[.)]\s+/.test(line));
  const expected = expectedSectionsFor(profile, input.signals);
  const emptySectionDetected = headings.some((heading) => {
    const start = lines.findIndex((line) => line.trim() === `## ${heading}` || line.trim() === `### ${heading}`);
    const nextHeading = lines.slice(start + 1).findIndex((line) => /^#{1,6}\s+/.test(line));
    const body = lines.slice(start + 1, nextHeading < 0 ? lines.length : start + 1 + nextHeading).join(' ').trim();
    return !body;
  });
  const normalizedHeadings = headings.map(normalizedHeading);
  const duplicateSectionDetected = normalizedHeadings.some((heading, index) => normalizedHeadings.indexOf(heading) !== index);
  const nextSectionIndex = lines.findIndex((line) => /next (?:steps|moves)|what i’d do next/i.test(line));
  const actionLines = nextSectionIndex >= 0 ? lines.slice(nextSectionIndex + 1).filter((line) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(line)) : [];
  return {
    profileMatchedRequest: profile === 'default' || expected.length === 0 || expected.some((section) => sectionPresent(headings, section)),
    expectedSectionMissing: expected.filter((section) => !sectionPresent(headings, section)),
    emptySectionDetected,
    duplicateSectionDetected,
    overlongBulletDetected: bullets.some((line) => line.trim().split(/\s+/).length > 42),
    excessiveListLength: bullets.length + numbered.length > 10,
    inventoryDumpDetected: bullets.length > 8 && headings.length <= 2,
    actionListProperlyOrdered: !actionLines.length || actionLines.every((line) => /^\s*\d+[.)]\s+/.test(line)),
  };
};

/** Lightweight evaluation signals for fixtures and reports, not a runtime gate. */
export const diagnoseAskLedgerAnswerStyle = (answer: string, input: LayoutDiagnosticInput = {}): AskLedgerAnswerStyleDiagnostics => {
  const headings = [...answer.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => match[1].trim().toLowerCase());
  const paragraphs = answer.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  const bullets = answer.split('\n').filter((line) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(line));
  const internalLanguage = /\b(?:the evidence suggests|based on the retrieved context|according to the provided resources|the context indicates|the available evidence shows|i analyzed the resources|my reasoning suggests|i need to determine|let me analyze|based on my analysis)\b/i;
  const emoji = answer.match(/[🎯📅✅⚠️📌💡📝🔄🔎❓📍🔥🚀✨💯]/gu) ?? [];
  const layout = diagnoseAskLedgerLayout(answer, input);
  return {
    largeParagraphDetected: paragraphs.some((paragraph) => paragraph.split(/\s+/).length > 110),
    redundantHeadingDetected: headings.some((heading, index) => index > 0 && heading === headings[index - 1]),
    excessiveHeadingCount: headings.length > 4,
    usefulBulletStructure: bullets.length >= 2,
    appropriateBoldUsage: (answer.match(/\*\*[^*]+\*\*/g) ?? []).length > 0 && (answer.match(/\*\*[^*]+\*\*/g) ?? []).length <= Math.max(8, Math.ceil(answer.split(/\s+/).length / 35)),
    internalLanguageDetected: internalLanguage.test(answer),
    excessiveEmojiUsage: emoji.length > Math.max(3, headings.length + 1),
    actionableConclusion: /\b(?:next steps?|do next|focus on|start with|prioritize|recommend|i['’]d do)\b/i.test(answer),
    ...layout,
  };
};
