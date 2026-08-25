/// <reference types="vite/client" />

type SidebarWindowMode = 'auth' | 'minimized' | 'compact' | 'expanded' | 'fullscreen';
type ModuleWindowKind =
  | 'new-tab'
  | 'circle'
  | 'calendar'
  | 'notes'
  | 'projects'
  | 'teams'
  | 'dashboard'
  | 'notifications'
  | 'settings'
  | 'inbox'
  | 'slack'
  | 'quick-follow-up'
  | 'quick-task'
  | 'quick-note'
  | 'quick-event'
  | 'quick-reminder';
type ModuleFocusPayload = {
  kind?: ModuleWindowKind;
  historyMode?: 'push' | 'replace';
  focusDate?: string | null;
  focusProjectId?: string | null;
  focusNoteId?: string | null;
  focusTaskId?: string | null;
  focusInboxId?: string | null;
  focusContext?: string | null;
  focusSection?: string | null;
};
type LedgerTabSession = {
  tabId: string;
  workspaceId?: string | null;
  module: ModuleWindowKind;
  route: ModuleFocusPayload & { kind: ModuleWindowKind };
  selectedResourceId?: string | null;
  routeState?: Record<string, unknown>;
  tabHistory: Array<ModuleFocusPayload & { kind: ModuleWindowKind }>;
  historyIndex: number;
  title?: string;
  icon?: string;
};

