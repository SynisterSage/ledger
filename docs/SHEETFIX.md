Fixed the actual handle-dismiss bug.

  The issue was QuickNoteSheet’s PanResponder was memoized with only dragY, so it
  kept the first closeSheet closure from when the sheet was not mounted. Dragging
  the handle called that stale close function, hit if (!mounted) return, and did
  nothing.

  I changed apps/mobile/src/features/quicknote/QuickNoteSheet.tsx so:

  - closeSheet is wrapped in useCallback
  - the PanResponder depends on the current closeSheet
  - the drag handle now calls the live mounted close path

  Validation passed:

  - npx --prefix apps/mobile tsc -p apps/mobile/tsconfig.json --noEmit
  - git diff --check

