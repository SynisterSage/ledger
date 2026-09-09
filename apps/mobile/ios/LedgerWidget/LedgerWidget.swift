import SwiftUI
import WidgetKit

private let ledgerWidgetURL = URL(string: "ledger:///today?source=widget")!

private enum LedgerWidgetPalette {
  static let lightBackground = Color(red: 1, green: 0.984, blue: 0.969)
  static let darkBackground = Color(red: 0.059, green: 0.059, blue: 0.059)
  static let lightPrimary = Color(red: 0.039, green: 0.039, blue: 0.039)
  static let darkPrimary = Color(red: 0.961, green: 0.961, blue: 0.961)
  static let lightSecondary = Color(red: 0.4, green: 0.4, blue: 0.4)
  static let darkSecondary = Color(red: 0.69, green: 0.69, blue: 0.69)
  static let lightMuted = Color(red: 0.6, green: 0.6, blue: 0.6)
  static let darkMuted = Color(red: 0.5, green: 0.5, blue: 0.5)
  static let lightBorder = Color(red: 0.898, green: 0.898, blue: 0.898)
  static let darkBorder = Color(red: 0.2, green: 0.2, blue: 0.2)
  static let lightAccent = Color(red: 1, green: 0.373, blue: 0.251)
  static let darkAccent = Color(red: 1, green: 0.549, blue: 0.373)
  static let lightAccentSoft = Color(red: 1, green: 0.91, blue: 0.863)
  static let darkAccentSoft = Color(red: 0.28, green: 0.14, blue: 0.1)
}

struct LedgerWidgetSnapshot: Codable {
  let focusTitle: String?
  let nextTitle: String?
  let nextMeta: String?
  let todayCount: Int
  let upcomingCount: Int
  let hasData: Bool
  let updatedAt: Date

  static let empty = LedgerWidgetSnapshot(
    focusTitle: nil,
    nextTitle: nil,
    nextMeta: nil,
    todayCount: 0,
    upcomingCount: 0,
    hasData: false,
    updatedAt: .now
  )
}

struct LedgerWidgetEntry: TimelineEntry {
  let date: Date
  let snapshot: LedgerWidgetSnapshot
}

struct LedgerWidgetProvider: TimelineProvider {
  func placeholder(in context: Context) -> LedgerWidgetEntry {
    LedgerWidgetEntry(
      date: .now,
      snapshot: LedgerWidgetSnapshot(
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

  func getSnapshot(in context: Context, completion: @escaping (LedgerWidgetEntry) -> Void) {
    completion(LedgerWidgetEntry(date: .now, snapshot: loadSnapshot()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<LedgerWidgetEntry>) -> Void) {
    let entry = LedgerWidgetEntry(date: .now, snapshot: loadSnapshot())
    let nextRefresh = Calendar.current.date(byAdding: .minute, value: 30, to: .now) ?? .now.addingTimeInterval(1800)
    completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
  }

  private func loadSnapshot() -> LedgerWidgetSnapshot {
    guard let data = UserDefaults(suiteName: "group.com.ledger.mobile.shared")?.data(forKey: "todaySnapshot") else {
      return .empty
    }

    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    return (try? decoder.decode(LedgerWidgetSnapshot.self, from: data)) ?? .empty
  }
}

struct LedgerWidgetView: View {
  @Environment(\.widgetFamily) private var family
  @Environment(\.colorScheme) private var colorScheme
  let entry: LedgerWidgetEntry

  private var primary: Color { colorScheme == .dark ? LedgerWidgetPalette.darkPrimary : LedgerWidgetPalette.lightPrimary }
  private var secondary: Color { colorScheme == .dark ? LedgerWidgetPalette.darkSecondary : LedgerWidgetPalette.lightSecondary }
  private var muted: Color { colorScheme == .dark ? LedgerWidgetPalette.darkMuted : LedgerWidgetPalette.lightMuted }
  private var border: Color { colorScheme == .dark ? LedgerWidgetPalette.darkBorder : LedgerWidgetPalette.lightBorder }
  private var accent: Color { colorScheme == .dark ? LedgerWidgetPalette.darkAccent : LedgerWidgetPalette.lightAccent }
  private var accentSoft: Color { colorScheme == .dark ? LedgerWidgetPalette.darkAccentSoft : LedgerWidgetPalette.lightAccentSoft }

  var body: some View {
    Group {
      if family == .systemSmall {
        smallView
      } else {
        mediumView
      }
    }
    .ledgerWidgetBackground(colorScheme == .dark ? LedgerWidgetPalette.darkBackground : LedgerWidgetPalette.lightBackground)
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
          .lineLimit(2)
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

      Text(entry.snapshot.hasData || entry.snapshot.upcomingCount > 0 ? summaryLabel : "Set a focus in Ledger")
        .font(.caption)
        .foregroundStyle(entry.snapshot.hasData || entry.snapshot.upcomingCount > 0 ? secondary : accent)
    }
    .padding(16)
  }

  private var mediumView: some View {
    VStack(alignment: .leading, spacing: 12) {
      header(title: "Today", detail: entry.snapshot.hasData ? summaryLabel : nil)
      Divider().overlay(border)

      if entry.snapshot.hasData {
        itemRow(label: "Focus", value: entry.snapshot.focusTitle ?? "No focus set", accent: true)
        itemRow(label: "Next", value: entry.snapshot.nextTitle ?? "Nothing queued", meta: entry.snapshot.nextMeta)
      } else {
        emptyState
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

  private var emptyState: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text("Your day will appear here")
        .font(.subheadline.weight(.medium))
        .foregroundStyle(primary)
      Text("Open Ledger to sync Today.")
        .font(.caption)
        .foregroundStyle(secondary)
        .lineLimit(2)
    }
  }

  private var summaryLabel: String {
    let openLabel = "\(entry.snapshot.todayCount) open"
    let nextLabel = entry.snapshot.upcomingCount == 1 ? "1 next" : "\(entry.snapshot.upcomingCount) next"
    return "\(openLabel) · \(nextLabel)"
  }

  private func itemRow(label: String, value: String, meta: String? = nil, accent: Bool = false) -> some View {
    HStack(alignment: .top, spacing: 8) {
      Text(label)
        .font(.caption.weight(.medium))
        .foregroundStyle(accent ? self.accent : secondary)
        .frame(width: 44, alignment: .leading)
      VStack(alignment: .leading, spacing: 2) {
        Text(value)
          .font(.subheadline.weight(.medium))
          .foregroundStyle(primary)
          .lineLimit(2)
        if let meta, !meta.isEmpty {
          Text(meta)
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
      }
    }
  }
}

private extension View {
  @ViewBuilder
  func ledgerWidgetBackground(_ color: Color) -> some View {
    if #available(iOS 17.0, *) {
      containerBackground(for: .widget) {
        color
      }
    } else {
      background(color)
    }
  }
}

@main
struct LedgerWidgetBundle: WidgetBundle {
  var body: some Widget {
    LedgerTodayWidget()
  }
}

struct LedgerTodayWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(
      kind: "com.ledger.mobile.today-widget",
      provider: LedgerWidgetProvider()
    ) { entry in
      LedgerWidgetView(entry: entry)
    }
    .configurationDisplayName("Ledger Today")
    .description("See your focus and what needs attention next.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}
