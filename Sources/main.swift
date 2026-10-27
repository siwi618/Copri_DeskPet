// Copri 桌宠的 macOS 外壳：透明置顶窗口 + WKWebView 渲染 web/ 里的角色。
// 负责窗口移动（拖拽、游荡、跟随鼠标）、点击穿透、睡眠计时和菜单；
// 角色的画面和表情全部在 web/pet.js 里。
import AppKit
import ServiceManagement
import WebKit

enum Mode: String {
    case wander, follow, stay
}

final class PetWebView: WKWebView {
    // 窗口不是 key window 时，第一下点击也要交给网页
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

final class PetController: NSObject, WKScriptMessageHandler, NSMenuDelegate {
    private let baseSize = NSSize(width: 260, height: 620)
    private let defaults = UserDefaults.standard

    private var panel: NSPanel!
    private var webView: PetWebView!
    private var statusItem: NSStatusItem!
    private var timer: Timer?

    private var scale: CGFloat {
        didSet { defaults.set(Double(scale), forKey: "scale") }
    }
    private var mode: Mode {
        didSet { defaults.set(mode.rawValue, forKey: "mode"); target = nil }
    }

    private var ready = false
    private var tickPending = false
    private var dragging = false
    private var dragOffset = NSPoint.zero
    private var target: NSPoint?
    private var nextWander = Date().addingTimeInterval(8)
    private var nextChatter = Date().addingTimeInterval(.random(in: 120...300))
    private var lastInteraction = Date()
    private var lastMouse = NSPoint.zero
    private var lastMouseMove = Date()
    private var asleep = false
    private var facing = ""
    // 走路：起步时间和当前速度（先蹲一下蓄力再加速，快到时减速）
    private var walkStart: Date?
    private var walkSpeed: CGFloat = 0
    // 长距离化成电流：超过 zapDistance（屏幕点）就不走了，变成一道红色电流过去
    private let zapDistance: CGFloat = 360
    private var zapping = false
    private var boltWindow: NSWindow?

    override init() {
        let s = defaults.double(forKey: "scale")
        scale = s > 0 ? CGFloat(s) : 0.6
        mode = Mode(rawValue: defaults.string(forKey: "mode") ?? "") ?? .wander
        super.init()
    }

    // MARK: - 启动

    func start() {
        let size = NSSize(width: baseSize.width * scale, height: baseSize.height * scale)
        panel = NSPanel(contentRect: NSRect(origin: savedOrigin(for: size), size: size),
                        styleMask: [.borderless, .nonactivatingPanel],
                        backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
        panel.isMovable = false
        panel.ignoresMouseEvents = true

        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "copri")
        webView = PetWebView(frame: NSRect(origin: .zero, size: size), configuration: config)
        webView.setValue(false, forKey: "drawsBackground")
        webView.autoresizingMask = [.width, .height]
        webView.pageZoom = scale
        panel.contentView = webView

        guard let web = Bundle.main.url(forResource: "web", withExtension: nil) else {
            fatalError("找不到 web 资源目录，请用 scripts/build.sh 打包后运行")
        }
        webView.loadFileURL(web.appendingPathComponent("pet.html"), allowingReadAccessTo: web)
        panel.orderFrontRegardless()

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.image = NSImage(systemSymbolName: "sparkles", accessibilityDescription: "Copri")
        let menu = NSMenu()
        menu.delegate = self
        statusItem.menu = menu

        timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30, repeats: true) { [weak self] _ in self?.tick() }
        RunLoop.main.add(timer!, forMode: .common)
    }

