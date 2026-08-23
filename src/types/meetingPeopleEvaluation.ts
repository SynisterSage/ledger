export type MeetingIdentityEvalLabel = 'known' | 'suggested' | 'unknown';

export type MeetingIdentityEvalCase = {
  id: string;
  transcript: string;
  expectedPerson?: string;
  expectedLabel: MeetingIdentityEvalLabel;
  actionOwner?: string;
};

export type MeetingIdentityPrediction = {
  label: MeetingIdentityEvalLabel;
  person?: string;
  confidence?: number;
  actionOwner?: string;
};

export const meetingIdentityEvalFixtures: MeetingIdentityEvalCase[] = [
  { id: 'self-identification', transcript: 'Hi, this is Samantha.', expectedPerson: 'Samantha', expectedLabel: 'suggested' },
  { id: 'direct-address-response', transcript: 'Sam, can you send that Friday? Yeah, I will.', expectedPerson: 'Sam', expectedLabel: 'suggested', actionOwner: 'Sam' },
  { id: 'third-person-mention', transcript: 'Jordan will send it tomorrow.', expectedLabel: 'unknown' },
  { id: 'clear-owner', transcript: 'I will send the revised artwork by Friday.', expectedLabel: 'suggested', actionOwner: 'current_user' },
  { id: 'ambiguous-owner', transcript: 'Someone should probably send that.', expectedLabel: 'unknown' },
  { id: 'similar-names', transcript: 'Sam Lee, can you check this? Sam Patel, can you approve it?', expectedLabel: 'unknown' },
  { id: 'sole-external-attendee', transcript: 'System audio from the only external attendee.', expectedPerson: 'Samantha', expectedLabel: 'known' },
  { id: 'group-system-audio', transcript: 'Three remote participants on one system-audio stream.', expectedLabel: 'unknown' },
  { id: 'misleading-name', transcript: 'The Samantha project is nearly finished.', expectedLabel: 'unknown' },
  { id: 'notes-contradicted', transcript: 'No, Samantha is not handling the budget; I am.', expectedLabel: 'suggested', actionOwner: 'current_user' },
  { id: 'no-evidence', transcript: 'We should revisit this later.', expectedLabel: 'unknown' },
  { id: 'conditional-owner', transcript: 'If approved, maybe Jordan can take it.', expectedLabel: 'unknown' },
  { id: 'confirmed-speaker', transcript: 'Previously confirmed Ledger identity continues speaking.', expectedPerson: 'Samantha', expectedLabel: 'known' },
  { id: 'address-without-response', transcript: 'Samantha, what do you think?', expectedLabel: 'unknown' },
  { id: 'owner-without-name', transcript: 'I can take the follow-up and report back Tuesday.', expectedLabel: 'suggested', actionOwner: 'current_user' },
  { id: 'quoted-name', transcript: 'He said, “Samantha will handle it.”', expectedLabel: 'unknown' },
  { id: 'two-speakers-one-stream', transcript: 'Speaker changes are audible but no diarization IDs exist.', expectedLabel: 'unknown' },
  { id: 'explicit-owner-date', transcript: 'Jacob will send the contract on August 28.', expectedPerson: 'Jacob', expectedLabel: 'suggested', actionOwner: 'Jacob' },
];

export const evaluateMeetingIdentityPredictions = (
  predictions: Record<string, MeetingIdentityPrediction>
) => {
  let correct = 0;
  let falseConfident = 0;
  let ownerCorrect = 0;
  let ownerCases = 0;
  for (const fixture of meetingIdentityEvalFixtures) {
    const prediction = predictions[fixture.id];
    if (!prediction) continue;
    const personCorrect = fixture.expectedPerson == null
      ? prediction.person == null
      : prediction.person?.toLowerCase() === fixture.expectedPerson.toLowerCase();
    if (prediction.label === fixture.expectedLabel && personCorrect) correct++;
    if (fixture.expectedLabel === 'unknown' && prediction.label !== 'unknown' && (prediction.confidence ?? 0) >= 0.8) falseConfident++;
    if (fixture.actionOwner) {
      ownerCases++;
      if (prediction.actionOwner?.toLowerCase() === fixture.actionOwner.toLowerCase()) ownerCorrect++;
    }
  }
  return {
    caseCount: meetingIdentityEvalFixtures.length,
    accuracy: correct / meetingIdentityEvalFixtures.length,
    falseConfidentAssignments: falseConfident,
    actionOwnerAccuracy: ownerCases ? ownerCorrect / ownerCases : 0,
    passes: correct / meetingIdentityEvalFixtures.length >= 0.8 && falseConfident === 0,
  };
};
