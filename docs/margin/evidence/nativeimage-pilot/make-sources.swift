// Draws the pilot's synthetic screenshots (ground-truth.txt as a coding question) with
// AppKit into PNG files, without opening a window:
//   swift make-sources.swift ground-truth.txt <outdir>
import AppKit

let args = CommandLine.arguments
let lines = try! String(contentsOfFile: args[1], encoding: .utf8).split(separator: "\n").map(String.init)
let outDir = args[2]

func draw(width: Int, height: Int, scale: CGFloat, dark: Bool, name: String) {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8,
                               samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                               bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    let ctx = NSGraphicsContext(bitmapImageRep: rep)!
    NSGraphicsContext.current = ctx
    // Flip so text runs top to bottom.
    ctx.cgContext.translateBy(x: 0, y: CGFloat(height)); ctx.cgContext.scaleBy(x: 1, y: -1)
    (dark ? NSColor(white: 0.12, alpha: 1) : NSColor.white).setFill()
    NSRect(x: 0, y: 0, width: width, height: height).fill()
    let fg = dark ? NSColor(white: 0.83, alpha: 1) : NSColor(white: 0.12, alpha: 1)
    let pad = 24 * scale
    var y = 16 * scale
    for (i, line) in lines.enumerated() {
        let font: NSFont
        if i == 0 { font = NSFont.systemFont(ofSize: 15 * scale) }
        else if i == lines.count - 1 { font = NSFont.systemFont(ofSize: 11 * scale) }
        else { font = NSFont(name: "Menlo", size: 13 * scale)! }
        let s = NSAttributedString(string: line, attributes: [.font: font, .foregroundColor: fg])
        let h = font.pointSize * 1.5
        ctx.cgContext.saveGState()
        ctx.cgContext.translateBy(x: pad, y: y + h); ctx.cgContext.scaleBy(x: 1, y: -1)
        s.draw(at: NSPoint(x: 0, y: (h - font.pointSize) / 2))
        ctx.cgContext.restoreGState()
        y += h + (i == 0 ? 12 * scale : 0)
    }
    NSGraphicsContext.restoreGraphicsState()
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(outDir)/\(name).png"))
}

draw(width: 2880, height: 1800, scale: 2, dark: false, name: "retinaLight")
draw(width: 2880, height: 1800, scale: 2, dark: true, name: "retinaDark")
draw(width: 1920, height: 1080, scale: 1, dark: false, name: "plain1x")
print("ok")
