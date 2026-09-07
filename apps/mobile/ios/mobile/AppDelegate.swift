internal import Expo
import React
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)

    // A Home Screen quick action can launch the app from a terminated state.
    // Wait until the React Native bridge has started before forwarding it as a
    // normal Ledger deep link.
    if let shortcutItem = launchOptions?[.shortcutItem] as? UIApplicationShortcutItem,
       let url = shortcutURL(for: shortcutItem) {
      DispatchQueue.main.async { [weak self] in
        guard let self else { return }
        _ = self.application(application, open: url, options: [:])
      }
    }
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Home Screen quick actions while Ledger is already running.
  public override func application(
    _ application: UIApplication,
    performActionFor shortcutItem: UIApplicationShortcutItem,
    completionHandler: @escaping (Bool) -> Void
  ) {
    guard let url = shortcutURL(for: shortcutItem) else {
      completionHandler(false)
      return
    }

    completionHandler(self.application(application, open: url, options: [:]))
  }

  private func shortcutURL(for shortcutItem: UIApplicationShortcutItem) -> URL? {
    switch shortcutItem.type {
    case "com.ledger.mobile.capture-note":
      return URL(string: "ledger://capture/note?source=quick-action")
    case "com.ledger.mobile.add-task":
      return URL(string: "ledger://capture/task?source=quick-action")
    case "com.ledger.mobile.add-reminder":
      return URL(string: "ledger://capture/reminder?source=quick-action")
    case "com.ledger.mobile.today":
      return URL(string: "ledger:///today?source=quick-action")
    default:
      return nil
    }
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
