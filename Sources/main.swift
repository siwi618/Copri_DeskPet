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

    // 一道锯齿状的红色电流：头先冲到终点、尾巴随后跟上，路径不停抖动。
    // 用 Core Animation 在一个临时的透明窗口里画，全程由 GPU 合成，几乎不占 CPU
    private func showBolt(from a: NSPoint, to b: NSPoint, done: @escaping () -> Void) {
        let pad: CGFloat = 40
        let rect = NSRect(x: min(a.x, b.x) - pad, y: min(a.y, b.y) - pad,
                          width: abs(a.x - b.x) + pad * 2, height: abs(a.y - b.y) + pad * 2)
        let w = NSWindow(contentRect: rect, styleMask: .borderless, backing: .buffered, defer: false)
        w.isOpaque = false
        w.backgroundColor = .clear
        w.hasShadow = false
        w.level = .floating
        w.ignoresMouseEvents = true
        w.isReleasedWhenClosed = false
        w.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
        let view = NSView(frame: NSRect(origin: .zero, size: rect.size))
        view.wantsLayer = true
        w.contentView = view

        let p0 = CGPoint(x: a.x - rect.minX, y: a.y - rect.minY)
        let p1 = CGPoint(x: b.x - rect.minX, y: b.y - rect.minY)
        // 主电流 + 两股更细的电丝，各自抖动，看起来噼啪作响
        let mainPaths = (0..<4).map { _ in Self.boltPath(from: p0, to: p1, amp: 26) }
        let duration = min(0.55, 0.28 + Double(hypot(p1.x - p0.x, p1.y - p0.y)) / 5000)
        let red = CGColor(red: 0.89, green: 0.19, blue: 0.31, alpha: 1)
        let pink = CGColor(red: 1, green: 0.42, blue: 0.6, alpha: 1)
        let strands: [(CGFloat, CGColor, Float, Bool, [CGPath])] = [
            (18, pink, 0.3, true, mainPaths), (7, red, 1, true, mainPaths), (2.4, .white, 0.95, false, mainPaths),
            (2, pink, 0.9, true, (0..<4).map { _ in Self.boltPath(from: p0, to: p1, amp: 34) }),
            (1.6, red, 0.9, true, (0..<4).map { _ in Self.boltPath(from: p0, to: p1, amp: 40) }),
        ]

        CATransaction.begin()
        CATransaction.setCompletionBlock { [weak self] in
            w.orderOut(nil)
            self?.boltWindow = nil
            done()
        }
        for (width, color, alpha, glow, paths) in strands {
            let l = CAShapeLayer()
            l.frame = view.bounds
            l.path = paths[0]
            l.fillColor = nil
            l.strokeColor = color
            l.lineWidth = width
            l.opacity = alpha
            l.lineJoin = .miter
            l.lineCap = .round
            // 动画结束后的状态：整条已经流走
            l.strokeStart = 1
            l.strokeEnd = 1
            if glow {
                l.shadowColor = red
                l.shadowRadius = 10
                l.shadowOpacity = 1
                l.shadowOffset = .zero
            }
            view.layer?.addSublayer(l)
            let head = CAKeyframeAnimation(keyPath: "strokeEnd")
            head.values = [0, 1, 1]
            head.keyTimes = [0, 0.6, 1]
            head.duration = duration
            let tail = CAKeyframeAnimation(keyPath: "strokeStart")
            tail.values = [0, 0, 1]
            tail.keyTimes = [0, 0.45, 1]
            tail.duration = duration
            let jitter = CAKeyframeAnimation(keyPath: "path")
            jitter.values = paths
            jitter.calculationMode = .discrete
            jitter.duration = 0.16
            jitter.repeatCount = .infinity
            let group = CAAnimationGroup()
            group.animations = [head, tail, jitter]
            group.duration = duration
            l.add(group, forKey: "bolt")
        }
        CATransaction.commit()
        w.orderFrontRegardless()
        boltWindow = w
    }

    private static func boltPath(from a: CGPoint, to b: CGPoint, amp maxAmp: CGFloat) -> CGPath {
        let path = CGMutablePath()
        let dx = b.x - a.x, dy = b.y - a.y
        let len = max(1, hypot(dx, dy))
        let nx = -dy / len, ny = dx / len
        let n = max(5, Int(len / 22))
        let amp = min(maxAmp, len * 0.07)
        path.move(to: a)
        for i in 1..<n {
            let t = CGFloat(i) / CGFloat(n)
            let off = CGFloat.random(in: -amp...amp)
            path.addLine(to: CGPoint(x: a.x + dx * t + nx * off, y: a.y + dy * t + ny * off))
        }
        path.addLine(to: b)
        return path
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
