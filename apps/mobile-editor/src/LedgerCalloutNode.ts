import { ElementNode, type NodeKey } from 'lexical';

export type LedgerCalloutVariant = 'info' | 'note' | 'warning' | 'success';

export class LedgerCalloutNode extends ElementNode {
  __variant: LedgerCalloutVariant;
  __attributes: Record<string, string>;
  constructor(variant: LedgerCalloutVariant = 'info', attributes: Record<string, string> = {}, key?: NodeKey) { super(key); this.__variant = variant; this.__attributes = attributes; }
  static getType() { return 'ledger-callout'; }
  static clone(node: LedgerCalloutNode) { return new LedgerCalloutNode(node.__variant, { ...node.__attributes }, node.__key); }
  static importDOM() {
    const convert = (element: HTMLElement) => {
      const marker = element.getAttribute('data-ledger-callout') ?? element.getAttribute('data-callout-type');
      if (!marker) return null;
      const variant = ['info', 'note', 'warning', 'success'].includes(marker) ? marker as LedgerCalloutVariant : 'info';
      return { conversion: () => ({ node: new LedgerCalloutNode(variant, Object.fromEntries(Array.from(element.attributes).map((attribute) => [attribute.name, attribute.value]))) }), priority: 5 };
    };
    return { aside: convert, div: convert, section: convert };
  }
  createDOM(config: { theme: Record<string, unknown> }) {
    const element = document.createElement('aside');
    element.setAttribute('data-ledger-callout', this.__variant);
    Object.entries(this.__attributes).forEach(([name, value]) => element.setAttribute(name, value));
    const className = (config.theme.callout as Record<string, string> | undefined)?.[this.__variant];
    if (className) element.className = className;
    return element;
  }
  updateDOM() { return false; }
  exportDOM() {
    const element = document.createElement('aside');
    element.setAttribute('data-ledger-callout', this.__variant);
    Object.entries(this.__attributes).forEach(([name, value]) => element.setAttribute(name, value));
    return { element };
  }
  static importJSON(serializedNode: { variant?: LedgerCalloutVariant; attributes?: Record<string, string> }) { return new LedgerCalloutNode(serializedNode.variant ?? 'info', serializedNode.attributes ?? {}); }
  exportJSON() { return { ...super.exportJSON(), type: 'ledger-callout' as const, version: 1, variant: this.__variant, attributes: this.__attributes }; }
}

export function $createLedgerCalloutNode(variant: LedgerCalloutVariant) { return new LedgerCalloutNode(variant); }
