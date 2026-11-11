import Foundation
import AppKit
import SwiftUI

struct BackupInfo { var status: String; var at: String?; var lastSuccessAt: String?; var message: String? }

struct BridgeStatus {
    var online = true
    var paused = false
    var pausedInLifeOS = false
    var initialSyncConfirmed = false
    var syncing = false
    var deviceRevoked = false
    var lastSuccessAt: Date?
    var lastError: String?
    var pendingForMac = 0
    var awaitingApproval = 0
    var requestsToday = 0
    var backupConfigured = false
    var backupLocal: BackupInfo?
    var backupExternal: BackupInfo?
    var syncedNotes = 0
    var heldBack = 0

    init() {}

    /// Reads the JSON the Core sends (the `data` of a `status` answer). Unknown or missing fields are simply left at defaults.
    init(json d: [String: Any]) {
        online = d["online"] as? Bool ?? true
        paused = d["paused"] as? Bool ?? false
        pausedInLifeOS = d["pausedByOwnerInLifeos"] as? Bool ?? false
        initialSyncConfirmed = d["initialSyncConfirmed"] as? Bool ?? false
        syncing = d["syncing"] as? Bool ?? false
        deviceRevoked = d["deviceRevoked"] as? Bool ?? false
        lastError = d["lastError"] as? String
        pendingForMac = d["pendingCommands"] as? Int ?? 0
        awaitingApproval = d["awaitingApproval"] as? Int ?? 0
        if let u = d["usageToday"] as? [String: Any] { requestsToday = u["requests"] as? Int ?? 0 }
        if let s = d["lastSuccessAt"] as? String { lastSuccessAt = ISO8601DateFormatter.fractional.date(from: s) ?? ISO8601DateFormatter().date(from: s) }
        if let docs = d["docs"] as? [String: Int] {
            syncedNotes = docs["synced"] ?? 0
            heldBack = (docs["blocked_secret"] ?? 0) + (docs["failed"] ?? 0)
        }
        if let b = d["backup"] as? [String: Any] {
            backupConfigured = b["configured"] as? Bool ?? false
            backupLocal = BackupInfo(json: b["local"] as? [String: Any])
            backupExternal = BackupInfo(json: b["external"] as? [String: Any])
        }
    }
}

extension BackupInfo {
    init?(json: [String: Any]?) {
        guard let j = json, let s = j["status"] as? String else { return nil }
        self.init(status: s, at: j["at"] as? String, lastSuccessAt: j["lastSuccessAt"] as? String, message: j["message"] as? String)
    }
}

extension ISO8601DateFormatter {
    static let fractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}

enum Health: Equatable {
    case notSetUp, stopped, ok, syncing, paused, offline, attention(String)

    var title: String {
        switch self {
        case .notSetUp: return "Not set up yet"
        case .stopped: return "Bridge is not running"
        case .ok: return "Synced"
        case .syncing: return "Syncing…"
        case .paused: return "Paused"
        case .offline: return "Offline"
        case .attention(let m): return m
        }
    }
    var symbol: String {
        switch self {
        case .notSetUp, .stopped: return "circle.dashed"
        case .ok: return "checkmark.circle.fill"
        case .syncing: return "arrow.triangle.2.circlepath"
        case .paused: return "pause.circle.fill"
        case .offline: return "wifi.slash"
        case .attention: return "exclamationmark.triangle.fill"
        }
    }
    var color: Color {
        switch self {
        case .ok: return .green
        case .syncing: return .blue
        case .paused, .offline, .notSetUp, .stopped: return .secondary
        case .attention: return .orange
        }
    }
}

struct LocalConfig {
    var lifeosUrl: String?
    var vaultPath: String?
    var vaultName: String?
    var deviceName: String?

    static func load() -> LocalConfig? {
        guard let data = FileManager.default.contents(atPath: BridgePaths.config),
              let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return LocalConfig(lifeosUrl: o["lifeosUrl"] as? String, vaultPath: o["vaultPath"] as? String, vaultName: o["vaultName"] as? String, deviceName: o["deviceName"] as? String)
    }
}

@MainActor
final class AppModel: ObservableObject {
    @Published var status: BridgeStatus?
    @Published var config: LocalConfig? = LocalConfig.load()
    @Published var message: String?
    @Published var busy: Set<String> = []
    @Published var agentInstalled = LaunchAgent.isInstalled
    private var timer: Timer?

    var health: Health {
        guard config != nil else { return .notSetUp }
        guard let s = status else { return .stopped }
        if s.deviceRevoked { return .attention("This Mac was revoked in LifeOS") }
        if !s.initialSyncConfirmed { return .attention("First sync not confirmed") }
        if s.paused { return .paused }
        if !s.online { return .offline }
        if s.syncing { return .syncing }
        if s.heldBack > 0 { return .attention("\(s.heldBack) held back") }
        if let l = s.lastError, !l.isEmpty, s.lastSuccessAt == nil { return .attention("Sync problem") }
        return .ok
    }

    /// Wrong, missing or failed backups need attention too.
    var backupProblem: Bool {
        guard let s = status, s.backupConfigured else { return false }
        return s.backupLocal?.status == "failed"
    }

    func start() {
        refresh()
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in Task { @MainActor in self?.refresh() } }
    }

    func refresh() {
        config = LocalConfig.load()
        agentInstalled = LaunchAgent.isInstalled
        Task.detached {
            let result = try? BridgeSocket.call("status", timeout: 4)
            let s = (result?["data"] as? [String: Any]).map(BridgeStatus.init(json:))
            await MainActor.run { self.status = s }
        }
    }

    /// Runs a socket command in the background and shows its outcome.
    func perform(_ key: String, _ cmd: String, args: [String: Any] = [:], done: String, timeout: TimeInterval = 600) {
        guard !busy.contains(key) else { return }
        busy.insert(key)
        Task.detached {
            var text = done
            do { _ = try BridgeSocket.call(cmd, args: args, timeout: timeout) } catch { text = error.localizedDescription }
            let shown = text
            await MainActor.run {
                self.busy.remove(key)
                self.message = shown
                self.refresh()
            }
        }
    }

    func syncNow() { perform("sync", "sync", done: "Sync finished") }
    func togglePause() { perform("pause", (status?.paused ?? false) ? "resume" : "pause", done: (status?.paused ?? false) ? "Resumed" : "Paused") }
    func backupNow() { perform("backup", "backup", done: "Backup finished") }

    func startBridge() {
        do { try LaunchAgent.start(); message = "Starting the Bridge…" } catch { message = error.localizedDescription }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.refresh() }
    }
    func stopBridge() {
        try? LaunchAgent.stop()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.refresh() }
    }

    func open(path: String) { NSWorkspace.shared.open(URL(fileURLWithPath: path)) }
    func openVault() { if let p = config?.vaultPath { open(path: p) } }
    func openLogs() { open(path: BridgePaths.log) }
    func openLifeOS(_ page: String = "app/settings") {
        guard let base = config?.lifeosUrl, let url = URL(string: "\(base)/\(page)") else { return }
        NSWorkspace.shared.open(url)
    }
}
