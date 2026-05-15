import type { JSX } from 'react'
import {
  DecoratorNode,
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  $applyNodeReplacement,
} from 'lexical'

export type SerializedImageNode = SerializedLexicalNode & {
  type: 'image'
  version: 1
  src: string
  altText: string
  storagePath?: string | null
}

function convertImageElement(domNode: Node): DOMConversionOutput | null {
  if (!(domNode instanceof HTMLImageElement)) return null
  const src = domNode.getAttribute('src') ?? ''
  const altText = domNode.getAttribute('alt') ?? ''
  return { node: $createImageNode({ src, altText }) }
}

export class ImageNode extends DecoratorNode<JSX.Element> {
  __src: string
  __altText: string
  __storagePath: string | null

  static getType(): string {
    return 'image'
  }

  static clone(node: ImageNode): ImageNode {
    return new ImageNode(node.__src, node.__altText, node.__storagePath, node.__key)
  }

  static importJSON(serializedNode: SerializedImageNode): ImageNode {
    return $createImageNode({
      src: serializedNode.src,
      altText: serializedNode.altText,
      storagePath: serializedNode.storagePath ?? null,
    })
  }

  exportJSON(): SerializedImageNode {
    return {
      ...super.exportJSON(),
      type: 'image',
      version: 1,
      src: this.__src,
      altText: this.__altText,
      storagePath: this.__storagePath ?? null,
    }
  }

  static importDOM(): DOMConversionMap | null {
    return {
      img: () => ({
        conversion: convertImageElement,
        priority: 1,
      }),
    }
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement('img')
    element.setAttribute('src', this.__src)
    element.setAttribute('alt', this.__altText)
    if (this.__storagePath) element.setAttribute('data-storage-path', this.__storagePath)
    return { element }
  }

  constructor(src: string, altText: string, storagePath?: string | null, key?: NodeKey) {
    super(key)
    this.__src = src
    this.__altText = altText
    this.__storagePath = storagePath ?? null
  }

  createDOM(): HTMLElement {
    const container = document.createElement('div')
    container.style.display = 'block'
    return container
  }

  updateDOM(): false {
    return false
  }

  decorate(_editor: LexicalEditor): JSX.Element {
    return (
      <img
        src={this.__src}
        data-storage-path={this.__storagePath ?? undefined}
        alt={this.__altText || 'Pasted image'}
        className="my-3 max-h-130 w-auto max-w-full rounded-lg border border-gray-200 object-contain"
      />
    )
  }
}

export function $createImageNode({
  src,
  altText = '',
  storagePath = null,
}: {
  src: string
  altText?: string
  storagePath?: string | null
}): ImageNode {
  return $applyNodeReplacement(new ImageNode(src, altText, storagePath))
}

export function $isImageNode(node: LexicalNode | null | undefined): node is ImageNode {
  return node instanceof ImageNode
}
