import SwiftUI
import AppKit

// Headless check used by tests and scripts: `ObsidianBridgeMenu --print-status [socket path]` prints the Bridge's
// status JSON (or an error) and exits. It uses the exact same socket client as the menu.
let args = CommandLine.arguments
if let i = args.firstIndex(of: "--print-status") {
    let path = args.count > i + 1 ? args[i + 1] : BridgePaths.socket
    do {
        let r = try BridgeSocket.call("status", path: path, timeout: 5)
        let data = try JSONSerialization.data(withJSONObject: r["data"] ?? [:], options: [.sortedKeys])
        print(String(decoding: data, as: UTF8.self))
        exit(0)
    } catch {
        print("{\"error\":\"\(error.localizedDescription)\"}")
        exit(1)
    }
}

ObsidianBridgeApp.main()

struct ObsidianBridgeApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        MenuBarExtra {
            MenuView().environmentObject(model).onAppear { model.start() }
        } label: {
            Image(systemName: model.backupProblem ? "exclamationmark.triangle.fill" : model.health.symbol)
        }
        .menuBarExtraStyle(.window)

        Window("Obsidian Bridge Setup", id: "setup") {
            WizardView().environmentObject(model)
        }
        .windowResizability(.contentSize)

        Window("Obsidian Bridge Settings", id: "settings") {
            SettingsView().environmentObject(model)
        }
        .windowResizability(.contentSize)
    }
}
