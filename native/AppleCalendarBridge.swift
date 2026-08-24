import EventKit
import Foundation

struct BridgeError: Error { let message: String }

func emit(_ value: Any) {
    guard JSONSerialization.isValidJSONObject(value) else { return }
    let data = try! JSONSerialization.data(withJSONObject: value)
    print(String(data: data, encoding: .utf8)!, terminator: "\n")
    fflush(stdout)
}

func iso(_ date: Date?) -> String? {
    guard let date else { return nil }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: date)
}

func hexColor(_ color: CGColor?) -> String {
    guard let components = color?.components, components.count >= 3 else { return "#94A3B8" }
    let values = components.count >= 4 ? Array(components.dropLast()) : components
    return String(format: "#%02X%02X%02X", Int(values[0] * 255), Int(values[1] * 255), Int(values[2] * 255))
}

let store = EKEventStore()

func calendarPayload(_ calendar: EKCalendar) -> [String: Any] {
    [
        "id": calendar.calendarIdentifier,
        "title": calendar.title,
        "sourceTitle": calendar.source.title,
        "sourceId": calendar.source.sourceIdentifier,
        "type": calendar.type.rawValue,
        "color": hexColor(calendar.cgColor),
        "allowsContentModifications": calendar.allowsContentModifications
    ]
}

func eventPayload(_ event: EKEvent) -> [String: Any] {
    var result: [String: Any] = [
        "id": event.eventIdentifier ?? "",
        "calendarId": event.calendar.calendarIdentifier,
        "calendarTitle": event.calendar.title,
        "calendarColor": hexColor(event.calendar.cgColor),
        "title": event.title ?? "Untitled event",
        "start": iso(event.startDate) ?? "",
        "end": iso(event.endDate) ?? "",
        "allDay": event.isAllDay,
        "availability": event.availability.rawValue,
        "status": event.status.rawValue
    ]
    if let timeZone = event.timeZone?.identifier { result["timeZone"] = timeZone }
    if let location = event.location { result["location"] = location }
    if let notes = event.notes { result["notes"] = notes }
    if let url = event.url?.absoluteString { result["url"] = url }
    if let lastModified = iso(event.lastModifiedDate) { result["lastModified"] = lastModified }
    if let recurrence = event.recurrenceRules?.first {
        var recurrencePayload: [String: Any] = ["frequency": recurrence.frequency.rawValue, "interval": recurrence.interval]
        if let count = recurrence.recurrenceEnd?.occurrenceCount { recurrencePayload["count"] = count }
        if let end = iso(recurrence.recurrenceEnd?.endDate) { recurrencePayload["end"] = end }
        result["recurrence"] = recurrencePayload
    }
    return result
}

func dateValue(_ input: Any?) -> Date? {
    guard let value = input as? String else { return nil }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
}

func queryRange(_ input: [String: Any]) -> (Date, Date)? {
    guard let start = dateValue(input["start"]),
          let end = dateValue(input["end"]),
          end > start else { return nil }
    return (start, end)
}

func calendarFor(_ id: Any?) -> EKCalendar? {
    guard let id = id as? String, !id.isEmpty else { return nil }
    return store.calendars(for: .event).first { $0.calendarIdentifier == id }
}

func reminderCalendarFor(_ id: Any?) -> EKCalendar? {
    guard let id = id as? String, !id.isEmpty else { return nil }
    return store.calendars(for: .reminder).first { $0.calendarIdentifier == id }
}

func normalizedError(_ code: String, _ message: String, notFound: Bool = false) -> [String: Any] {
    var result: [String: Any] = ["ok": false, "code": code, "error": message]
    if notFound { result["notFound"] = true }
    return result
}

func spanFor(_ input: Any?) -> EKSpan { (input as? String) == "futureEvents" ? .futureEvents : .thisEvent }

