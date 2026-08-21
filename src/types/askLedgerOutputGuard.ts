export type AskLedgerOutputMapping = {
  raw: string;
  display: string;
  kind: 'structured_value' | 'resource_id';
};

export type AskLedgerOutputGuardDiagnostics = {
  hiddenReasoningRemoved: boolean;
  internalMetadataRemoved: boolean;
  knownStructuredValueNormalized: boolean;
  knownResourceIdNormalized: boolean;
};

export type AskLedgerOutputGuardResult = {
  answer: string;
  diagnostics: AskLedgerOutputGuardDiagnostics;
};

const emptyDiagnostics = (): AskLedgerOutputGuardDiagnostics => ({
  hiddenReasoningRemoved: false,
  internalMetadataRemoved: false,
  knownStructuredValueNormalized: false,
  knownResourceIdNormalized: false,
});

const hiddenReasoningBlock = /<(?:think|thinking|reasoning|reasoning_content)>[\s\S]*?<\/(?:think|thinking|reasoning|reasoning_content)>/gi;
const unclosedHiddenReasoningBlock = /<(?:think|thinking|reasoning|reasoning_content)>[\s\S]*$/i;
const hiddenReasoningLine = /^\s*(?:<\/?(?:think|thinking|reasoning|reasoning_content)>|reasoning_content\s*[:=]).*$/gim;
const internalMetadataLine = /^\s*(?:model[_ -]?id|resource[_ -]?id|retrieval[_ -]?(?:score|rank|debug)|embedding(?:[_ -]?(?:metadata|score|vector))?|token[_ -]?(?:budget|count)|prompt[_ -]?tokens?|completion[_ -]?tokens?|system prompt|presentation signals)\s*[:=].*$/gim;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Small deterministic last-mile guard. It only rewrites values explicitly
 * supplied by Ledger and removes unmistakable internal/debug fragments.
 */
export const sanitizeAskLedgerOutput = (value: string, mappings: AskLedgerOutputMapping[] = []): AskLedgerOutputGuardResult => {
  const diagnostics = emptyDiagnostics();
  let answer = String(value ?? '');
  const beforeReasoning = answer;
  answer = answer.replace(hiddenReasoningBlock, '').replace(unclosedHiddenReasoningBlock, '').replace(hiddenReasoningLine, '');
  diagnostics.hiddenReasoningRemoved = answer !== beforeReasoning;

  const beforeMetadata = answer;
  answer = answer.replace(internalMetadataLine, '');
  diagnostics.internalMetadataRemoved = answer !== beforeMetadata;

  const orderedMappings = mappings
    .filter((mapping) => mapping.raw && mapping.display && mapping.raw !== mapping.display)
    .sort((a, b) => b.raw.length - a.raw.length);
  for (const mapping of orderedMappings) {
    const pattern = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(mapping.raw)}(?![A-Za-z0-9])`, 'g');
    if (!pattern.test(answer)) continue;
    answer = answer.replace(pattern, mapping.display);
    if (mapping.kind === 'resource_id') diagnostics.knownResourceIdNormalized = true;
    else diagnostics.knownStructuredValueNormalized = true;
  }

  return { answer: answer.replace(/\n{3,}/g, '\n\n').trim(), diagnostics };
};
