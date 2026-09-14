type MatchingEventTimeUpdateInput = {
  matchStartAt: string;
  originalAnchorStartAt: string;
  editedAnchorStartAt: Date;
  durationMinutes: number;
};

type ReviewedMatch = {
  id: string;
  start_at: string;
};

const localDayNumber = (date: Date) =>
  Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / (24 * 60 * 60 * 1000);

export const buildMatchingEventTimeUpdate = ({
  matchStartAt,
  originalAnchorStartAt,
  editedAnchorStartAt,
  durationMinutes,
}: MatchingEventTimeUpdateInput) => {
  const matchingStart = new Date(matchStartAt);
  const originalAnchorStart = new Date(originalAnchorStartAt);
  if (
    Number.isNaN(matchingStart.getTime()) ||
    Number.isNaN(originalAnchorStart.getTime()) ||
    Number.isNaN(editedAnchorStartAt.getTime()) ||
    !Number.isFinite(durationMinutes) ||
    durationMinutes <= 0
  ) {
    throw new Error('Invalid matching event schedule.');
  }

  const dayShift =
    localDayNumber(editedAnchorStartAt) - localDayNumber(originalAnchorStart);
  matchingStart.setDate(matchingStart.getDate() + dayShift);
  matchingStart.setHours(
    editedAnchorStartAt.getHours(),
    editedAnchorStartAt.getMinutes(),
    0,
    0
  );
  const matchingEnd = new Date(matchingStart.getTime() + durationMinutes * 60 * 1000);

  return {
    start_at: matchingStart.toISOString(),
    end_at: matchingEnd.toISOString(),
  };
};

export const buildReviewedMatchingEventUpdates = ({
  matches,
  originalAnchorStartAt,
  editedAnchorStartAt,
  durationMinutes,
}: Omit<MatchingEventTimeUpdateInput, 'matchStartAt'> & { matches: ReviewedMatch[] }) =>
  matches.map((match) => ({
    id: match.id,
    ...buildMatchingEventTimeUpdate({
      matchStartAt: match.start_at,
      originalAnchorStartAt,
      editedAnchorStartAt,
      durationMinutes,
    }),
  }));
