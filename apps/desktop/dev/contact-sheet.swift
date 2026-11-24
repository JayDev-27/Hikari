// Tile images into one labelled contact sheet over a checkerboard (shows transparency),
// each cell outlined so clipping at the frame edge is obvious.
//   swift dev/contact-sheet.swift out.png [--cols N] [--cell WxH] image1.png image2.png …
// Labels come from file names (without extension).
import AppKit

var args = Array(CommandLine.arguments.dropFirst())
guard args.count >= 2 else { print("usage: contact-sheet.swift out.png [--cols N] [--cell WxH] images…"); exit(1) }
let out = args.removeFirst()
var cols = 0, cw = 280, ch = 427
while let f = args.first, f.hasPrefix("--") {
  args.removeFirst()
  if f == "--cols" { cols = Int(args.removeFirst())! }
  if f == "--cell" { let p = args.removeFirst().split(separator: "x").map { Int($0)! }; cw = p[0]; ch = p[1] }
}
let files = args
if cols == 0 { cols = files.count }
let rows = (files.count + cols - 1) / cols
let pad = 14, lab = 24
let W = cols * (cw + pad) + pad, H = rows * (ch + lab + pad) + pad
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: W, pixelsHigh: H, bitsPerSample: 8, samplesPerPixel: 4,
                           hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
NSGraphicsContext.current?.imageInterpolation = .high
NSColor(white: 0.86, alpha: 1).setFill(); NSRect(x: 0, y: 0, width: W, height: H).fill()
for (i, f) in files.enumerated() {
  let col = i % cols, row = i / cols
  let x = pad + col * (cw + pad), y = H - (row + 1) * (ch + lab + pad)
  for cy in stride(from: 0, to: ch, by: 12) { for cx in stride(from: 0, to: cw, by: 12) {
    ((cx / 12 + cy / 12) % 2 == 0 ? NSColor(white: 0.96, alpha: 1) : NSColor(white: 0.80, alpha: 1)).setFill()
    NSRect(x: x + cx, y: y + cy, width: min(12, cw - cx), height: min(12, ch - cy)).fill()
  } }
  if let img = NSImage(contentsOfFile: f) {
    // aspect-fit inside the cell
    let s = min(CGFloat(cw) / img.size.width, CGFloat(ch) / img.size.height)
    let w = img.size.width * s, h = img.size.height * s
    img.draw(in: NSRect(x: CGFloat(x) + (CGFloat(cw) - w) / 2, y: CGFloat(y) + (CGFloat(ch) - h) / 2, width: w, height: h))
  }
  NSColor.red.withAlphaComponent(0.7).setStroke()
  let p = NSBezierPath(rect: NSRect(x: x, y: y, width: cw, height: ch)); p.lineWidth = 1.5; p.stroke()
  let name = ((f as NSString).lastPathComponent as NSString).deletingPathExtension
  (name as NSString).draw(at: NSPoint(x: x + 2, y: y + ch + 3), withAttributes: [.font: NSFont.boldSystemFont(ofSize: 14)])
}
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
