import React, { useEffect, useState, type JSX } from 'react'
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
import { supabase } from '../../../services/supabase'

export type SerializedImageNode = SerializedLexicalNode & {
  type: 'image'
  version: 1
  src: string
  altText: string
  storagePath?: string | null
}

const NOTE_IMAGE_BUCKET = 'note-images'

const extractStoragePathFromSrc = (src: string): string | null => {
  const value = String(src ?? '').trim()
  if (!value) return null

  const markerPublic = `/storage/v1/object/public/${NOTE_IMAGE_BUCKET}/`
  const markerSign = `/storage/v1/object/sign/${NOTE_IMAGE_BUCKET}/`

  const publicIdx = value.indexOf(markerPublic)
  if (publicIdx >= 0) {
    const path = value.slice(publicIdx + markerPublic.length).split('?')[0]
    return path || null
  }

  const signIdx = value.indexOf(markerSign)
  if (signIdx >= 0) {
    const path = value.slice(signIdx + markerSign.length).split('?')[0]
    return path || null
  }

  return null
}

function convertImageElement(domNode: Node): DOMConversionOutput | null {
  if (!(domNode instanceof HTMLImageElement)) return null
  const src = domNode.getAttribute('src') ?? ''
  const altText = domNode.getAttribute('alt') ?? ''
  const storagePath = domNode.getAttribute('data-storage-path') ?? extractStoragePathFromSrc(src)
  return { node: $createImageNode({ src, altText, storagePath }) }
}

function NoteImage({
  src,
  altText,
  storagePath,
}: {
  src: string
  altText: string
  storagePath?: string | null
}): JSX.Element {
  const [resolvedSrc, setResolvedSrc] = useState(src)

  useEffect(() => {
    let disposed = false
    let objectUrlToRevoke: string | null = null
    setResolvedSrc(src)

    if (!storagePath)
      return () => {
        disposed = true
      }

    const resolveUrl = async () => {
      // Primary path: authenticated download + object URL. This works for private buckets
      // and avoids relying on public access.
      const { data: blobData, error: blobError } = await supabase.storage
        .from(NOTE_IMAGE_BUCKET)
        .download(storagePath)

      if (!disposed && !blobError && blobData) {
        objectUrlToRevoke = URL.createObjectURL(blobData)
        setResolvedSrc(objectUrlToRevoke)
        return
      }

      // Fallback: signed URL for projects that disallow direct public object fetch.
      const { data, error } = await supabase.storage
        .from(NOTE_IMAGE_BUCKET)
        .createSignedUrl(storagePath, 60 * 60 * 24 * 7)

      if (disposed) return
      if (!error && data?.signedUrl) {
        setResolvedSrc(data.signedUrl)
        return
      }

      const publicData = supabase.storage.from(NOTE_IMAGE_BUCKET).getPublicUrl(storagePath).data
      if (publicData?.publicUrl) {
        setResolvedSrc(publicData.publicUrl)
      }
    }

    void resolveUrl()

    return () => {
      disposed = true
      if (objectUrlToRevoke) URL.revokeObjectURL(objectUrlToRevoke)
    }
  }, [src, storagePath])

  return (
    <img
      src={resolvedSrc}
      data-storage-path={storagePath ?? undefined}
      alt={altText || 'Pasted image'}
      className="my-3 max-h-130 w-auto max-w-full rounded-lg border border-gray-200 object-contain"
    />
  )
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
    return <NoteImage src={this.__src} storagePath={this.__storagePath} altText={this.__altText} />
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
