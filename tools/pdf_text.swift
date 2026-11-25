// CURIVEN PDF text extraction with macOS PDFKit (no third-party code, nothing downloaded).
// Usage: pdf_text <file.pdf> <maxPages>   → JSON on stdout: {"pageCount":N,"pages":[{"n":1,"text":"…"}]} or {"error":"…"}
// Reads text only: no JavaScript, links, attachments, forms or embedded media are run or opened. Run by server.py in a
// child process with a time limit; the input file is a private temporary copy deleted afterwards.
import Foundation
import PDFKit

func emit(_ obj: [String: Any]) {
    if let d = try? JSONSerialization.data(withJSONObject: obj) { FileHandle.standardOutput.write(d) }
}
let args = CommandLine.arguments
guard args.count == 3, let maxPages = Int(args[2]), maxPages > 0 else { emit(["error": "usage"]); exit(2) }
guard let doc = PDFDocument(url: URL(fileURLWithPath: args[1])) else { emit(["error": "unreadable"]); exit(0) }
if doc.isLocked { emit(["error": "locked"]); exit(0) }
var pages: [[String: Any]] = []
let count = doc.pageCount
for i in 0..<min(count, maxPages) {
    autoreleasepool {
        let text = doc.page(at: i)?.string ?? ""
        pages.append(["n": i + 1, "text": String(text.prefix(20000))])
    }
}
emit(["pageCount": count, "pages": pages])
