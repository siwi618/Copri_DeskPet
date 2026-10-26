# Copri DeskPet · 摩羯桌宠

一只住在 macOS 桌面上的 Copri（摩羯）：闪粉红色炸毛、绿色面罩、蓝色靶心眼，飘在所有窗口上面。

## 它会做什么

| 操作 | 反应 |
| --- | --- |
| 什么都不做 | 漂浮、眨眼、闪粉闪烁，眼睛一直盯着你的鼠标；隔一会儿自己在屏幕上飘来飘去，偶尔冒一句台词 |
| 单击 | 咧嘴笑、蹦一下、说句话 |
| 双击 | 转个圈 |
| 拖拽 | 吃惊大叫、手脚乱蹬，松手后落在新位置 |
| 3 分钟没人理 | 闭眼睡觉（zzz），单击叫醒 |
| 右键 / 菜单栏 ✨ 图标 | 说句话、转圈、睡觉/叫醒、模式（自由游荡 / 跟着鼠标 / 待在原地）、大小、开机启动、退出 |

透明区域点击会穿透到下面的窗口，只有角色本体能被点到。位置、大小、模式会被记住。

## 运行

需要 macOS 13+ 和 Xcode 命令行工具（`xcode-select --install`）。

```bash
scripts/build.sh --run     # 编译、打包成 build/Copri.app 并启动
```

想长期使用：把 `build/Copri.app` 拖进「应用程序」，再在菜单里勾选「开机自动启动」。

## 结构

```
Sources/main.swift   macOS 外壳：透明置顶窗口、点击穿透、拖拽/游荡/跟随、睡眠计时、菜单
web/pet.html         角色矢量画（SVG），按截图里的造型和配色重绘
web/pet.css          配色、动画和各个状态（idle / happy / drag / sleep / move-left|right / spin）
web/pet.js           眨眼、视线跟随、命中测试、台词气泡、与 Swift 的消息桥
web/preview.html     开发用：浏览器里并排预览各状态
scripts/build.sh     编译 + 打包 + ad-hoc 签名
scripts/icon.html    开发用：渲染图标；scripts/make_icon.py 转成 Resources/AppIcon.icns
```

改造型或动作只需要动 `web/` 里的文件：`cd web && python3 -m http.server`，打开 `preview.html` 就能看效果，改完 `scripts/build.sh --run`。

## 配色

| | 色值 |
| --- | --- |
| 头发 | `#e43050` + 白色闪粉 |
| 描边/阴影 | `#8b4ff0` |
| 面罩 | `#6cf084` |
| 身体 | `#06040f` |
| 瞳孔 | `#2a5ad8` |
