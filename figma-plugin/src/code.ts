const readSelection = () => {
  const fileKey = (figma as unknown as { fileKey?: string }).fileKey;
  return { nodes: figma.currentPage.selection.slice(0, 100).map((node) => ({ id: String(node.id), name: String(node.name).slice(0, 200), type: String(node.type) })), pageId: String(figma.currentPage.id), pageName: String(figma.currentPage.name).slice(0, 200), fileName: String(figma.root.name).slice(0, 200), ...(fileKey ? { fileKey: String(fileKey).slice(0, 128) } : {}), fileKeyAvailable: Boolean(fileKey) };
};
figma.showUI(__html__, { width: 360, height: 520, themeColors: true });
const postSelection = () => figma.ui.postMessage({ type: 'selection-context', context: readSelection() });
figma.ui.onmessage = (message) => {
  if (message.type === 'request-selection') postSelection();
  if (message.type === 'node-reference-set') {
    const payload = message as unknown as { nodeId?: string; value?: string };
    const node = figma.getNodeById(String(payload.nodeId ?? ''));
    const value = String(payload.value ?? '');
    if (node && value.length <= 4000) node.setPluginData('ledger_reference_v1', value);
  }
  if (message.type === 'node-reference-get') {
    const payload = message as unknown as { nodeId?: string; requestId?: string };
    const node = figma.getNodeById(String(payload.nodeId ?? ''));
    figma.ui.postMessage({ type: 'node-reference-response', requestId: String(payload.requestId ?? ''), value: node?.getPluginData('ledger_reference_v1') || null });
  }
  if (message.type === 'storage-get' || message.type === 'storage-set' || message.type === 'storage-delete') {
    const requestId = String((message as unknown as { requestId?: string }).requestId ?? '');
    const key = String((message as unknown as { key?: string }).key ?? '');
    if (!requestId || !key || key.length > 120) return;
    void (async () => {
      if (message.type === 'storage-get') figma.ui.postMessage({ type: 'storage-response', requestId, value: await figma.clientStorage.getAsync(key) });
      else if (message.type === 'storage-set') { await figma.clientStorage.setAsync(key, (message as unknown as { value?: unknown }).value); figma.ui.postMessage({ type: 'storage-response', requestId, ok: true }); }
      else { await figma.clientStorage.deleteAsync(key); figma.ui.postMessage({ type: 'storage-response', requestId, ok: true }); }
    })();
  }
  if (message.type === 'open-external' && typeof (message as { url?: unknown }).url === 'string') {
    try { const url = new URL(String((message as unknown as { url: string }).url)); if (['https:', 'http:'].includes(url.protocol) && ['ledgerworkspace.com', 'www.ledgerworkspace.com', 'api.ledgerworkspace.com', 'localhost', '127.0.0.1'].includes(url.hostname)) figma.openExternal(url.toString()); } catch { /* reject arbitrary URLs */ }
  }
  if (message.type === 'close') figma.closePlugin();
};
figma.on('selectionchange', postSelection);
postSelection();
