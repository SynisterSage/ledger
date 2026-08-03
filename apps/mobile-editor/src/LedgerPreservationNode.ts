import { ElementNode, type LexicalNode, type NodeKey } from 'lexical';

const PRESERVED_TAGS = ['aside', 'figure', 'img', 'hr', 'section', 'div', 'ul', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'figcaption'];
const PRESERVED_ALWAYS = new Set(['img', 'hr', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'figcaption']);

function hasLedgerMetadata(element: HTMLElement) {
  return Array.from(element.attributes).some((attribute) => attribute.name.startsWith('data-ledger-')) || element.getAttribute('data-type') === 'check-list';
}

export class LedgerPreservationNode extends ElementNode {
  __html: string;
  __tag: string;
  constructor(html: string, tag = 'div', key?: NodeKey) { super(key); this.__html = html; this.__tag = tag; }
  static getType() { return 'ledger-preservation'; }
  static clone(node: LedgerPreservationNode) { return new LedgerPreservationNode(node.__html, node.__tag, node.__key); }
  static importDOM() {
    return Object.fromEntries(PRESERVED_TAGS.map((tag) => [tag, (element: HTMLElement) => hasLedgerMetadata(element) || PRESERVED_ALWAYS.has(tag) ? { conversion: () => ({ node: new LedgerPreservationNode(element.outerHTML, tag) }), priority: 4 } : null]));
  }
  createDOM() {
    const template = document.createElement('template');
    template.innerHTML = this.__html;
    const element = template.content.firstElementChild;
    return element instanceof HTMLElement ? element : document.createElement(this.__tag);
  }
  updateDOM() { return false; }
  exportDOM() {
    const template = document.createElement('template');
    template.innerHTML = this.__html;
    return { element: template.content.firstElementChild ?? document.createElement(this.__tag) };
  }
  isInline() { return false; }
  canBeEmpty() { return true; }
  static importJSON(serializedNode: { html?: string; tag?: string }) { return new LedgerPreservationNode(serializedNode.html ?? '', serializedNode.tag ?? 'div'); }
  exportJSON() { return { ...super.exportJSON(), html: this.__html, tag: this.__tag, type: 'ledger-preservation' as const, version: 1 }; }
}

export function $createLedgerPreservationNode(html: string, tag?: string) { return new LedgerPreservationNode(html, tag); }
export function $isLedgerPreservationNode(node: LexicalNode | null | undefined): node is LedgerPreservationNode { return node instanceof LedgerPreservationNode; }