func recurrenceRule(_ input: Any?) -> EKRecurrenceRule? {
    guard let value = input as? String, value != "none", !value.isEmpty else { return nil }
    let frequency: EKRecurrenceFrequency
    switch value { case "daily": frequency = .daily; case "weekly", "weekdays": frequency = .weekly; case "monthly": frequency = .monthly; case "yearly": frequency = .yearly; default: return nil }
    return EKRecurrenceRule(recurrenceWith: frequency, interval: 1, daysOfTheWeek: nil, daysOfTheMonth: nil, monthsOfTheYear: nil, weeksOfTheYear: nil, daysOfTheYear: nil, setPositions: nil, end: nil)
}

func validateEventInput(_ input: [String: Any]) -> (EKCalendar, Date, Date)? {
    guard let calendar = calendarFor(input["calendarId"]), calendar.allowsContentModifications,
          let start = dateValue(input["start"]), let end = dateValue(input["end"]), end > start,
          let title = input["title"] as? String, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
    return (calendar, start, end)
}

func applyEventFields(_ event: EKEvent, input: [String: Any], calendar: EKCalendar, start: Date, end: Date) {
    event.calendar = calendar
    event.title = (input["title"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    event.startDate = start
    event.endDate = end
    event.isAllDay = (input["allDay"] as? Bool) ?? false
    event.timeZone = (input["timeZone"] as? String).flatMap { TimeZone(identifier: $0) } ?? TimeZone.current
    event.location = input["location"] as? String
    event.notes = input["notes"] as? String
    if let rawURL = input["url"] as? String, !rawURL.isEmpty { event.url = URL(string: rawURL) }
    event.recurrenceRules = recurrenceRule(input["recurrence"]).map { [$0] }
}

func requestAccess() async {
    if #available(macOS 14.0, *) {
        do { let granted = try await store.requestFullAccessToEvents(); emit(["ok": true, "granted": granted]) }
        catch { emit(["ok": false, "error": error.localizedDescription]) }
    } else {
        store.requestAccess(to: .event) { granted, error in
            emit(["ok": error == nil, "granted": granted, "error": error?.localizedDescription as Any])
        }
    }
}

func statusPayload() -> [String: Any] {
    let status = EKEventStore.authorizationStatus(for: .event)
    let label: String
    if #available(macOS 14.0, *) {
        switch status { case .fullAccess: label = "granted"; case .writeOnly: label = "denied"; case .denied: label = "denied"; case .restricted: label = "restricted"; case .notDetermined: label = "not_requested"; @unknown default: label = "unknown" }
    } else {
        switch status { case .authorized: label = "granted"; case .denied: label = "denied"; case .restricted: label = "restricted"; case .notDetermined: label = "not_requested"; default: label = "unknown" }
    }
    return ["ok": true, "status": label]
}

func reminderStatusPayload() -> [String: Any] {
    let status = EKEventStore.authorizationStatus(for: .reminder)
    let label: String
    if #available(macOS 14.0, *) {
        switch status { case .fullAccess: label = "granted"; case .writeOnly: label = "denied"; case .denied: label = "denied"; case .restricted: label = "restricted"; case .notDetermined: label = "not_requested"; @unknown default: label = "unknown" }
    } else {
        switch status { case .authorized: label = "granted"; case .denied: label = "denied"; case .restricted: label = "restricted"; case .notDetermined: label = "not_requested"; default: label = "unknown" }
    }
    return ["ok": true, "status": label]
}

func reminderCalendarPayload(_ calendar: EKCalendar) -> [String: Any] {
    [
        "id": calendar.calendarIdentifier,
        "title": calendar.title,
        "sourceTitle": calendar.source.title,
        "sourceId": calendar.source.sourceIdentifier,
        "type": calendar.type.rawValue,
        "color": hexColor(calendar.cgColor),
        "allowsContentModifications": calendar.allowsContentModifications
    ]
}

