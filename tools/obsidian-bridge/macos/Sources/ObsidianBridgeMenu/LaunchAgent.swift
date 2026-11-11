import Foundation

/// Start-at-login for the Bridge, as a user LaunchAgent (no root). The app only does this when the owner clicks the button.
enum LaunchAgent {
    static var uid: String { String(getuid()) }

    /// Is a Bridge service answering on its socket right now? (Never start a second one.)
    static func isRunning() -> Bool { (try? BridgeSocket.call("status", timeout: 2)) != nil }

    /// Ask a running service to stop cleanly and wait for it to go away.
    static func stopAndWait() {
        guard isRunning() else { return }
        _ = try? BridgeSocket.call("shutdown", timeout: 2)
        for _ in 0..<25 {
            Thread.sleep(forTimeInterval: 0.2)
            if !isRunning() { break }
        }
    }

    /// Run the service with its current settings: stop the old one (if any), then start it the way this Mac is set up.
    static func restart() throws {
        stopAndWait()
        if isInstalled {
            if isLoaded() { try shell("/bin/launchctl", ["kickstart", "-k", "gui/\(uid)/\(BridgePaths.label)"]) }
            else { try shell("/bin/launchctl", ["bootstrap", "gui/\(uid)", BridgePaths.plist]) }
        } else { try launchDetached() }
    }

    static var isInstalled: Bool { FileManager.default.fileExists(atPath: BridgePaths.plist) }

    static func isLoaded() -> Bool {
        (try? shell("/bin/launchctl", ["print", "gui/\(uid)/\(BridgePaths.label)"])) != nil
    }

    static func plistText(node: String, cli: String) -> String {
        let logs = BridgePaths.home + "/logs"
        return """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
          <key>Label</key><string>\(BridgePaths.label)</string>
          <key>ProgramArguments</key>
          <array><string>\(node)</string><string>\(cli)</string><string>run</string></array>
          <key>RunAtLoad</key><true/>
          <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
          <key>ThrottleInterval</key><integer>15</integer>
          <key>ProcessType</key><string>Background</string>
          <key>StandardOutPath</key><string>\(logs)/launchd.out.log</string>
          <key>StandardErrorPath</key><string>\(logs)/launchd.err.log</string>
        </dict>
        </plist>
        """
    }

    static func install() throws {
        guard let core = BridgePaths.core() else { throw CoreError.notInstalled }
        stopAndWait() // a service started without the login item must not keep running next to the new one
        try FileManager.default.createDirectory(atPath: BridgePaths.home + "/logs", withIntermediateDirectories: true)
        try FileManager.default.createDirectory(atPath: (BridgePaths.plist as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
        try plistText(node: core.node, cli: core.cli).write(toFile: BridgePaths.plist, atomically: true, encoding: .utf8)
        _ = try? shell("/bin/launchctl", ["bootout", "gui/\(uid)/\(BridgePaths.label)"])
        try shell("/bin/launchctl", ["bootstrap", "gui/\(uid)", BridgePaths.plist])
    }

    static func uninstall() throws {
        _ = try? shell("/bin/launchctl", ["bootout", "gui/\(uid)/\(BridgePaths.label)"])
        try? FileManager.default.removeItem(atPath: BridgePaths.plist)
    }

    /// Starts the service for this session only (no login item). It keeps running after the app quits.
    static func launchDetached() throws {
        if isRunning() { return }
        guard let core = BridgePaths.core() else { throw CoreError.notInstalled }
        try FileManager.default.createDirectory(atPath: BridgePaths.home + "/logs", withIntermediateDirectories: true)
        let logPath = BridgePaths.home + "/logs/launchd.out.log"
        if !FileManager.default.fileExists(atPath: logPath) { FileManager.default.createFile(atPath: logPath, contents: nil) }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: core.node)
        p.arguments = [core.cli, "run"]
        p.standardInput = FileHandle.nullDevice
        if let h = FileHandle(forWritingAtPath: logPath) { h.seekToEndOfFile(); p.standardOutput = h; p.standardError = h }
        try p.run()
    }

    static func start() throws {
        if isRunning() { return }
        // without a login item, just run it now; installing one is a separate, explicit choice
        if !isInstalled { try launchDetached(); return }
        if isLoaded() { try shell("/bin/launchctl", ["kickstart", "gui/\(uid)/\(BridgePaths.label)"]) }
        else { try shell("/bin/launchctl", ["bootstrap", "gui/\(uid)", BridgePaths.plist]) }
    }

    static func stop() throws {
        // asks the service to stop cleanly; launchd then restarts it only after a crash, not after a clean exit
        _ = try? BridgeSocket.call("shutdown")
    }

    @discardableResult
    static func shell(_ exe: String, _ args: [String]) throws -> String {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: exe)
        p.arguments = args
        let out = Pipe(), err = Pipe()
        p.standardOutput = out
        p.standardError = err
        try p.run()
        let o = out.fileHandleForReading.readDataToEndOfFile()
        let e = err.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        guard p.terminationStatus == 0 else { throw CoreError.failed(String(decoding: e, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)) }
        return String(decoding: o, as: UTF8.self)
    }
}
