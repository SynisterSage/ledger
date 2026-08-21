import test from 'node:test';
import assert from 'node:assert/strict';
import { ASK_LEDGER_ABSTENTION, buildAskLedgerPrompt, buildAskLedgerRepairPrompt } from './askLedgerPrompt.ts';
import type { AskLedgerContextItem } from '../src/types/askLedgerContext.ts';
import { getAskLedgerSkill } from './askLedgerSkills.ts';

const context: AskLedgerContextItem[] = [
  {
    resourceType: 'project',
    resourceId: 'project-1',
    title: 'Local AI',
    content: 'The project is in Planning at 15% progress.',
    status: 'Planning',
    updatedAt: '2026-08-16T10:00:00Z',
  },
  {
    resourceType: 'task',
    resourceId: 'task-1',
    title: 'Compare local models',
    content: 'The task is In Progress.',
    status: 'In Progress',
    projectName: 'Local AI',
    updatedAt: '2026-08-16T11:00:00Z',
  },
  {
    resourceType: 'note',
    resourceId: 'note-1',
    title: 'Decision note',
    content: 'Qwen3 1.7B is currently leading after testing.',
    updatedAt: '2026-08-16T12:00:00Z',
  },
];

test('builds a compact grounded prompt without raw resource JSON', () => {
  const prompt = buildAskLedgerPrompt({ question: 'What is the status?', contextItems: context });

  assert.match(prompt, /Use only the Ledger context below/);
  assert.match(prompt, /prefer the record with the clearest newer Updated or Time value/);
  assert.match(prompt, /Planning at 15% progress/);
  assert.match(prompt, /In Progress/);
  assert.match(prompt, /Qwen3 1\.7B is currently leading/);
  assert.doesNotMatch(prompt, /resourceType|resourceId|"project-1"/);
  assert.match(prompt, /Do not output <think> tags/);
});

test('injects the shared presentation contract without changing the evidence contract', () => {
  const prompt = buildAskLedgerPrompt({ question: 'What needs attention this week?', contextItems: context, executionMode: 'workspace_synthesis', presentationProfile: 'weekly_plan' });
  assert.match(prompt, /ANSWER STYLE/);
  assert.match(prompt, /bullets for 2–5 related items/);
  assert.match(prompt, /🎯 Focus this week → 📅 Deadlines & commitments → ⚠️ Watchouts → ✅ Next steps/);
  assert.match(prompt, /PRESENTATION SIGNALS/);
  assert.match(prompt, /actionItemsPresent: true/);
  assert.match(prompt, /Never mention evidence, retrieval, context, resources/);
  assert.match(prompt, /EVIDENCE PACKAGE/);
});

