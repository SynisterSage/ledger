import {
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  ElementNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedElementNode,
  $applyNodeReplacement,
} from 'lexical';
import type { CalloutType } from '../types/blocks';

export type SerializedCalloutNode = SerializedElementNode & {
  type: 'ledger-callout';
  version: 1;
  calloutType: CalloutType;
  icon: string | null;
};

const isCalloutType = (value: string | null): value is CalloutType =>
  value === 'info' || value === 'note' || value === 'warning' || value === 'success';

const convertCalloutElement = (domNode: Node): DOMConversionOutput | null => {
  if (!(domNode instanceof HTMLElement)) return null;
  const calloutType = domNode.dataset.calloutType ?? null;
  return {
    node: $createCalloutNode({
      calloutType: isCalloutType(calloutType) ? calloutType : 'info',
      icon: domNode.dataset.calloutIcon || null,
    }),
  };
};

export class CalloutNode extends ElementNode {
  __calloutType: CalloutType;
  __icon: string | null;

  static getType(): string {
    return 'ledger-callout';
  }

  static clone(node: CalloutNode): CalloutNode {
    return new CalloutNode(node.__calloutType, node.__icon, node.__key);
  }

  static importJSON(serializedNode: SerializedCalloutNode): CalloutNode {
    return $createCalloutNode({
      calloutType: serializedNode.calloutType,
      icon: serializedNode.icon,
    });
  }

  static importDOM(): DOMConversionMap | null {
    return {
      div: (domNode) =>
        domNode.hasAttribute('data-ledger-callout')
          ? { conversion: convertCalloutElement, priority: 4 }
          : null,
    };
  }

  constructor(calloutType: CalloutType = 'info', icon: string | null = null, key?: NodeKey) {
    super(key);
    this.__calloutType = calloutType;
    this.__icon = icon;
  }

  getCalloutType(): CalloutType {
    return this.getLatest().__calloutType;
  }

  setCalloutType(calloutType: CalloutType): this {
    const writable = this.getWritable();
    writable.__calloutType = calloutType;
    return writable;
  }

  getIcon(): string | null {
    return this.getLatest().__icon;
  }

  setIcon(icon: string | null): this {
    const writable = this.getWritable();
    writable.__icon = icon;
    return writable;
  }

  exportJSON(): SerializedCalloutNode {
    return {
      ...super.exportJSON(),
      type: 'ledger-callout',
      version: 1,
      calloutType: this.getCalloutType(),
      icon: this.getIcon(),
    };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement('div');
    element.dataset.ledgerCallout = 'true';
    element.dataset.calloutType = this.__calloutType;
    if (this.__icon) element.dataset.calloutIcon = this.__icon;
    element.className = 'ledger-callout ledger-callout--' + this.__calloutType;
    element.setAttribute('role', 'note');
    return element;
  }

  updateDOM(prevNode: CalloutNode, dom: HTMLElement): boolean {
    if (prevNode.__calloutType !== this.__calloutType) {
      dom.dataset.calloutType = this.__calloutType;
      dom.className = 'ledger-callout ledger-callout--' + this.__calloutType;
    }
    if (prevNode.__icon !== this.__icon) {
      if (this.__icon) dom.dataset.calloutIcon = this.__icon;
      else delete dom.dataset.calloutIcon;
    }
    return false;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement('div');
    element.setAttribute('data-ledger-callout', 'true');
    element.setAttribute('data-callout-type', this.getCalloutType());
    if (this.getIcon()) element.setAttribute('data-callout-icon', this.getIcon()!);
    return { element };
  }
}

export function $createCalloutNode({
  calloutType = 'info',
  icon = null,
}: { calloutType?: CalloutType; icon?: string | null } = {}): CalloutNode {
  return $applyNodeReplacement(new CalloutNode(calloutType, icon));
}

export function $isCalloutNode(node: LexicalNode | null | undefined): node is CalloutNode {
  return node instanceof CalloutNode;
}
