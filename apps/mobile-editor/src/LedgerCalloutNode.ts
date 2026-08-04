import {
  $applyNodeReplacement,
  ElementNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
} from 'lexical';

export type LedgerCalloutVariant = 'info' | 'note' | 'warning' | 'success';

const isVariant = (value: string | null): value is LedgerCalloutVariant =>
  value === 'info' || value === 'note' || value === 'warning' || value === 'success';

const variantFromElement = (element: HTMLElement): LedgerCalloutVariant => {
  const classVariant = Array.from(element.classList)
    .find((name) => name.startsWith('ledger-callout--'))
    ?.replace('ledger-callout--', '') ?? null;
  const value = element.getAttribute('data-callout-type')
    ?? element.getAttribute('data-ledger-callout-type')
    ?? element.getAttribute('data-callout-style')
    ?? classVariant;
  return isVariant(value) ? value : 'info';
};

const colors = (variant: LedgerCalloutVariant) => {
  if (variant === 'warning') return { border: '#f59e0b', background: 'rgba(245, 158, 11, 0.10)' };
  if (variant === 'success') return { border: '#34d399', background: 'rgba(52, 211, 153, 0.09)' };
  return { border: '#ff5f40', background: 'rgba(255, 95, 64, 0.08)' };
};

export class LedgerCalloutNode extends ElementNode {
  __variant: LedgerCalloutVariant;

  constructor(variant: LedgerCalloutVariant = 'info', key?: NodeKey) {
    super(key);
    this.__variant = variant;
  }

  static getType() { return 'ledger-callout'; }

  static clone(node: LedgerCalloutNode) {
    return new LedgerCalloutNode(node.__variant, node.__key);
  }

  static importDOM() {
    const convert = (element: HTMLElement) => {
      if (!element.hasAttribute('data-ledger-callout') && !element.classList.contains('ledger-callout')) return null;
      return { conversion: () => ({ node: new LedgerCalloutNode(variantFromElement(element)) }), priority: 6 };
    };
    return {
      aside: convert,
      div: convert,
      section: convert,
    };
  }

  getVariant() {
    return this.getLatest().__variant;
  }

  createDOM(_config: EditorConfig) {
    const variant = this.getVariant();
    const color = colors(variant);
    const element = document.createElement('div');
    element.className = `ledger-callout ledger-callout--${variant}`;
    element.dataset.ledgerCallout = 'true';
    element.dataset.calloutType = variant;
    element.dataset.ledgerCalloutType = variant;
    element.dataset.calloutStyle = variant;
    element.setAttribute('role', 'note');
    element.style.borderLeft = `3px solid ${color.border}`;
    element.style.background = color.background;
    return element;
  }

  updateDOM(previousNode: LedgerCalloutNode, dom: HTMLElement) {
    if (previousNode.__variant !== this.__variant) {
      const next = this.createDOM({} as EditorConfig);
      dom.className = next.className;
      dom.dataset.calloutType = this.__variant;
      dom.dataset.ledgerCalloutType = this.__variant;
      dom.dataset.calloutStyle = this.__variant;
      dom.style.borderLeft = next.style.borderLeft;
      dom.style.background = next.style.background;
    }
    return false;
  }

  exportDOM() {
    const variant = this.getVariant();
    const color = colors(variant);
    const element = document.createElement('aside');
    element.className = `ledger-callout ledger-callout--${variant}`;
    element.setAttribute('data-ledger-callout', 'true');
    element.setAttribute('data-callout-type', variant);
    element.setAttribute('data-ledger-callout-type', variant);
    element.setAttribute('data-callout-style', variant);
    element.setAttribute('role', 'note');
    element.style.borderLeft = `3px solid ${color.border}`;
    element.style.background = color.background;
    return { element };
  }

  static importJSON(serializedNode: { variant?: LedgerCalloutVariant }) {
    return $createLedgerCalloutNode(serializedNode.variant ?? 'info');
  }

  exportJSON() {
    return { ...super.exportJSON(), type: 'ledger-callout' as const, version: 1, variant: this.getVariant() };
  }
}

export function $createLedgerCalloutNode(variant: LedgerCalloutVariant) {
  return $applyNodeReplacement(new LedgerCalloutNode(variant));
}

export function $isLedgerCalloutNode(node: LexicalNode | null | undefined): node is LedgerCalloutNode {
  return node instanceof LedgerCalloutNode;
}
