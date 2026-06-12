• Edited src/components/Projects/ProjectsWindow.tsx (+5 -2)
    1344      <div
    1345 -      className="h-screen overflow-hidden rounded-3xl border border-[#E
          2D4C4] bg-[#FFF9F4] flex flex-col text-gray-900 shadow-[0_24px_80px_rgb
          a(15,23,42,0.08)]"
    1346 -      style={{ scrollbarGutter: 'stable' }}
    1345 +      className="relative h-screen overflow-hidden rounded-3xl border b
          order-[#E2D4C4] bg-[#FFF9F4] flex flex-col text-gray-900 shadow-[0_24px
          _80px_rgba(15,23,42,0.08)]"
    1346 +      style={{ scrollbarGutter: isLinkNoteModalOpen ? 'auto' : 'stable'
           }}
    1347      >
         ⋮
    2510          onClose={() => setIsLinkNoteModalOpen(false)}
    2511 +        backdropBorderRadius="inherit"
    2512 +        disablePortal
    2513 +        manageWindowChrome={false}
    2514          classNameContainer="w-full max-w-[420px] overflow-hidden rounde
          d-xl border border-[#E2D4C4] bg-[#FFF8F2] shadow-xl"


          • Edited src/components/Settings/SettingsWindow.tsx (+12 -2)
    1614
    1615 +  const isSettingsModalOpen =
    1616 +    isExtensionTokenModalOpen ||
    1617 +    extensionTokenConfirmAction !== null ||
    1618 +    (isWorkspaceManageModalOpen && Boolean(activeWorkspace)) ||
    1619 +    (isWorkspaceDeleteModalOpen && Boolean(activeWorkspace)) ||
    1620 +    Boolean(inviteModal && selectedInvite);
    1621 +
    1622    return (
         ⋮
    1624        className={settingsTheme.shell}
    1618 -      style={{ scrollbarGutter: 'stable' }}
    1625 +      style={{ scrollbarGutter: isSettingsModalOpen ? 'auto' : 'stable'
           }}
    1626      >
         ⋮
    1691
    1685 -          <main className={settingsTheme.main} aria-live="polite">
    1692 +          <main
    1693 +            className={`${settingsTheme.main} ${isSettingsModalOpen ? '
          overflow-hidden' : 'overflow-auto'}`}
    1694 +            aria-live="polite"
    1695 +          >
    1696              <div className="mx-auto max-w-4xl space-y-5">