test('uses the stable abstention instruction for unsupported questions', () => {
  const prompt = buildAskLedgerPrompt({ question: 'When will Local AI launch?', contextItems: context });

  assert.match(prompt, new RegExp(ASK_LEDGER_ABSTENTION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(prompt, /Do not invent facts, status, dates, deadlines, owners, or decisions/);
});

test('lets a selected skill interpret a brief follow-up as the skill request', () => {
  const skill = getAskLedgerSkill('plan_my_week');
  assert.ok(skill);
  const prompt = buildAskLedgerPrompt({ question: 'Help me out', contextItems: context, skill, skillContext: 'Selected skill: Plan my week' });

  assert.match(prompt, /treat the selected skill's purpose as the request/);
  assert.match(prompt, /Do not abstain merely because the message says something like/);
});

test('bounds follow-up context and keeps it separate from current Ledger evidence', () => {
  const prompt = buildAskLedgerPrompt({
    question: 'What about the mobile side?',
    contextItems: context,
    recentConversation: {
      previousQuestion: 'What is the current local AI status?',
      previousAnswer: 'A previous answer that should only resolve the reference.',
      previousSources: [{ resourceType: 'project', resourceId: 'project-1', title: 'Local AI' }],
    },
  });

  assert.match(prompt, /Recent exchange for resolving references only/);
  assert.match(prompt, /What about the mobile side\?/);
  assert.match(prompt, /Do not invent facts/);
});

test('keeps conversational prompts free of global grounding abstention', () => {
  const prompt = buildAskLedgerPrompt({ question: 'Thanks', responseMode: 'conversational' });
  assert.doesNotMatch(prompt, /Use only the Ledger context below/);
  assert.doesNotMatch(prompt, new RegExp(ASK_LEDGER_ABSTENTION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('tells conversational follow-ups to answer directly instead of critiquing prior output', () => {
  const prompt = buildAskLedgerPrompt({
    question: 'Why not?',
    responseMode: 'follow_up',
    recentConversation: { previousQuestion: 'What is your favorite YouTuber?', previousAnswer: "I don't have a favorite YouTuber.", previousSources: [] },
  });
  assert.match(prompt, /Answer the current question directly/);
  assert.match(prompt, /never critique, grade, or rewrite the previous answer/);
});

test('constrains capability answers to application-owned capabilities', () => {
  const prompt = buildAskLedgerPrompt({
    question: 'Can you read PDFs?',
    responseMode: 'conversational',
    capabilityDescription: 'Ask Ledger can:\n- Read attached PDF files through attachment retrieval.',
  });
  assert.match(prompt, /Trusted application capabilities/);
  assert.match(prompt, /Read attached PDF files through attachment retrieval/);
});

test('passes adaptive depth guidance through the shared grounded prompt', () => {
  const brief = buildAskLedgerPrompt({ question: 'Is Task X done?', responseMode: 'workspace_grounded', answerDepth: 'brief' });
  const detailed = buildAskLedgerPrompt({ question: 'Why is Project A blocked?', responseMode: 'workspace_grounded', answerDepth: 'detailed' });
  assert.match(brief, /Answer directly and minimally/);
  assert.match(detailed, /thorough explanation using the available evidence/);
  assert.doesNotMatch(brief, /1-3 concise paragraphs/);
});

test('separates evidence from instructions and requires deep synthesis with missing coverage', () => {
  const prompt = buildAskLedgerPrompt({
    question: 'Look across meetings and projects and tell me where everything stands.',
    generationDepth: 'deep',
    generationDepthReason: 'research_route',
    evidencePackage: {
      request: 'Look across meetings and projects and tell me where everything stands.',
      coverage: { requested: ['projects', 'tasks', 'reminders'], found: ['projects', 'tasks'], missing: ['reminders'], truncated: [] },
      sections: [],
      sources: [],
      stats: { retrieved: 2, selected: 2, dropped: 0, estimatedTokens: 100, estimatedTokensBefore: 120 },
      text: 'PROJECTS\n- Alfa is in progress.\nTASKS\n- Review proof — today.',
    },
  });
  assert.match(prompt, /ANSWER MODE: deep/);
  assert.match(prompt, /EVIDENCE PACKAGE/);
  assert.match(prompt, /MISSING \/ LIMITED EVIDENCE/);
  assert.match(prompt, /reminders/);
  assert.match(prompt, /overall picture/);
  assert.match(prompt, /Do not stop at a list of projects/);
  assert.match(prompt, /USER REQUEST/);
});

test('uses the primary event time for last-workday lookups', () => {
  const prompt = buildAskLedgerPrompt({
    question: 'When was my last day working at Alfa Art Gallery?',
    primaryContext: [{
      resourceType: 'event',
      resourceId: 'event-alfa',
      title: 'Alfa - Hybrid Work',
      timestamp: '2026-08-13T15:00:00Z',
      content: 'Workday event.',
    }],
  });
  assert.match(prompt, /newest primary workplace Event and its Time/);
  assert.match(prompt, /Thursday, Aug 13 at 3:00 PM/);
  assert.doesNotMatch(prompt, /2026-08-13T15:00:00Z/);
});

test('asks project-specific answers to include linked work context', () => {
  const prompt = buildAskLedgerPrompt({
    question: 'What is my Pigmented Perceptions project?',
    primaryContext: [{ resourceType: 'project', resourceId: 'project-1', title: 'Pigmented Perceptions', content: 'In progress.' }],
    supportingContext: [{ resourceType: 'milestone', resourceId: 'milestone-1', title: 'Posters & Banners', content: 'In progress.', projectId: 'project-1' }],
  });
  assert.match(prompt, /scan its linked milestones, tasks or next actions, reminders, events, notes/);
  assert.match(prompt, /Posters &amp; Banners|Posters & Banners/);
});

test('repair prompt keeps validation bounded and distinguishes unavailable evidence', () => {
  const evidencePackage = {
    request: 'What happened across GitHub and projects?',
    coverage: { requested: ['projects', 'external'], found: ['projects'], missing: ['external'], truncated: [], unavailable: ['GitHub'] },
    sections: [], sources: [], stats: { retrieved: 1, selected: 1, dropped: 0, estimatedTokens: 20, estimatedTokensBefore: 20 }, text: 'PROJECTS\n- Alfa is in progress.',
  };
  const prompt = buildAskLedgerRepairPrompt({ question: evidencePackage.request, evidencePackage, answer: 'There were no GitHub updates.', validationFailures: '- unavailable_claimed_empty: GitHub was unavailable.' });
  assert.match(prompt, /GitHub/);
  assert.match(prompt, /unavailable/);
  assert.match(prompt, /ORIGINAL ANSWER/);
  assert.match(prompt, /Return only the corrected answer/);
});
