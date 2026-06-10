import AppIntents
import UIKit

enum LedgerSiriCaptureKind: String {
  case reminder
  case task
  case event
  case note
}

@MainActor
enum LedgerSiriIntentSupport {
  static func openCaptureURL(kind: LedgerSiriCaptureKind, queryItems: [URLQueryItem]) async throws {
    var components = URLComponents()
    components.scheme = "ledger"
    components.host = nil
    components.path = "/capture/\(kind.rawValue)"
    components.queryItems = queryItems.isEmpty ? nil : queryItems

    guard let url = components.url else {
      throw NSError(domain: "LedgerSiriIntentSupport", code: 1, userInfo: [
        NSLocalizedDescriptionKey: "Could not build Ledger deep link."
      ])
    }

    await withCheckedContinuation { continuation in
      UIApplication.shared.open(url, options: [:]) { _ in
        continuation.resume()
      }
    }
  }

  static func textQueryItem(_ name: String, value: String?) -> URLQueryItem? {
    let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let trimmed, !trimmed.isEmpty else { return nil }
    return URLQueryItem(name: name, value: trimmed)
  }

  static func dateQueryItem(_ name: String, value: Date?) -> URLQueryItem? {
    guard let value else { return nil }
    return URLQueryItem(name: name, value: ISO8601DateFormatter().string(from: value))
  }

  static func boolQueryItem(_ name: String, value: Bool) -> URLQueryItem {
    URLQueryItem(name: name, value: value ? "1" : "0")
  }
}

struct AddLedgerReminderIntent: AppIntent {
  static let title: LocalizedStringResource = "Add Ledger Reminder"
  static let description = IntentDescription("Create a reminder in Ledger.")
  static let openAppWhenRun = true

  @Parameter(title: "Title")
  var title: String

  @Parameter(title: "Due At")
  var dueAt: Date?

  @Parameter(title: "Workspace")
  var workspaceName: String?

  @Parameter(title: "Note")
  var note: String?

  static var parameterSummary: some ParameterSummary {
    Summary("Add reminder \(\.$title)")
  }

  func perform() async throws -> some IntentResult {
    try await LedgerSiriIntentSupport.openCaptureURL(kind: .reminder, queryItems: [
      LedgerSiriIntentSupport.textQueryItem("title", value: title),
      LedgerSiriIntentSupport.dateQueryItem("dueAt", value: dueAt),
      LedgerSiriIntentSupport.textQueryItem("workspace", value: workspaceName),
      LedgerSiriIntentSupport.textQueryItem("note", value: note),
      URLQueryItem(name: "source", value: "siri"),
    ].compactMap { $0 })

    return .result(dialog: "Opening Ledger to add the reminder.")
  }
}

struct AddLedgerTaskIntent: AppIntent {
  static let title: LocalizedStringResource = "Add Ledger Task"
  static let description = IntentDescription("Create a task in Ledger.")
  static let openAppWhenRun = true

  @Parameter(title: "Title")
  var title: String

  @Parameter(title: "Due Date")
  var dueDate: Date?

  @Parameter(title: "Due At")
  var dueAt: Date?

  @Parameter(title: "Workspace")
  var workspaceName: String?

  @Parameter(title: "Add to Today")
  var addToToday: Bool?

  static var parameterSummary: some ParameterSummary {
    Summary("Add task \(\.$title)")
  }

  func perform() async throws -> some IntentResult {
    try await LedgerSiriIntentSupport.openCaptureURL(kind: .task, queryItems: [
      LedgerSiriIntentSupport.textQueryItem("title", value: title),
      LedgerSiriIntentSupport.dateQueryItem("dueDate", value: dueDate),
      LedgerSiriIntentSupport.dateQueryItem("dueAt", value: dueAt),
      LedgerSiriIntentSupport.textQueryItem("workspace", value: workspaceName),
      LedgerSiriIntentSupport.boolQueryItem("addToToday", value: addToToday ?? false),
      URLQueryItem(name: "source", value: "siri"),
    ].compactMap { $0 })

    return .result(dialog: "Opening Ledger to add the task.")
  }
}

