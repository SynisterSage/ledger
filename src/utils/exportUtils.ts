import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'

export type ExportFormat = 'pdf' | 'png' | 'txt' | 'html'

interface ExportNote {
  id: string
  title: string
  content: string
  date?: string
  created_at?: string
}

interface ExportMindMap {
  id: string
  title: string
  element: HTMLElement
  created_at?: string
}

const formatTimestamp = (date?: string) => {
  if (!date) return new Date().toLocaleDateString()
  return new Date(date).toLocaleDateString()
}

const sanitizeFilename = (name: string): string => {
  return name.replace(/[^a-z0-9\s]/gi, '').replace(/\s+/g, '-').toLowerCase().slice(0, 50)
}

const downloadFile = (content: Blob | string, filename: string) => {
  const blob = typeof content === 'string' ? new Blob([content], { type: 'text/plain' }) : content
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Export regular notes in various formats
 */
export const exportNote = async (note: ExportNote, format: 'html' | 'pdf' | 'txt' = 'pdf') => {
  try {
    const cleanContent = note.content.replace(/<[^>]*>/g, '').trim()
    const filename = `${sanitizeFilename(note.title)}.${format}`

    if (format === 'txt') {
      const textContent = `${note.title}
Date: ${note.date || 'Not set'}
Created: ${formatTimestamp(note.created_at)}

${cleanContent}`
      downloadFile(textContent, filename)
    } else if (format === 'html') {
      const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${note.title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px; }
    h1 { color: #1a1a1a; margin-bottom: 10px; }
    .meta { color: #666; font-size: 14px; margin-bottom: 20px; border-bottom: 1px solid #eee; padding-bottom: 10px; }
    .content { margin-top: 20px; }
  </style>
</head>
<body>
  <h1>${note.title}</h1>
  <div class="meta">
    <p><strong>Date:</strong> ${note.date || 'Not set'}</p>
    <p><strong>Created:</strong> ${formatTimestamp(note.created_at)}</p>
  </div>
  <div class="content">${note.content}</div>
</body>
</html>`
      downloadFile(new Blob([htmlContent], { type: 'text/html' }), filename)
    } else if (format === 'pdf') {
      const pdf = new jsPDF()
      const pageWidth = pdf.internal.pageSize.getWidth()
      const pageHeight = pdf.internal.pageSize.getHeight()
      const margin = 15

      // Title
      pdf.setFont(undefined, 'bold')
      pdf.setFontSize(18)
      const titleLines = pdf.splitTextToSize(note.title, pageWidth - margin * 2)
      pdf.text(titleLines, margin, margin)

      // Metadata
      let yPosition = margin + titleLines.length * 7 + 5
      pdf.setFont(undefined, 'normal')
      pdf.setFontSize(10)
      pdf.setTextColor(100)
      pdf.text(`Date: ${note.date || 'Not set'}`, margin, yPosition)
      yPosition += 5
      pdf.text(`Created: ${formatTimestamp(note.created_at)}`, margin, yPosition)
      yPosition += 10

      // Content
      pdf.setTextColor(0)
      pdf.setFontSize(11)
      const contentLines = pdf.splitTextToSize(cleanContent, pageWidth - margin * 2)
      pdf.text(contentLines, margin, yPosition)

      pdf.save(filename)
    }
  } catch (error) {
    console.error('Export failed:', error)
    throw error
  }
}

/**
 * Export mind map as PDF, PNG, or TXT
 */
export const exportMindMap = async (mindMap: ExportMindMap, format: ExportFormat = 'pdf') => {
  try {
    const filename = `${sanitizeFilename(mindMap.title)}`

    if (format === 'txt') {
      // Export mind map structure as indented text
      const element = mindMap.element
      const textNodes: string[] = []
      const extractText = (el: HTMLElement, indent = 0) => {
        const text = el.innerText?.trim()
        if (text && text.length > 0) {
          textNodes.push('  '.repeat(indent) + text)
        }
        el.children && Array.from(el.children).forEach((child) => extractText(child as HTMLElement, indent + 1))
      }
      extractText(element)
      const textContent = `${mindMap.title}\n\n${textNodes.join('\n')}`
      downloadFile(textContent, `${filename}.txt`)
    } else {
      // Clone the element to avoid modifying the original
      const clone = mindMap.element.cloneNode(true) as HTMLElement

      // Capture canvas
      const canvas = await html2canvas(clone, {
        scale: 2,
        backgroundColor: '#ffffff',
        logging: false,
      })

      if (format === 'png') {
        // Export as PNG
        canvas.toBlob((blob) => {
          if (!blob) return
          downloadFile(blob, `${filename}.png`)
        }, 'image/png')
      } else if (format === 'pdf') {
        // Export as PDF
        const imgData = canvas.toDataURL('image/png')
        const imgWidth = 210 // A4 width in mm
        const imgHeight = (canvas.height * imgWidth) / canvas.width

        const pdf = new jsPDF({
          orientation: imgHeight > imgWidth ? 'portrait' : 'landscape',
          unit: 'mm',
          format: 'a4',
        })

        const pageHeight = pdf.internal.pageSize.getHeight()
        const pageWidth = pdf.internal.pageSize.getWidth()
        let heightLeft = imgHeight
        let position = 0

        // Add title
        pdf.setFont(undefined, 'bold')
        pdf.setFontSize(14)
        pdf.text(mindMap.title, 10, 10)

        // Add image with pagination
        position = 25
        while (heightLeft >= 0) {
          const sourceY = position - 25
          pdf.addImage(imgData, 'PNG', 0, position, pageWidth, imgHeight)
          heightLeft -= pageHeight
          position += pageHeight
          if (heightLeft > 0) {
            pdf.addPage()
            position = 0
          }
        }

        pdf.save(`${filename}.pdf`)
      }
    }
  } catch (error) {
    console.error('Mind map export failed:', error)
    throw error
  }
}

/**
 * Bulk export multiple notes
 */
export const bulkExportNotes = async (notes: ExportNote[], format: 'html' | 'pdf' | 'txt' = 'pdf') => {
  for (const note of notes) {
    await exportNote(note, format)
    // Small delay between exports to prevent browser blocking
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

/**
 * Bulk export multiple mind maps
 */
export const bulkExportMindMaps = async (mindMaps: ExportMindMap[], format: ExportFormat = 'pdf') => {
  for (const mindMap of mindMaps) {
    await exportMindMap(mindMap, format)
    // Small delay between exports
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
}
