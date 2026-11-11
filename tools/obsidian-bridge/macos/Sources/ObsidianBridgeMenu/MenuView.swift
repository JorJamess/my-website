import SwiftUI

private let relative: RelativeDateTimeFormatter = {
    let f = RelativeDateTimeFormatter()
    f.unitsStyle = .short
    return f
}()

private func ago(_ d: Date?) -> String { d.map { relative.localizedString(for: $0, relativeTo: Date()) } ?? "never" }
private func ago(iso: String?) -> String {
    guard let iso, let d = ISO8601DateFormatter.fractional.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return "never" }
    return ago(d)
}

struct MenuView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            if model.config == nil {
                Text("Set up the Bridge to start syncing the notes you choose.").font(.callout).foregroundStyle(.secondary)
                actionButton("Set up…", "wand.and.stars") { openWindow(id: "setup"); NSApp.activate(ignoringOtherApps: true) }
            } else if model.status == nil {
                Text("The service that syncs your notes is not running.").font(.callout).foregroundStyle(.secondary)
                actionButton("Start the Bridge", "play.fill") { model.startBridge() }
                Divider()
                shortcuts
            } else if let s = model.status {
                rows(s)
                Divider()
                actions(s)
                Divider()
                shortcuts
            }
            if let m = model.message { Text(m).font(.caption).foregroundStyle(.secondary).lineLimit(3) }
            Divider()
            actionButton("Quit (the Bridge keeps running)", "power") { NSApp.terminate(nil) }
        }
        .padding(12)
        .frame(width: 330)
    }

    private var header: some View {
        HStack(spacing: 8) {
            Image(systemName: model.health.symbol).foregroundStyle(model.health.color)
            VStack(alignment: .leading, spacing: 0) {
                Text("Obsidian Bridge").font(.headline)
                Text(model.health.title).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
        }
    }

    private func rows(_ s: BridgeStatus) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            if let v = model.config?.vaultName { row("Vault", v) }
            row("Last sync", ago(s.lastSuccessAt))
            row("Approvals", approvalsText(s))
            row("Local backup", backupText(s.backupLocal, configured: s.backupConfigured, none: "not set up"))
            row("External SSD", backupText(s.backupExternal, configured: s.backupConfigured, none: "not set up"))
            if s.heldBack > 0 { row("Held back", "\(s.heldBack) (see LifeOS)") }
        }.font(.callout)
    }

    private func approvalsText(_ s: BridgeStatus) -> String {
        var parts: [String] = []
        if s.awaitingApproval > 0 { parts.append("\(s.awaitingApproval) waiting for you") }
        if s.pendingForMac > 0 { parts.append("\(s.pendingForMac) for this Mac") }
        return parts.isEmpty ? "none waiting" : parts.joined(separator: ", ")
    }

    private func backupText(_ b: BackupInfo?, configured: Bool, none: String) -> String {
        guard configured else { return none }
        guard let b else { return "no result yet" }
        switch b.status {
        case "ok": return "✓ \(ago(iso: b.lastSuccessAt))"
        case "unavailable": return "unavailable" + (b.lastSuccessAt != nil ? " (last ok \(ago(iso: b.lastSuccessAt)))" : "")
        default: return "failed" + (b.lastSuccessAt != nil ? " (last ok \(ago(iso: b.lastSuccessAt)))" : "")
        }
    }

    private func row(_ k: String, _ v: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(k).foregroundStyle(.secondary)
            Spacer()
            Text(v).multilineTextAlignment(.trailing)
        }
    }

    private func actions(_ s: BridgeStatus) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            actionButton(model.busy.contains("sync") ? "Syncing…" : "Sync now", "arrow.triangle.2.circlepath", disabled: s.paused || model.busy.contains("sync")) { model.syncNow() }
            actionButton(s.paused ? "Resume" : "Pause", s.paused ? "play.fill" : "pause.fill") { model.togglePause() }
            actionButton(model.busy.contains("backup") ? "Backing up…" : "Back up now", "externaldrive", disabled: !s.backupConfigured || model.busy.contains("backup")) { model.backupNow() }
        }
    }

    private var shortcuts: some View {
        VStack(alignment: .leading, spacing: 2) {
            actionButton("View pending actions…", "checklist") { model.openLifeOS("app/approvals") }
            actionButton("Open LifeOS", "safari") { model.openLifeOS("app") }
            actionButton("Open Vault", "folder") { model.openVault() }
            actionButton("View logs", "doc.text") { model.openLogs() }
            actionButton("Settings…", "gearshape") { openWindow(id: "settings"); NSApp.activate(ignoringOtherApps: true) }
        }
    }

    private func actionButton(_ title: String, _ symbol: String, disabled: Bool = false, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack { Image(systemName: symbol).frame(width: 18); Text(title); Spacer() }.contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.vertical, 3)
        .disabled(disabled)
        .opacity(disabled ? 0.45 : 1)
    }
}
