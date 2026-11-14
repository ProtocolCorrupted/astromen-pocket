import UIKit
import WebKit
import Capacitor

final class NativeStreamManager: NSObject, URLSessionDataDelegate, WKScriptMessageHandler {
    weak var webView: WKWebView?
    private var session: URLSession!
    private var tasks: [String: URLSessionDataTask] = [:]
    private var taskIds: [Int: String] = [:]
    private let lock = NSLock()

    override init() {
        super.init()
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 120
        config.timeoutIntervalForResource = 900
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        self.session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let id = body["id"] as? String else { return }

        if message.name == "pocketStreamAbort" {
            lock.lock()
            let task = tasks.removeValue(forKey: id)
            if let t = task { taskIds.removeValue(forKey: t.taskIdentifier) }
            lock.unlock()
            task?.cancel()
            return
        }

        guard message.name == "pocketStreamStart",
              let urlString = body["url"] as? String,
              let url = URL(string: urlString) else {
            emit(id: id, payload: ["type": "error", "message": "Invalid stream URL."])
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = (body["method"] as? String) ?? "POST"
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")

        if let headers = body["headers"] as? [String: String] {
            for (k, v) in headers {
                request.setValue(v, forHTTPHeaderField: k)
            }
        }
        if let rawBody = body["body"] as? String {
            request.httpBody = rawBody.data(using: .utf8)
        }

        let task = session.dataTask(with: request)
        lock.lock()
        tasks[id] = task
        taskIds[task.taskIdentifier] = id
        lock.unlock()
        task.resume()
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        lock.lock()
        let id = taskIds[dataTask.taskIdentifier]
        lock.unlock()
        if let id = id, let http = response as? HTTPURLResponse {
            let contentType = (http.allHeaderFields["Content-Type"] as? String) ?? (http.allHeaderFields["content-type"] as? String) ?? ""
            emit(id: id, payload: ["type": "response", "status": http.statusCode, "contentType": contentType])
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        let id = taskIds[dataTask.taskIdentifier]
        lock.unlock()
        guard let id = id, !data.isEmpty else { return }
        emit(id: id, payload: ["type": "chunk", "data": data.base64EncodedString()])
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        guard let id = taskIds.removeValue(forKey: task.taskIdentifier) else {
            lock.unlock()
            return
        }
        tasks.removeValue(forKey: id)
        lock.unlock()

        if let err = error as NSError? {
            if err.domain == NSURLErrorDomain && err.code == NSURLErrorCancelled {
                emit(id: id, payload: ["type": "cancelled"])
            } else {
                emit(id: id, payload: ["type": "error", "message": err.localizedDescription])
            }
        } else {
            emit(id: id, payload: ["type": "end"])
        }
    }

    private func emit(id: String, payload: [String: Any]) {
        var event = payload
        event["id"] = id
        guard let jsonData = try? JSONSerialization.data(withJSONObject: event),
              let jsonString = String(data: jsonData, encoding: .utf8) else { return }
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript("window.__pocketStreamEvent && window.__pocketStreamEvent(\(jsonString));", completionHandler: nil)
        }
    }
}

class PocketViewController: CAPBridgeViewController, UIScrollViewDelegate {
    private let streamManager = NativeStreamManager()
    private var streamRegistered = false

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

        streamManager.webView = webView
        if !streamRegistered {
            streamRegistered = true
            let controller = webView.configuration.userContentController
            controller.removeScriptMessageHandler(forName: "pocketStreamStart")
            controller.removeScriptMessageHandler(forName: "pocketStreamAbort")
            controller.add(streamManager, name: "pocketStreamStart")
            controller.add(streamManager, name: "pocketStreamAbort")
        }

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
