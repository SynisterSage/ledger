import AppKit
import ApplicationServices
import Foundation

func emit(_ value: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: value), let line = String(data: data, encoding: .utf8) else { return }
    print(line, terminator: "\n"); fflush(stdout)
}

let workspace = NSWorkspace.shared
let zoomNames = Set(["us.zoom.xos", "us.zoom.videomeetings", "zoom.us"])
var currentPID: pid_t = 0
var observer: AXObserver?
var observedElement: AXUIElement?
var lastName = ""
var lastWindow: AXUIElement?
var needsRediscovery = false

func timestamp() -> Int { Int(Date().timeIntervalSince1970 * 1000) }
func stringAttribute(_ element: AXUIElement, _ attribute: String) -> String? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else { return nil }
    if let string = value as? String { return string.trimmingCharacters(in: .whitespacesAndNewlines) }
    return nil
}

func candidateName(_ element: AXUIElement) -> String? {
    let role = stringAttribute(element, kAXRoleAttribute as String) ?? ""
    let description = stringAttribute(element, kAXDescriptionAttribute as String) ?? ""
    let title = stringAttribute(element, kAXTitleAttribute as String) ?? ""
    let value = stringAttribute(element, kAXValueAttribute as String) ?? ""
    let candidate = [title, value, description].first { name in
        let normalized = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return normalized.count >= 2 && normalized.count <= 160 &&
            !["zoom", "participants", "gallery", "speaker view", "mute", "unmute"].contains(normalized.lowercased()) &&
            (role == kAXStaticTextRole || role == kAXButtonRole || role == kAXTextFieldRole || description.lowercased().contains("speaker"))
    }
    return candidate
}

func emitNameIfCandidate(_ element: AXUIElement) {
    guard let candidate = candidateName(element), candidate != lastName else { return }
    lastName = candidate
    emit(["type": "speaker-change", "displayName": candidate, "observedAtMs": timestamp()])
}

func discover(_ element: AXUIElement, depth: Int = 0, candidates: inout [AXUIElement]) {
    if depth > 5 { return }
    if candidateName(element) != nil {
        candidates.append(element)
        emit(["type": "candidate", "role": stringAttribute(element, kAXRoleAttribute as String) ?? "", "observedAtMs": timestamp()])
    }
    var children: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &children) == .success,
          let list = children as? [AXUIElement] else { return }
    for child in list { discover(child, depth: depth + 1, candidates: &candidates) }
}

func notification(_ observer: AXObserver, _ element: AXUIElement, _ notification: CFString, _ refcon: UnsafeMutableRawPointer?) {
    if notification == (kAXUIElementDestroyedNotification as CFString) { detach(); return }
    if notification == (kAXCreatedNotification as CFString) { needsRediscovery = true; return }
    emitNameIfCandidate(element)
}

func attach(_ pid: pid_t) {
    detach()
    guard AXIsProcessTrusted() else { emit(["type": "state", "state": "not-authorized"]); return }
    let app = AXUIElementCreateApplication(pid)
    var result: AXError = .success
    var windows: CFTypeRef?
    result = AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &windows)
    guard result == .success, let list = windows as? [AXUIElement], let window = list.first else {
        detach()
        emit(["type": "meeting-window", "state": "not-found", "observedAtMs": timestamp()]); return
    }
    emit(["type": "meeting-window", "state": "found", "observedAtMs": timestamp()])
    var created: AXObserver?
    guard AXObserverCreate(pid, notification, &created) == .success, let created else { emit(["type": "observer", "state": "unavailable"]); return }
    observer = created; observedElement = window; lastWindow = window
    needsRediscovery = false
    let center = CFRunLoopGetMain()
    CFRunLoopAddSource(center, AXObserverGetRunLoopSource(created), .defaultMode)
    var candidates: [AXUIElement] = []
    discover(window, candidates: &candidates)
    candidates.append(window)
    for candidate in candidates {
        for name in [kAXTitleChangedNotification, kAXValueChangedNotification, kAXUIElementDestroyedNotification] {
            AXObserverAddNotification(created, candidate, name as CFString, nil)
        }
    }
    AXObserverAddNotification(created, window, kAXCreatedNotification as CFString, nil)
    emit(["type": "observer", "state": "attached", "pid": pid])
    let candidateNames = candidates.compactMap { candidateName($0)?.lowercased() }
    let duplicateNames = Set(candidateNames.filter { candidateName in candidateNames.filter { $0 == candidateName }.count > 1 })
    for name in duplicateNames {
        emit(["type": "speaker-change", "displayName": name, "ambiguous": true, "observedAtMs": timestamp()])
    }
    for candidate in candidates {
        if let name = candidateName(candidate)?.lowercased(), duplicateNames.contains(name) { continue }
        emitNameIfCandidate(candidate)
    }
}

func detach() {
    if let currentObserver = observer {
        CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(currentObserver), .defaultMode)
        observer = nil
        emit(["type": "observer", "state": "detached"])
    }
    observedElement = nil; lastName = ""; needsRediscovery = false
    lastWindow = nil
}

func findZoom() -> NSRunningApplication? {
    workspace.runningApplications.first { app in
        guard let id = app.bundleIdentifier?.lowercased() else { return false }
        return zoomNames.contains(id) || id.contains("zoom")
    }
}

emit(["type": "state", "platform": "darwin", "trusted": AXIsProcessTrusted()])
Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
    if !AXIsProcessTrusted() {
        if observer != nil { detach() }
        emit(["type": "state", "state": "not-authorized", "observedAtMs": timestamp()])
        return
    }
    guard let app = findZoom(), app.processIdentifier > 0 else {
        if currentPID != 0 { emit(["type": "zoom", "state": "terminated", "observedAtMs": timestamp()]); currentPID = 0; detach() }
        return
    }
    if currentPID != app.processIdentifier {
        currentPID = app.processIdentifier
        emit(["type": "zoom", "state": "running", "pid": currentPID, "observedAtMs": timestamp()])
        attach(currentPID)
    } else {
        let root = AXUIElementCreateApplication(currentPID)
        var windows: CFTypeRef?
        if AXUIElementCopyAttributeValue(root, kAXWindowsAttribute as CFString, &windows) == .success,
           let list = windows as? [AXUIElement], let window = list.first {
            if observer == nil || needsRediscovery || lastWindow == nil || !CFEqual(lastWindow, window) {
                emit(["type": "observer", "state": "rediscovering", "pid": currentPID, "observedAtMs": timestamp()])
                attach(currentPID)
            }
        } else if observer != nil {
            detach()
            emit(["type": "meeting-window", "state": "not-found", "observedAtMs": timestamp()])
        }
    }
}
RunLoop.main.run()
