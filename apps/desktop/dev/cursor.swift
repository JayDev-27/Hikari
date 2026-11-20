// Cursor helper for hands-on stage tests (moves the real cursor).
//   swift dev/cursor.swift pos                 → print cursor (points, top-left origin)
//   swift dev/cursor.swift move X Y            → warp cursor (no permission needed)
//   swift dev/cursor.swift trusted             → can this process post mouse events? (Accessibility)
//   swift dev/cursor.swift drag X1 Y1 X2 Y2    → press at 1, move in steps, release at 2 (needs Accessibility)
//   swift dev/cursor.swift window              → Hikari stage window bounds (points)
import AppKit
import ApplicationServices
import CoreGraphics

func cursor() -> CGPoint { CGEvent(source: nil)?.location ?? .zero }
func post(_ type: CGEventType, _ p: CGPoint) {
  CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
}

let a = CommandLine.arguments.dropFirst().map { $0 }
switch a.first ?? "" {
case "pos":
  let p = cursor(); print(Int(p.x), Int(p.y))
case "move":
  CGWarpMouseCursorPosition(CGPoint(x: Double(a[1])!, y: Double(a[2])!))
  CGAssociateMouseAndMouseCursorPosition(1)
case "trusted":
  print(AXIsProcessTrusted() ? "yes" : "no")
case "drag":
  let p1 = CGPoint(x: Double(a[1])!, y: Double(a[2])!), p2 = CGPoint(x: Double(a[3])!, y: Double(a[4])!)
  post(.mouseMoved, p1); usleep(150_000)
  post(.leftMouseDown, p1); usleep(120_000)
  for i in 1...20 {
    let t = Double(i) / 20
    post(.leftMouseDragged, CGPoint(x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t)); usleep(15_000)
  }
  post(.leftMouseUp, p2)
case "window":
  let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as! [[String: Any]]
  for w in list where (w[kCGWindowOwnerName as String] as? String) == "desktop" {
    let b = w[kCGWindowBounds as String] as! [String: Double]
    print(Int(b["X"]!), Int(b["Y"]!), Int(b["Width"]!), Int(b["Height"]!))
  }
default:
  print("usage: pos | move X Y | trusted | drag X1 Y1 X2 Y2 | window")
}