    private func savedOrigin(for size: NSSize) -> NSPoint {
        if defaults.object(forKey: "x") != nil {
            let p = NSPoint(x: defaults.double(forKey: "x"), y: defaults.double(forKey: "y"))
            if NSScreen.screens.contains(where: { $0.visibleFrame.contains(NSPoint(x: p.x + size.width / 2, y: p.y + size.height / 2)) }) {
                return p
            }
        }
        let vf = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1280, height: 800)
        return NSPoint(x: vf.maxX - size.width - 40, y: vf.minY + 20)
    }

    private func saveOrigin() {
        defaults.set(Double(panel.frame.origin.x), forKey: "x")
        defaults.set(Double(panel.frame.origin.y), forKey: "y")
    }

    private func js(_ code: String) {
        guard ready else { return }
        webView.evaluateJavaScript(code, completionHandler: nil)
    }

    // MARK: - 每帧逻辑

    private func tick() {
        guard ready else { return }
        let now = Date()
        let mouse = NSEvent.mouseLocation
        if hypot(mouse.x - lastMouse.x, mouse.y - lastMouse.y) > 1 {
            lastMouse = mouse
            lastMouseMove = now
        }

        if dragging {
            if NSEvent.pressedMouseButtons & 1 == 0 {
                dragging = false
                lastInteraction = now
                saveOrigin()
                js("copri.dropped()")
            } else {
                panel.setFrameOrigin(NSPoint(x: mouse.x - dragOffset.x, y: mouse.y - dragOffset.y))
            }
        } else if !asleep {
            updateMovement(now: now, mouse: mouse)
            if now > nextChatter {
                nextChatter = now.addingTimeInterval(.random(in: 180...420))
                js("copri.talk()")
            }
            // 长时间没人理就睡觉
            if now.timeIntervalSince(lastInteraction) > 180 && now.timeIntervalSince(lastMouseMove) > 60 {
                goToSleep()
            }
        }

        // 把鼠标位置换算到网页坐标：用于眼睛跟随，并判断鼠标下面是不是角色本体
        guard !tickPending else { return }
        tickPending = true
        let f = panel.frame
        let px = (mouse.x - f.minX) / scale
        let py = (f.maxY - mouse.y) / scale
        webView.evaluateJavaScript("copri.tick(\(px), \(py))") { [weak self] result, _ in
            guard let self else { return }
            self.tickPending = false
            let hit = (result as? Bool) ?? false
            let inside = self.panel.frame.contains(NSEvent.mouseLocation)
            self.panel.ignoresMouseEvents = !(self.dragging || (inside && hit))
        }
    }

    private func updateMovement(now: Date, mouse: NSPoint) {
        guard !zapping else { return }
        let f = panel.frame
        let maxSpeed: CGFloat
        switch mode {
        case .stay:
            target = nil
            maxSpeed = 0
        case .follow:
            // 飘在鼠标右下方，不挡住光标
            target = NSPoint(x: mouse.x + 24, y: mouse.y - f.height * 0.85)
            maxSpeed = 150
        case .wander:
            if target == nil && now > nextWander { target = wanderTarget(from: f) }
            maxSpeed = 75
        }

        guard let t = target else { stopWalking(); return }
        let dx = t.x - f.minX, dy = t.y - f.minY
        let dist = hypot(dx, dy)
        // 跟随模式留一点余量：离得近就站着，拉开一段再起步，免得原地抽动
        if dist <= 2 || (mode == .follow && dist < (walkStart == nil ? 70 : 40)) {
            arrived(at: t)
            return
        }
        if dist > zapDistance {
            zap(to: t)
            return
        }
        if walkStart == nil {
            walkStart = now
            walkSpeed = 0
        }
        // 朝向看左右；几乎竖直走的时候保持原来的朝向
        setFacing(abs(dx) < 6 ? (facing.isEmpty ? "move-right" : facing) : (dx < 0 ? "move-left" : "move-right"))
        // 前 0.2 秒是蓄力（和 CSS 的 prep 一样长），不动
        guard now.timeIntervalSince(walkStart!) > 0.2 else { return }
        let accel = maxSpeed / 0.4
        walkSpeed = min(maxSpeed, walkSpeed + accel / 30)
        let v = max(12, min(walkSpeed, sqrt(2 * accel * dist)))
        let step = min(dist, v / 30)
        panel.setFrameOrigin(NSPoint(x: f.minX + dx / dist * step, y: f.minY + dy / dist * step))
    }

    private func arrived(at t: NSPoint) {
        if mode == .wander {
            panel.setFrameOrigin(t)
            target = nil
            nextWander = Date().addingTimeInterval(.random(in: 8...25))
            saveOrigin()
        }
        stopWalking()
    }

    private func stopWalking() {
        walkStart = nil
        walkSpeed = 0
        setFacing("")
    }

    // 游荡目的地：多数是附近走得到的地方，偶尔去屏幕另一头（化成电流过去）
    private func wanderTarget(from f: NSRect) -> NSPoint {
        let vf = (panel.screen ?? NSScreen.main)?.visibleFrame ?? f
        let maxX = max(vf.minX, vf.maxX - f.width), maxY = max(vf.minY, vf.maxY - f.height)
        if Double.random(in: 0..<1) < 0.65 {
            let a = CGFloat.random(in: 0..<(2 * .pi)), r = CGFloat.random(in: 120...300)
            return NSPoint(x: min(max(f.minX + cos(a) * r, vf.minX), maxX),
                           y: min(max(f.minY + sin(a) * r * 0.5, vf.minY), maxY))
        }
        return NSPoint(x: .random(in: vf.minX...maxX), y: .random(in: vf.minY...maxY))
    }

    // MARK: - 化成电流

    private func zap(to t: NSPoint) {
        zapping = true
        walkStart = nil
        walkSpeed = 0
        facing = ""
        js("copri.zapOut()")
        let from = panel.frame
        // 等身体被拉成细线消失，再放出闪电
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
            guard let self else { return }
            if self.dragging { self.zapping = false; return }
            self.panel.alphaValue = 0
            let to = NSRect(origin: t, size: from.size)
            self.showBolt(from: self.bodyCenter(from), to: self.bodyCenter(to)) {
                if !self.dragging { self.panel.setFrameOrigin(t) }
                self.panel.alphaValue = 1
                self.js("copri.zapIn()")
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.48) {
                    self.zapping = false
                    if self.mode == .wander {
                        self.target = nil
                        self.nextWander = Date().addingTimeInterval(.random(in: 8...25))
                    }
                    self.saveOrigin()
                }
            }
        }
    }

    // 网页坐标里身体中心约在 (131, 360)
    private func bodyCenter(_ f: NSRect) -> NSPoint {
        NSPoint(x: f.minX + 131 * scale, y: f.maxY - 360 * scale)
    }

    // 一道动漫画风的电流：和 Copri 身体同一个画法——锯齿折线撑成有粗细的多边形（两头尖、中间粗，
    // 拐角处戳出带折角的尖刺），填她身上的粉红，左下错开一层紫色描边，里面撒白色闪粉，不发光。
    // 先从起点往终点「长」出来，停一拍再从起点收掉；形状每 0.08 秒换一帧，像动画里一拍三的闪烁。
    // 用 Core Animation 在一个临时的透明窗口里画，全程由 GPU 合成，几乎不占 CPU
    private func showBolt(from a: NSPoint, to b: NSPoint, done: @escaping () -> Void) {
        let s = scale
        let pad = 90 * s + 24
        let rect = NSRect(x: min(a.x, b.x) - pad, y: min(a.y, b.y) - pad,
                          width: abs(a.x - b.x) + pad * 2, height: abs(a.y - b.y) + pad * 2)
        let w = NSWindow(contentRect: rect, styleMask: .borderless, backing: .buffered, defer: false)
        w.isOpaque = false
        w.backgroundColor = .clear
        w.hasShadow = false
        w.level = .floating
        w.ignoresMouseEvents = true
        w.isReleasedWhenClosed = false
        w.animationBehavior = .none
        w.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
        let view = NSView(frame: NSRect(origin: .zero, size: rect.size))
        view.wantsLayer = true
        w.contentView = view

        let p0 = CGPoint(x: a.x - rect.minX, y: a.y - rect.minY)
        let p1 = CGPoint(x: b.x - rect.minX, y: b.y - rect.minY)
        let frames = (0..<3).map { _ in Self.boltShape(from: p0, to: p1, s: s) }
        let duration = min(0.55, 0.32 + Double(hypot(p1.x - p0.x, p1.y - p0.y)) / 6000)
        let pink = CGColor(red: 0.894, green: 0.188, blue: 0.314, alpha: 1)   // --hair #e43050
        let purple = CGColor(red: 0.545, green: 0.310, blue: 0.941, alpha: 1) // --hair-ol #8b4ff0

        let bolt = CALayer()
        bolt.frame = view.bounds
        view.layer?.addSublayer(bolt)
        // 紫描边：和身体一样往左下错开 2.5 个网页单位
        let layers: [(CGColor, CGPoint, KeyPath<(body: CGPath, specks: CGPath), CGPath>)] = [
            (purple, CGPoint(x: -2.5 * s, y: -2.5 * s), \.body),
            (pink, .zero, \.body),
            (CGColor(red: 1, green: 1, blue: 1, alpha: 0.85), .zero, \.specks),
        ]
        for (color, offset, part) in layers {
            let l = CAShapeLayer()
            l.frame = view.bounds.offsetBy(dx: offset.x, dy: offset.y)
            l.path = frames[0][keyPath: part]
            l.fillColor = color
            l.strokeColor = nil
            let flicker = CAKeyframeAnimation(keyPath: "path")
            flicker.values = frames.map { $0[keyPath: part] }
            flicker.calculationMode = .discrete
            flicker.duration = 0.24
            flicker.repeatCount = .infinity
            l.add(flicker, forKey: "flicker")
            bolt.addSublayer(l)
        }
        // 遮罩沿起点→终点的直线推进：头先冲到终点，停一拍，尾巴再从起点收掉
        let mask = CAShapeLayer()
        mask.frame = view.bounds
        let line = CGMutablePath()
        line.move(to: p0)
        line.addLine(to: p1)
        mask.path = line
        mask.strokeColor = .black
        mask.fillColor = nil
        mask.lineWidth = pad * 2
        mask.lineCap = .square
        mask.strokeStart = 1
        mask.strokeEnd = 1
        bolt.mask = mask

        CATransaction.begin()
        CATransaction.setCompletionBlock { [weak self] in
            w.orderOut(nil)
            self?.boltWindow = nil
            done()
        }
        let head = CAKeyframeAnimation(keyPath: "strokeEnd")
        head.values = [0, 1, 1]
        head.keyTimes = [0, 0.45, 1]
        head.duration = duration
        let tail = CAKeyframeAnimation(keyPath: "strokeStart")
        tail.values = [0, 0, 1]
        tail.keyTimes = [0, 0.6, 1]
        tail.duration = duration
        let group = CAAnimationGroup()
        group.animations = [head, tail]
        group.duration = duration
        mask.add(group, forKey: "strike")
        CATransaction.commit()
        w.orderFrontRegardless()
        boltWindow = w
    }

    /// 生成一帧电流：body 是粉红多边形（主干 + 尖刺），specks 是里面的白色闪粉
    private static func boltShape(from a: CGPoint, to b: CGPoint, s: CGFloat) -> (body: CGPath, specks: CGPath) {
        let dx = b.x - a.x, dy = b.y - a.y
        let len = max(1, hypot(dx, dy))
        let ux = dx / len, uy = dy / len, nx = -uy, ny = ux
        // 主干：长短不一的折线，大体左右交替但不死板，折角尖
        var ts: [CGFloat] = [0]
        while ts.last! < 1 { ts.append(ts.last! + (48 * s + 14) / len * .random(in: 0.5...1.6)) }
        ts[ts.count - 1] = 1
        let amp = min(34 * s + 8, len * 0.14)
        var spine = [a]
        var side: CGFloat = Bool.random() ? 1 : -1
        for t in ts.dropFirst().dropLast() {
            side = Double.random(in: 0..<1) < 0.8 ? -side : side
            let off = side * amp * .random(in: 0.3...1)
            spine.append(CGPoint(x: a.x + dx * t + nx * off, y: a.y + dy * t + ny * off))
        }
        spine.append(b)

        // 粗细：两头收成尖，中间粗；两侧各自随机，边缘不平行，像一块块碎片拼起来
        let wMax = 30 * s + 5
        var left = [CGPoint](), right = [CGPoint](), widths = [CGFloat]()
        for (i, p) in spine.enumerated() {
            let t = CGFloat(i) / CGFloat(spine.count - 1)
            let end = i == 0 || i == spine.count - 1
            let base = wMax * (0.35 + 0.65 * sin(.pi * t))
            let wl = end ? 0 : base * .random(in: 0.12...0.8), wr = end ? 0 : base * .random(in: 0.12...0.8)
            let prev = spine[max(0, i - 1)], next = spine[min(spine.count - 1, i + 1)]
            let tl = max(0.001, hypot(next.x - prev.x, next.y - prev.y))
            let px = -(next.y - prev.y) / tl, py = (next.x - prev.x) / tl
            left.append(CGPoint(x: p.x + px * wl, y: p.y + py * wl))
            right.append(CGPoint(x: p.x - px * wr, y: p.y - py * wr))
            widths.append(wl + wr)
        }
        let body = CGMutablePath()
        addPolygon(body, left + right.reversed())

        // 分叉：一部分折角处朝外戳出一根微微折一下的长尖刺
        func spike(from p: CGPoint, dir: (CGFloat, CGFloat), length L: CGFloat, half: CGFloat, depth: Int) {
            let (bx, by) = dir
            let kink = CGFloat.random(in: -0.35...0.35)
            let mid = CGPoint(x: p.x + bx * L * 0.5 - by * kink * L * 0.3, y: p.y + by * L * 0.5 + bx * kink * L * 0.3)
            let tip = CGPoint(x: mid.x + (bx * 0.8 + by * kink * 0.5) * L * 0.5, y: mid.y + (by * 0.8 - bx * kink * 0.5) * L * 0.5)
            addPolygon(body, [CGPoint(x: p.x - by * half, y: p.y + bx * half),
                              CGPoint(x: mid.x - by * half * 0.55, y: mid.y + bx * half * 0.55),
                              tip,
                              CGPoint(x: mid.x + by * half * 0.55, y: mid.y - bx * half * 0.55),
                              CGPoint(x: p.x + by * half, y: p.y - bx * half)])
            if depth > 0 && L > 30 * s + 10 {
                let turn = CGFloat.random(in: 0.5...0.9) * (Bool.random() ? 1 : -1)
                let cx = bx * cos(turn) - by * sin(turn), cy = bx * sin(turn) + by * cos(turn)
                spike(from: mid, dir: (cx, cy), length: L * 0.45, half: half * 0.5, depth: depth - 1)
            }
        }
        for i in 1..<(spine.count - 1) where Double.random(in: 0..<1) < 0.4 {
            let p = spine[i]
            let side: CGFloat = ((p.x - a.x) * nx + (p.y - a.y) * ny) >= 0 ? 1 : -1
            let fwd = CGFloat.random(in: -0.2...1.1)
            var bx = nx * side + ux * fwd, by = ny * side + uy * fwd
            let bl = hypot(bx, by)
            bx /= bl; by /= bl
            spike(from: p, dir: (bx, by), length: CGFloat.random(in: 24...56) * s + 8,
                  half: max(1.5, widths[i] * 0.3), depth: 0)
        }

        // 白色闪粉：沿主干撒在粉红里面
        let specks = CGMutablePath()
        for _ in 0..<Int(len / 7) {
            let i = Int.random(in: 1..<(spine.count - 1))
            let j = Bool.random() ? i - 1 : i + 1
            let t = CGFloat.random(in: 0...1)
            let q = CGPoint(x: spine[i].x + (spine[j].x - spine[i].x) * t, y: spine[i].y + (spine[j].y - spine[i].y) * t)
            let lim = min(widths[i], widths[j]) * 0.2
            let o = CGFloat.random(in: -lim...max(-lim, lim))
            let r = CGFloat.random(in: 0.5...1.4) * max(1, s * 1.6)
            let c = CGPoint(x: q.x + nx * o, y: q.y + ny * o)
            addPolygon(specks, [CGPoint(x: c.x, y: c.y + r), CGPoint(x: c.x + r * 0.8, y: c.y),
                                CGPoint(x: c.x, y: c.y - r * 0.9), CGPoint(x: c.x - r * 0.7, y: c.y)])
        }
        return (body, specks)
    }

    /// 多边形统一成同一个绕向再加进路径，免得重叠处按非零规则被挖空
    private static func addPolygon(_ path: CGMutablePath, _ pts: [CGPoint]) {
        var area: CGFloat = 0
        for k in pts.indices {
            let p = pts[k], q = pts[(k + 1) % pts.count]
            area += p.x * q.y - q.x * p.y
        }
        path.addLines(between: area < 0 ? pts.reversed() : pts)
        path.closeSubpath()
    }

    private func setFacing(_ s: String) {
        guard s != facing else { return }
        facing = s
        js("copri.setState('\(s.isEmpty ? "idle" : s)')")
    }

    private func goToSleep() {
        asleep = true
        target = nil
        facing = ""
        js("copri.sleep()")
    }

    private func wakeUp() {
        asleep = false
        lastInteraction = Date()
        nextWander = Date().addingTimeInterval(5)
        js("copri.wake()")
    }

    // MARK: - 来自网页的消息

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        lastInteraction = Date()
        switch type {
        case "ready":
            ready = true
        case "press":
            target = nil
        case "dragStart":
            dragging = true
            target = nil
            facing = ""
            walkStart = nil
            walkSpeed = 0
            let m = NSEvent.mouseLocation
            dragOffset = NSPoint(x: m.x - panel.frame.minX, y: m.y - panel.frame.minY)
        case "interact":
            if asleep { asleep = false; nextWander = Date().addingTimeInterval(5) }
        case "menu":
            let menu = NSMenu()
            buildMenu(menu)
            menu.popUp(positioning: nil, at: NSEvent.mouseLocation, in: nil)
        default:
            break
        }
    }

    // MARK: - 菜单

    func menuNeedsUpdate(_ menu: NSMenu) {
        buildMenu(menu)
    }

    private func buildMenu(_ menu: NSMenu) {
        menu.removeAllItems()
        menu.addItem(item("说句话", #selector(talk)))
        menu.addItem(item("转个圈", #selector(spin)))
        menu.addItem(item(asleep ? "叫醒它" : "让它睡觉", #selector(toggleSleep)))
        menu.addItem(.separator())
        for (title, m) in [("自由游荡", Mode.wander), ("跟着鼠标", Mode.follow), ("待在原地", Mode.stay)] {
            let i = item(title, #selector(setMode(_:)))
            i.representedObject = m.rawValue
            i.state = mode == m ? .on : .off
            menu.addItem(i)
        }
        menu.addItem(.separator())
        let sizeItem = NSMenuItem(title: "大小", action: nil, keyEquivalent: "")
        let sizeMenu = NSMenu()
        for (title, s) in [("小", 0.45), ("中", 0.6), ("大", 0.8)] {
            let i = item(title, #selector(setScale(_:)))
            i.representedObject = s
            i.state = abs(Double(scale) - s) < 0.01 ? .on : .off
            sizeMenu.addItem(i)
        }
        sizeItem.submenu = sizeMenu
        menu.addItem(sizeItem)
        let login = item("开机自动启动", #selector(toggleLogin))
        login.state = SMAppService.mainApp.status == .enabled ? .on : .off
        menu.addItem(login)
        menu.addItem(.separator())
        menu.addItem(item("退出 Copri", #selector(quit)))
    }

    private func item(_ title: String, _ action: Selector) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: action, keyEquivalent: "")
        i.target = self
        return i
    }

    @objc private func talk() {
        if asleep { wakeUp() }
        lastInteraction = Date()
        js("copri.talk()")
    }

    @objc private func spin() {
        if asleep { wakeUp() }
        lastInteraction = Date()
        js("copri.flash('spin', 800)")
    }

    @objc private func toggleSleep() {
        asleep ? wakeUp() : goToSleep()
    }

    @objc private func setMode(_ sender: NSMenuItem) {
        guard let raw = sender.representedObject as? String, let m = Mode(rawValue: raw) else { return }
        mode = m
        lastInteraction = Date()
        if asleep { wakeUp() }
    }

    @objc private func setScale(_ sender: NSMenuItem) {
        guard let s = sender.representedObject as? Double else { return }
        let f = panel.frame
        scale = CGFloat(s)
        let size = NSSize(width: baseSize.width * scale, height: baseSize.height * scale)
        // 以脚底中心为锚点缩放
        panel.setFrame(NSRect(x: f.midX - size.width / 2, y: f.minY, width: size.width, height: size.height), display: true)
        webView.pageZoom = scale
        saveOrigin()
    }

    @objc private func toggleLogin() {
        let service = SMAppService.mainApp
        do {
            if service.status == .enabled {
                try service.unregister()
            } else {
                try service.register()
            }
        } catch {
            let alert = NSAlert()
            alert.messageText = "设置开机启动失败"
            alert.informativeText = "请先把 Copri.app 拖进「应用程序」文件夹再试。\n\(error.localizedDescription)"
            alert.runModal()
        }
    }

    @objc private func quit() {
        saveOrigin()
        NSApp.terminate(nil)
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let controller = PetController()
controller.start()
app.run()
