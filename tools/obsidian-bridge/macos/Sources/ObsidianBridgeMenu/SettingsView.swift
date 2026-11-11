import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.openWindow) private var openWindow
    @State private var confirmInstall = false
    @State private var confirmRemove = false

    var body: some View {
        Form {
            Section("Connection") {
                LabeledContent("Mac", value: model.config?.deviceName ?? "not set up")
                LabeledContent("Vault", value: model.config?.vaultName ?? "—")
                LabeledContent("LifeOS", value: model.config?.lifeosUrl ?? "—")
                LabeledContent("Requests today", value: model.status.map { String($0.requestsToday) } ?? "—")
            }
            Section("Start at login") {
                Text(model.agentInstalled ? "The Bridge starts when you log in and restarts after a crash. It runs as you, with no administrator rights." : "The Bridge only runs while you start it. Install it as a login item to keep it running in the background.")
                    .font(.callout).foregroundStyle(.secondary)
                HStack {
                    if model.agentInstalled {
                        Button("Remove login item…") { confirmRemove = true }
                    } else {
                        Button("Install login item…") { confirmInstall = true }.disabled(model.config == nil)
                    }
                    Button(model.status == nil ? "Start the Bridge" : "Stop the Bridge") { model.status == nil ? model.startBridge() : model.stopBridge() }.disabled(model.config == nil)
                }
            }
            Section("Setup") {
                Button("Run setup again…") { openWindow(id: "setup"); NSApp.activate(ignoringOtherApps: true) }
                Text("Your vault and backups are never touched by setup. Pairing again replaces this Mac's device token in the Keychain.").font(.caption).foregroundStyle(.secondary)
            }
            Section("Files") {
                Button("Show Bridge folder in Finder") { model.open(path: BridgePaths.home) }
                Text("Settings and state are private to your user. The device token is in the macOS Keychain, not in any file.").font(.caption).foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .frame(width: 480, height: 480)
        .alert("Install the login item?", isPresented: $confirmInstall) {
            Button("Install") { do { try LaunchAgent.install(); model.message = "Installed" } catch { model.message = error.localizedDescription }; model.refresh() }
            Button("Cancel", role: .cancel) {}
        } message: { Text("This writes one file in ~/Library/LaunchAgents and starts the Bridge now and at every login. It does not need administrator rights.") }
        .alert("Remove the login item?", isPresented: $confirmRemove) {
            Button("Remove", role: .destructive) { try? LaunchAgent.stop(); try? LaunchAgent.uninstall(); model.refresh() }
            Button("Cancel", role: .cancel) {}
        } message: { Text("The Bridge stops and no longer starts at login. Your vault, backups and settings stay as they are.") }
    }
}
