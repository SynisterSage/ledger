/** Application-owned capability facts. Keep this list aligned with real Ask Ledger paths. */
export const ASK_LEDGER_CAPABILITIES = [
  'Search workspace context across projects, tasks, milestones, notes, calendar items, reminders, meetings, and transcripts.',
  'Answer workspace questions only when the supplied Ledger records support the claims.',
  'Read attached PDF, DOCX, TXT, Markdown, CSV, and XLSX files through local attachment retrieval.',
  'Run built-in or custom Skills using their supplied Ledger or attachment context.',
  'Propose supported actions such as creating tasks, reminders, or notes; mutations require the existing review and confirmation flow.',
  'Rewrite, summarize, explain, or format the current conversation without searching the workspace when no new facts are requested.',
].join('\n- ');

export const ASK_LEDGER_CAPABILITY_DESCRIPTION = `Ask Ledger can:\n- ${ASK_LEDGER_CAPABILITIES}`;

export const ASK_LEDGER_PRODUCT_DESCRIPTION = 'Ledger is a calm desktop accountability workspace for capturing thoughts, planning your day, organizing projects and calendar context, following through on next actions, and reviewing what moved, what is blocked, and what comes next.';

export const ASK_LEDGER_CREATOR_DESCRIPTION = 'Ledger was made by Lex Ferguson, a Monmouth University alumnus. Learn more at https://aferguson.art.';

export const isLedgerProductQuestion = (question: string) => /^\s*(?:what\s+(?:does|is)\s+ledger(?:\s+do)?|what\s+is\s+ledger\s+what\s+does\s+it\s+do)\s*\??\s*$/i.test(question);
export const isLedgerCreatorQuestion = (question: string) => /^\s*(?:who\s+(?:made|built|created)\s+(?:ledger|it)|who\s+is\s+ledger\s+made\s+by)\s*\??\s*$/i.test(question);
