// Render the logo SVG to PNG with AppKit (no extra tools needed).
//   swift assets/brand/render.swift assets/brand/hikari-logo.svg out.png 1024
import AppKit

let args = CommandLine.arguments
guard args.count >= 4, let img = NSImage(contentsOfFile: args[1]), let size = Int(args[3]) else {
  fputs("usage: render.swift in.svg out.png size\n", stderr); exit(1)
}
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8,
                           samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                           bytesPerRow: 0, bitsPerPixel: 0)!
rep.size = NSSize(width: size, height: size)
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
NSGraphicsContext.current?.imageInterpolation = .high
img.draw(in: NSRect(x: 0, y: 0, width: size, height: size))
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[2]))
