export const htmlToPlainText = (value: string) =>
  String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const normalizeEditorHtml = (value: string) => {
  const trimmed = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!trimmed || trimmed === '<p><br></p>' || trimmed === '<p></p>') {
    return '<p></p>';
  }
  return String(value ?? '');
};

/**
 * Make imported HTML safe and predictable before Lexical walks it. This is
 * intentionally load-only: saved Lexical HTML is not rewritten just because
 * a note was opened, and unknown elements are left in place so their readable
 * children can still be imported by Lexical.
 */
export const sanitizeEditorHtml = (value: string) => {
  const input = String(value ?? '');
  if (!input.trim() || typeof DOMParser === 'undefined') return input;

  try {
    const document = new DOMParser().parseFromString(input, 'text/html');
    document.querySelectorAll('script, style, iframe, object, embed, meta, link').forEach((node) => {
      node.remove();
    });

    document.querySelectorAll<HTMLElement>('*').forEach((element) => {
      Array.from(element.attributes).forEach((attribute) => {
        if (attribute.name.toLowerCase().startsWith('on')) {
          element.removeAttribute(attribute.name);
        }
      });

      for (const attributeName of ['href', 'src', 'action', 'formaction']) {
        const attribute = element.getAttribute(attributeName);
        if (!attribute) continue;
        const normalized = attribute.trim().toLowerCase();
        if (/^(?:javascript|vbscript|data):/.test(normalized)) {
          element.removeAttribute(attributeName);
        }
      }
    });

    return document.body.innerHTML;
  } catch {
    // Lexical's DOM parser remains the final compatibility fallback.
    return input;
  }
};
