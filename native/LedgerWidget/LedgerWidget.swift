import Foundation
import SwiftUI
import WidgetKit

private let ledgerWidgetURL = URL(string: "ledger:///today?source=mac-widget")!
private let ledgerWidgetAppGroup = "group.com.ledger.desktop.shared"
private let ledgerWidgetSnapshotPath = "ledger-widget/today.json"

private enum LedgerWidgetPalette {
  static let lightBackground = Color(red: 1.0, green: 0.984, blue: 0.969)
  static let darkBackground = Color(red: 0.075, green: 0.075, blue: 0.075)
  static let lightPrimary = Color(red: 0.067, green: 0.094, blue: 0.153)
  static let darkPrimary = Color(red: 0.96, green: 0.96, blue: 0.96)
  static let lightSecondary = Color(red: 0.29, green: 0.32, blue: 0.38)
  static let darkSecondary = Color(red: 0.70, green: 0.70, blue: 0.70)
  static let lightAccent = Color(red: 1.0, green: 0.373, blue: 0.251)
  static let darkAccent = Color(red: 1.0, green: 0.55, blue: 0.38)
}

struct LedgerMacWidgetSnapshot: Codable {
  let workspaceId: String?
  let workspaceName: String?
  let focusTitle: String?
  let nextTitle: String?
  let nextMeta: String?
  let todayCount: Int
  let upcomingCount: Int
  let hasData: Bool
  let updatedAt: Date

  static let empty = LedgerMacWidgetSnapshot(
    workspaceId: nil,
    workspaceName: nil,
    focusTitle: nil,
    nextTitle: nil,
    nextMeta: nil,
    todayCount: 0,
    upcomingCount: 0,
    hasData: false,
    updatedAt: .now
  )
}

struct LedgerMacWidgetEntry: TimelineEntry {
  let date: Date
  let snapshot: LedgerMacWidgetSnapshot
}

struct LedgerMacWidgetProvider: TimelineProvider {
  func placeholder(in context: Context) -> LedgerMacWidgetEntry {
    LedgerMacWidgetEntry(
      date: .now,
      snapshot: LedgerMacWidgetSnapshot(
        workspaceId: "preview",
        workspaceName: "Personal",
        focusTitle: "Finish the most important thing",
        nextTitle: "Review what needs attention",
        nextMeta: "Today",
        todayCount: 3,
        upcomingCount: 2,
        hasData: true,
        updatedAt: .now
      )
    )
  }

  func getSnapshot(in context: Context, completion: @escaping (LedgerMacWidgetEntry) -> Void) {
    completion(LedgerMacWidgetEntry(date: .now, snapshot: loadSnapshot()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<LedgerMacWidgetEntry>) -> Void) {
    let entry = LedgerMacWidgetEntry(date: .now, snapshot: loadSnapshot())
    let nextRefresh = Calendar.current.date(byAdding: .minute, value: 30, to: .now)
      ?? .now.addingTimeInterval(1800)
    completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
  }

  private func loadSnapshot() -> LedgerMacWidgetSnapshot {
    guard
      let container = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: ledgerWidgetAppGroup
      )
    else {
      return .empty
    }

    let url = container.appendingPathComponent(ledgerWidgetSnapshotPath)
    guard let data = try? Data(contentsOf: url) else { return .empty }

    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    return (try? decoder.decode(LedgerMacWidgetSnapshot.self, from: data)) ?? .empty
  }
}

struct LedgerMacWidgetView: View {
  @Environment(\.widgetFamily) private var family
  @Environment(\.colorScheme) private var colorScheme
  let entry: LedgerMacWidgetEntry

  private var primary: Color {
    colorScheme == .dark ? LedgerWidgetPalette.darkPrimary : LedgerWidgetPalette.lightPrimary
  }

  private var secondary: Color {
    colorScheme == .dark ? LedgerWidgetPalette.darkSecondary : LedgerWidgetPalette.lightSecondary
  }

  private var accent: Color {
    colorScheme == .dark ? LedgerWidgetPalette.darkAccent : LedgerWidgetPalette.lightAccent
  }

