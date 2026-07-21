# LocalRAG-Chat

本地隐私 AI 聊天助手，基于 RAG（检索增强生成）技术，所有数据存储在本地，不上传任何信息。

## 功能特性

- 🔒 完全本地运行，数据不出本机
- 🤖 支持本地 AI 模型（gte-small 向量检索）
- 🔑 加密金库系统，保护 API Key 安全
- 💬 支持多 AI 厂商接入（OpenAI、Claude 等）

## 技术栈

- 前端：Vue 3 + Vite
- 后端：Rust + Tauri 2
- 数据库：SQLite（本地）
- AI：ONNX Runtime + gte-small 向量模型

## 平台说明

| 平台 | 向量搜索引擎 | 状态 |
|------|------------|------|
| Windows | fts5 + lsh | ✅ 支持 |
| macOS | fts5 + lsh | ✅ 支持 |
| Linux | usearch | ⚠️ 需要替换 |

### Linux 用户

Linux 下请将 `src-tauri/src/engine/vector_index.rs` 替换为 usearch 实现，参考文件见仓库对应路径。

## 使用方法

### 直接下载

前往 [Releases](https://github.com/contorers/localRag-Chat/releases) 下载最新安装包。

### 自行编译

环境要求：
- Node.js 18+
- Rust 1.70+

```bash
git clone https://github.com/contorers/localRag-Chat.git
cd localRag-Chat
npm install
cargo tauri build
```

> ⚠️ 编译前需自行准备 gte-small 模型文件，放置于 `src-tauri/models/gte-small/` 目录下。

## 注意事项

- 首次启动需要设置二级密码用于加密金库
- API Key 经过本地加密存储，不会明文保存
- 模型文件较大（约 130MB），不包含在仓库中，需自行下载

## License

MIT
