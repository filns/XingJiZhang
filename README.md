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

##### 1. 注册百度智能云账号

1. 打开 [百度智能云](https://console.bce.baidu.com/)
2. 点击右上角「注册」或「立即注册」，使用手机号或邮箱完成注册
3. 登录后进入 [百度智能云控制台](https://console.bce.baidu.com/)

##### 2. 实名认证（必须）

百度 OCR API 要求账户完成实名认证才能使用：
1. 将鼠标悬停在控制台右上角头像，点击「安全认证」
2. 选择「个人实名认证」，填写姓名 + 身份证号，通过支付宝/微信扫码完成（通常 1-2 分钟）

> **注意**：不完成实名认证，后续创建的应用将无法调用 API。

##### 3. 创建文字识别应用

1. 在控制台顶部搜索栏搜索「文字识别」，进入产品页，点击「立即使用」
2. 在左侧菜单选择「概览」，然后点击「创建应用」
3. 填写应用信息：

| 字段 | 填写内容 |
|------|----------|
| 应用名称 | 自定义，如 `星记账OCR` |
| 应用类型 | 选择「个人开发者」 |
| 接口选择 | 勾选「文字识别」下的全部接口（或至少勾选「通用文字识别」） |
| 应用描述 | 选填，如「个人记账软件的票据识别功能」 |

4. 阅读并同意协议后，点击「立即创建」

##### 4. 获取 API 凭证

创建完成后，返回「应用列表」，点击应用名称进入详情页，记录以下三项信息：

| 凭证名称 | 页面显示 | 格式说明 |
|----------|---------|----------|
| **App ID** | `AppID` | 纯数字，如 `123787984` |
| **API Key** | `API Key` | 字母+数字组合 |
| **Secret Key** | `Secret Key` | 字母+数字组合 |

> ⚠️ **Secret Key 等同于密码，切勿公开分享或提交到 Git 仓库。**

##### 5. 在星记账中配置

1. 打开星记账，点击顶部标签栏右侧齿轮按钮（⚙）
2. 在「百度 OCR API 配置」区域分别填入三项凭证
3. 点击「保存 API 配置」
4. 切换到「OCR 导入」标签页，选择「百度 OCR (云端)」即可开始使用

##### 费用说明

百度文字识别 API 提供每日免费额度，个人记账绰绰有余：

| 接口类型 | 每日免费调用次数 |
|----------|------------------|
| 通用文字识别（标准版） | 500 次/天 |
| 通用文字识别（高精度版） | 50 次/天 |
| 通用文字识别（含位置版） | 500 次/天 |

- 星记账默认使用标准版，勾选「高精度」复选框后调用高精度版
- 超出免费额度后按量计费，详见 [百度 OCR 定价](https://ai.baidu.com/ai-doc/OCR/6k3h7yxuv)

##### 常见问题

**Q: 提示「API 调用失败」？**
- 检查三项凭证是否完整复制，无多余空格
- 确认账户已完成实名认证
- 确认应用已勾选「通用文字识别」接口
- 在控制台→概览检查剩余免费额度

**Q: Secret Key 可以重置吗？**
可以。在应用详情页点击「重置」，生成新的 Secret Key 后在星记账中更新配置。

**Q: 数据安全？**
API 凭证存储在你电脑本地数据库（`%APPDATA%/xingjizhang/accounting.db`），OCR 图片通过 HTTPS 加密传输至百度服务器识别，不会上传至任何第三方服务器。

#### 方式二：本地 EasyOCR（离线识别）

本地 EasyOCR 是**完全离线**的识别方案，无需注册账号、无需联网、无调用次数限制。但首次启动会自动下载识别模型（约 100 MB），识别速度取决于电脑性能。

##### 1. 安装 Python

确保已安装 Python 3.8 或更高版本：
- 打开命令提示符（Win+R，输入 `cmd`）
- 输入 `python --version` 确认版本号
- 如未安装，前往 [python.org](https://www.python.org/downloads/) 下载安装包
- 安装时务必勾选 **「Add Python to PATH」**

##### 2. 安装依赖包

```bash
pip install easyocr pillow numpy
```

> 国内用户可加镜像加速：`pip install easyocr pillow numpy -i https://pypi.tuna.tsinghua.edu.cn/simple`

##### 3. 启动 OCR 本地服务

在项目目录下运行：

```bash
cd XingJiZhang
python ocr_server.py --port 8868
```

首次运行会自动下载 EasyOCR 的中文识别模型（Chinese + English），大小约 100 MB，请耐心等待。下载完成后显示：

```
[OCR Server] Engine ready.
[OCR Server] Listening on http://127.0.0.1:8868
[OCR Server] Press Ctrl+C to stop.
```

##### 4. 在星记账中使用

1. 保持命令行窗口运行（不要关闭）
2. 打开星记账，切换到「OCR 导入」标签页
3. 在识别引擎中选择 **「PaddleOCR (本地)」**
4. 选择图片后点击「开始识别」

##### 高级选项

| 参数 | 说明 |
|------|------|
| `--port 8868` | 自定义端口号（默认 8868） |
| `--gpu` | 启用 GPU 加速（需 CUDA 环境） |

```bash
# GPU 加速模式（识别速度更快）
python ocr_server.py --port 8868 --gpu
```

##### 常见问题

**Q: 首次启动报错或长时间无响应？**
首次运行需要下载模型，视网络情况需要 2-10 分钟。下载进度会显示在命令行中。如网络不畅，可手动下载模型文件放到 `C:\Users\<用户名>\.EasyOCR\model\` 目录。

**Q: 提示无法连接本地服务？**
- 确认命令行窗口仍在运行，未被关闭
- 确认端口 8868 未被其他程序占用
- 尝试重启本地服务：`Ctrl+C` 停止后重新运行 `python ocr_server.py`

**Q: 识别速度慢？**
EasyOCR 纯 CPU 模式下识别一张图片通常需要 3-10 秒。如需加速：
- 使用 CUDA GPU + `--gpu` 参数（需显卡支持）
- 将图片裁剪到只包含票据区域，减小识别范围
- 优先使用百度云 OCR，标准版每日 500 次免费

**Q: 支持多语言吗？**
当前配置为简体中文 + 英文（`['ch_sim', 'en']`）。如需其他语言，可编辑 `ocr_server.py` 第 117 行修改语言列表。完整语言列表参见 [EasyOCR 文档](https://github.com/JaidedAI/EasyOCR)。

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
