import Foundation

/// Where the Bridge keeps its files, and how to reach the Core. The app has no business logic of its own:
/// it talks to the running service over a private socket and runs the same command line the Terminal uses.
enum BridgePaths {
    static let label = "com.jameswebpupu.obsidian-bridge"

    static var home: String {
        if let h = ProcessInfo.processInfo.environment["OBSIDIAN_BRIDGE_HOME"], !h.isEmpty { return h }
        return NSHomeDirectory() + "/Library/Application Support/ObsidianBridge"
    }
    static var socket: String { home + "/bridge.sock" }
    static var log: String { home + "/logs/bridge.log" }
    static var config: String { home + "/config.json" }
    static var plist: String { NSHomeDirectory() + "/Library/LaunchAgents/\(label).plist" }

    /// node and the Core's command line, written next to the app when it was built (see scripts/build-app.sh).
    struct Core { let node: String; let cli: String }

    static func core() -> Core? {
        let env = ProcessInfo.processInfo.environment
        if let n = env["OBSIDIAN_BRIDGE_NODE"], let c = env["OBSIDIAN_BRIDGE_CLI"] { return Core(node: n, cli: c) }
        guard let url = Bundle.main.url(forResource: "bridge-paths", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: String],
              let node = obj["node"], let cli = obj["cli"] else { return nil }
        return Core(node: node, cli: cli)
    }
}