struct CreateLedgerEventIntent: AppIntent {
  static let title: LocalizedStringResource = "Create Ledger Event"
  static let description = IntentDescription("Create an event in Ledger.")
  static let openAppWhenRun = true

  @Parameter(title: "Title")
  var title: String

  @Parameter(title: "Starts At")
  var startsAt: Date

  @Parameter(title: "Ends At")
  var endsAt: Date?

  @Parameter(title: "Workspace")
  var workspaceName: String?

  @Parameter(title: "Description")
  var descriptionText: String?

  static var parameterSummary: some ParameterSummary {
    Summary("Create event \(\.$title)")
  }

  func perform() async throws -> some IntentResult {
    try await LedgerSiriIntentSupport.openCaptureURL(kind: .event, queryItems: [
      LedgerSiriIntentSupport.textQueryItem("title", value: title),
      LedgerSiriIntentSupport.dateQueryItem("startsAt", value: startsAt),
      LedgerSiriIntentSupport.dateQueryItem("endsAt", value: endsAt),
      LedgerSiriIntentSupport.textQueryItem("workspace", value: workspaceName),
      LedgerSiriIntentSupport.textQueryItem("description", value: descriptionText),
      URLQueryItem(name: "source", value: "siri"),
    ].compactMap { $0 })

    return .result(dialog: "Opening Ledger to create the event.")
  }
}

struct SaveLedgerNoteIntent: AppIntent {
  static let title: LocalizedStringResource = "Save Ledger Note"
  static let description = IntentDescription("Save a note to Ledger.")
  static let openAppWhenRun = true

  @Parameter(title: "Title")
  var title: String?

  @Parameter(title: "Body")
  var body: String

  @Parameter(title: "Workspace")
  var workspaceName: String?

  static var parameterSummary: some ParameterSummary {
    Summary("Save note \(\.$body)")
  }

  func perform() async throws -> some IntentResult {
    try await LedgerSiriIntentSupport.openCaptureURL(kind: .note, queryItems: [
      LedgerSiriIntentSupport.textQueryItem("title", value: title),
      LedgerSiriIntentSupport.textQueryItem("body", value: body),
      LedgerSiriIntentSupport.textQueryItem("workspace", value: workspaceName),
      URLQueryItem(name: "source", value: "siri"),
    ].compactMap { $0 })

    return .result(dialog: "Opening Ledger to save the note.")
  }
}

struct LedgerAppShortcutsProvider: AppShortcutsProvider {
  @AppShortcutsBuilder
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: AddLedgerReminderIntent(),
      phrases: [
        "Add a reminder in \(.applicationName)",
        "Add a reminder with \(.applicationName)",
        "Create a reminder in \(.applicationName)",
      ],
      shortTitle: "Add Reminder",
      systemImageName: "bell"
    )
    AppShortcut(
      intent: AddLedgerTaskIntent(),
      phrases: [
        "Add a task in \(.applicationName)",
        "Create a task in \(.applicationName)",
        "Add a task with \(.applicationName)",
      ],
      shortTitle: "Add Task",
      systemImageName: "checklist"
    )
    AppShortcut(
      intent: CreateLedgerEventIntent(),
      phrases: [
        "Create an event in \(.applicationName)",
        "Add an event in \(.applicationName)",
        "Create an event with \(.applicationName)",
      ],
      shortTitle: "Create Event",
      systemImageName: "calendar"
    )
    AppShortcut(
      intent: SaveLedgerNoteIntent(),
      phrases: [
        "Save a note in \(.applicationName)",
        "Take a note in \(.applicationName)",
        "Save a note with \(.applicationName)",
      ],
      shortTitle: "Save Note",
      systemImageName: "note.text"
    )
  }
}
