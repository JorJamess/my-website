// Test helper: writes a small PDF with real, selectable text.
// usage: make-fixture <out.pdf> <fontName> <page text 1> [page text 2 ...]   (use font "none" for a blank page)
import Foundation
import CoreText
import CoreGraphics

let args = CommandLine.arguments
guard args.count >= 4 else { exit(64) }
let out = URL(fileURLWithPath: args[1])
let fontName = args[2]
var box = CGRect(x: 0, y: 0, width: 595, height: 842)
guard let ctx = CGContext(out as CFURL, mediaBox: &box, nil) else { exit(1) }
for text in args[3...] {
    ctx.beginPDFPage(nil)
    if fontName != "none" && !text.isEmpty {
        let font = CTFontCreateWithName(fontName as CFString, 18, nil)
        let attr = NSAttributedString(string: text, attributes: [NSAttributedString.Key(rawValue: kCTFontAttributeName as String): font])
        let setter = CTFramesetterCreateWithAttributedString(attr)
        let path = CGPath(rect: CGRect(x: 50, y: 60, width: 495, height: 720), transform: nil)
        let frame = CTFramesetterCreateFrame(setter, CFRangeMake(0, 0), path, nil)
        CTFrameDraw(frame, ctx)
    }
    ctx.endPDFPage()
}
ctx.closePDF()
