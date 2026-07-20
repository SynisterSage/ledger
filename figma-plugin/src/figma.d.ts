declare const figma: {
  showUI: (html: string, options?: { width?: number; height?: number; themeColors?: boolean }) => void;
  ui: { onmessage: ((message: { type: string }) => void) | null; postMessage: (message: unknown) => void };
  currentPage: { id: string; name: string; selection: Array<{ id: string; name: string; type: string }> };
  root: { name: string };
  getNodeById: (id: string) => { setPluginData: (key: string, value: string) => void; getPluginData: (key: string) => string } | null;
  closePlugin: (message?: string) => void;
  openExternal: (url: string) => void;
  clientStorage: { getAsync: (key: string) => Promise<unknown>; setAsync: (key: string, value: unknown) => Promise<void>; deleteAsync: (key: string) => Promise<void> };
  on: (event: 'selectionchange', handler: () => void) => void;
};
declare const __html__: string;
