import UIKit
import Capacitor

@objc(MainViewController)
class MainViewController: CAPBridgeViewController {

    override func viewDidLoad() {
        super.viewDidLoad()
        let bgColor = UIColor(red: 5.0 / 255.0, green: 10.0 / 255.0, blue: 24.0 / 255.0, alpha: 1.0)
        view.backgroundColor = bgColor
        webView?.isOpaque = false
        webView?.backgroundColor = bgColor
        webView?.scrollView.backgroundColor = bgColor
    }

    override open func capacitorDidLoad() {
        super.capacitorDidLoad()
        LocalMediaServer.start()
        bridge?.registerPluginInstance(StatocystPlugin())
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        return .lightContent
    }
}