  var body: some View {
    Group {
      if family == .systemSmall {
        smallView
      } else {
        mediumView
      }
    }
    .ledgerWidgetBackground(
      colorScheme == .dark
        ? LedgerWidgetPalette.darkBackground
        : LedgerWidgetPalette.lightBackground
    )
    .widgetURL(ledgerWidgetURL)
  }

  private var smallView: some View {
    VStack(alignment: .leading, spacing: 8) {
      header(title: "Today")

      if entry.snapshot.hasData {
        Text("Focus")
          .font(.caption.weight(.medium))
          .foregroundStyle(accent)
        Text(entry.snapshot.focusTitle ?? "No focus set")
          .font(.headline.weight(.semibold))
          .foregroundStyle(primary)
          .lineLimit(3)
      } else {
        Text("No focus set")
          .font(.headline.weight(.semibold))
          .foregroundStyle(primary)
        Text("Choose one thing to move today.")
          .font(.caption)
          .foregroundStyle(secondary)
          .lineLimit(2)
      }

      Spacer(minLength: 0)

      Text(entry.snapshot.hasData ? summaryLabel : "Open Ledger to begin")
        .font(.caption)
        .foregroundStyle(entry.snapshot.hasData ? secondary : accent)
    }
    .padding(16)
  }

  private var mediumView: some View {
    VStack(alignment: .leading, spacing: 12) {
      header(title: "Today", detail: entry.snapshot.hasData ? summaryLabel : nil)
      Divider()

      if entry.snapshot.hasData {
        itemRow(label: "Focus", value: entry.snapshot.focusTitle ?? "No focus set", accent: true)
        itemRow(label: "Next", value: entry.snapshot.nextTitle ?? "Nothing queued", meta: entry.snapshot.nextMeta)
      } else {
        VStack(alignment: .leading, spacing: 6) {
          Text("Your day will appear here")
            .font(.subheadline.weight(.medium))
            .foregroundStyle(primary)
          Text("Open Ledger to sync Today.")
            .font(.caption)
            .foregroundStyle(secondary)
        }
      }

      Spacer(minLength: 0)
    }
    .padding(16)
  }

  private func header(title: String, detail: String? = nil) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      HStack(spacing: 6) {
        Circle()
          .fill(accent)
          .frame(width: 7, height: 7)
        Text(title)
          .font(.headline.weight(.semibold))
          .foregroundStyle(primary)
      }
      Spacer(minLength: 0)
      if let detail {
        Text(detail)
          .font(.caption)
          .foregroundStyle(secondary)
          .lineLimit(1)
      }
    }
  }

  private func itemRow(label: String, value: String, meta: String? = nil, accent: Bool = false) -> some View {
    HStack(alignment: .top, spacing: 8) {
      Text(label)
        .font(.caption.weight(.medium))
        .foregroundStyle(accent ? self.accent : secondary)
        .frame(width: 42, alignment: .leading)
      VStack(alignment: .leading, spacing: 2) {
        Text(value)
          .font(.subheadline.weight(.medium))
          .foregroundStyle(primary)
          .lineLimit(2)
        if let meta, !meta.isEmpty {
          Text(meta)
            .font(.caption2)
            .foregroundStyle(secondary)
        }
      }
    }
  }

  private var summaryLabel: String {
    let openLabel = "\(entry.snapshot.todayCount) open"
    let nextLabel = entry.snapshot.upcomingCount == 1
      ? "1 next"
      : "\(entry.snapshot.upcomingCount) next"
    return "\(openLabel) · \(nextLabel)"
  }
}

private extension View {
  @ViewBuilder
  func ledgerWidgetBackground(_ color: Color) -> some View {
    if #available(macOS 14.0, *) {
      containerBackground(for: .widget) {
        color
      }
    } else {
      background(color)
    }
  }
}

@main
struct LedgerMacWidgetBundle: WidgetBundle {
  var body: some Widget {
    LedgerTodayMacWidget()
  }
}

struct LedgerTodayMacWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(
      kind: "com.ledger.desktop.today-widget",
      provider: LedgerMacWidgetProvider()
    ) { entry in
      LedgerMacWidgetView(entry: entry)
    }
    .configurationDisplayName("Ledger Today")
    .description("See your focus and what needs attention next.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}
