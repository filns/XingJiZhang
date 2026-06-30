# 星记账 (XingJiZhang)

轻量级个人记账桌面应用，基于 Electron + SQLite 构建。支持手动记账、CSV/XLSX 导入、微信账单解析、百度 OCR 小票识别，以及图表统计分析。

## 功能

- **记账** — 支出/收入双类型，自定义分类（图标+名称），多账户管理
- **流水** — 交易列表，按月/类型/分类/账户筛选，关键词搜索，批量编辑/删除
- **图表** — 月度收支概览、每日消费趋势、分类占比饼图
- **OCR 导入** — 拍照或截图识别小票/账单，支持百度云 OCR（高精度）和本地 EasyOCR
- **文件导入** — CSV / XLSX 批量导入，自动匹配分类和账户；**微信支付账单 XLSX 一键导入**
- **自动分类** — 根据商户名称/备注关键词自动匹配分类（覆盖餐饮、交通、购物等 12+ 类别）
- **导出** — CSV / Excel 导出，可按筛选条件导出
- **自定义背景** — 支持纯色或图片背景
- **浅色毛玻璃 UI** — iOS 风格磨砂玻璃质感

## 技术栈

| 技术 | 用途 |
|------|------|
| Electron 25 | 桌面框架 |
| sql.js (SQLite WASM) | 本地数据库 |
| Chart.js 4 | 图表渲染 |
| SheetJS (xlsx) | Excel 导入/导出 |
| 百度 OCR API | 云端小票识别 |
| EasyOCR (可选) | 本地 OCR 引擎 |

## 快速开始

### 环境要求

- Node.js 18+
- npm

### 安装与运行

```bash
# 克隆仓库
git clone https://github.com/YOUR_USERNAME/XingJiZhang.git
cd XingJiZhang

# 安装依赖
npm install

# 启动应用
npm start

# 构建 Windows 安装包
npm run build
```

### 配置 OCR (可选)

#### 方式一：百度云 OCR

1. 注册 [百度智能云](https://console.bce.baidu.com/ai/) 账号
2. 创建文字识别应用，获取 `App ID`、`API Key`、`Secret Key`
3. 在应用「设置」→「API 设置」中填入上述凭证

#### 方式二：本地 EasyOCR

```bash
pip install easyocr pillow numpy
python ocr_server.py --port 8868
```

启动后在 OCR 页面选择「EasyOCR 本地」引擎即可离线识别。

## 项目结构

```
├── main.js          # Electron 主进程（窗口、菜单、IPC）
├── preload.js       # 预加载脚本（安全暴露 API）
├── app.js           # 渲染进程（UI 逻辑）
├── database.js      # SQLite 数据库操作
├── ocr.js           # OCR 模块（百度云 + 本地 EasyOCR）
├── import.js        # 文件导入解析（CSV/XLSX/微信账单）
├── export.js        # 文件导出（CSV/Excel）
├── index.html       # 主页面
├── style.css        # 样式表（CSS 变量 + 毛玻璃主题）
├── ocr_server.py    # EasyOCR 本地 HTTP 服务
├── assets/          # 图标、字体资源
└── package.json
```

## 数据存储

所有记账数据存储在 SQLite 数据库中：

- Windows: `%APPDATA%/xingjizhang/accounting.db`
- 数据库文件可备份、迁移

## 构建

```bash
npm run build
```

构建产物在 `dist/` 目录，生成 NSIS 安装程序 (Windows)。

## License

MIT

## 免责声明

本应用使用的百度 OCR API 为第三方服务，请自行遵守其服务条款。应用的 API 凭证通过应用内「设置」页面管理，不会上传至任何服务器。
