## 📝 核心开发记录 (Dev Log)

*   **本地持久化**: 放弃了传统的 LocalStorage，采用异步的 IndexedDB 处理海量消息存储。
*   **安全加固**: 实现了基于端到端加密思想的本地数据处理逻辑。
*   **模块化重构**: 将核心业务逻辑拆分为独立的 Vue 组件，降低了 AI 辅助编程时的上下文压力。

## 🤝 贡献与反馈

如果你有任何想法或建议，欢迎提交 Issue 或 Pull Request！

## ✨ 项目亮点

*   **⚡ 极致轻量**：基于 Tauri 架构，安装包仅 **~11MB**，运行内存占用比 Electron 方案降低了 **80%**。
*   **🔒 隐私优先**：采用 Local-first 架构，所有聊天记录通过 **IndexedDB** 存储在本地，不上传云端。
*   **🚀 高性能渲染**：针对大模型流式输出（Streaming）优化了渲染逻辑，支持高频更新下的虚拟滚动与样式解析。
*   **🛠️ 跨平台支持**：一套代码同时适配 Windows、macOS（未来支持）。

## 🏗️ 技术架构

项目采用了现代全栈开发思想进行构建：

*   **前端**: Vue 3 (Composition API) + Vite + Tailwind CSS
*   **跨平台外壳**: Tauri (Rust 驱动) & Electron (兼容版)
*   **本地数据库**: IndexedDB (使用原生 API 进行高性能数据持久化)

📝 Project-One-LocalRAG 项目技术白皮书
一、 项目定位与核心作用
Project-One-LocalRAG 是一款专注于个人隐私与极致性能的本地大模型（LLM）检索集成客户端。

在 AI 应用爆发的背景下，本项目解决了以下核心痛点：

数据隐私脱敏：所有聊天数据通过 Local-first 架构存储于用户本地，不经过第三方云端数据库，确保信息安全。

资源占用优化：针对传统桌面应用“内存怪兽”的问题，通过架构演进实现了极低的系统资源占用。

离线持久化：即使在无网络环境下，用户依然可以检索、查看历史对话记录。

二、 核心技术栈选型
本项目采用了现代化的前端技术流派，并结合了底层系统级编程语言进行性能加持：

1. 视图层：Vue 3 + Vite
响应式架构：利用 Vue 3 的 Composition API 实现业务逻辑与 UI 的深度解耦，便于维护复杂的 AI 流式输出状态。

构建优化：基于 Vite 的极速热更新能力，大幅提升了开发迭代效率。

2. 跨平台外壳：Tauri 2.0 (核心演进)
本项目经历了从 Electron 到 Tauri 的技术迁移，这是性能飞跃的关键：

渲染内核：调用系统原生的 WebView2（Windows），不再内置重量级的 Chromium 内核。

后端驱动：使用 Rust 语言处理系统级逻辑，相比 Node.js 具有更强的内存安全性和运行速度。

体积压缩：通过 Rust 编译器的静态优化，将安装包体积从 ~80MB 压缩至 ~5MB。

3. 数据持久化：IndexedDB
高性能存储：放弃了容量受限的 LocalStorage，采用浏览器原生的异步数据库 IndexedDB。

海量存储支持：能够轻松处理数万条聊天消息记录，并支持复杂的索引查询，确保检索体验不卡顿。

4. 安全协议
端侧处理：参考了分布式架构中的安全设计，在本地实现数据封装，防止敏感信息泄露。

tauri exe可执行文件地址：project-one-localRag\src-tauri\target\release app.exe
Electron exe可执行文件地址：project-one-localRag\release\win-unpacked LocalRAG-Chat.exe
