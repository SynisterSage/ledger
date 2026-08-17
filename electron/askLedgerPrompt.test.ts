import test from 'node:test';
import assert from 'node:assert/strict';
import { ASK_LEDGER_ABSTENTION, buildAskLedgerPrompt } from './askLedgerPrompt.ts';
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
