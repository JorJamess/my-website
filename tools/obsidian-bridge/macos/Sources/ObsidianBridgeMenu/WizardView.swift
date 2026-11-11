import SwiftUI
import AppKit

private func pickFolder(_ message: String) -> String? {
    let p = NSOpenPanel()
    p.canChooseDirectories = true
    p.canChooseFiles = false
    p.allowsMultipleSelection = false
    p.canCreateDirectories = true
    p.message = message
    p.prompt = "Choose"
    return p.runModal() == .OK ? p.url?.path : nil
}

private func bytes(_ n: Double?) -> String {
    guard let n else { return "unknown" }
    return ByteCountFormatter.string(fromByteCount: Int64(n), countStyle: .file)
}

private enum Step: Int, CaseIterable { case vault, backups, checks, connect, preview, finish
    var title: String {
        switch self {
        case .vault: return "Your vault"
        case .backups: return "Backups"
        case .checks: return "Checks"
        case .connect: return "Connect to LifeOS"
        case .preview: return "Review the first sync"
        case .finish: return "All set"
        }
    }
}

/// The Setup Wizard. Every check and action runs in the Bridge's own command line (`wizard` steps); this view only
/// collects choices and shows results. Nothing is uploaded until the review step is confirmed.
struct WizardView: View {
    @EnvironmentObject var model: AppModel
    @State private var step: Step = .vault
    @State private var busy = false
    @State private var error: String?

