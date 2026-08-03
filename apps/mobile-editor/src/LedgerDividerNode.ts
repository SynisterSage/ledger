import { ElementNode, type NodeKey } from 'lexical';

export class LedgerDividerNode extends ElementNode {
  constructor(key?: NodeKey) { super(key); }
  static getType() { return 'ledger-divider'; }
  static clone(node: LedgerDividerNode) { return new LedgerDividerNode(node.__key); }
  static importDOM() { return { hr: () => ({ conversion: () => ({ node: new LedgerDividerNode() }), priority: 6 }) }; }
  createDOM() { return document.createElement('hr'); }
  updateDOM() { return false; }
  exportDOM() { return { element: document.createElement('hr') }; }
  static importJSON() { return new LedgerDividerNode(); }
  exportJSON() { return { ...super.exportJSON(), type: 'ledger-divider' as const, version: 1 }; }
}

export function $createLedgerDividerNode() { return new LedgerDividerNode(); }
