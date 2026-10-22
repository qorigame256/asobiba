import Capacitor
import GameKit
import UIKit

// みんなの対戦の iPhone 側の小さな部品（2026-10-22。審査 4.2 の「アプリならではの良さ」）。JS からは app/js/native.js が呼ぶ。
// Capacitor 8 で使える Game Center の部品が見つからなかったので自前で持つ（写真の保存・共有もここに入れ、外の部品を増やさない）。
// - signIn: Game Center にログインする（まだなら iPhone のログインの画面を出す）。{ ok: ログインできたか }
// - reportAchievements: 実績の進み具合を Game Center へ送る。{ list: [{ id, percent }] }
// - showAchievements: Game Center の実績の画面を開く
// - shareScreen: いまの画面を画像にして、iPhone の共有の画面（画像を保存・LINE など）を開く
// Game Center は、Xcode で「Game Center」の機能（capability）を付けないと動かない（無料の Apple ID では付けられない）。
// 付いていなくても signIn が ok: false を返すだけで、アプリはふつうに動く。
@objc(AsobibaNativePlugin)
public class AsobibaNativePlugin: CAPPlugin, CAPBridgedPlugin, GKGameCenterControllerDelegate {
    public let identifier = "AsobibaNativePlugin"
    public let jsName = "AsobibaNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reportAchievements", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showAchievements", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareScreen", returnType: CAPPluginReturnPromise)
    ]

    // ログインの結果を待っている呼び出し。authenticateHandler は一度しか置けず、あとで何度も呼ばれるので、待っている分をまとめて返す
    private var waiting: [CAPPluginCall] = []
    private var handlerSet = false

    @objc public func signIn(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let player = GKLocalPlayer.local
            if player.isAuthenticated {
                call.resolve(["ok": true])
                return
            }
            self.waiting.append(call)
            if self.handlerSet {
                // 前に断られた・出せなかったときは、iPhone がもう画面を出さない（設定アプリからログインしてもらう）
                self.finishSignIn()
                return
            }
            self.handlerSet = true
            player.authenticateHandler = { [weak self] viewController, _ in
                guard let self = self else { return }
                if let vc = viewController, let top = self.bridge?.viewController {
                    top.present(vc, animated: true)
                    return
                }
                self.finishSignIn()
            }
        }
    }

    private func finishSignIn() {
        let ok = GKLocalPlayer.local.isAuthenticated
        let calls = waiting
        waiting = []
        for c in calls { c.resolve(["ok": ok]) }
    }

    @objc public func reportAchievements(_ call: CAPPluginCall) {
        guard GKLocalPlayer.local.isAuthenticated else {
            call.resolve(["ok": false])
            return
        }
        let list = call.getArray("list", JSObject.self) ?? []
        let achievements: [GKAchievement] = list.compactMap { item in
            guard let id = item["id"] as? String, let percent = item["percent"] as? Double else { return nil }
            let a = GKAchievement(identifier: id)
            a.percentComplete = min(100, max(0, percent))
            a.showsCompletionBanner = true
            return a
        }
        if achievements.isEmpty {
            call.resolve(["ok": true])
            return
        }
        GKAchievement.report(achievements) { error in
            call.resolve(["ok": error == nil])
        }
    }

    @objc public func showAchievements(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard GKLocalPlayer.local.isAuthenticated, let top = self.bridge?.viewController else {
                call.resolve(["ok": false])
                return
            }
            let vc = GKGameCenterViewController(state: .achievements)
            vc.gameCenterDelegate = self
            top.present(vc, animated: true)
            call.resolve(["ok": true])
        }
    }

    public func gameCenterViewControllerDidFinish(_ gameCenterViewController: GKGameCenterViewController) {
        gameCenterViewController.dismiss(animated: true)
    }

    @objc public func shareScreen(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let webView = self.bridge?.webView, let top = self.bridge?.viewController else {
                call.resolve(["ok": false])
                return
            }
            webView.takeSnapshot(with: nil) { image, _ in
                guard let image = image else {
                    call.resolve(["ok": false])
                    return
                }
                let sheet = UIActivityViewController(activityItems: [image], applicationActivities: nil)
                // iPad では共有の画面を吹き出しで出すので、出す場所が要る（無いと落ちる）
                sheet.popoverPresentationController?.sourceView = top.view
                sheet.popoverPresentationController?.sourceRect = CGRect(x: top.view.bounds.midX, y: top.view.bounds.midY, width: 0, height: 0)
                sheet.popoverPresentationController?.permittedArrowDirections = []
                top.present(sheet, animated: true)
                call.resolve(["ok": true])
            }
        }
    }
}