    @State private var vault: String = ""
    @State private var vaultInfo: [String: Any]?
    @State private var backup: String = ""
    @State private var backupInfo: [String: Any]?
    @State private var external: String = ""
    @State private var externalInfo: [String: Any]?
    @State private var acceptUnencrypted = false
    @State private var system: [String: Any]?
    @State private var url = ""
    @State private var code = ""
    @State private var deviceName = Host.current().localizedName ?? "My Mac"
    @State private var paired = false
    @State private var preview: [String: Any]?
    @State private var confirmed = false
    @State private var installLogin = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ProgressView(value: Double(step.rawValue + 1), total: Double(Step.allCases.count)).tint(Color(red: 0.85, green: 0.33, blue: 0.12))
            Text("Step \(step.rawValue + 1) of \(Step.allCases.count)").font(.caption).foregroundStyle(.secondary)
            Text(step.title).font(.title2.weight(.semibold))
            content
            if let error { Text(error).foregroundStyle(.red).font(.callout).fixedSize(horizontal: false, vertical: true) }
            Spacer(minLength: 0)
            HStack {
                Button("Back") { error = nil; step = Step(rawValue: step.rawValue - 1) ?? .vault }.disabled(step == .vault || busy)
                Spacer()
                if busy { ProgressView().controlSize(.small) }
                Button(nextTitle) { Task { await next() } }
                    .keyboardShortcut(.defaultAction)
                    .disabled(!canContinue || busy)
            }
        }
        .padding(22)
        .frame(width: 560, height: 520)
        .task { system = try? await CoreRunner.wizard("system") }
    }

    private var nextTitle: String {
        switch step {
        case .finish: return "Done"
        case .preview: return "Start syncing"
        case .connect: return paired ? "Continue" : "Pair this Mac"
        default: return "Continue"
        }
    }

    private var canContinue: Bool {
        switch step {
        case .vault: return (vaultInfo?["valid"] as? Bool == true) && (vaultInfo?["readWrite"] as? Bool == true)
        case .backups:
            guard backupInfo?["writable"] as? Bool == true, backupInfo?["insideVault"] as? Bool != true else { return false }
            return !needsEncryptionAck || acceptUnencrypted
        case .checks: return (system?["node"] as? [String: Any])?["ok"] as? Bool == true
        case .connect: return paired || (url.hasPrefix("https://") && !code.isEmpty && !deviceName.isEmpty)
        case .preview: return confirmed
        case .finish: return true
        }
    }

    private var needsEncryptionAck: Bool {
        (system?["fileVault"] as? Bool == false) || (backupInfo?["encrypted"] as? Bool == false) || (externalInfo?["encrypted"] as? Bool == false)
    }

    @ViewBuilder private var content: some View {
        switch step {
        case .vault:
            Text("Choose your Obsidian vault. The Bridge reads it and only sends notes you mark with lifeos_sync: true. The vault is never moved.").foregroundStyle(.secondary)
            HStack {
                Text(vault.isEmpty ? "No folder chosen" : vault).lineLimit(2).truncationMode(.middle).font(.callout.monospaced())
                Spacer()
                Button("Choose…") { choose("Choose your Obsidian vault folder") { vault = $0; Task { await checkVault() } } }
            }
            if let v = vaultInfo {
                check(v["valid"] as? Bool == true, "Valid Obsidian vault", "That folder has no .obsidian folder, so it is not a vault")
                if v["valid"] as? Bool == true {
                    check(v["readWrite"] as? Bool == true, "The Bridge can read and write it", "No access. Allow it in System Settings → Privacy & Security → Files and Folders (or Full Disk Access) for Node, then try again.")
                    Text("\(v["markdownFiles"] as? Int ?? 0) notes, \(bytes(v["sizeBytes"] as? Double))").font(.callout).foregroundStyle(.secondary)
                }
            }
        case .backups:
            Text("Backups cover the whole vault: notes, PDFs, images, settings. Pick a folder outside the vault. An external SSD is optional and can be added later.").foregroundStyle(.secondary)
            folderRow("Local backup folder", backup, "Choose a folder for local backups") { backup = $0; Task { await checkBackup() } }
            if let b = backupInfo {
                check(b["insideVault"] as? Bool != true, "Outside the vault", "Pick a folder outside the vault")
                check(b["writable"] as? Bool == true, "Writable, \(bytes(b["freeBytes"] as? Double)) free", "The Bridge can't write there")
                if b["enoughSpace"] as? Bool == false { warn("Free space is under three times the vault size; daily backups may not fit.") }
                if b["encrypted"] as? Bool == false { warn("This drive is not encrypted. Prefer APFS (Encrypted) in Disk Utility. The Bridge never formats a drive.") }
            }
            folderRow("External SSD folder (optional)", external, "Choose a folder on the external drive") { external = $0; Task { await checkExternal() } }
            if let e = externalInfo {
                check(e["available"] as? Bool == true, "Drive found", "The drive isn't available. You can skip this and add it later.")
                if e["encrypted"] as? Bool == false { warn("The external drive is not encrypted.") }
            }
            if needsEncryptionAck { Toggle("I understand some of these are not encrypted and want to continue", isOn: $acceptUnencrypted) }
        case .checks:
            Text("A few things the Bridge needs on this Mac.").foregroundStyle(.secondary)
            let node = system?["node"] as? [String: Any]
            check(node?["ok"] as? Bool == true, "Node.js \(node?["version"] as? String ?? "?")", "Node.js 22.5 or newer is required")
            switch system?["fileVault"] as? Bool {
            case .some(true): check(true, "FileVault is on", "")
            case .some(false): warn("FileVault is off. Turn it on in System Settings → Privacy & Security → FileVault so backups on this Mac are encrypted at rest.")
            default: warn("Could not check FileVault.")
            }
            if system?["pdfReader"] as? Bool == true { check(true, "PDF text reader is built", "") } else { warn("The PDF text reader is not built (notes will sync, PDF text will not). Run scripts/build.sh.") }
            Text("If macOS asks to let Node access folders, say yes: the Bridge can't read your vault without it. No OCR or cloud services are used.").font(.caption).foregroundStyle(.secondary)
        case .connect:
            Text("In LifeOS open Settings → Obsidian → Make pairing code, then enter it here. The code works once and expires in 10 minutes.").foregroundStyle(.secondary)
            TextField("LifeOS address (https://…)", text: $url).textFieldStyle(.roundedBorder).disabled(paired)
            TextField("Name for this Mac", text: $deviceName).textFieldStyle(.roundedBorder).disabled(paired)
            TextField("Pairing code (like K7QM-4XD2)", text: $code).textFieldStyle(.roundedBorder).font(.body.monospaced()).disabled(paired)
            if paired { check(true, "Paired. The device token is in the macOS Keychain.", "") }
        case .preview:
            Text("This is what the first sync would send. Only numbers are shown; notes you didn't mark are never named. Nothing has been uploaded yet.").foregroundStyle(.secondary)
            if let p = preview {
                Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 4) {
                    previewRow("Notes marked to share", p["eligibleNotes"])
                    previewRow("  already have an id", p["notesWithId"])
                    previewRow("  need a new id (added to the note)", p["notesNeedingId"])
                    previewRow("  invalid or duplicate ids", (p["invalidIds"] as? Int ?? 0) + (p["duplicateIdGroups"] as? Int ?? 0))
                    previewRow("Referenced PDFs (text only)", p["referencedPdfs"])
                    previewRow("  over the size limit / not found", (p["pdfsTooLarge"] as? Int ?? 0) + (p["pdfsNotFound"] as? Int ?? 0))
                    previewRow("Held back by the secret scan", p["blockedBySecretScan"])
                    GridRow { Text("Text to upload"); Text(bytes(p["estimatedTextBytes"] as? Double)) }
                }.font(.callout)
                Text("Images and PDF files never leave this Mac.").font(.caption).foregroundStyle(.secondary)
            }
            Toggle("I reviewed this and want to start syncing", isOn: $confirmed)
        case .finish:
            Text("Setup is done. The Bridge syncs in the background; the icon in the menu bar shows its status.").foregroundStyle(.secondary)
            Toggle("Start the Bridge at login (installs one file in ~/Library/LaunchAgents, no administrator rights)", isOn: $installLogin)
        }
    }

    // MARK: pieces

    private func check(_ ok: Bool, _ good: String, _ bad: String) -> some View {
        Label(ok ? good : bad, systemImage: ok ? "checkmark.circle.fill" : "xmark.octagon.fill").foregroundStyle(ok ? Color.green : Color.red).font(.callout)
    }
    private func warn(_ text: String) -> some View {
        Label(text, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange).font(.callout).fixedSize(horizontal: false, vertical: true)
    }
    private func previewRow(_ title: String, _ value: Any?) -> some View { GridRow { Text(title); Text("\(value as? Int ?? 0)").monospacedDigit() } }
    private func folderRow(_ title: String, _ path: String, _ message: String, _ set: @escaping (String) -> Void) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            HStack {
                Text(path.isEmpty ? "Not chosen" : path).lineLimit(1).truncationMode(.middle).font(.callout.monospaced())
                Spacer()
                Button("Choose…") { choose(message, set) }
            }
        }
    }
    private func choose(_ message: String, _ set: (String) -> Void) { if let p = pickFolder(message) { set(p) } }

    // MARK: actions (all work happens in the Core)

    private func checkVault() async {
        error = nil
        do { vaultInfo = try await CoreRunner.wizard("check-vault", ["path": vault]) } catch { self.error = error.localizedDescription }
    }
    private func checkBackup() async {
        error = nil
        do { backupInfo = try await CoreRunner.wizard("check-backup", ["path": backup, "vault": vault]) } catch { self.error = error.localizedDescription }
    }
    private func checkExternal() async {
        error = nil
        do { externalInfo = try await CoreRunner.wizard("check-external", ["path": external]) } catch { self.error = error.localizedDescription }
    }

    private func next() async {
        error = nil
        busy = true
        defer { busy = false }
        do {
            switch step {
            case .backups:
                system = try await CoreRunner.wizard("system")
            case .connect:
                if !paired {
                    var flags = ["url": url, "code": code, "name": deviceName, "vault": vault, "backup": backup]
                    if !external.isEmpty { flags["external"] = external }
                    _ = try await CoreRunner.wizard("pair", flags, switches: acceptUnencrypted ? ["allow-unencrypted"] : [])
                    paired = true
                    code = ""
                }
                preview = try await CoreRunner.wizard("preview")
            case .preview:
                _ = try await CoreRunner.wizard("confirm")
            case .finish:
                if installLogin { try LaunchAgent.install() } else { try LaunchAgent.restart() }
                model.refresh()
                NSApp.keyWindow?.close()
                return
            default: break
            }
            step = Step(rawValue: step.rawValue + 1) ?? .finish
        } catch {
            self.error = error.localizedDescription
        }
    }
}
