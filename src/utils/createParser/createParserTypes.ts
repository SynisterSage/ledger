export type ParseConfidence = 'high' | 'medium' | 'low';

export type ParsedRecurrence = 'none' | 'daily' | 'weekly' | 'monthly' | 'weekdays';

export interface ParsedCreateInput {
  title?: string;
  date?: string;
  time?: string;
  durationMinutes?: number;
  allDay?: boolean;
  recurrence?: ParsedRecurrence;
  location?: string;
  confidence: {
    date?: ParseConfidence;
    time?: ParseConfidence;
    duration?: ParseConfidence;
  };
}
