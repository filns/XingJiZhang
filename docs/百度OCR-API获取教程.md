# 百度 OCR API 获取教程

本教程手把手教你获取百度文字识别 API 的三项凭证：**App ID**、**API Key**、**Secret Key**。

---

## 第一步：注册百度智能云账号

1. 打开 [百度智能云](https://console.bce.baidu.com/)
2. 点击右上角「注册」或「立即注册」
3. 使用手机号或邮箱完成注册（已有百度账号可直接登录）
4. 登录后进入 [百度智能云控制台](https://console.bce.baidu.com/)

---

## 第二步：实名认证（必须）

百度 OCR API 要求账户完成实名认证才能使用：

1. 将鼠标悬停在控制台右上角的头像，点击「安全认证」
2. 选择「个人实名认证」或「企业实名认证」
3. 个人认证：填写姓名 + 身份证号，通过支付宝/微信扫码完成
4. 认证通常在 1-2 分钟内完成

> **注意**：不完成实名认证，后续创建的应用将无法调用 API。

---

## 第三步：创建文字识别应用

1. 在控制台顶部的搜索栏搜索「文字识别」
2. 进入「文字识别」产品页，点击「立即使用」
3. 在左侧菜单栏选择「概览」，然后点击「创建应用」
4. 填写应用信息：

| 字段 | 填写内容 |
|------|----------|
| 应用名称 | 自定义，如 `星记账OCR` |
| 应用类型 | 选择「个人开发者」或「企业开发者」 |
| 接口选择 | 勾选「文字识别」下的全部接口（或至少勾选「通用文字识别」） |
| 应用描述 | 选填，如「个人记账软件的票据识别功能」 |

5. 阅读并同意协议后，点击「立即创建」

---

## 第四步：获取API凭证

创建完成后，返回「应用列表」页面，你会看到刚创建的应用。点击应用名称进入详情页，记录以下三项信息：

| 凭证名称 | 在页面上的显示 | 示例格式 |
|----------|---------------|----------|
| **App ID** | `AppID` | 一串纯数字，如 `123787984` |
| **API Key** | `API Key` | 字母+数字组合，如 `EAHmuzMfqzzKrq1zZqjbDIrH` |
| **Secret Key** | `Secret Key` | 字母+数字组合，如 `OvJxrFjrnzfScDxaZLCe6t5JcyIjInDv` |

> ⚠️ **安全警告**：Secret Key 等同于密码，切勿公开分享或提交到 Git 仓库。

---

## 第五步：在星记账中配置

1. 打开「星记账」应用
2. 点击顶部标签栏右侧的齿轮按钮（⚙）
3. 在「百度 OCR API 配置」区域，分别填入三项凭证：

   ```
   App ID     → 填入你的 AppID
   API Key    → 填入你的 API Key
   Secret Key → 填入你的 Secret Key
   ```

4. 点击「保存 API 配置」
5. 切换到「OCR 导入」标签页，选择「百度 OCR (云端)」引擎即可开始使用

---

## 费用说明

百度文字识别 API 提供**每日免费额度**：

| 接口类型 | 每日免费调用次数 |
|----------|------------------|
| 通用文字识别（标准版） | 500 次/天 |
| 通用文字识别（高精度版） | 50 次/天 |
| 通用文字识别（含位置版） | 500 次/天 |

- 个人日常记账使用**绰绰有余**
- 超出免费额度后按量计费，详情见 [百度 OCR 定价](https://ai.baidu.com/ai-doc/OCR/6k3h7yxuv)
- 星记账默认使用标准版，勾选「高精度」复选框后会调用高精度版（消耗高精度额度）

---

## 常见问题

### Q: 提示「API 调用失败」怎么办？

1. 检查 App ID / API Key / Secret Key 是否**完整复制**，无多余空格
2. 确认账户已完成**实名认证**
3. 确认应用已勾选**通用文字识别**接口
4. 检查是否有剩余**免费额度**（控制台 → 概览可查看）

### Q: Secret Key 可以重置吗？

可以。在应用详情页点击「重置」，会生成新的 Secret Key。重置后需在星记账中更新配置。

### Q: 一个账号可以创建多个应用吗？

可以。百度智能云允许创建多个应用，各自独立的 API 凭证和调用额度。

### Q: 数据安全问题？

星记账的 API 凭证存储在你电脑的本地数据库中（`%APPDATA%/xingjizhang/accounting.db`），OCR 图片通过 HTTPS 加密传输至百度服务器进行识别。不会上传至任何第三方服务器。

---

## 附录：直接访问链接

| 步骤 | 链接 |
|------|------|
| 注册/登录 | [https://console.bce.baidu.com/](https://console.bce.baidu.com/) |
| 文字识别产品页 | [https://console.bce.baidu.com/ai/#/ai/ocr/overview/index](https://console.bce.baidu.com/ai/#/ai/ocr/overview/index) |
| 创建应用 | [https://console.bce.baidu.com/ai/#/ai/ocr/app/create](https://console.bce.baidu.com/ai/#/ai/ocr/app/create) |
| 应用列表 | [https://console.bce.baidu.com/ai/#/ai/ocr/app/list](https://console.bce.baidu.com/ai/#/ai/ocr/app/list) |
| 定价详情 | [https://ai.baidu.com/ai-doc/OCR/6k3h7yxuv](https://ai.baidu.com/ai-doc/OCR/6k3h7yxuv) |
