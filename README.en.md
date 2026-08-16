<div align="center">

# dsh-page-preview

**Show pages directly in the DeepSeek Harness Web GUI**

[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e.svg)](LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-web%20bundle-4f46e5.svg)](https://github.com/watericetangcw/dsh-page-preview)

**[简体中文](README.md) · English**

<img src="docs/hello-world.png" alt="Screenshot of the inline preview and floating preview window in action" />

</div>

Install once, use forever: turn HTML code blocks the model writes into **inline interactive previews**, and live-preview any local page or URL in a **floating window** at the bottom-right.

## ✨ Features

### 🖥️ Inline preview

Ask DSH to emit an `html page-preview` code block, and once the answer lands it becomes an **interactive preview pane** right below the message — fullscreen, collapse, open in a new tab — while the code block itself stays a normal code block.

### 🪟 Floating preview

Four tools, always ready:

| Tool | What it does |
| --- | --- |
| `preview_register` | Register and open a preview: a local HTML file, a directory containing `index.html`, or an http(s) URL |
| `preview_replace` | Switch the preview to another page |
| `preview_refresh` | Refresh after you edit the files |
| `preview_unregister` | Remove the registration and close the window |

The window is movable, resizable, and fullscreen-able; content scales to a virtual desktop width, so small windows never squash your page. Closing it morphs it into a top-right capsule with a breathing green light — click to bring it back. Previews are session-scoped, so switching sessions never mixes them up.

## 🚀 Quick install

One command:

```powershell
dsh plugin --profile web add github:watericetangcw/dsh-page-preview
```

Then restart `dsh web` and refresh the browser page once.

## 🧪 Try it now

Copy a prompt, send it to DSH, and watch it work:

**① Inline preview — generate and show a page**

```
Please write a complete static HTML page (all CSS and JS inlined), show it in an `html page-preview` code block, and make it a live clock card.
```

**② Floating preview — preview an online page**

```
Please preview this page with preview_register: https://watericetangcw.github.io/dsh-page-preview/hello-world
```

**③ Floating preview — preview a local project and refresh**

```
Please preview the docs/demo-site directory with preview_register, change the page title to "dsh-page-preview demo", then call preview_refresh so I can see the update.
```

## 📖 Usage

- **Inline preview**: have DSH output ` ```html page-preview ... ``` ` (CSS and JS must be fully inlined).
- **Floating preview**: call `preview_register` with a path or URL; the other three tools replace, refresh, and close it.

## 🔗 Links

- Repository: [github.com/watericetangcw/dsh-page-preview](https://github.com/watericetangcw/dsh-page-preview)
- Live demos: [Hello World](https://watericetangcw.github.io/dsh-page-preview/hello-world) · [demo-site](https://watericetangcw.github.io/dsh-page-preview/demo-site/)

## 📄 License

[MIT](LICENSE) © 2026 WateRice
