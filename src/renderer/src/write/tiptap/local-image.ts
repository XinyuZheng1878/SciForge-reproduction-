import { Image } from '@tiptap/extension-image'
import {
  resolveWriteMarkdownResource,
  resolveWriteMarkdownResourcePath
} from '@shared/write-markdown-resource'

export type WriteLocalImageOptions = {
  className?: string
  getFilePath?: () => string
}

/**
 * Image node for rich markdown editing. It keeps the raw markdown `src`
 * attribute intact for serialization while rendering a plain img element in
 * the editor.
 */
export const WriteLocalImage = Image.extend<WriteLocalImageOptions>({
  addOptions() {
    return {
      ...this.parent?.(),
      allowBase64: true,
      className: 'write-rich-image',
      getFilePath: () => ''
    }
  },

  addNodeView() {
    if (typeof document === 'undefined') return null

    return ({ node }) => {
      const dom = document.createElement('img')
      dom.className = this.options.className || 'write-rich-image'
      dom.draggable = true

      const applyAttrs = (attrs: typeof node.attrs): void => {
        const src = typeof attrs.src === 'string' ? attrs.src : ''
        const alt = typeof attrs.alt === 'string' ? attrs.alt : ''
        const title = typeof attrs.title === 'string' ? attrs.title : ''
        const filePath = this.options.getFilePath?.() || null
        const resolved = resolveWriteMarkdownResource(src, filePath)
        if (resolved) dom.src = resolved
        else dom.removeAttribute('src')
        dom.alt = alt
        if (title) dom.title = title
        else dom.removeAttribute('title')
        dom.dataset.rawSrc = src
        const localPath = resolveWriteMarkdownResourcePath(src, filePath)
        if (!localPath || typeof window.sciforge?.readWorkspaceImage !== 'function') return
        void window.sciforge.readWorkspaceImage({ path: localPath })
          .then((result) => {
            if (dom.dataset.rawSrc !== src) return
            if (result.ok) {
              dom.src = result.dataUrl
              dom.classList.remove('write-rich-image-error')
              dom.removeAttribute('title')
              return
            }
            dom.classList.add('write-rich-image-error')
            dom.title = result.message
          })
          .catch((error) => {
            if (dom.dataset.rawSrc !== src) return
            dom.classList.add('write-rich-image-error')
            dom.title = error instanceof Error ? error.message : String(error)
          })
      }

      applyAttrs(node.attrs)

      return {
        dom,
        update: (updated) => {
          if (updated.type.name !== node.type.name) return false
          applyAttrs(updated.attrs)
          return true
        }
      }
    }
  }
})
