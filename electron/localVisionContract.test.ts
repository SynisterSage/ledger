import assert from 'node:assert/strict';
import test from 'node:test';
import { LOCAL_VISION_TRANSCRIPTION_PROMPT, parseLocalVisionResponse } from './localVisionContract.ts';

test('builds a transcription prompt that forbids guessing', () => {
  assert.match(LOCAL_VISION_TRANSCRIPTION_PROMPT, /Return JSON only/);
  assert.match(LOCAL_VISION_TRANSCRIPTION_PROMPT, /\[unclear\]/);
});

test('parses fenced local vision JSON into the shared OCR result', () => {
  assert.deepEqual(parseLocalVisionResponse(`
    \`\`\`json
    {"text":"Plan","lines":[{"text":"Plan"}],"blocks":[{"type":"heading","text":"Plan"}],"uncertain":false,"unclearRegions":[]}
    \`\`\`
  `, 123), {
    text: 'Plan',
    lines: [{ text: 'Plan' }],
    blocks: [{ type: 'heading', text: 'Plan' }],
    engine: 'local-vision',
    uncertain: false,
    unclearRegions: [],
    durationMs: 123,
  });
});

test('rejects malformed or incomplete local vision output', () => {
  assert.equal(parseLocalVisionResponse('I cannot read this image.'), null);
  assert.equal(parseLocalVisionResponse('{"text":"bad","lines":[],"blocks":[{"type":"paragraph","text":"bad","checked":true}]}'), null);
});