func reminderPayload(_ reminder: EKReminder) -> [String: Any] {
    var result: [String: Any] = [
        "id": reminder.calendarItemIdentifier,
        "title": reminder.title ?? "Untitled reminder",
        "completed": reminder.isCompleted,
        "priority": reminder.priority,
        "listId": reminder.calendar.calendarIdentifier,
        "listTitle": reminder.calendar.title,
        "listColor": hexColor(reminder.calendar.cgColor)
    ]
    if let notes = reminder.notes { result["notes"] = notes }
    if let completed = reminder.completionDate { result["completionDate"] = iso(completed) }
    if let modified = reminder.lastModifiedDate { result["lastModified"] = iso(modified) }
    if let due = reminder.dueDateComponents {
        var components = due
        let allDay = components.hour == nil && components.minute == nil
        if allDay { components.hour = 12; components.minute = 0; components.second = 0 }
        var calendar = Calendar(identifier: .gregorian)
        if let timeZone = components.timeZone { calendar.timeZone = timeZone }
        if let date = calendar.date(from: components) {
            result["dueAt"] = iso(date) ?? ""
            result["allDay"] = allDay
        }
    }
    if let recurrence = reminder.recurrenceRules?.first {
        var recurrencePayload: [String: Any] = ["frequency": recurrence.frequency.rawValue, "interval": recurrence.interval]
        if let count = recurrence.recurrenceEnd?.occurrenceCount { recurrencePayload["count"] = count }
        if let end = iso(recurrence.recurrenceEnd?.endDate) { recurrencePayload["end"] = end }
        result["recurrence"] = recurrencePayload
    }
    return result
}

func dueComponents(_ input: [String: Any]) -> DateComponents? {
    guard let raw = input["dueAt"] as? String, let date = dateValue(raw) else { return nil }
    var calendar = Calendar(identifier: .gregorian)
    if let identifier = input["timeZone"] as? String, let timeZone = TimeZone(identifier: identifier) { calendar.timeZone = timeZone }
    var components = calendar.dateComponents([.year, .month, .day], from: date)
    if (input["allDay"] as? Bool) != true { components.hour = calendar.component(.hour, from: date); components.minute = calendar.component(.minute, from: date); components.second = 0 }
    return components
}

