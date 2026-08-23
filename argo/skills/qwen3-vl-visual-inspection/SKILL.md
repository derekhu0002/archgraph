---
name: qwen3-vl-visual-inspection
description: "使用 qwen3-vl-plus 视觉模型查看图片并输出画面元素与百分比坐标，作为无图像输入能力 Agent 的代理验收。Use when: 查看图片、视觉验收、标注定位、图片内容检查、qwen3-vl。"
argument-hint: "图片路径 + 检查问题"
disable-model-invocation: false
---

# Qwen3-VL Visual Inspection

使用 qwen3-vl-plus 视觉模型查看图片，报告画面元素与百分比坐标，作为无图像输入能力 Agent 的代理验收手段。

## 接口

```
POST https://llm-clids9mqc5o1mbvb.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions
Content-Type: application/json
Authorization: Bearer <QWEN_KEY>
```

```json
{
  "model": "qwen3-vl-plus",
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "image_url", "image_url": { "url": "data:image/png;base64,<b64>" } },
        { "type": "text", "text": "<检查问题>" }
      ]
    }
  ],
  "max_tokens": 2000
}
```

## 典型用法

1. **画面元素完整性**：让模型列出画面中出现的元素，核对与生成 prompt 的符合度。
2. **角色/标注定位**：让模型报告各人物/物体的百分比坐标 (x%, y%)，用于叠加标注框。
3. **标注质量验收**：检查标注框是否遮挡人物、是否相互重叠、文字是否可读。

## 凭据

从 `argo/.env` 的 `QWEN_KEY` 读取。禁止写入文件或日志。

## 输出

模型的文字描述（中文）与坐标列表；据此迭代修改图片或标注。
