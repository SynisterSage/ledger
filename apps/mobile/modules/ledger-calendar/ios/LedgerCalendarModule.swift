import ExpoModulesCore
import EventKit

public final class LedgerCalendarModule: Module {
  private let eventStore = EKEventStore()

  public func definition() -> ModuleDefinition {
    Name("LedgerCalendar")

    AsyncFunction("getAuthorizationStatus") { () -> String in
      self.authorizationStatus()
    }

    AsyncFunction("requestAccess") { () async -> String in
      if #available(iOS 17.0, *) {
        await withCheckedContinuation { continuation in
          self.eventStore.requestFullAccessToEvents { _ in
            continuation.resume(returning: self.authorizationStatus())
          }
        }
      } else {
        await withCheckedContinuation { continuation in
          self.eventStore.requestAccess(to: .event) { _ , _ in
            continuation.resume(returning: self.authorizationStatus())
          }
        }
      }
    }

    AsyncFunction("listCalendars") { () throws -> [[String: Any]] in
      guard self.hasReadAccess else {
        throw CalendarModuleError.accessDenied
      }

      return self.eventStore.calendars(for: .event).map { calendar in
        [
          "id": calendar.calendarIdentifier,
          "title": calendar.title,
          "sourceTitle": calendar.source.title,
          "sourceId": calendar.source.sourceIdentifier,
          "color": self.hexColor(calendar.cgColor),
          "allowsContentModifications": calendar.allowsContentModifications,
          "type": calendar.type.rawValue
        ]
      }
    }

    AsyncFunction("fetchEvents") { (start: String, end: String, calendarIds: [String]) throws -> [[String: Any]] in
      guard self.hasReadAccess else {
        throw CalendarModuleError.accessDenied
      }
      guard let startDate = self.isoFormatter.date(from: start),
            let endDate = self.isoFormatter.date(from: end) else {
        throw CalendarModuleError.invalidDateRange
      }

      let calendars = self.eventStore.calendars(for: .event).filter { calendar in
        calendarIds.contains(calendar.calendarIdentifier)
      }
      guard !calendars.isEmpty else { return [] }
      let predicate = self.eventStore.predicateForEvents(withStart: startDate, end: endDate, calendars: calendars)
      return self.eventStore.events(matching: predicate).map(self.eventPayload)
    }

    AsyncFunction("createEvent") { (title: String, start: String, end: String, allDay: Bool, notes: String?, location: String?, calendarId: String) throws -> [String: Any] in
      guard self.hasReadAccess else { throw CalendarModuleError.accessDenied }
      guard let startDate = self.isoFormatter.date(from: start),
            let endDate = self.isoFormatter.date(from: end),
            let calendar = self.eventStore.calendars(for: .event).first(where: { $0.calendarIdentifier == calendarId }),
            calendar.allowsContentModifications else {
        throw CalendarModuleError.invalidEvent
      }
      let event = EKEvent(eventStore: self.eventStore)
      event.title = title
      event.startDate = startDate
      event.endDate = allDay ? (Calendar.current.date(byAdding: .day, value: 1, to: startDate) ?? endDate) : endDate
      event.isAllDay = allDay
      event.notes = notes
      event.location = location
      event.calendar = calendar
      try self.eventStore.save(event, span: .thisEvent)
      return self.eventPayload(event)
    }

    AsyncFunction("updateEvent") { (eventId: String, title: String, start: String, end: String, allDay: Bool, notes: String?, location: String?) throws -> [String: Any] in
      guard self.hasReadAccess,
            let event = self.eventStore.event(withIdentifier: eventId),
            let startDate = self.isoFormatter.date(from: start),
            let endDate = self.isoFormatter.date(from: end) else {
        throw CalendarModuleError.invalidEvent
      }
      event.title = title
      event.startDate = startDate
      event.endDate = allDay ? (Calendar.current.date(byAdding: .day, value: 1, to: startDate) ?? endDate) : endDate
      event.isAllDay = allDay
      event.notes = notes
      event.location = location
      try self.eventStore.save(event, span: .thisEvent)
      return self.eventPayload(event)
    }

    AsyncFunction("getEvent") { (eventId: String) throws -> [String: Any] in
      guard self.hasReadAccess, let event = self.eventStore.event(withIdentifier: eventId) else {
        throw CalendarModuleError.invalidEvent
      }
      return self.eventPayload(event)
    }

    AsyncFunction("deleteEvent") { (eventId: String) throws -> Bool in
      guard self.hasReadAccess, let event = self.eventStore.event(withIdentifier: eventId) else {
        throw CalendarModuleError.invalidEvent
      }
      try self.eventStore.remove(event, span: .thisEvent)
      return true
    }
  }

  private var isoFormatter: ISO8601DateFormatter {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }

  private func eventPayload(_ event: EKEvent) -> [String: Any] {
    var payload: [String: Any] = [
      "id": event.eventIdentifier,
      "calendarId": event.calendar.calendarIdentifier,
      "calendarTitle": event.calendar.title,
      "calendarColor": hexColor(event.calendar.cgColor),
      "title": event.title ?? "Untitled event",
      "start": isoFormatter.string(from: event.startDate),
      "end": isoFormatter.string(from: event.endDate),
      "allDay": event.isAllDay,
      "status": event.status.rawValue
    ]
    if let lastModified = event.lastModifiedDate { payload["lastModified"] = isoFormatter.string(from: lastModified) }
    if let timeZone = event.timeZone?.identifier { payload["timeZone"] = timeZone }
    if let notes = event.notes { payload["notes"] = notes }
    if let location = event.location { payload["location"] = location }
    if let url = event.url?.absoluteString { payload["url"] = url }
    return payload
  }

  private var hasReadAccess: Bool {
    if #available(iOS 17.0, *) {
      return EKEventStore.authorizationStatus(for: .event) == .fullAccess
    }
    return EKEventStore.authorizationStatus(for: .event) == .authorized
  }

  private func authorizationStatus() -> String {
    let status = EKEventStore.authorizationStatus(for: .event)
    if #available(iOS 17.0, *) {
      switch status {
      case .fullAccess: return "granted"
      case .writeOnly: return "write_only"
      default: break
      }
    }
    switch status {
    case .notDetermined: return "not_requested"
    case .restricted: return "restricted"
    case .denied: return "denied"
    case .authorized: return "granted"
    @unknown default: return "unknown"
    }
  }

  private func hexColor(_ color: CGColor) -> String {
    guard let components = color.components, components.count >= 3 else { return "#94A3B8" }
    let values = components.count >= 4 ? components : [components[0], components[1], components[2], 1]
    return String(format: "#%02X%02X%02X", Int(values[0] * 255), Int(values[1] * 255), Int(values[2] * 255))
  }
}

private enum CalendarModuleError: Error {
  case accessDenied
  case invalidDateRange
  case invalidEvent
}