interface ImportMetaEnv {
  readonly VITE_ICAL_SERVICE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  ledgerIpc?: {
    events?: Record<string, (listenerOrSubscription: ((...args: any[]) => void) | string) => string | void>;
    commands?: Record<string, (payload?: any) => Promise<unknown> | void>;
  };
  __LEDGER_RUNTIME__?: {
    apiUrl?: string;
    ledgerWebUrl?: string;
    supabaseUrl?: string;
    supabasePublishableKey?: string;
  };
  meetingAudio?: {
    devices: () => Promise<{ devices: Array<{ id: string; name: string; kind: 'input'; available: boolean; isBluetooth: boolean; isDefault: boolean; isOutputDefault: boolean; channelCount: number }>; outputDevice: { id: string; name: string; isBluetooth: boolean } | null }>;
    permissions: () => Promise<{
      microphone: 'not_requested' | 'granted' | 'denied' | 'restricted' | 'requires_restart' | 'unavailable';
      systemAudio: 'not_requested' | 'granted' | 'denied' | 'restricted' | 'requires_restart' | 'unavailable';
    }>;
    requestPermissions: () => Promise<{
      microphone: 'not_requested' | 'granted' | 'denied' | 'restricted' | 'requires_restart' | 'unavailable';
      systemAudio: 'not_requested' | 'granted' | 'denied' | 'restricted' | 'requires_restart' | 'unavailable';
    }>;
    openSystemSettings: (area: 'microphone' | 'screen-recording') => Promise<boolean>;
    status: () => Promise<unknown>;
    storagePath: () => Promise<string>;
    openStoragePath: () => Promise<{ ok: boolean; error?: string }>;
    recoveries: () => Promise<unknown>;
    inspect: (sessionId?: string) => Promise<unknown>;
    recover: (payload: { sessionId: string; noteId: string; workspaceId: string }) => Promise<unknown>;
    discardRecovery: (sessionId: string) => Promise<unknown>;
    start: (payload: { noteId: string; workspaceId: string; microphone: boolean; systemAudio: boolean; microphoneDeviceId?: string | null }) => Promise<unknown>;
    testSource: (source: 'user_microphone' | 'system_audio', microphoneDeviceId?: string | null) => Promise<unknown>;
    pause: () => Promise<unknown>;
    resume: () => Promise<unknown>;
    stop: () => Promise<unknown>;
    reveal: (payload: { sessionId: string }) => Promise<unknown>;
    deleteAudio: (payload: { sessionId: string; source?: 'user_microphone' | 'system_audio' }) => Promise<unknown>;
    play: (payload: { sessionId: string; source: 'user_microphone' | 'system_audio' }) => Promise<unknown>;
    onLevel: (listener: (event: { source: 'user_microphone' | 'system_audio'; level: number }) => void) => () => void;
    onError: (listener: (event: { source: 'user_microphone' | 'system_audio'; error: string }) => void) => () => void;
    onDevicesChanged: (listener: () => void) => () => void;
  };
  meetingTranscription?: {
    modelStatus: () => Promise<unknown>;
    downloadModel: () => Promise<unknown>;
    cancelModelDownload: () => Promise<unknown>;
    deleteModel: () => Promise<unknown>;
    prepare: (payload: { sessionId: string; noteId: string; workspaceId: string }) => Promise<unknown>;
    status: (jobId?: string) => Promise<unknown>;
    start: (payload: { sessionId: string; noteId: string; workspaceId: string; force?: boolean }) => Promise<unknown>;
    cancel: (jobId: string) => Promise<unknown>;
    results: (jobId: string) => Promise<unknown>;
    complete: (payload: { jobId: string; retention: 'delete_after_transcription' | 'retain' }) => Promise<unknown>;
    fail: (payload: { jobId: string; error: string }) => Promise<unknown>;
    onProgress: (listener: (event: unknown) => void) => () => void;
    onSegments: (listener: (event: unknown) => void) => () => void;
    onModelChange: (listener: (event: unknown) => void) => () => void;
  };
  askLedger?: {
    generateOverviewFocus: (snapshot: unknown, options?: { previousResult?: unknown }) => Promise<{ insights: unknown[] }>;
    generateProjectLens: (payload: unknown) => Promise<unknown>;
    generateProjectLensAction: (payload: unknown) => Promise<unknown>;
    generateMeetingRecap: (payload: unknown) => Promise<unknown>;
    generateMeetingPeople: (payload: unknown) => Promise<unknown>;
    generateMeetingPrep: (payload: unknown) => Promise<unknown>;
    listSkills: () => Promise<unknown[]>;
    selectAttachments: (payload: { workspaceId: string; conversationId: string; existingCount?: number; existingSizeBytes?: number }) => Promise<unknown>;
    openAttachment: (attachmentId: string) => Promise<{ ok: boolean; error?: string }>;
    removeAttachments: (payload: { conversationId: string; attachmentIds: string[] }) => Promise<{ ok: boolean }>;
    localAIStatus: () => Promise<unknown>;
    localAIHardware: () => Promise<unknown>;
    localAICapability: () => Promise<unknown>;
    acknowledgeLocalAITier: (tier: 'fast' | 'balanced') => Promise<unknown>;
    getGenerationModels: () => Promise<unknown>;
    getAvailableGenerationModels: () => Promise<unknown>;
    getSelectedGenerationTier: () => Promise<'fast' | 'balanced'>;
    setSelectedGenerationTier: (tier: 'fast' | 'balanced') => Promise<unknown>;
    switchGenerationTier: (tier: 'fast' | 'balanced') => Promise<unknown>;
    getGenerationRuntimeState: () => Promise<unknown>;
    getGenerationModelStatus: (modelId: string) => Promise<unknown>;
    downloadGenerationModel: (modelId: string) => Promise<unknown>;
    cancelGenerationModelDownload: (modelId: string) => Promise<unknown>;
    removeGenerationModel: (modelId: string) => Promise<unknown>;
    downloadLocalAI: (role: 'generation' | 'embedding') => Promise<unknown>;
    cancelLocalAIDownload: (role: 'generation' | 'embedding') => Promise<unknown>;
    removeLocalAI: (role: 'generation' | 'embedding') => Promise<unknown>;
    onLocalAIStatus: (listener: (event: unknown) => void) => () => void;
    onGenerationRuntimeState: (listener: (event: unknown) => void) => () => void;
    start: (payload: { requestId?: string; question: string; workspaceId: string; documents: unknown[]; lexicalResults: unknown[]; conversation?: unknown; skillId?: string; customSkill?: unknown; explicitContext?: unknown; attachmentIds?: string[]; reasoningMode?: 'off' | 'thinking'; timeZone?: string; timeFormat?: '12h' | '24h'; messageId?: string; performance?: { uiSubmitStartedAt?: number; preflightStartedAt?: number; preflightCompletedAt?: number } }) => Promise<{ requestId: string }>;
    executeSkill: (payload: { skillId: string; question: string; workspaceId: string; documents: unknown[]; lexicalResults: unknown[]; conversation?: unknown; explicitContext?: unknown }) => Promise<{ requestId: string }>;
    cancel: (requestId: string) => Promise<{ ok: boolean }>;
    onStream: (listener: (event: unknown) => void) => () => void;
  };
  desktopWindow?: {
    platform?: string;
    getDeviceSessionId: (legacyDeviceId?: string) => string;
    getRenderingSettings: () => Promise<{
      mode: 'auto' | 'high_quality' | 'compatibility';
      platform: string;
    }>;
    getSidebarAccessibilityState: () => Promise<{
      prefersReducedTransparency: boolean;
    }>;
    getSidebarMaterialState?: () => Promise<{
      requestedEngine:
        | 'solid'
        | 'renderer'
        | 'native-macos'
        | 'native-windows-mica'
        | 'native-windows-mica-alt'
        | 'native-windows-acrylic';
      resolvedEngine:
        | 'solid'
        | 'renderer'
        | 'native-macos'
        | 'native-windows-mica'
        | 'native-windows-mica-alt'
        | 'native-windows-acrylic';
      featureFlagEnabled: boolean;
      nativeMaterialActive?: boolean;
      fallbackReason?: string | null;
      requestedMacVibrancy?: 'under-window' | 'sidebar' | 'hud';
      resolvedMacVibrancy?: 'under-window' | 'sidebar' | 'hud' | null;
      visualEffectState?: 'followWindow' | 'active';
      frostedBackgroundEnabled: boolean;
      prefersReducedTransparency: boolean;
      electronVersion?: string;
      osVersion?: string;
      prefersHighContrast?: boolean;
      macOSVersion?: string;
      windowsVersion?: string;
      transparencyEffectsAvailable?: boolean;
      failure?: string;
    }>;
    setSidebarMaterialDevelopmentSelection?: (enabled: boolean | 'under-window' | 'sidebar' | 'hud' | 'mica' | 'mica-alt' | 'acrylic') => Promise<{
      enabled: boolean;
      engine:
        | 'solid'
        | 'renderer'
        | 'native-macos'
        | 'native-windows-mica'
        | 'native-windows-mica-alt'
        | 'native-windows-acrylic';
      supported: boolean;
    }>;
    setSidebarMaterialDevelopmentVisualEffectState?: (state: 'followWindow' | 'active') => Promise<{
      supported: boolean;
    }>;
    resetSidebarMaterialDiagnostics?: () => Promise<unknown>;
    setRenderingMode: (mode: 'auto' | 'high_quality' | 'compatibility') => Promise<{
      mode: 'auto' | 'high_quality' | 'compatibility';
      requiresRestart: true;
    }>;
    restartApp: () => Promise<void>;
    setMode: (mode: SidebarWindowMode) => Promise<void>;
    setVisible: (isVisible: boolean) => Promise<void>;
    hideTemporary: () => Promise<void>;
    quitApp: () => Promise<void>;
    setAlwaysOnTop: (alwaysOnTop: boolean) => Promise<void>;
    setFloatingPosition: (position: { x: number; y: number }) => Promise<void>;
    beginFloatingDrag: () => Promise<{ x: number; y: number }>;
    finishFloatingDrag: () => Promise<{
      x: number;
      y: number;
      width: number;
      height: number;
    } | null>;
    updateFloatingDrag: () => Promise<{
      x: number;
      y: number;
      width: number;
      height: number;
    } | null>;
    beginHeaderDrag: () => Promise<{
      x: number;
      y: number;
      width: number;
      height: number;
    } | null>;
    updateHeaderDrag: () => Promise<{
      x: number;
      y: number;
      width: number;
      height: number;
    } | null>;
    finishHeaderDrag: () => Promise<{
      x: number;
      y: number;
      width: number;
      height: number;
    } | null>;
    applySidebarPreferences: (preferences: {
      position?: 'right' | 'left' | 'top' | 'bottom' | 'floating';
      opacity?: number;
      frostedBackgroundEnabled?: boolean;
      defaultState?: 'expanded' | 'collapsed' | 'remember';
      alwaysOnTop?: boolean;
      shellFullscreen?: boolean;
      autoHide?: boolean;
      isExpanded?: boolean;
      collapsedRestoreIsExpanded?: boolean;
      isHidden?: boolean;
      floatingPosition?: { x: number; y: number };
      floatingDockEnabled?: boolean;
      floatingDockThreshold?: number;
      lastState?: 'expanded' | 'collapsed';
    }) => Promise<void>;
    previewSidebarOpacity: (opacity: number) => void;
    dockFloatingWindow: () => Promise<{
      x: number;
      y: number;
      width: number;
      height: number;
    } | null>;
    detachFloatingWindow: () => Promise<void>;
    getFloatingDockState: () => Promise<{
      isDocked: boolean;
      attachmentStatus: string;
      side: 'right' | 'left' | 'top' | 'bottom' | 'floating' | null;
    }>;
    openSearchInWorkspaceWindow?: (query?: string) => Promise<boolean>;
    toggleModule: (kind: ModuleWindowKind, focus?: string | ModuleFocusPayload) => Promise<void>;
    openModule: (kind: ModuleWindowKind, focus?: string | ModuleFocusPayload) => Promise<void>;
    closeModule: (kind: ModuleWindowKind) => Promise<void>;
    minimizeModule: (kind: ModuleWindowKind) => Promise<void>;
    toggleModuleFullscreen: (kind: ModuleWindowKind) => Promise<boolean>;
    goBackWorkspaceWindow?: () => Promise<void>;
    goForwardWorkspaceWindow?: () => Promise<void>;
    getWorkspaceNavigationState?: () => Promise<{
      canGoBack: boolean;
      canGoForward: boolean;
      currentModule: ModuleWindowKind | null;
      currentRoute?: ModuleFocusPayload | null;
      recentRoutes?: ModuleFocusPayload[];
      windowId?: string;
    }>;
    clearWorkspaceRecent?: () => Promise<boolean>;
    getWindowBounds?: () => Promise<{
      x: number;
      y: number;
      width: number;
      height: number;
      windowId?: string;
    } | null>;
    detachTab?: (
      session: LedgerTabSession,
      screenPoint: { x: number; y: number }
    ) => Promise<{ success: boolean }>;
    confirmTabDetach?: (transferId: string) => Promise<boolean>;
    getTabDetachSession?: (transferId: string) => Promise<LedgerTabSession | null>;
    updateWorkspaceRoute?: (route: ModuleFocusPayload) => Promise<void>;
    selectWorkspaceRoute?: (route: ModuleFocusPayload) => Promise<boolean>;
    closeWorkspaceRoute?: (route: ModuleFocusPayload) => Promise<boolean>;
    openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>;
    openCheckin: () => Promise<void>;
  };
}
