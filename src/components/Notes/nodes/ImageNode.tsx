import {
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  DecoratorNode,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  $applyNodeReplacement,
} from 'lexical'
import { supabase } from '../../../services/supabase'

export type SerializedImageNode = SerializedLexicalNode & {
  type: 'image'
  version: 3
  src: string
  altText: string
  storagePath?: string | null
  width?: number | null
}

const NOTE_IMAGE_BUCKET = 'note-images'
const DEFAULT_IMAGE_WIDTH = 560
const MIN_IMAGE_WIDTH = 180
const MAX_IMAGE_WIDTH = 960

const resolveImageSrc = (src: string, storagePath: string | null) => {
  const normalizedSrc = String(src ?? '').trim()
  if (
    normalizedSrc.startsWith('data:') ||
    normalizedSrc.startsWith('blob:') ||
    normalizedSrc.startsWith('file:')
  ) {
    return normalizedSrc
  }
  if (!storagePath) return normalizedSrc
  return supabase.storage.from(NOTE_IMAGE_BUCKET).getPublicUrl(storagePath).data?.publicUrl ?? normalizedSrc
}

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

const parseDimension = (value: string | null | undefined): number | null => {
  if (!value) return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null
}

function convertImageElement(domNode: Node): DOMConversionOutput | null {
  if (!(domNode instanceof HTMLImageElement)) return null
  const src = domNode.getAttribute('src') ?? ''
  const altText = domNode.getAttribute('alt') ?? ''
  const storagePath = domNode.getAttribute('data-storage-path') ?? extractStoragePathFromSrc(src)
  const width =
    parseDimension(domNode.getAttribute('width')) ??
    parseDimension(domNode.style.width) ??
    parseDimension(domNode.getAttribute('data-width'))
  return { node: $createImageNode({ src, altText, storagePath, width }) }
}

export class ImageNode extends DecoratorNode<null> {
  __src: string
  __altText: string
  __storagePath: string | null
  __width: number | null

  static getType(): string {
    return 'image'
  }

  static clone(node: ImageNode): ImageNode {
    return new ImageNode(node.__src, node.__altText, node.__storagePath, node.__width, node.__key)
  }

  static importJSON(serializedNode: SerializedImageNode): ImageNode {
    return $createImageNode({
      src: serializedNode.src,
      altText: serializedNode.altText,
      storagePath: serializedNode.storagePath ?? null,
      width: serializedNode.width ?? null,
    })
  }

  getWidth(): number | null {
    return this.__width
  }

  setWidth(width: number | null): this {
    const writable = this.getWritable()
    writable.__width = width
    return writable
  }

