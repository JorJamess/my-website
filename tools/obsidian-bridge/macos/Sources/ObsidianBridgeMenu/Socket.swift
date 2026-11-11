import Foundation
import Darwin

enum SocketError: Error, LocalizedError {
    case notRunning, timeout, badAnswer, remote(String)
    var errorDescription: String? {
        switch self {
        case .notRunning: return "The Bridge service is not running."
        case .timeout: return "The Bridge did not answer in time."
        case .badAnswer: return "The Bridge sent an answer the app could not read."
        case .remote(let m): return m
        }
    }
}

/// One request to the Bridge service over its private Unix socket (newline-delimited JSON, same as the command line).
enum BridgeSocket {
    static func call(_ cmd: String, args: [String: Any] = [:], path: String = BridgePaths.socket, timeout: TimeInterval = 20) throws -> [String: Any] {
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw SocketError.notRunning }
        defer { close(fd) }

        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let bytes = Array(path.utf8)
        guard bytes.count < MemoryLayout.size(ofValue: addr.sun_path) else { throw SocketError.notRunning }
        withUnsafeMutableBytes(of: &addr.sun_path) { raw in
            for (i, b) in bytes.enumerated() { raw[i] = b }
            raw[bytes.count] = 0
        }
        let size = socklen_t(MemoryLayout<sockaddr_un>.size)
        let ok = withUnsafePointer(to: &addr) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, size) } }
        guard ok == 0 else { throw SocketError.notRunning }

        var tv = timeval(tv_sec: Int(timeout), tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))

        let payload = try JSONSerialization.data(withJSONObject: ["cmd": cmd, "args": args])
        var line = payload
        line.append(0x0A)
        let sent = line.withUnsafeBytes { send(fd, $0.baseAddress, line.count, 0) }
        guard sent == line.count else { throw SocketError.notRunning }

        var buffer = Data()
        var chunk = [UInt8](repeating: 0, count: 8192)
        while !buffer.contains(0x0A) {
            let n = recv(fd, &chunk, chunk.count, 0)
            if n < 0 { throw SocketError.timeout }
            if n == 0 { break }
            buffer.append(chunk, count: n)
        }
        guard let nl = buffer.firstIndex(of: 0x0A),
              let obj = try JSONSerialization.jsonObject(with: buffer[..<nl]) as? [String: Any] else { throw SocketError.badAnswer }
        if (obj["ok"] as? Bool) != true { throw SocketError.remote(obj["error"] as? String ?? "The Bridge refused that.") }
        return obj
    }
}
