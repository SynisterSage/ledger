import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { zipSync } from 'fflate';

export type ExportFormat = 'pdf' | 'png' | 'txt' | 'html';

interface ExportNote {
  id: string;
  title: string;
  content: string;
  date?: string;
  created_at?: string;
}

interface ExportMindMap {
  id: string;
  title: string;
  element: HTMLElement;
  created_at?: string;
}

const formatTimestamp = (date?: string) => {
  if (!date) return new Date().toLocaleDateString();
  return new Date(date).toLocaleDateString();
};

const sanitizeFilename = (name: string, fallback = 'untitled-note'): string => {
  const sanitized = name
    .replace(/[^a-z0-9\s]/gi, '')
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 50);
  return sanitized || fallback;
};

const getUniqueArchiveFilename = (title: string, format: ExportFormat, usedNames: Set<string>) => {
  const base = sanitizeFilename(title);
  const extension = format;
  let filename = `${base}.${extension}`;
  let suffix = 2;
  while (usedNames.has(filename)) {
    filename = `${base}-${suffix}.${extension}`;
    suffix += 1;
  }
  usedNames.add(filename);
  return filename;
};

const downloadFile = (content: Blob | string, filename: string) => {
  const blob = typeof content === 'string' ? new Blob([content], { type: 'text/plain' }) : content;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const hasUnsupportedColorFunction = (value: string) =>
  /oklch\(|oklab\(|\boklab\b|lch\(|lab\(|color\(|color-mix\(|var\(/i.test(value);

const sanitizeInlineStyle = (element: Element) => {
  const htmlElement = element as HTMLElement;
  const style = htmlElement.style;
  if (!style) return;

  for (let index = style.length - 1; index >= 0; index -= 1) {
    const property = style.item(index);
    const value = style.getPropertyValue(property);
    if (property.startsWith('--') || hasUnsupportedColorFunction(value)) {
      style.removeProperty(property);
    }
  }
};

const buildInlineStyleSnapshot = (sourceRoot: HTMLElement) => {
  const wrapper = document.createElement('div');
  wrapper.style.position = 'fixed';
  wrapper.style.left = '-20000px';
  wrapper.style.top = '0';
  wrapper.style.padding = '0';
  wrapper.style.margin = '0';
  wrapper.style.background = '#ffffff';
  wrapper.style.zIndex = '-1';

  const sourceToClone = new Map<Element, Element>();

  const cloneTree = (source: Node): Node => {
    if (source.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(source.textContent ?? '');
    }

    if (source.nodeType !== Node.ELEMENT_NODE) {
      return document.createTextNode('');
    }

    const sourceElement = source as Element;
    const clone = sourceElement.cloneNode(false) as Element;
    clone.removeAttribute('class');
    clone.removeAttribute('style');
    sourceToClone.set(sourceElement, clone);
    for (const child of Array.from(source.childNodes)) {
      clone.appendChild(cloneTree(child));
    }
    return clone;
  };

  const cloneRoot = cloneTree(sourceRoot) as HTMLElement;
  wrapper.appendChild(cloneRoot);
  document.body.appendChild(wrapper);

  const applyComputedStyles = (source: Element) => {
    const clone = sourceToClone.get(source) as HTMLElement | SVGElement | undefined;
    if (!clone) return;
    const computed = window.getComputedStyle(source as HTMLElement);

    for (const property of Array.from(computed)) {
      // Skip CSS custom props (Tailwind vars often contain oklch()).
      if (property.startsWith('--')) continue;
      const value = computed.getPropertyValue(property);
      const priority = computed.getPropertyPriority(property);
      // html2canvas currently fails on modern color functions in declarations.
      if (!value || hasUnsupportedColorFunction(value)) continue;
      if (value) {
        (clone as HTMLElement).style.setProperty(property, value, priority);
      }
    }
    sanitizeInlineStyle(clone);

    for (const child of Array.from(source.children)) {
      applyComputedStyles(child);
    }
  };

  applyComputedStyles(sourceRoot);

  return {
    element: cloneRoot,
    cleanup: () => {
      wrapper.remove();
    },
  };
};

const createNoteExportBlob = async (
  note: ExportNote,
  format: 'html' | 'pdf' | 'txt' = 'pdf'
): Promise<Blob> => {
  const cleanContent = note.content.replace(/<[^>]*>/g, '').trim();

  if (format === 'txt') {
    const textContent = `${note.title}
Date: ${note.date || 'Not set'}
Created: ${formatTimestamp(note.created_at)}

${cleanContent}`;
    return new Blob([textContent], { type: 'text/plain;charset=utf-8' });
  }

  if (format === 'html') {
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
</html>`;
    return new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
  }

  const pdf = new jsPDF();
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 15;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(18);
  const titleLinesRaw = pdf.splitTextToSize(note.title, pageWidth - margin * 2);
  const titleLines = Array.isArray(titleLinesRaw) ? titleLinesRaw : [String(titleLinesRaw)];
  pdf.text(titleLines, margin, margin);

  let yPosition = margin + titleLines.length * 7 + 5;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.setTextColor(100);
  pdf.text(`Date: ${note.date || 'Not set'}`, margin, yPosition);
  yPosition += 5;
  pdf.text(`Created: ${formatTimestamp(note.created_at)}`, margin, yPosition);
  yPosition += 10;

  pdf.setTextColor(0);
  pdf.setFontSize(11);
  const contentLinesRaw = pdf.splitTextToSize(cleanContent, pageWidth - margin * 2);
  const contentLines = Array.isArray(contentLinesRaw) ? contentLinesRaw : [String(contentLinesRaw)];
  const lineHeight = 5;

  for (const line of contentLines) {
    if (yPosition > pageHeight - margin) {
      pdf.addPage();
      yPosition = margin;
    }
    pdf.text(line, margin, yPosition);
    yPosition += lineHeight;
  }

  return pdf.output('blob');
};

/**
 * Export one regular note as a single file.
 */
export const exportNote = async (note: ExportNote, format: 'html' | 'pdf' | 'txt' = 'pdf') => {
  try {
    const blob = await createNoteExportBlob(note, format);
    downloadFile(blob, `${sanitizeFilename(note.title)}.${format}`);
  } catch (error) {
    console.error('Export failed:', error);
    throw error;
  }
};

const downloadZip = async (files: Array<{ name: string; blob: Blob }>, filename: string) => {
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) {
    entries[file.name] = new Uint8Array(await file.blob.arrayBuffer());
  }
  const archive = zipSync(entries, { level: 6 });
  downloadFile(new Blob([archive.buffer as ArrayBuffer], { type: 'application/zip' }), filename);
};

/**
 * Export multiple notes as one ZIP archive, with one file per note.
 */
export const bulkExportNotes = async (
  notes: ExportNote[],
  format: 'html' | 'pdf' | 'txt' = 'pdf'
) => {
  if (notes.length === 0) return;
  const usedNames = new Set<string>();
  const files = await Promise.all(
    notes.map(async (note) => ({
      name: getUniqueArchiveFilename(note.title, format, usedNames),
      blob: await createNoteExportBlob(note, format),
    }))
  );
  await downloadZip(files, `ledger-notes-${new Date().toISOString().slice(0, 10)}.zip`);
};

const createMindMapExportBlob = async (
  mindMap: ExportMindMap,
  format: ExportFormat = 'pdf'
): Promise<Blob> => {
  if (format === 'txt') {
    const textNodes: string[] = [];
    const extractText = (el: HTMLElement, indent = 0) => {
      const text = el.innerText?.trim();
      if (text) textNodes.push('  '.repeat(indent) + text);
      Array.from(el.children).forEach((child) => extractText(child as HTMLElement, indent + 1));
    };
    extractText(mindMap.element);
    return new Blob([`${mindMap.title}\n\n${textNodes.join('\n')}`], {
      type: 'text/plain;charset=utf-8',
    });
  }

  // Snapshot with inline computed styles avoids html2canvas failures on unsupported
  // modern CSS color functions (e.g. oklch) coming from global stylesheets.
  const snapshot = buildInlineStyleSnapshot(mindMap.element);
  let canvas: HTMLCanvasElement;
  try {
    canvas = await html2canvas(snapshot.element, {
      scale: 2,
      backgroundColor: '#ffffff',
      logging: false,
      useCORS: true,
      allowTaint: true,
      onclone: (clonedDocument) => {
        // Remove external styles so html2canvas only sees the safe inline snapshot.
        clonedDocument
          .querySelectorAll('style,link[rel="stylesheet"]')
          .forEach((node) => node.remove());
        clonedDocument.querySelectorAll('*').forEach((node) => {
          node.removeAttribute('class');
          sanitizeInlineStyle(node);
        });

        const style = clonedDocument.createElement('style');
        style.textContent = `
              * {
                box-sizing: border-box;
              }
              html, body {
                margin: 0;
                padding: 0;
                background: #ffffff;
              }
            `;
        clonedDocument.head.appendChild(style);
      },
    });
  } finally {
    snapshot.cleanup();
  }

  if (format === 'png') {
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) reject(new Error('Failed to convert canvas to blob'));
        else resolve(blob);
      }, 'image/png');
    });
  }

  const imgData = canvas.toDataURL('image/png');
  const pdf = new jsPDF({
    orientation: canvas.width >= canvas.height ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 10;
  const maxWidth = pageWidth - margin * 2;
  const maxHeight = pageHeight - margin * 2 - 10;

  const widthScale = maxWidth / canvas.width;
  const heightScale = maxHeight / canvas.height;
  const scale = Math.min(widthScale, heightScale, 1);
  const renderWidth = canvas.width * scale;
  const renderHeight = canvas.height * scale;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(14);
  pdf.text(mindMap.title, margin, 8);

  const x = margin + (maxWidth - renderWidth) / 2;
  const y = 14 + (maxHeight - renderHeight) / 2;
  pdf.addImage(imgData, 'PNG', x, y, renderWidth, renderHeight);

  return pdf.output('blob');
};

/**
 * Export one mind map as a single file.
 */
export const exportMindMap = async (mindMap: ExportMindMap, format: ExportFormat = 'pdf') => {
  try {
    const blob = await createMindMapExportBlob(mindMap, format);
    downloadFile(blob, `${sanitizeFilename(mindMap.title)}.${format}`);
  } catch (error) {
    console.error('Mind map export failed:', error);
    throw error;
  }
};

/**
 * Export multiple mind maps as one ZIP archive.
 */
export const bulkExportMindMaps = async (
  mindMaps: ExportMindMap[],
  format: ExportFormat = 'pdf'
) => {
  if (mindMaps.length === 0) return;
  const usedNames = new Set<string>();
  const files = await Promise.all(
    mindMaps.map(async (mindMap) => ({
      name: getUniqueArchiveFilename(mindMap.title, format, usedNames),
      blob: await createMindMapExportBlob(mindMap, format),
    }))
  );
  await downloadZip(files, `ledger-mind-maps-${new Date().toISOString().slice(0, 10)}.zip`);
};
