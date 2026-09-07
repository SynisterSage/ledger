import Foundation
import React
import WidgetKit

@objc(LedgerWidgetBridge)
final class LedgerWidgetBridge: NSObject, RCTBridgeModule {
  static func moduleName() -> String! {
    "LedgerWidgetBridge"
  }

  static func requiresMainQueueSetup() -> Bool {
    false
  }

  @objc(updateSnapshot:)
  func updateSnapshot(_ snapshot: NSDictionary) {
    guard let data = try? JSONSerialization.data(withJSONObject: snapshot, options: []) else {
      return
    }

    UserDefaults(suiteName: "group.com.ledger.mobile")?.set(data, forKey: "todaySnapshot")

    if #available(iOS 14.0, *) {
      WidgetCenter.shared.reloadTimelines(ofKind: "com.ledger.mobile.today-widget")
    }
  }
}
