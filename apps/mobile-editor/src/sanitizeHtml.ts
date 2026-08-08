const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:', 'ledger:']);

export function sanitizeEditorHtml(value: string) {
  const input = String(value ?? '');
  if (!input.trim()) return '<p></p>';

  const document = new DOMParser().parseFromString(input, 'text/html');
  document.querySelectorAll('script, style, iframe, object, embed, meta, link, base').forEach((node) => node.remove());
  document.querySelectorAll<HTMLElement>('*').forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc') element.removeAttribute(attribute.name);
    });

    for (const attributeName of ['href', 'src', 'action', 'formaction', 'data-url']) {
      const attribute = element.getAttribute(attributeName);
      if (!attribute) continue;
      const url = attribute.trim();
      if (/^(?:javascript|vbscript|data|file|blob):/i.test(url)) {
        element.removeAttribute(attributeName);
        continue;
      }
      if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
        try {
          const parsed = new URL(url);
          if (!SAFE_URL_PROTOCOLS.has(parsed.protocol) || parsed.username || parsed.password) element.removeAttribute(attributeName);
        } catch {
          element.removeAttribute(attributeName);
        }
      }
    }
  });
  return document.body.innerHTML;
}
