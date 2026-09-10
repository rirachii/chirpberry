import Foundation

public enum BarDock: String, CaseIterable, Sendable {
    case top, left, right, bottom
    public var title: String { rawValue.capitalized }
    public var isVertical: Bool { self == .left || self == .right }

    /// Anchors to the usable screen area so expansion stays inside the display and clear of the Dock/menu bar.
    public func frame(in area: CGRect, expanded: Bool, recording: Bool = false) -> CGRect {
        let proposed = expanded
            ? (isVertical ? CGSize(width: 96, height: recording ? 310 : 240) : CGSize(width: recording ? 286 : 200, height: 60))
            : (isVertical ? CGSize(width: 24, height: 78) : CGSize(width: 70, height: 24))
        let inset: CGFloat = 6
        let width = min(proposed.width, max(0, area.width - inset * 2))
        let height = min(proposed.height, max(0, area.height - inset * 2))
        let origin: CGPoint
        switch self {
        case .top: origin = CGPoint(x: area.midX - width / 2, y: area.maxY - height - inset)
        case .bottom: origin = CGPoint(x: area.midX - width / 2, y: area.minY + inset)
        case .left: origin = CGPoint(x: area.minX + inset, y: area.midY - height / 2)
        case .right: origin = CGPoint(x: area.maxX - width - inset, y: area.midY - height / 2)
        }
        return CGRect(origin: origin, size: CGSize(width: width, height: height))
    }
}
