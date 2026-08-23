---
name: dashscope-media-generator
description: "使用阿里云 DashScope 原生图像生成接口生成图片。Use when: 生成图片、AI 绘图、dashscope 图像生成、qwen-image。"
argument-hint: "画面描述（主题/风格/尺寸）"
disable-model-invocation: false
---

# DashScope Media Generator

使用阿里云 DashScope 原生图像生成接口生成写实图片。

## 接口

创建异步任务（X-DashScope-Async: enable）：

```
POST https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis
Content-Type: application/json
Authorization: Bearer <QWEN_KEY>
X-DashScope-Async: enable
```

```json
{
  "model": "qwen-image",
  "input": { "prompt": "<画面描述>" },
  "parameters": { "size": "1280*720", "n": 1, "water_mark": false }
}
```

轮询结果：

```
GET https://dashscope.aliyuncs.com/api/v1/tasks/<task_id>
Authorization: Bearer <QWEN_KEY>
```

任务状态 `SUCCEEDED` 后取 `output.results[0].url` 下载图片。

## 模型约束（实测）

- **可用**：`qwen-image`、`qwen-image-plus`（原生接口仅这两个模型名可用）。
- **不可用**：`qwen-image-2.0` / `qwen-image-3.0` / `wan2.7-image` / `qwen-image-max` 等在原生接口返回 400（模型名仅在 OpenAI 兼容端点可用，而该端点 images/generations 返回 404）。
- **禁用端点**：标准 OpenAI 兼容端点 `/compatible-mode/v1/images/generations` 不支持图片生成（404）。

## 凭据

从 `argo/.env` 的 `QWEN_KEY` 读取。禁止写入文件或日志。

## 输出

返回输出文件路径、所用模型与尺寸、状态（已生成 / BLOCKED）。
