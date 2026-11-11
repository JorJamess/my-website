import Foundation

enum CoreError: Error, LocalizedError {
    case notInstalled, failed(String)
    var errorDescription: String? {
        switch self {
        case .notInstalled: return "The Bridge command line was not found. Rebuild the app with scripts/build-app.sh."
        case .failed(let m): return m
        }
    }
}

/// Runs the Core's command line (`obsidian-bridge wizard <step> --json`) and returns its JSON answer.
enum CoreRunner {
    static func wizard(_ step: String, _ flags: [String: String] = [:], switches: [String] = []) async throws -> [String: Any] {
        guard let core = BridgePaths.core() else { throw CoreError.notInstalled }
        var args = [core.cli, "wizard", step]
        for (k, v) in flags.sorted(by: { $0.key < $1.key }) { args += ["--\(k)", v] }
        for s in switches { args.append("--\(s)") }
        return try await run(core.node, args)
    }

    /// Plain command (e.g. `sync`) for when the service is not running.
    static func command(_ words: [String]) async throws -> String {
        guard let core = BridgePaths.core() else { throw CoreError.notInstalled }
        return try await runText(core.node, [core.cli] + words)
    }

    private static func runText(_ exe: String, _ args: [String]) async throws -> String {
        try await withCheckedThrowingContinuation { cont in
            DispatchQueue.global().async {
                let p = Process()
                p.executableURL = URL(fileURLWithPath: exe)
                p.arguments = args
                let out = Pipe(), err = Pipe()
                p.standardOutput = out
                p.standardError = err
                do { try p.run() } catch { return cont.resume(throwing: CoreError.failed("Could not start Node: \(error.localizedDescription)")) }
                let data = out.fileHandleForReading.readDataToEndOfFile()
                let errData = err.fileHandleForReading.readDataToEndOfFile()
                p.waitUntilExit()
                let text = String(decoding: data, as: UTF8.self)
                if p.terminationStatus != 0 && text.isEmpty { return cont.resume(throwing: CoreError.failed(String(decoding: errData, as: UTF8.self))) }
                cont.resume(returning: text)
            }
        }
    }

    private static func run(_ exe: String, _ args: [String]) async throws -> [String: Any] {
        let text = try await runText(exe, args)
        guard let data = text.data(using: .utf8),
              let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw CoreError.failed("Unexpected answer from the Bridge") }
        if let e = obj["error"] as? String { throw CoreError.failed(e) }
        return obj
    }
}