func applyReminderFields(_ reminder: EKReminder, input: [String: Any], list: EKCalendar) {
    reminder.calendar = list
    reminder.title = (input["title"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    reminder.notes = input["notes"] as? String
    reminder.priority = (input["priority"] as? NSNumber)?.intValue ?? (input["priority"] as? Int ?? 0)
    reminder.dueDateComponents = dueComponents(input)
    reminder.isCompleted = (input["completed"] as? Bool) ?? reminder.isCompleted
    if reminder.isCompleted && reminder.completionDate == nil { reminder.completionDate = Date() }
    if !reminder.isCompleted { reminder.completionDate = nil }
    reminder.recurrenceRules = recurrenceRule(input["recurrence"]).map { [$0] }
}

func requestReminderAccess() async {
    if #available(macOS 14.0, *) {
        do { let granted = try await store.requestFullAccessToReminders(); emit(["ok": true, "granted": granted]) }
        catch { emit(normalizedError("permission_denied", "Reminders access could not be granted.")) }
    } else {
        store.requestAccess(to: .reminder) { granted, error in
            emit(["ok": error == nil, "granted": granted, "error": error?.localizedDescription as Any])
        }
    }
}

func handleReminders(_ input: [String: Any]) async {
    let command = input["command"] as? String ?? "permission-status"
    if command == "permission-status" || command == "get-connection-status" { emit(reminderStatusPayload()); return }
    if command == "request-access" { await requestReminderAccess(); return }
    let accessGranted: Bool
    if #available(macOS 14.0, *) { accessGranted = EKEventStore.authorizationStatus(for: .reminder) == .fullAccess }
    else { accessGranted = EKEventStore.authorizationStatus(for: .reminder) == .authorized }
    guard accessGranted else { emit(normalizedError("permission_denied", "Reminders access is not granted.")); exit(0) }
    if command == "lists" {
        emit(["ok": true, "lists": store.calendars(for: .reminder).map(reminderCalendarPayload)])
        return
    }
    if command == "get-writable-lists" {
        emit(["ok": true, "lists": store.calendars(for: .reminder).filter { $0.allowsContentModifications }.map(reminderCalendarPayload)])
        return
    }
    if command == "get-reminder" {
        guard let reminderId = input["reminderId"] as? String, let reminder = store.calendarItem(withIdentifier: reminderId) as? EKReminder else { emit(normalizedError("reminder_not_found", "This Apple reminder is no longer available.", notFound: true)); return }
        emit(["ok": true, "reminder": reminderPayload(reminder)])
        return
    }
    if command == "create-reminder" {
        guard let list = reminderCalendarFor(input["listId"]), list.allowsContentModifications, let title = input["title"] as? String, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { emit(normalizedError("invalid_reminder", "Choose a writable Apple reminder list and enter a title.")); return }
        let reminder = EKReminder(eventStore: store)
        applyReminderFields(reminder, input: input, list: list)
        do { try store.save(reminder, commit: true); emit(["ok": true, "reminder": reminderPayload(reminder)]) }
        catch { emit(normalizedError("save_failed", "Ledger couldn’t save this reminder to Apple Reminders.")) }
        return
    }
    if ["update-reminder", "set-completed", "move-reminder", "delete-reminder"].contains(command) {
        guard let reminderId = input["reminderId"] as? String, let reminder = store.calendarItem(withIdentifier: reminderId) as? EKReminder else { emit(normalizedError("reminder_not_found", "This Apple reminder is no longer available.", notFound: true)); return }
        if !reminder.calendar.allowsContentModifications { emit(normalizedError("list_not_writable", "This reminder list does not allow Ledger to make changes.")); return }
        if command == "delete-reminder" {
            do { try store.remove(reminder, commit: true); emit(["ok": true, "deleted": true, "reminderId": reminderId]) }
            catch { emit(normalizedError("delete_failed", "Ledger couldn’t delete this reminder from Apple Reminders.")) }
            return
        }
        if command == "move-reminder" {
            guard let list = reminderCalendarFor(input["listId"]), list.allowsContentModifications else { emit(normalizedError("list_not_writable", "This reminder list does not allow Ledger to make changes.")); return }
            reminder.calendar = list
        } else if command == "set-completed" {
            reminder.isCompleted = (input["completed"] as? Bool) ?? false
            reminder.completionDate = reminder.isCompleted ? (reminder.completionDate ?? Date()) : nil
        } else {
            guard let list = reminderCalendarFor(input["listId"] ?? reminder.calendar.calendarIdentifier), list.allowsContentModifications else { emit(normalizedError("list_not_writable", "This reminder list does not allow Ledger to make changes.")); return }
            applyReminderFields(reminder, input: input, list: list)
        }
        do { try store.save(reminder, commit: true); emit(["ok": true, "reminder": reminderPayload(reminder)]) }
        catch { emit(normalizedError("save_failed", "Ledger couldn’t save this reminder to Apple Reminders.")) }
        return
    }
    if command == "fetch-reminders" || command == "refresh" {
        guard let (start, end) = queryRange(input) else {
            emit(normalizedError("invalid_range", "Apple Reminders needs a valid start and end time."))
            return
        }
        let ids = Set((input["listIds"] as? [String]) ?? [])
        let lists = store.calendars(for: .reminder).filter { ids.contains($0.calendarIdentifier) }
        if lists.isEmpty {
            emit(["ok": true, "reminders": []])
            return
        }
        let predicate = store.predicateForReminders(in: lists)
        store.fetchReminders(matching: predicate) { reminders in
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = .current
            let filtered = (reminders ?? []).filter { reminder in
                guard let components = reminder.dueDateComponents else { return false }
                guard let date = calendar.date(from: components) else { return false }
                return date >= start && date < end
            }
            emit(["ok": true, "reminders": filtered.map(reminderPayload)])
            exit(0)
        }
        return
    }
    emit(normalizedError("unsupported_command", "Unsupported Apple Reminders command."))
    exit(0)
}

func handle(_ input: [String: Any]) async {
    let command = input["command"] as? String ?? "status"
    if command == "status" { emit(statusPayload()); return }
    if command == "connection-status" { emit(statusPayload()); return }
    if command == "request" { await requestAccess(); return }
    let accessGranted: Bool
    if #available(macOS 14.0, *) { accessGranted = EKEventStore.authorizationStatus(for: .event) == .fullAccess }
    else { accessGranted = EKEventStore.authorizationStatus(for: .event) == .authorized }
    guard accessGranted else { emit(normalizedError("permission_denied", "Calendar access is not granted.")); return }
    if command == "calendars" { emit(["ok": true, "calendars": store.calendars(for: .event).map(calendarPayload)]); return }
    if command == "writable-calendars" { emit(["ok": true, "calendars": store.calendars(for: .event).filter { $0.allowsContentModifications }.map(calendarPayload)]); return }
    if command == "get-event" {
        guard let eventId = input["eventId"] as? String, let event = store.event(withIdentifier: eventId) else { emit(normalizedError("event_not_found", "This Apple Calendar event is no longer available.", notFound: true)); return }
        emit(["ok": true, "event": eventPayload(event)]); return
    }
    if command == "events" || command == "refresh-range" {
        guard let (start, end) = queryRange(input) else {
            emit(normalizedError("invalid_range", "Apple Calendar needs a valid start and end time."))
            return
        }
        let ids = Set((input["calendarIds"] as? [String]) ?? [])
        let calendars = store.calendars(for: .event).filter { ids.contains($0.calendarIdentifier) }
        if calendars.isEmpty {
            emit(["ok": true, "events": []])
            return
        }
        let predicate = store.predicateForEvents(withStart: start, end: end, calendars: calendars)
        emit(["ok": true, "events": store.events(matching: predicate).map(eventPayload)])
        return
    }
    if command == "create" {
        guard let (calendar, start, end) = validateEventInput(input) else { emit(normalizedError("invalid_event", "Invalid Apple Calendar event or destination calendar.")); return }
        let event = EKEvent(eventStore: store)
        applyEventFields(event, input: input, calendar: calendar, start: start, end: end)
        do { try store.save(event, span: spanFor(input["span"]), commit: true); emit(["ok": true, "event": eventPayload(event)]) }
        catch { emit(["ok": false, "error": error.localizedDescription]) }
        return
    }
    if command == "update" || command == "move" || command == "delete" {
        guard let eventId = input["eventId"] as? String, let event = store.event(withIdentifier: eventId) else { emit(normalizedError("event_not_found", "This Apple Calendar event is no longer available.", notFound: true)); return }
        let span = spanFor(input["span"])
        do {
            if command == "delete" {
                try store.remove(event, span: span, commit: true)
                emit(["ok": true, "deleted": true, "eventId": eventId])
            } else {
                guard let calendar = calendarFor(input["calendarId"]), calendar.allowsContentModifications else { emit(normalizedError("calendar_not_writable", "This calendar does not allow Ledger to edit its events.")); return }
                if command == "move" { event.calendar = calendar }
                else {
                    guard let start = dateValue(input["start"]), let end = dateValue(input["end"]), end > start else { emit(["ok": false, "error": "Invalid Apple Calendar dates."]); return }
                    applyEventFields(event, input: input, calendar: calendar, start: start, end: end)
                }
                try store.save(event, span: span, commit: true)
                emit(["ok": true, "event": eventPayload(event)])
            }
        } catch { emit(["ok": false, "error": error.localizedDescription]) }
        return
    }
    emit(["ok": false, "error": "Unsupported Apple Calendar command."])
}

if CommandLine.arguments.contains("--watch") {
    NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: store, queue: .main) { _ in emit(["changed": true]) }
    RunLoop.main.run()
} else if let line = readLine(), let data = line.data(using: .utf8), let input = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
    Task {
        if let command = input["command"] as? String, ["permission-status", "get-connection-status", "request-access", "lists", "fetch-reminders", "refresh", "get-writable-lists", "get-reminder", "create-reminder", "update-reminder", "set-completed", "move-reminder", "delete-reminder"].contains(command) {
            await handleReminders(input)
            if command != "fetch-reminders" && command != "refresh" { exit(0) }
        } else {
            await handle(input)
            exit(0)
        }
    }
    dispatchMain()
}
