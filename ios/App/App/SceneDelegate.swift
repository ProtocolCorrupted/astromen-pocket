import UIKit
import WebKit
import Capacitor

class PocketViewController: CAPBridgeViewController, UIScrollViewDelegate {
    override func viewDidLoad() {
        super.viewDidLoad()
        let bg = UIColor(red: 16.0 / 255.0, green: 19.0 / 255.0, blue: 18.0 / 255.0, alpha: 1.0)
        view.backgroundColor = bg
        overrideUserInterfaceStyle = .dark
        configureNativeWebView()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        configureNativeWebView()
    }

    private func configureNativeWebView() {
        guard let webView = self.webView else { return }
        let bg = UIColor(red: 16.0 / 255.0, green: 19.0 / 255.0, blue: 18.0 / 255.0, alpha: 1.0)
        webView.isOpaque = false
        webView.backgroundColor = bg
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false

        let scrollView = webView.scrollView
        scrollView.delegate = self
        scrollView.backgroundColor = bg
        scrollView.bounces = false
        scrollView.alwaysBounceVertical = false
        scrollView.alwaysBounceHorizontal = false
        scrollView.isScrollEnabled = false
        scrollView.showsVerticalScrollIndicator = false
        scrollView.showsHorizontalScrollIndicator = false
        scrollView.contentInsetAdjustmentBehavior = .never
        scrollView.minimumZoomScale = 1.0
        scrollView.maximumZoomScale = 1.0
        scrollView.zoomScale = 1.0
        scrollView.bouncesZoom = false
        scrollView.pinchGestureRecognizer?.isEnabled = false

        for subview in scrollView.subviews {
            for recognizer in subview.gestureRecognizers ?? [] {
                if let tap = recognizer as? UITapGestureRecognizer, tap.numberOfTapsRequired > 1 {
                    tap.isEnabled = false
                }
            }
        }
    }

    // Returning nil completely disables WKWebView pinch-zoom and input-focus auto-zoom
    func viewForZooming(in scrollView: UIScrollView) -> UIView? {
        return nil
    }

    func scrollViewWillBeginZooming(_ scrollView: UIScrollView, with view: UIView?) {
        scrollView.pinchGestureRecognizer?.isEnabled = false
    }

    func scrollViewDidZoom(_ scrollView: UIScrollView) {
        if scrollView.zoomScale != 1.0 {
            scrollView.setZoomScale(1.0, animated: false)
        }
    }

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        if scrollView.contentOffset != .zero {
            scrollView.contentOffset = .zero
        }
    }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.overrideUserInterfaceStyle = .dark
        window?.backgroundColor = UIColor(red: 16.0 / 255.0, green: 19.0 / 255.0, blue: 18.0 / 255.0, alpha: 1.0)
        window?.rootViewController = PocketViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
