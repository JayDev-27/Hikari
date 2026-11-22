// Build the macOS menu-bar (tray) template icon from the app logo.
// Template images are black + alpha only; macOS tints them for light/dark menu bars.
// We keep the white sakura flower (low saturation, high brightness) and drop the
// pink tile, then crop to the flower and pad into a square canvas.
//   swift assets/brand/tray.swift assets/brand/hikari-logo-1024.png out.png 44
import AppKit

let a = CommandLine.arguments
guard a.count >= 4, let src = NSBitmapImageRep(data: try! Data(contentsOf: URL(fileURLWithPath: a[1]))), let size = Int(a[3]) else {
  fputs("usage: tray.swift logo.png out.png size\n", stderr); exit(1)
}
let w = src.pixelsWide, h = src.pixelsHigh
var alpha = [Double](repeating: 0, count: w * h)
var minX = w, minY = h, maxX = 0, maxY = 0
for y in 0..<h {
  for x in 0..<w {
    guard let c = src.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) else { continue }
    let r = Double(c.redComponent), g = Double(c.greenComponent), b = Double(c.blueComponent)
    let mx = max(r, g, b), mn = min(r, g, b)
    let sat = mx > 0 ? (mx - mn) / mx : 0
    // White petals: bright and nearly unsaturated. Smooth ramp keeps anti-aliased edges.
    let bright = (mn - 0.72) / 0.18
    let unsat = (0.30 - sat) / 0.15
    let v = max(0, min(1, bright)) * max(0, min(1, unsat)) * Double(c.alphaComponent)
    alpha[y * w + x] = v
    if v > 0.5 { minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y) }
  }
}
// Keep only the main flower: the largest connected bright shape (the tile's
// sparkle and dot are separate, smaller shapes). Mask everything else out.
var label = [Int32](repeating: 0, count: w * h)
var bestLabel: Int32 = 0, bestSize = 0, next: Int32 = 0
var stack: [Int] = []
for start in 0..<(w * h) where alpha[start] > 0.5 && label[start] == 0 {
  next += 1
  var count = 0
  stack.append(start); label[start] = next
  while let i = stack.popLast() {
    count += 1
    let x = i % w, y = i / w
    for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
      let nx = x + dx, ny = y + dy
      guard nx >= 0, ny >= 0, nx < w, ny < h else { continue }
      let j = ny * w + nx
      if alpha[j] > 0.5 && label[j] == 0 { label[j] = next; stack.append(j) }
    }
  }
  if count > bestSize { bestSize = count; bestLabel = next }
}
// Grow the kept region by a few px so anti-aliased edges (alpha < 0.5) survive.
var keep = [Bool](repeating: false, count: w * h)
minX = w; minY = h; maxX = 0; maxY = 0
for y in 0..<h { for x in 0..<w where label[y * w + x] == bestLabel {
  minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y)
  for dy in -3...3 { for dx in -3...3 {
    let nx = x + dx, ny = y + dy
    if nx >= 0, ny >= 0, nx < w, ny < h { keep[ny * w + nx] = true }
  } }
} }
for i in 0..<(w * h) where !keep[i] { alpha[i] = 0 }
let cx0 = 0, cx1 = w, cy0 = 0, cy1 = h
let bw = maxX - minX + 1, bh = maxY - minY + 1, side = max(bw, bh)
let pad = Double(side) * 0.04
let out = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4,
                           hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
let scale = (Double(side) + 2 * pad) / Double(size)
let ox = Double(minX) - (Double(side) - Double(bw)) / 2 - pad
let oy = Double(minY) - (Double(side) - Double(bh)) / 2 - pad
for y in 0..<size {
  for x in 0..<size {
    // Box-filter downsample: average alpha over the source area this pixel covers.
    let sx0 = ox + Double(x) * scale, sy0 = oy + Double(y) * scale
    var sum = 0.0, n = 0.0
    var yy = sy0
    while yy < sy0 + scale {
      var xx = sx0
      while xx < sx0 + scale {
        let ix = Int(xx), iy = Int(yy)
        if ix >= cx0 && ix < cx1 && iy >= cy0 && iy < cy1 { sum += alpha[iy * w + ix] }
        n += 1; xx += 1
      }
      yy += 1
    }
    let av = n > 0 ? sum / n : 0
    out.setColor(NSColor(deviceRed: 0, green: 0, blue: 0, alpha: CGFloat(av)), atX: x, y: y)
  }
}
try! out.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: a[2]))
print("flower bbox \(minX),\(minY) \(bw)x\(bh) → \(size)px")
