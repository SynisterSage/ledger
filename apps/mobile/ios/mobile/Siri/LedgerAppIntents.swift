import AppIntents
import Foundation
import Security
import SwiftUI
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
  let type: String?
  let title: String?
  let timeLabel: String?
  let dateLabel: String?
}

struct LedgerTodaySiriCaptures: Decodable {
  let count: Int?
}

struct LedgerSiriAuthCredentials {
  let accessToken: String
  let refreshToken: String?
}

struct LedgerTodaySiriRow: Identifiable {
  let id = UUID()
  let kind: String
  let title: String
  let detail: String?
  let tint: Color
}

struct LedgerTodaySiriSnapshot {
  let spokenSummary: String
  let todayCount: Int
  let upcomingCount: Int
  let captureCount: Int
  let todayRows: [LedgerTodaySiriRow]
  let upcomingRows: [LedgerTodaySiriRow]
}

struct LedgerTodaySiriResponse: Decodable {
  let upcoming: [LedgerTodaySiriItem]?
  let today: [LedgerTodaySiriItem]?
  let captures: LedgerTodaySiriCaptures?
}

enum LedgerTodaySiriSummaryBuilder {
  static func build(from response: LedgerTodaySiriResponse) -> LedgerTodaySiriSnapshot {
    let upcoming = response.upcoming ?? []
    let today = response.today ?? []
    let captureCount = max(0, response.captures?.count ?? 0)
    let upcomingCount = upcoming.count
    let todayCount = today.count
    let totalCount = upcomingCount + todayCount + captureCount

    if totalCount == 0 {
      return LedgerTodaySiriSnapshot(
        spokenSummary: "Nothing needs attention in Ledger today.",
        todayCount: todayCount,
        upcomingCount: upcomingCount,
        captureCount: captureCount,
        todayRows: [],
        upcomingRows: []
      )
    }

    let todayRows = Array(today.prefix(3)).compactMap { rowModel(for: $0) }
    let upcomingRows = Array(upcoming.prefix(3)).compactMap { rowModel(for: $0, prefersFullDate: true) }

    return LedgerTodaySiriSnapshot(
      spokenSummary: todayCount == 0 && upcomingCount == 0
        ? "Nothing needs attention in Ledger today."
        : "Here’s today in Ledger.",
      todayCount: todayCount,
      upcomingCount: upcomingCount,
      captureCount: captureCount,
      todayRows: todayRows,
      upcomingRows: upcomingRows
    )
  }

  private static func formatCount(_ count: Int, singular: String, plural: String) -> String {
    count == 1 ? "one \(singular)" : "\(count) \(plural)"
  }

  private static func cleaned(_ value: String?) -> String? {
    let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let trimmed, !trimmed.isEmpty else { return nil }
    return trimmed
  }

  private static func rowModel(for item: LedgerTodaySiriItem, prefersFullDate: Bool = false) -> LedgerTodaySiriRow? {
    guard let title = cleaned(item.title) else { return nil }

    let kind = itemKind(item.type) ?? "Item"
    let schedule = prefersFullDate
      ? cleaned(item.dateLabel) ?? cleaned(item.timeLabel)
      : cleaned(item.timeLabel) ?? cleaned(item.dateLabel)

    let detail = [kind, schedule].compactMap { $0 }.joined(separator: " · ")
    let tint: Color
    switch cleaned(item.type)?.lowercased() {
    case "event":
      tint = .orange
    case "reminder":
      tint = .blue
    case "task":
      tint = .green
    case "deadline":
      tint = .red
    default:
      tint = .secondary
    }

    return LedgerTodaySiriRow(
      kind: kind,
      title: title,
      detail: detail.isEmpty ? nil : detail,
      tint: tint
    )
  }

  private static func itemKind(_ value: String?) -> String? {
    switch cleaned(value)?.lowercased() {
    case "event":
      return "event"
    case "reminder":
      return "reminder"
    case "task":
      return "task"
    case "deadline":
      return "deadline"
    case "focus":
      return "focus"
    case "project_action":
      return "project action"
    default:
      return nil
    }
  }

}

