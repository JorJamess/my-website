// Extracts selectable text from a PDF with macOS PDFKit. No OCR. Prints one JSON object per line:
//   {"type":"info","pages":N,"locked":false}
//   {"type":"page","page":1,"text":"..."}
// Pages are streamed so a large PDF never has to sit in memory as one string.
import Foundation
import PDFKit

func emit(_ obj: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: obj, options: [.withoutEscapingSlashes]),
       var s = String(data: data, encoding: .utf8) {
        s += "\n"
        FileHandle.standardOutput.write(s.data(using: .utf8)!)
    }
}

guard CommandLine.arguments.count >= 2 else {
    FileHandle.standardError.write("usage: pdf-text <file.pdf>\n".data(using: .utf8)!)
    exit(64)
}
let url = URL(fileURLWithPath: CommandLine.arguments[1])
guard let doc = PDFDocument(url: url) else {
    emit(["type": "error", "message": "not a readable PDF"])
    exit(2)
}
if doc.isLocked {
    emit(["type": "info", "pages": doc.pageCount, "locked": true])
    exit(3)
}
emit(["type": "info", "pages": doc.pageCount, "locked": false])
for i in 0..<doc.pageCount {
    autoreleasepool {
        let text = doc.page(at: i)?.string ?? ""
        emit(["type": "page", "page": i + 1, "text": text])
    }
}
