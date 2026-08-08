import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const gallerySource = await readFile(new URL('../../src/components/Notes/TemplateGallery.tsx', import.meta.url), 'utf8');
const sanitizerSource = await readFile(new URL('../../src/components/Notes/editor/utils/html.ts', import.meta.url), 'utf8');

test('template gallery sanitizes persisted HTML at the render boundary', () => {
  assert.match(gallerySource, /dangerouslySetInnerHTML/);
  assert.match(gallerySource, /sanitizeEditorHtml\(previewTemplate\.content_html/);
});

test('template sanitizer removes active markup and dangerous URL schemes', () => {
  assert.match(sanitizerSource, /querySelectorAll\('script, style, iframe, object, embed, meta, link'\)/);
  assert.match(sanitizerSource, /attribute\.name\.toLowerCase\(\)\.startsWith\('on'\)/);
  assert.match(sanitizerSource, /javascript\|vbscript\|data/);
});
