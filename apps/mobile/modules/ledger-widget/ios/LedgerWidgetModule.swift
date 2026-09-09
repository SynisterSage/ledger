import ExpoModulesCore
import Foundation
import WidgetKit

public final class LedgerWidgetModule: Module {
  private let appGroup = "group.com.ledger.mobile.shared"
  private let snapshotKey = "todaySnapshot"
  private let widgetKind = "com.ledger.mobile.today-widget"

  public func definition() -> ModuleDefinition {
    Name("LedgerWidget")

    Function("updateSnapshot") { (snapshot: [String: Any]) -> Bool in
      guard JSONSerialization.isValidJSONObject(snapshot),
            let data = try? JSONSerialization.data(withJSONObject: snapshot, options: []) else {
        return false
      }

      guard let defaults = UserDefaults(suiteName: appGroup) else {
        return false
      }

      defaults.set(data, forKey: snapshotKey)
      WidgetCenter.shared.reloadTimelines(ofKind: widgetKind)
      return true
    }
  }
}
