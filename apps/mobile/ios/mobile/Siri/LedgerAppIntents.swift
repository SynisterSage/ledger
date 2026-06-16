import AppIntents
import Foundation
import Security
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

struct LedgerTodaySiriItem: Decodable {
  let title: String?
  let timeLabel: String?
}

struct LedgerTodaySiriCaptures: Decodable {
  let count: Int?
}

struct LedgerTodaySiriResponse: Decodable {
  let upcoming: [LedgerTodaySiriItem]?
  let today: [LedgerTodaySiriItem]?
  let captures: LedgerTodaySiriCaptures?
}

enum LedgerTodaySiriSummaryBuilder {
  static func build(from response: LedgerTodaySiriResponse) -> String {
    let upcoming = response.upcoming ?? []
    let today = response.today ?? []
    let captureCount = max(0, response.captures?.count ?? 0)
    let upcomingCount = upcoming.count
    let todayCount = today.count
    let totalCount = upcomingCount + todayCount + captureCount

    if totalCount == 0 {
      return "Nothing needs attention in Ledger today."
    }

    var parts: [String] = [
      "You have \(formatCount(upcomingCount, singular: "upcoming item", plural: "upcoming items")), \(formatCount(todayCount, singular: "action", plural: "actions")), and \(formatCount(captureCount, singular: "capture", plural: "captures")) waiting in Ledger."
    ]

    if let nextUpcoming = upcoming.first, let title = cleaned(nextUpcoming.title) {
      if let timeLabel = cleaned(nextUpcoming.timeLabel) {
        parts.append("Your next item is \(title) at \(timeLabel).")
      } else {
        parts.append("Your next item is \(title).")
      }
    } else if let firstToday = today.first, let title = cleaned(firstToday.title) {
      parts.append("First up: \(title).")
    }

    if upcomingCount == 0, todayCount <= 1, captureCount == 0 {
      parts[0] = todayCount == 1
        ? "Today looks light in Ledger. You have one action due."
        : parts[0]
    } else if todayCount == 0, captureCount == 0, upcomingCount <= 1 {
      parts[0] = upcomingCount == 1
        ? "Today looks light in Ledger. You have one upcoming item and no actions due."
        : parts[0]
    }

    if totalCount > 3 {
      let actionTitles = today.compactMap { cleaned($0.title) }.prefix(2)
      if !actionTitles.isEmpty, upcomingCount > 0 {
        parts.append("You also have \(actionTitles.joined(separator: " and ")).")
      }
      parts.append("Open Ledger to see the full list.")
    }

    return parts.joined(separator: " ")
  }

  private static func formatCount(_ count: Int, singular: String, plural: String) -> String {
    count == 1 ? "one \(singular)" : "\(count) \(plural)"
  }

  private static func cleaned(_ value: String?) -> String? {
    let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let trimmed, !trimmed.isEmpty else { return nil }
    return trimmed
  }
}

enum LedgerTodaySiriAPI {
  private static let authStorageKey = "ledger-mobile-auth"

  static func loadTodaySummary() async -> String {
    guard let accessToken = readMobileAccessToken() else {
      return "Open Ledger to sign in first."
    }

    guard let baseURL = readAPIBaseURL() else {
      return "I couldn't reach Ledger right now."
    }

    var components = URLComponents(url: baseURL.appendingPathComponent("api/mobile/today"), resolvingAgainstBaseURL: false)
    components?.queryItems = [
      URLQueryItem(name: "workspace_id", value: "all"),
      URLQueryItem(name: "date", value: todayDateKey()),
    ]

    guard let url = components?.url else {
      return "I couldn't load Today from Ledger."
    }

    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.timeoutInterval = 12

    do {
      let (data, response) = try await URLSession.shared.data(for: request)
      guard let httpResponse = response as? HTTPURLResponse else {
        return "I couldn't reach Ledger right now."
      }

      if httpResponse.statusCode == 401 || httpResponse.statusCode == 403 {
        return "Open Ledger to sign in first."
      }

      guard (200...299).contains(httpResponse.statusCode) else {
        return "I couldn't reach Ledger right now."
      }

      let today = try JSONDecoder().decode(LedgerTodaySiriResponse.self, from: data)
      return LedgerTodaySiriSummaryBuilder.build(from: today)
    } catch {
      return "I couldn't reach Ledger right now."
    }
  }

  private static func readAPIBaseURL() -> URL? {
    guard
      let rawValue = Bundle.main.object(forInfoDictionaryKey: "LedgerAPIBaseURL") as? String,
      !rawValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else {
      return nil
    }

    return URL(string: rawValue.trimmingCharacters(in: .whitespacesAndNewlines))
  }

  private static func readMobileAccessToken() -> String? {
    guard let sessionJSON = readSecureStoreValue(forKey: authStorageKey) else {
      return nil
    }

    guard
      let data = sessionJSON.data(using: .utf8),
      let object = try? JSONSerialization.jsonObject(with: data)
    else {
      return nil
    }

    return findAccessToken(in: object)
  }

  private static func readSecureStoreValue(forKey key: String) -> String? {
    let encodedKey = Data(key.utf8)
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "app",
      kSecAttrGeneric as String: encodedKey,
      kSecAttrAccount as String: encodedKey,
      kSecMatchLimit as String: kSecMatchLimitOne,
      kSecReturnData as String: kCFBooleanTrue as Any,
    ]

    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    guard status == errSecSuccess, let data = item as? Data else {
      return nil
    }

    return String(data: data, encoding: .utf8)
  }

  private static func findAccessToken(in value: Any) -> String? {
    if let dictionary = value as? [String: Any] {
      if let token = dictionary["access_token"] as? String, !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        return token.trimmingCharacters(in: .whitespacesAndNewlines)
      }

      for nestedValue in dictionary.values {
        if let token = findAccessToken(in: nestedValue) {
          return token
        }
      }
    }

    if let array = value as? [Any] {
      for nestedValue in array {
        if let token = findAccessToken(in: nestedValue) {
          return token
        }
      }
    }

    return nil
  }

  private static func todayDateKey() -> String {
    let formatter = DateFormatter()
    formatter.calendar = Calendar.current
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone.current
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: Date())
  }
}

struct GetLedgerTodayIntent: AppIntent {
  static let title: LocalizedStringResource = "What's Today in Ledger?"
  static let description = IntentDescription("Get a short read-only summary of Today in Ledger.")
  static let openAppWhenRun = true

  static var parameterSummary: some ParameterSummary {
    Summary("Check Today in Ledger")
  }

  func perform() async throws -> some IntentResult {
    let summary = await LedgerTodaySiriAPI.loadTodaySummary()
    return .result(dialog: IntentDialog(stringLiteral: summary))
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
      intent: GetLedgerTodayIntent(),
      phrases: [
        "What's Today in \(.applicationName)",
        "Check Today in \(.applicationName)",
        "What do I have in \(.applicationName) today",
      ],
      shortTitle: "Check Today",
      systemImageName: "sun.max"
    )
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
