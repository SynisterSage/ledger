/** Application-owned capability facts. Keep this list aligned with real Ask Ledger paths. */
export const ASK_LEDGER_CAPABILITIES = [
  'Search workspace context across projects, tasks, milestones, notes, calendar items, reminders, meetings, and transcripts.',
  'Answer workspace questions only when the supplied Ledger records support the claims.',
  'Read attached PDF, DOCX, TXT, Markdown, and CSV files through attachment retrieval.',
  'Run built-in or custom Skills using their supplied Ledger or attachment context.',
  'Propose supported actions such as creating tasks, reminders, or notes; mutations require the existing review and confirmation flow.',
  'Rewrite, summarize, explain, or format the current conversation without searching the workspace when no new facts are requested.',
].join('\n- ');

export const ASK_LEDGER_CAPABILITY_DESCRIPTION = `Ask Ledger can:\n- ${ASK_LEDGER_CAPABILITIES}`;