struct LedgerTodaySiriSnippetView: View {
  let snapshot: LedgerTodaySiriSnapshot

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack(alignment: .firstTextBaseline) {
        VStack(alignment: .leading, spacing: 2) {
          Text("Today in Ledger")
            .font(.headline)
          Text(summaryLine)
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
        Spacer(minLength: 12)
        VStack(alignment: .trailing, spacing: 4) {
          countPill(label: "Today", value: snapshot.todayCount)
          countPill(label: "Next", value: snapshot.upcomingCount)
        }
      }

      if !snapshot.todayRows.isEmpty {
        siriSection(title: "Today", rows: snapshot.todayRows)
      }

      if !snapshot.upcomingRows.isEmpty {
        siriSection(title: "Upcoming", rows: snapshot.upcomingRows)
      }

      if snapshot.captureCount > 0 {
        HStack {
          Text("Captures")
            .font(.subheadline.weight(.semibold))
          Spacer()
          Text("\(snapshot.captureCount)")
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.secondary)
        }
        .padding(.top, 2)
      }
    }
    .padding(.vertical, 10)
    .padding(.horizontal, 14)
  }

  private var summaryLine: String {
    if snapshot.todayCount == 0, snapshot.upcomingCount == 0, snapshot.captureCount == 0 {
      return "Nothing needs attention today."
    }

    var parts: [String] = []
    if snapshot.todayCount > 0 {
      parts.append("\(snapshot.todayCount) today")
    }
    if snapshot.upcomingCount > 0 {
      parts.append("\(snapshot.upcomingCount) upcoming")
    }
    if snapshot.captureCount > 0 {
      parts.append("\(snapshot.captureCount) captures")
    }
    return parts.joined(separator: " | ")
  }

  private func countPill(label: String, value: Int) -> some View {
    HStack(spacing: 6) {
      Text(label)
      Text("\(value)")
        .fontWeight(.semibold)
    }
    .font(.caption)
    .foregroundStyle(.secondary)
  }

  private func siriSection(title: String, rows: [LedgerTodaySiriRow]) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      Text(title)
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(.secondary)

      VStack(alignment: .leading, spacing: 12) {
        ForEach(rows) { row in
          HStack(alignment: .top, spacing: 10) {
            Circle()
              .fill(row.tint)
              .frame(width: 8, height: 8)
              .padding(.top, 6)

            VStack(alignment: .leading, spacing: 2) {
              Text(row.title)
                .font(.body.weight(.medium))
                .lineLimit(1)
              if let detail = row.detail {
                Text(detail)
                  .font(.caption)
                  .foregroundStyle(.secondary)
                  .lineLimit(1)
              }
            }

            Spacer(minLength: 8)
          }
        }
      }
      .padding(.leading, 2)
    }
  }
}

enum LedgerTodaySiriAPI {
  private static let authStorageKey = "ledger-mobile-auth"

  static func loadTodaySnapshot() async -> LedgerTodaySiriSnapshot {
    guard let credentials = readMobileAuthCredentials() else {
      return LedgerTodaySiriSnapshot(
        spokenSummary: "Open Ledger to sign in first.",
        todayCount: 0,
        upcomingCount: 0,
        captureCount: 0,
        todayRows: [],
        upcomingRows: []
      )
    }

    guard let baseURL = readAPIBaseURL() else {
      return LedgerTodaySiriSnapshot(
        spokenSummary: "I couldn't reach Ledger right now.",
        todayCount: 0,
        upcomingCount: 0,
        captureCount: 0,
        todayRows: [],
        upcomingRows: []
      )
    }

    if let snapshot = await fetchTodaySnapshot(baseURL: baseURL, accessToken: credentials.accessToken) {
      return snapshot
    }

    guard
      let refreshToken = credentials.refreshToken,
      let refreshedAccessToken = await refreshAccessToken(refreshToken)
    else {
      return LedgerTodaySiriSnapshot(
        spokenSummary: "Open Ledger to sign in first.",
        todayCount: 0,
        upcomingCount: 0,
        captureCount: 0,
        todayRows: [],
        upcomingRows: []
      )
    }

    guard let snapshot = await fetchTodaySnapshot(baseURL: baseURL, accessToken: refreshedAccessToken) else {
      return LedgerTodaySiriSnapshot(
        spokenSummary: "I couldn't reach Ledger right now.",
        todayCount: 0,
        upcomingCount: 0,
        captureCount: 0,
        todayRows: [],
        upcomingRows: []
      )
    }

    return snapshot
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

  private static func readSupabaseBaseURL() -> URL? {
    guard
      let rawValue = Bundle.main.object(forInfoDictionaryKey: "LedgerSupabaseURL") as? String,
      !rawValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else {
      return nil
    }

    return URL(string: rawValue.trimmingCharacters(in: .whitespacesAndNewlines))
  }

  private static func readSupabaseAnonKey() -> String? {
    guard
      let rawValue = Bundle.main.object(forInfoDictionaryKey: "LedgerSupabaseAnonKey") as? String
    else {
      return nil
    }

    let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
  }

  private static func readMobileAuthCredentials() -> LedgerSiriAuthCredentials? {
    guard let sessionJSON = readSecureStoreValue(forKey: authStorageKey) else {
      return nil
    }

    guard
      let data = sessionJSON.data(using: .utf8),
      let object = try? JSONSerialization.jsonObject(with: data)
    else {
      return nil
    }

    guard let accessToken = findString(in: object, key: "access_token") else {
      return nil
    }

    return LedgerSiriAuthCredentials(
      accessToken: accessToken,
      refreshToken: findString(in: object, key: "refresh_token")
    )
  }

  private static func readSecureStoreValue(forKey key: String) -> String? {
    let encodedKey = Data(key.utf8)
    let baseQuery: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "app",
      kSecAttrGeneric as String: encodedKey,
      kSecAttrAccount as String: encodedKey,
    ]

    for query in [
      baseQuery.merging([
        kSecMatchLimit as String: kSecMatchLimitOne,
        kSecReturnData as String: kCFBooleanTrue as Any,
      ], uniquingKeysWith: { _, new in new }),
      [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrGeneric as String: encodedKey,
        kSecAttrAccount as String: encodedKey,
        kSecMatchLimit as String: kSecMatchLimitOne,
        kSecReturnData as String: kCFBooleanTrue as Any,
      ],
    ] {
      var item: CFTypeRef?
      let status = SecItemCopyMatching(query as CFDictionary, &item)
      guard status == errSecSuccess, let data = item as? Data else {
        continue
      }

      return String(data: data, encoding: .utf8)
    }

    return nil
  }