  exportJSON(): SerializedImageNode {
    return {
      ...super.exportJSON(),
      type: 'image',
      version: 3,
      src: this.__src,
      altText: this.__altText,
      storagePath: this.__storagePath ?? null,
      width: this.__width ?? null,
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
    element.setAttribute('src', resolveImageSrc(this.__src, this.__storagePath))
    element.setAttribute('alt', this.__altText)
    if (this.__storagePath) element.setAttribute('data-storage-path', this.__storagePath)
    if (this.__width) {
      element.setAttribute('width', String(this.__width))
      element.setAttribute('data-width', String(this.__width))
      element.style.width = `${this.__width}px`
      element.style.height = 'auto'
    }
    return { element }
  }

  constructor(
    src: string,
    altText: string,
    storagePath?: string | null,
    width?: number | null,
    key?: NodeKey
  ) {
    super(key)
    this.__src = src
    this.__altText = altText
    this.__storagePath = storagePath ?? null
    this.__width = width ?? null
  }

  createDOM(): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.setAttribute('data-lexical-image-node-key', this.getKey())
    wrapper.contentEditable = 'false'
    wrapper.className =
      'group relative my-4 block overflow-hidden rounded-2xl border border-[#E6D8C6] bg-white shadow-[0_10px_28px_rgba(15,23,42,0.08)]'
    wrapper.style.width = `${this.__width ?? DEFAULT_IMAGE_WIDTH}px`
    wrapper.style.maxWidth = '100%'
    wrapper.style.minWidth = `${MIN_IMAGE_WIDTH}px`
    wrapper.style.contain = 'layout paint'

    const img = document.createElement('img')
    img.src = resolveImageSrc(this.__src, this.__storagePath)
    img.alt = this.__altText || 'Pasted image'
    if (this.__storagePath) img.setAttribute('data-storage-path', this.__storagePath)
    if (this.__width) {
      img.setAttribute('width', String(this.__width))
      img.setAttribute('data-width', String(this.__width))
    }
    img.className = 'block h-auto w-full max-h-[72vh] select-none object-contain'
    img.draggable = false
    wrapper.appendChild(img)

    const handle = document.createElement('div')
    handle.setAttribute('aria-hidden', 'true')
    handle.className =
      'absolute bottom-1 right-1 h-4 w-4 cursor-se-resize rounded-md bg-[#FFF7ED] opacity-0 transition-opacity group-hover:opacity-100'
    handle.style.boxShadow = '0 0 0 1px rgba(255,95,64,0.14) inset'
    handle.innerHTML =
      '<div style="position:absolute;right:4px;bottom:4px;width:8px;height:8px;border-right:2px solid rgba(255,95,64,0.9);border-bottom:2px solid rgba(255,95,64,0.9);opacity:0.9;"></div>'

    let startX = 0
    let startWidth = 0
    let rafId = 0

    const stopDragging = () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', stopDragging)
      window.removeEventListener('pointercancel', stopDragging)
      wrapper.dataset.resizing = 'false'
      if (rafId) {
        window.cancelAnimationFrame(rafId)
        rafId = 0
      }
      document.body.style.userSelect = ''
    }

    const onPointerMove = (event: PointerEvent) => {
      event.preventDefault()
      const nextWidth = Math.max(
        MIN_IMAGE_WIDTH,
        Math.min(MAX_IMAGE_WIDTH, Math.round(startWidth + (event.clientX - startX)))
      )
      if (rafId) window.cancelAnimationFrame(rafId)
      rafId = window.requestAnimationFrame(() => {
        wrapper.style.width = `${nextWidth}px`
      })
    }

    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      startX = event.clientX
      startWidth = Math.round(wrapper.getBoundingClientRect().width)
      wrapper.dataset.resizing = 'true'
      document.body.style.userSelect = 'none'
      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', stopDragging)
      window.addEventListener('pointercancel', stopDragging)
    })

    wrapper.appendChild(handle)
    return wrapper
  }

  updateDOM(dom: HTMLElement): false {
    const wrapper = dom as HTMLDivElement
    const img = wrapper.querySelector('img')
    if (img) {
      img.src = resolveImageSrc(this.__src, this.__storagePath)
      img.alt = this.__altText || 'Pasted image'
    }
    if (this.__storagePath) {
      img?.setAttribute('data-storage-path', this.__storagePath)
    } else {
      img?.removeAttribute('data-storage-path')
    }
    if (this.__width) {
      wrapper.style.width = `${this.__width}px`
      img?.setAttribute('width', String(this.__width))
      img?.setAttribute('data-width', String(this.__width))
    } else {
      wrapper.style.width = `${DEFAULT_IMAGE_WIDTH}px`
      img?.removeAttribute('width')
      img?.removeAttribute('data-width')
    }
    return false
  }

  decorate(): null {
    return null
  }
}

export function $createImageNode({
  src,
  altText = '',
  storagePath = null,
  width = null,
}: {
  src: string
  altText?: string
  storagePath?: string | null
  width?: number | null
}): ImageNode {
  return $applyNodeReplacement(new ImageNode(src, altText, storagePath, width))
}

export function $isImageNode(node: LexicalNode | null | undefined): node is ImageNode {
  return node instanceof ImageNode
}