  private static func findString(in value: Any, key: String) -> String? {
    if let dictionary = value as? [String: Any] {
      if let token = dictionary[key] as? String, !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        return token.trimmingCharacters(in: .whitespacesAndNewlines)
      }

      for nestedValue in dictionary.values {
        if let token = findString(in: nestedValue, key: key) {
          return token
        }
      }
    }

    if let array = value as? [Any] {
      for nestedValue in array {
        if let token = findString(in: nestedValue, key: key) {
          return token
        }
      }
    }

    return nil
  }

  private static func fetchTodaySnapshot(baseURL: URL, accessToken: String) async -> LedgerTodaySiriSnapshot? {
    guard let url = todayRequestURL(baseURL: baseURL) else {
      return nil
    }

    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.timeoutInterval = 12

    do {
      let (data, response) = try await URLSession.shared.data(for: request)
      guard let httpResponse = response as? HTTPURLResponse else {
        return nil
      }

      guard (200...299).contains(httpResponse.statusCode) else {
        return nil
      }

      let today = try JSONDecoder().decode(LedgerTodaySiriResponse.self, from: data)
      return LedgerTodaySiriSummaryBuilder.build(from: today)
    } catch {
      return nil
    }
  }

  private static func todayRequestURL(baseURL: URL) -> URL? {
    var components = URLComponents(url: baseURL.appendingPathComponent("api/mobile/today"), resolvingAgainstBaseURL: false)
    components?.queryItems = [
      URLQueryItem(name: "workspace_id", value: "all"),
      URLQueryItem(name: "date", value: todayDateKey()),
    ]

    return components?.url
  }

  private static func refreshAccessToken(_ refreshToken: String) async -> String? {
    guard let baseURL = readSupabaseBaseURL(), let anonKey = readSupabaseAnonKey() else {
      return nil
    }

    guard let url = URLComponents(
      url: baseURL.appendingPathComponent("auth/v1/token"),
      resolvingAgainstBaseURL: false
    )?.url else {
      return nil
    }

    var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
    components?.queryItems = [URLQueryItem(name: "grant_type", value: "refresh_token")]

    guard let tokenURL = components?.url else {
      return nil
    }

    var request = URLRequest(url: tokenURL)
    request.httpMethod = "POST"
    request.setValue(anonKey, forHTTPHeaderField: "apikey")
    request.setValue("Bearer \(anonKey)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.timeoutInterval = 12
    request.httpBody = try? JSONSerialization.data(withJSONObject: [
      "refresh_token": refreshToken
    ])

    do {
      let (data, response) = try await URLSession.shared.data(for: request)
      guard let httpResponse = response as? HTTPURLResponse, (200...299).contains(httpResponse.statusCode) else {
        return nil
      }

      let object = try JSONSerialization.jsonObject(with: data)
      return findString(in: object, key: "access_token")
    } catch {
      return nil
    }
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
  static let openAppWhenRun = false

  static var parameterSummary: some ParameterSummary {
    Summary("Check Today in Ledger")
  }

  func perform() async throws -> some IntentResult & ProvidesDialog & ShowsSnippetView {
    let snapshot = await LedgerTodaySiriAPI.loadTodaySnapshot()
    return .result(dialog: IntentDialog(stringLiteral: snapshot.spokenSummary)) {
      LedgerTodaySiriSnippetView(snapshot: snapshot)
    }
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
