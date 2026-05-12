# 视觉转发（Vision Forwarding）问题诊断报告

> 审查日期：2026-05-12  
> 审查范围：`src/provider.ts`、`src/utils/visionContent.ts`、`src/utils/anthropicConverter.ts`、`src/utils/v1ResponseConverter.ts`  
> 审查目标：识别 VS Code 扩展把 Copilot Chat 请求中包含图像的消息转发到 OpenAI / Anthropic / Responses API 等后端时存在的潜在 Bug、协议不规范处与健壮性问题。

---

## 高严重度问题

### H-1. 不支持视觉的模型仍会转发图片

- **文件路径**：`src/provider.ts`
- **代码位置**：
  - `_extractUserContent` 中 `part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith('image/')` 分支（约 3736 行附近）
  - 模型能力声明处 `capabilities.imageInput = model.vision || false`（约 579 行）
- **问题描述**：扩展在 `prepareLanguageModelChat` 阶段通过 `capabilities.imageInput` 声明模型是否支持图片输入，但请求转换阶段 `_extractUserContent` 不再检查当前模型的 `vision` 字段。只要 `LanguageModelDataPart` 的 MIME 以 `image/` 开头，就会被编码为 `image_url` 并转发给后端。
- **影响**：
  - 用户在非视觉模型中误带图片时，后端会直接 400 报错或忽略图片。
  - 能力声明与实际行为不一致。
  - 模型可能完全看不到图片，但用户以为模型看到了。
- **建议修复**：
  - 在 `_extractUserContent` 增加 `model.vision` 判断；不支持时丢弃图片并以 `[image omitted: current model does not support image input]` 占位。
  - 或在更高层（`provideLanguageModelChatResponse`）直接抛出用户可读错误。
  - 推荐抽出统一工具函数 `supportsImageInput(model): boolean` 供各分支复用。

---

### H-2. 用户消息合并时 `string + array` / `array + string` 场景会丢失内容

- **文件路径**：`src/provider.ts`
- **代码位置**：`_convertMessages` 中 `canMerge` 合并逻辑（约 3601-3611 行）
- **问题描述**：当连续两条 `user` 消息可以合并时，当前实现只覆盖了两种情况：
  - `lastMsg.content` 与 `content` 都是字符串
  - `lastMsg.content` 与 `content` 都是数组

  没有覆盖：
  - `lastMsg.content` 是字符串而新 `content` 是数组（包含图片的情况）
  - `lastMsg.content` 是数组而新 `content` 是字符串

  当上述两种情况发生时，分支什么也不做也不 `push`，导致整条消息被静默丢弃。
- **影响**：
  - 严重的上下文丢失。
  - 图片消息可能被完全丢弃，且没有任何错误或日志。
  - 文本说明与图片分离，模型理解错乱。
- **建议修复**：
  - 在合并前将 `content` 统一规范化为 `parts` 数组：
    - 字符串：`[{ type: 'text', text }]`
    - 数组：保持原样
  - 合并时统一拼接两个数组。
  - 最终输出前再做格式优化（仅在仅含单个纯文本 part 时回退为字符串）。

---

### H-3. 工具结果中的图片被 `JSON.stringify` 为乱码文本

- **文件路径**：`src/provider.ts`
- **代码位置**：`collectToolResultText`（约 356-374 行）；`_extractUserContent` 中的 `isToolResultPart(part)` 分支
- **问题描述**：`collectToolResultText` 对工具结果 content 中既不是文本、又不是 `cache_control` 的 `LanguageModelDataPart`，会直接 `JSON.stringify` 拼到文本中。这意味着工具调用返回的图片字节会被序列化为类似 `{"0":137,"1":80,...}` 的无意义乱码插入到 prompt。
- **影响**：
  - 工具返回图片场景完全不可用：模型看不到图片。
  - 图片字节污染上下文，浪费大量 token，可能超出 token 限制。
  - 「截图工具」「图像生成工具」「读图工具」等功能性失效。
- **建议修复**：
  - 让 `collectToolResultText` 跳过二进制 `DataPart` 并替换为可读占位符，例如 `[tool returned image: image/png, 12345 bytes; omitted]`。
  - 若需要把工具结果图片转发给模型，需新增 `collectToolResultContentParts`，返回结构化的 `content parts`（文本 + image_url），并在 `_convertMessages` 中把 tool message 的 `content` 设为数组。
  - 注意：OpenAI Chat Completions 标准的 tool role 不支持多模态 content，需明确取舍。

---

### H-4. Anthropic 转换器允许 assistant 消息包含 image block

- **文件路径**：`src/utils/anthropicConverter.ts`
- **代码位置**：`convertContentBlocks`（约 175-202 行）；被 `convertMessagesToAnthropic` 同时用于 user/assistant
- **问题描述**：`convertContentBlocks` 对所有 `image_url` part 一律转换为 Anthropic `image` block，不区分 role。但 Anthropic Messages API 要求 image 输入只能位于 user 消息中，assistant content 不允许包含 image block。
- **影响**：
  - 历史 assistant 消息中如果有图片 part（例如多协议互转时），会生成非法 Anthropic 请求，导致 400。
  - 多轮上下文回放容易触发。
- **建议修复**：
  - 让 `convertContentBlocks` 接受 `role` 参数，或由调用方按 role 过滤。
  - 对 `role === 'assistant'` 时遇到图片 part：丢弃并打 debug 日志，或替换为 `[assistant image omitted]` 文本占位。

---

### H-5. Responses API 转换可能在 assistant/output 消息中生成 `input_image`

- **文件路径**：`src/utils/v1ResponseConverter.ts`
- **代码位置**：`convertMessageContentForResponses` 中 `part.type === 'image_url'` 分支（约 254-259 行）
- **问题描述**：函数同时处理 user 和 assistant 两种 role，但 `image_url` 分支无差别地生成 `{ type: 'input_image', image_url }`。Responses API 中 `input_image` 语义上只允许用于 input/user role，assistant/output 消息不应包含 input-only content。
- **影响**：
  - 历史 assistant 含图片时生成非法 Responses API 请求。
  - 部分严格实现的后端会直接拒绝。
- **建议修复**：
  - 根据 `role` 区分行为：
    - `role === 'user'`：生成 `input_image`。
    - `role === 'assistant'`：丢弃图片并写入 `output_text` 占位（例如 `[assistant image omitted]`）。
  - 或在更上层（`_extractAssistantContent`）就保证 assistant 消息不会保留图片 part。

---

### H-6. Anthropic 路径下 tool 消息没有把工具结果图片转换为合法 content block

- **文件路径**：`src/utils/anthropicConverter.ts`
- **代码位置**：`convertMessagesToAnthropic` 中 `role === 'tool'` 分支（约 95-104 行）
- **问题描述**：当前 tool 消息会被映射为 Anthropic 的 `tool_result` block，但 `toolResult.content` 基本原样取自 `msg.content`，没有复用 `convertContentBlocks`。如果上游 tool 消息包含 OpenAI 风格的 `image_url` parts，Anthropic 路径不会把它们转换成 `tool_result.content` 中允许的 `image` block。
- **影响**：
  - 即便 H-3 修复后保留了工具结果图片，Anthropic 转换层仍可能把结构化图片原样透传为非法结构。
  - 工具结果图片要么被后端拒绝，要么被忽略。
  - 「截图工具」「图像生成工具」「图像检索工具」在 Anthropic 后端上无法形成端到端视觉链路。
- **建议修复**：
  - 为 tool result 单独实现 `convertToolResultContentBlocks`。
  - 对 tool result 中的文本转为 `{ type: 'text', text }`。
  - 对 tool result 中的图片转为 Anthropic 支持的 `{ type: 'image', source: ... }`。
  - 对不支持或超限图片插入占位文本，不要原样透传二进制或 data URL。

---

### H-7. Responses API 的 tool / assistant-with-tools 分支会把图片退化为纯文本

- **文件路径**：`src/utils/v1ResponseConverter.ts`
- **代码位置**：
  - `convertChatCompletionsToResponsesAPI` 中 `role === 'tool'` 分支（约 32-46 行）
  - `convertChatCompletionsToResponsesAPI` 中 assistant 带 `tool_calls` 分支（约 49-72 行）
  - `contentToPlainText` / `contentPartToText`（约 582-615 行）
- **问题描述**：Responses API 中 tool 输出被转换为 `function_call_output.output` 字符串，因此当前实现调用 `contentToPlainText`。当 content 里有 `image_url` 时，`contentPartToText` 会返回图片 URL 或整段 data URL 字符串。这会把图片数据作为普通文本塞进请求体，而不是结构化图片。
- **影响**：
  - data URL 图片会形成巨大的字符串，污染上下文并浪费 token。
  - assistant 带工具调用时的图片处理与普通 assistant 分支不一致，排查困难。
  - 严格后端可能因为 output 过大或格式异常直接拒绝。
- **建议修复**：
  - tool 分支中遇到图片只输出可读占位，例如 `[tool returned image: image/png, omitted]`。
  - assistant 带 `tool_calls` 的 content 不应直接 `contentToPlainText`；应按 role 做图片过滤或占位。
  - 明确 Responses API 中 `function_call_output.output` 只承载文本，不承载图片。

---

### H-8. Anthropic 合并连续 role 时可能把 tool_result 与用户图片合并进同一条 user 消息

- **文件路径**：`src/utils/anthropicConverter.ts`
- **代码位置**：`mergeConsecutiveRoles`（约 215-232 行）
- **问题描述**：Anthropic 转换中 tool 消息会映射为 `role: 'user'` 的 `tool_result` block。随后 `mergeConsecutiveRoles` 会把连续相同 role 的消息合并。如果 tool_result 后面紧跟真正的 user 文本或图片，它们可能被合并到同一条 user 消息。
- **影响**：
  - 可能破坏 Anthropic 对 `tool_result` block 顺序和配对关系的要求。
  - 后端可能返回类似 tool result 顺序不合法的协议错误。
  - 工具结果图片与后续用户图片混在同一 content 数组中，语义边界不清晰。
- **建议修复**：
  - `mergeConsecutiveRoles` 不应无条件合并包含 `tool_result` 的 user 消息。
  - 对含 `tool_result` 的消息设置不可合并边界。
  - 增加「tool result 后紧跟 user 图片」的转换测试。

---

### H-9. Anthropic `tool_result.content` 仍可能包含非法 block

- **文件路径**：`src/utils/anthropicConverter.ts`
- **代码位置**：`convertMessagesToAnthropic` 中 `role === 'tool'` 分支；`convertContentBlocks` 的未知 block 透传分支
- **问题描述**：即使 tool 消息开始复用 content block 转换逻辑，普通 `convertContentBlocks` 中的未知类型仍会被原样 `blocks.push(part)`。但 Anthropic `tool_result.content` 只应包含文本或图片 block。若工具结果中混入 `tool_use`、`reasoning`、`input_image`、`output_text` 或其它未知结构，会被原样放进 `tool_result.content`，触发协议错误。
- **影响**：
  - Anthropic 后端可能返回 400，提示 tool result content 类型非法。
  - 多协议互转或未来 VS Code 新 part 类型出现时风险较高。
- **建议修复**：
  - 为 tool result 单独实现严格转换函数，只允许输出 `{ type: 'text' }` 与 `{ type: 'image' }`。
  - 未知内容统一转为文本占位，例如 `[unsupported tool result content omitted]`。
  - tool result 内容为空时兜底为字符串空值或一条安全文本占位，避免空数组被拒绝。

---

### H-10. 多个连续 Anthropic tool_result 可能形成连续 user 消息

- **文件路径**：`src/utils/anthropicConverter.ts`
- **代码位置**：`mergeConsecutiveRoles`
- **问题描述**：tool 消息会被映射为 `role: 'user'` 的 `tool_result` block。为了避免 H-8，当前合并逻辑不能把 `tool_result` 与普通 user 文本/图片合并。但如果多个工具结果连续出现，它们也都是 `role: 'user'` 且都含 `tool_result`，若完全禁止合并，就会形成多条连续 user 消息，违反 Anthropic 对 user/assistant 交替的要求。
- **影响**：
  - 并行或连续工具结果在 Anthropic 路径下可能直接 400。
  - 修复 H-8 时容易引入该副作用。
- **建议修复**：
  - 仅禁止「含 tool_result 的 user」与「普通 user」混合合并。
  - 如果前后两条 user 都只含 tool_result，应允许合并为一条 user 消息，包含多个 `tool_result` block。
  - 如果前后两条都不含 tool_result，也可按原逻辑合并。

---

## 中严重度问题

### M-1. MIME 校验不一致：用户图片入口只判断 `image/` 前缀

- **文件路径**：`src/provider.ts`、`src/utils/visionContent.ts`
- **代码位置**：
  - `src/provider.ts` `_extractUserContent`：`part.mimeType.startsWith('image/')`
  - `src/utils/visionContent.ts`：`SUPPORTED_IMAGE_TYPES`、`isSupportedImageType`
- **问题描述**：`visionContent.ts` 已定义支持的 MIME 集合（`image/png`、`image/jpeg`、`image/gif`、`image/webp`），但 `_extractUserContent` 实际只检查 `startsWith('image/')`，导致 `image/svg+xml`、`image/bmp`、`image/tiff`、`image/heic` 等也会被转发。
- **影响**：
  - 不同后端路径行为不一致：有的转发、有的在 Anthropic 转换中静默丢弃、有的报错。
  - 后端拒绝大尺寸不支持格式时用户难以排查。
- **建议修复**：
  - `_extractUserContent` 改用 `isSupportedImageType(part.mimeType)`。
  - 生成 data URL 前对 MIME 调用 `normalizeImageMediaType`。
  - 不支持时给出明确错误或占位，不要静默通过。

---

### M-2. Anthropic 转换器对不支持的 base64 图片静默丢弃

- **文件路径**：`src/utils/anthropicConverter.ts`
- **代码位置**：`convertContentBlocks` 中 `if (!isSupportedImageType(dataImage.mediaType)) continue;`（约 188 行）
- **问题描述**：当 data URL 解析成功但 MIME 不在支持列表中时，直接 `continue` 跳过，没有日志、没有用户提示、没有占位文本。
- **影响**：用户图片完全丢失，但前端无感知，模型回答会脱离图片上下文。
- **建议修复**：
  - 至少打 warn 日志并向 content 中插入 `[unsupported image omitted: <mediaType>]` 占位。
  - 或更严格：直接抛错，提示用户切换图片格式。

---

### M-3. Anthropic 对 http(s) URL 图片未做校验，也未判断端点能力

- **文件路径**：`src/utils/anthropicConverter.ts`
- **代码位置**：`convertContentBlocks` 中 `blocks.push({ type: 'image', source: { type: 'url', url } });`（约 198 行）
- **问题描述**：当 `image_url` 不是 data URL 时直接生成 `source: { type: 'url', url }`。但：
  - 没有验证 URL scheme（可能是 `file:` 或其它）。
  - 没有判断 Anthropic 端点是否支持 url source（部分代理网关不支持）。
  - 没有 MIME 校验。
- **影响**：
  - 不支持 url source 的端点会报错。
  - 非 http/https 的 URL 也会被错误传给 Anthropic 让其 fetch 失败。
- **建议修复**：
  - 仅当 `url` 以 `http://` 或 `https://` 开头时才生成 url source。
  - 提供配置项 `supportsAnthropicImageUrlSource`，默认保守关闭，关闭时回退为「下载并转 base64」或直接报错。
  - 对其它 scheme（`file:`、`blob:`、`data:` 解析失败等）抛错或占位。

---

### M-4. `parseDataImageUrl` 不支持非 base64 data URL，SVG 等场景被错误回退

- **文件路径**：`src/utils/visionContent.ts`、`src/utils/anthropicConverter.ts`
- **代码位置**：
  - `parseDataImageUrl`：强制要求 `base64` 标志
  - `convertContentBlocks` 的 `else` 分支：把无法解析的 data URL 当成远程 url 传给 Anthropic
- **问题描述**：遇到 `data:image/svg+xml,<svg ...>` 或 `data:image/svg+xml,%3Csvg...%3E` 这种非 base64 的 data URL，`parseDataImageUrl` 返回 `undefined`，随后 Anthropic 分支会把整串 data URL 当作远程 URL 发送。Anthropic 实际无法 fetch 这种 data URL，必然失败。
- **影响**：SVG / URL 编码型 data URL 场景失败，且错误来自后端，前端无法定位。
- **建议修复**：
  - Anthropic 转换在 `url.startsWith('data:')` 但 `parseDataImageUrl` 失败时，应直接当作非法图片处理，给出明确错误或占位，不要回退为 url source。
  - 视需求增加对非 base64 data URL 的解码（百分号编码 → utf-8 文本 → base64），但需结合后端是否真的支持 SVG。

---

### M-5. `image/jpg` 被 normalize 但生成 data URL 仍用原始 MIME

- **文件路径**：`src/provider.ts`、`src/utils/visionContent.ts`
- **代码位置**：`_extractUserContent` 中：``data:${part.mimeType};base64,${base64}``（约 3739 行）
- **问题描述**：`normalizeImageMediaType` 会把 `image/jpg` 规范化为 `image/jpeg`，但 `_extractUserContent` 直接使用 `part.mimeType` 构造 data URL，没有规范化。
- **影响**：会生成 `data:image/jpg;base64,...`。部分后端只接受 `image/jpeg`，导致兼容性差，并与后续 `isSupportedImageType` 行为不一致。
- **建议修复**：
  ```ts
  const mediaType = normalizeImageMediaType(part.mimeType);
  if (!isSupportedImageType(mediaType)) { /* skip or error */ }
  textParts.push({
      type: 'image_url',
      image_url: { url: `data:${mediaType};base64,${base64}` },
  });
  ```

---

### M-6. `getImageUrlFromPart` 未覆盖 Anthropic 原生 base64 source

- **文件路径**：`src/utils/visionContent.ts`
- **代码位置**：`getImageUrlFromPart`（约 69-101 行）
- **问题描述**：函数支持的四种形态没有覆盖 Anthropic 原生：
  ```json
  { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "..." } }
  ```
  导致从 Anthropic 风格消息往 OpenAI / Responses 互转时图片会丢失。
- **影响**：多协议互转场景下，历史消息中的 Anthropic 原生图片 block 无法被识别。
- **建议修复**：在 `getImageUrlFromPart` 中增加分支，若 `source.type === 'base64'` 且 `media_type` + `data` 合法，则拼接 `data:${media_type};base64,${data}` 返回。

---

### M-7. Responses API 的 `input_image` 字段格式与某些兼容后端不一致

- **文件路径**：`src/utils/v1ResponseConverter.ts`
- **代码位置**：`parts.push({ type: 'input_image', image_url: imageUrl });`（约 258 行）
- **问题描述**：OpenAI 官方 Responses API 中 `input_image.image_url` 标准为字符串。但部分自称 "OpenAI 兼容" 的后端仍沿用 Chat Completions 的 `{ url }` 对象结构。当前实现没有为后者提供兼容选项。
- **影响**：切换到部分兼容后端时图片输入失败。
- **建议修复**：
  - 默认保留 OpenAI Responses 标准格式。
  - 在 provider 配置中提供 `responsesImageUrlFormat: 'string' | 'object'` 选项，按需输出 `image_url: url` 或 `image_url: { url }`。
  - 如需支持 `detail` 参数，可允许 `{ type: 'input_image', image_url, detail }`。

---

### M-8. prompt 后缀只追加到最后一条 user，可能与图片消息错位

- **文件路径**：`src/provider.ts`
- **代码位置**：`_convertMessages` 中 prompt appendix 注入逻辑（约 3665-3695 行）
- **问题描述**：当前扩展会把 expert / solution / todo / 全局 prompt / 工作区 prompt 等附加文本注入到最终消息中的最后一条 user 消息。如果图片位于较早的 user 消息，而最后一条 user 只是普通文本，附加提示会与图片语义错位。若 H-2 触发导致图片消息被吞掉，appendix 还会被追加到错误的文本消息上。
- **影响**：
  - 图文指代关系被破坏。
  - 附加指令可能改变用户原始多模态消息顺序。
  - 用户看到的是带图提问，后端收到的可能是「无图消息 + 大段附加提示」。
- **建议修复**：
  - 优先把扩展附加指令放入 system / developer 语义位置。
  - 若必须追加到 user，优先选择含图片的当前 user 消息末尾。
  - 禁止把附加提示插入图片和用户说明文本之间。

---

### M-9. `isToolResultPart` 类型守卫过宽，异常对象可能进入工具结果处理

- **文件路径**：`src/provider.ts`
- **代码位置**：`isToolResultPart`（约 343-352 行）
- **问题描述**：当前守卫只检查对象存在 `callId` 字符串和 `content` 字段，没有验证 `content` 是否为数组，也没有验证其中 part 的类型。异常对象会进入 `collectToolResultText`，继续触发 JSON 序列化、二进制污染或运行时错误。
- **影响**：
  - 工具结果处理链路健壮性不足。
  - VS Code API 未来扩展 part 类型后，容易出现未知内容被错误序列化。
- **建议修复**：
  - 收紧 `isToolResultPart`，要求 `Array.isArray(content)`。
  - 对未知 part 使用明确占位和日志，不要直接 `JSON.stringify`。
  - 为未来 API 变化预留默认安全分支。

---

### M-10. prompt context cache 与视觉链路存在耦合风险

- **文件路径**：`src/promptContextCache.ts`
- **代码位置**：`normalizePromptContextMessages`、`contentToText`（约 60-90 行）
- **问题描述**：缓存层会把图片内容文本化为占位或省略。这个策略本身合理，但如果 H-3 未修复，工具结果图片可能已经被序列化为大量普通文本，再进入缓存层，导致缓存膨胀或污染后续上下文。
- **影响**：
  - 图片二进制错误文本可能被长期缓存。
  - 缓存大小限制被无意义内容占满。
  - 后续请求即使不含图片，也可能带上历史污染文本。
- **建议修复**：
  - 缓存层对疑似 data URL、超长 base64、二进制数组 JSON 文本做防御性截断。
  - 工具结果内容进入缓存前先统一清洗。
  - 在视觉修复测试中加入缓存归一化场景。

---

### M-11. OpenAI `image_url.detail` 字段在转换中未形成明确策略

- **文件路径**：`src/utils/anthropicConverter.ts`、`src/utils/v1ResponseConverter.ts`
- **代码位置**：图片转换相关分支
- **问题描述**：OpenAI Chat Completions 的 `image_url` 对象可以包含 `detail: 'low' | 'high' | 'auto'`。Anthropic 没有完全等价字段，Responses API 则支持类似 detail 语义。当前转换大多只提取 URL，忽略 detail。
- **影响**：
  - 用户或上游指定的低/高清图处理偏好被静默丢弃。
  - 不同后端图像 token 成本和识别质量可能不一致。
- **建议修复**：
  - 文档化各后端对 detail 的取舍。
  - Responses API 路径尽量保留 detail。
  - Anthropic 路径明确记录为不支持并打印 debug 日志。

---

### M-12. 自动识别模型 vision 能力的来源不够可靠

- **文件路径**：`src/views/configView.ts`
- **代码位置**：拉取模型列表并设置 `vision` 的逻辑（约 990 行）
- **问题描述**：当前自动同步模型能力时主要依赖 `input_modalities` 是否包含 `image`。不同兼容后端可能使用 `modalities`、`capabilities.vision`、`capabilities.input.image` 等不同字段表达视觉能力。
- **影响**：
  - 支持图片的模型可能被误判为不支持。
  - 不支持图片的模型也可能被手动配置为支持，导致后端错误。
- **建议修复**：
  - 支持多种常见能力字段。
  - 保留用户手动覆盖能力。
  - 在配置界面显示 vision 来源：自动推断 / 用户手动 / 未知。

---

### M-13. baseUrl 与 apiType 误配会放大视觉请求失败

- **文件路径**：`src/provider.ts`
- **代码位置**：`_requestModel` 中 endpoint 拼接逻辑（约 1629-1648 行）
- **问题描述**：扩展根据 `apiType` 拼接 `/chat/completions`、`/messages` 或 `/responses`。如果用户把带 `/v1` 的 OpenAI baseUrl 与 Anthropic apiType 混用，或把兼容网关路径配错，视觉请求通常会更早触发协议错误。
- **影响**：
  - 用户容易误以为是图片转发失败，实际是 endpoint 与协议组合不匹配。
  - 远程图片、Responses 图片格式等兼容问题会被误诊。
- **建议修复**：
  - 在诊断日志中输出 apiType、endpoint 类型、是否含图片，不输出图片数据。
  - 增加配置校验提示常见误配。

---

### M-14. 多模态 content 中相邻 text part 未压缩合并

- **文件路径**：`src/provider.ts`
- **代码位置**：`compactOpenAIContent`
- **问题描述**：修复 H-2 后，字符串和数组会统一转成 parts 合并。当结果中包含图片时，当前实现会保留数组原貌，可能出现多个相邻 `{ type: 'text' }` part。
- **影响**：
  - token 略有浪费。
  - 部分兼容后端对多个相邻 text part 处理不稳定。
- **建议修复**：
  - 在压缩 content 时合并相邻 text part，只保留必要的图文边界。

---

### M-15. TODO-LOCK 在纯文本与多模态路径中的位置语义不一致

- **文件路径**：`src/provider.ts`
- **代码位置**：`_convertMessages` 末尾 prompt appendix 注入逻辑
- **问题描述**：纯文本 user 消息中，`hasCurrentTodoTask` 会把 TODO-LOCK 前置到用户内容之前；多模态数组路径为保护图文顺序改为把 appendix 追加到末尾，导致同一逻辑在不同 content 形态下语义不同。
- **影响**：
  - 多模态消息下 TODO-LOCK 优先级降低。
  - 如果模型强依赖前置约束，行为可能与纯文本路径不同。
- **建议修复**：
  - 更优策略是把 TODO-LOCK / 强制任务类提示放入 system 消息，而不是塞入 user 多模态 content。
  - 若短期不重构 system 注入，则至少避免数组文本 part 带冗余前导换行，并在测试中覆盖该差异。

---

### M-16. 工具结果与 Responses 纯文本化未统一识别 Anthropic 原生 image block

- **文件路径**：`src/utils/v1ResponseConverter.ts`
- **代码位置**：`contentPartToText`
- **问题描述**：当前纯文本化函数主要识别 `image_url`。若历史消息或工具结果中出现 Anthropic 原生 `{ type: 'image', source: ... }`，虽然不会泄漏图片数据，但也不会输出明确占位。
- **影响**：
  - 图片被静默丢失，可观测性差。
  - 与 `getImageUrlFromPart` 已支持 Anthropic 原生 base64 source 的能力不一致。
- **建议修复**：
  - `contentPartToText` 中同时识别 `part.type === 'image'` 并输出安全占位。

---

### M-17. 工具结果 callId 应要求非空

- **文件路径**：`src/provider.ts`
- **代码位置**：`isToolResultPart`
- **问题描述**：类型守卫只判断 `callId` 是字符串，没有要求非空。空字符串会生成非法 `tool_call_id`。
- **影响**：
  - 后端可能拒绝 tool 消息。
  - 异常工具结果对象更容易进入请求链路。
- **建议修复**：
  - 要求 `callId.trim().length > 0`。

---

## 低严重度问题

### L-1. 图片丢弃 / 转换失败缺少可观测性

- **位置**：四个相关文件中的所有 `continue` / 静默丢弃分支
- **问题描述**：当前在 MIME 不匹配、URL 解析失败、image 不允许在 assistant 等场景下大量使用 `continue`，没有日志、没有 UI 反馈。
- **影响**：排错成本高；用户只能看到「模型没看到图」，但不知道是被扩展丢弃还是后端忽略。
- **建议修复**：
  - 引入统一的 vision 日志（debug/warn 级别），输出 MIME、大小、被跳过原因、目标协议。
  - 对来自用户的显式输入图像建议升级为可见错误，而历史消息中的图像可走静默 + 日志。

---

### L-2. 缺少图片大小限制与请求体保护

- **位置**：`src/provider.ts` `_extractUserContent` 中 `Buffer.from(part.data).toString('base64')`
- **问题描述**：未对单张图片大小、总图片大小做限制，base64 化后请求体可能膨胀 ~33%。
- **影响**：易触发后端请求体上限，内存峰值高；超大图引发性能问题。
- **建议修复**：
  - 增加配置项：单图大小上限 / 总图大小上限（默认例如 5MB / 20MB）。
  - 超限时给出明确错误。
  - 可选：在扩展内做缩放压缩（注意可能改变图像语义，建议默认关闭）。

---

### L-3. prompt 后缀注入到多模态 content 可能破坏图文顺序

- **位置**：`src/provider.ts` `_convertMessages` 中 `lastMsg.content.unshift / push`（约 3677-3683 行）
- **问题描述**：当最后一条 user content 为数组（含图片）且需要追加 prompt 后缀（expert / solution / todo / 全局 prompt / 工作区 prompt）时，会把这些文本 part 一股脑塞进 content 头或尾，可能改变图文相对顺序，影响模型对「这张图…」之类指代关系的理解。`hasCurrentTodoTask` 走 `unshift` 还会把系统性指令插到图片前面。
- **影响**：多模态对话中模型对图片的上下文理解可能被破坏。
- **建议修复**：
  - 优先把扩展附加指令放进 system / developer 消息，而不是混进 user content。
  - 若必须放 user，统一追加到末尾（不要 `unshift`），并将其包裹为单独 part，与用户原始文本/图片解耦。
  - 增加单元测试验证多模态 user 消息中图文顺序。

---

### L-4. `parseDataImageUrl` 错误类型表达不足

- **位置**：`src/utils/visionContent.ts` `parseDataImageUrl`
- **问题描述**：当前返回 `{ mediaType, data } | undefined`，调用方无法区分「非 data URL」「data URL 格式错」「非 base64」「MIME 不支持」等不同情况，于是只能做粗糙回退。
- **影响**：导致 M-4 中「SVG data URL 被回退为远程 URL」类问题。
- **建议修复**：
  - 返回判别联合，例如：
    ```ts
    type DataImageParseResult =
      | { kind: 'ok'; mediaType: string; data: string }
      | { kind: 'not_data_url' }
      | { kind: 'invalid_data_url'; reason: string }
      | { kind: 'unsupported_media_type'; mediaType: string };
    ```
  - 调用方根据 `kind` 决定是否报错 / 占位 / 回退。

---

### L-5. 请求失败、日志和调试输出缺少图片数据脱敏规则

- **位置**：`src/provider.ts` 请求体构造和错误处理相关逻辑
- **问题描述**：图片会以 base64 data URL 形式进入请求体。虽然错误处理通常不打印完整请求体，但文档和实现中缺少明确约束：任何日志、错误对象、调试输出都不得包含完整图片数据或图片字节。
- **影响**：
  - 用户截图、照片、私密文件可能被写入日志。
  - 大量 base64 数据会让日志不可读，并增加隐私风险。
- **建议修复**：
  - 统一日志脱敏函数，遇到 `data:image/...;base64,` 只保留 MIME 与字节长度。
  - 请求失败时禁止输出完整 body。
  - 配置诊断日志也只输出图片数量、类型、大小和丢弃原因。

---

### L-6. 响应方向的多模态内容缺少未来兼容预案

- **位置**：Anthropic / Responses 流式响应转换器
- **问题描述**：当前报告主要关注请求方向的视觉输入。但 Responses API 等接口后续可能返回图片、音频或其它非文本 content。现有转换器多以文本抽取为主，遇到未知多模态输出可能静默丢弃。
- **影响**：
  - 未来后端返回图片或音频时，用户看不到结果。
  - 调试时难以发现是后端没返回，还是扩展转换层丢弃。
- **建议修复**：
  - 对未知 `output_*` content 插入占位并记录日志。
  - 在类型层预留多模态响应结构。
  - 明确当前版本只保证文本响应输出。

---

### L-7. README 中视觉能力描述与实际支持矩阵可能不一致

- **位置**：`README.md` 中视觉 / 多模态能力描述
- **问题描述**：README 表述容易让用户理解为三种后端都完整支持图片输入。但当前实际支持主要集中在用户图片输入，工具结果图片、assistant 图片、Anthropic tool_result 图片、Responses tool 输出图片等路径并未完整支持。
- **影响**：
  - 用户预期高于实际能力。
  - 问题定位时难以判断是设计不支持还是 bug。
- **建议修复**：
  - 在 README 中加入实际支持矩阵。
  - 区分「用户直接图片输入」「工具结果图片」「历史 assistant 图片」「远程图片 URL」等场景。

---

## 视觉转发支持矩阵（当前行为与期望行为）

| 协议路径 | 消息角色 | 图片来源 | 当前行为 | 期望行为 | 关联问题 |
| --- | --- | --- | --- | --- | --- |
| OpenAI Chat Completions | user | VS Code DataPart | 转为 `image_url`，但未检查 model.vision / MIME | 检查 vision、MIME、大小后转发 | H-1、M-1、M-5、L-2 |
| OpenAI Chat Completions | user | 连续文本 + 图片消息 | 混合合并可能静默丢内容 | 统一 parts 合并 | H-2 |
| OpenAI Chat Completions | tool | 工具结果图片 | 可能被 JSON 序列化为乱码文本 | 标准不支持多模态 tool，使用安全占位 | H-3 |
| OpenAI Chat Completions | assistant | 历史图片 part | 上游若保留，后续协议转换可能非法 | 源头过滤或占位 | H-4、H-5 |
| Anthropic Messages | user | data URL 图片 | 支持部分 MIME，不支持时静默丢弃 | 不支持时占位或报错 | M-2 |
| Anthropic Messages | user | http(s) URL 图片 | 直接生成 url source | 按端点能力与 scheme 校验 | M-3 |
| Anthropic Messages | assistant | 图片 part | 可能生成非法 image block | 丢弃或占位 | H-4 |
| Anthropic Messages | tool | 工具结果图片 | 未转换为合法 tool_result image block | 转为合法 block 或占位 | H-6 |
| Anthropic Messages | tool + user | tool_result 后接用户图片 | 可能被合并到同一 user 消息 | 含 tool_result 的消息不参与普通合并 | H-8 |
| Anthropic Messages | tool | 未知工具结果 block | 可能原样进入 `tool_result.content` | 只允许 text/image，其它占位 | H-9 |
| Anthropic Messages | 多个 tool | 连续 tool_result | 可能形成连续 user 消息 | 多个 tool_result 合并为同一 user 消息 | H-10 |
| Responses API | user | image_url | 生成 `input_image` | 保留标准字符串格式，可配置兼容对象格式 | M-7 |
| Responses API | assistant | 图片 part | 可能生成 `input_image` 或被纯文本化 | 按 assistant 角色占位 | H-5、H-7 |
| Responses API | tool | 工具结果图片 | data URL 可能进入字符串 output | 只输出安全占位 | H-7 |

---

## 工具结果含图片的端到端策略

工具结果图片不能只在 `_extractUserContent` 层处理，还需要按目标协议形成完整策略：

1. **OpenAI Chat Completions**：标准 tool role 不支持多模态 content。工具结果图片应转为占位文本，例如 `[tool returned image: image/png, 12345 bytes; omitted]`。
2. **Anthropic Messages**：`tool_result.content` 可以承载结构化 block。若后端支持，应将工具结果图片转为合法 `image` block；若不支持，使用占位。
3. **Responses API**：`function_call_output.output` 是字符串，不能承载图片。必须使用占位，不得把完整 data URL 或二进制 JSON 放入 output。
4. **缓存与日志**：工具结果图片进入缓存或日志前必须被清洗为「类型 + 大小 + 省略原因」。

统一占位建议：

```text
[tool returned image: <media_type>, <bytes> bytes; omitted]
```

---

## prompt 附加内容与多模态顺序规则

为避免附加提示破坏图文顺序，建议采用以下规则：

1. 优先放入 system / developer 语义位置，不要混入用户原始图文 content。
2. 如果必须附加到 user 消息，优先选择当前轮包含图片的 user 消息末尾。
3. 禁止把附加提示插入用户文本和图片之间。
4. `hasCurrentTodoTask` 等需要前置强调的内容，也不应使用 `unshift` 插到图片前；应拆成独立系统提示或追加为独立文本 part。
5. 合并消息前后都应保持用户原始 part 的相对顺序。

---

## 请求体保护、缓存与隐私规则

1. 对单张图片、单次请求总图片大小设置上限。
2. base64 化前统计原始字节，base64 化后避免重复复制大对象。
3. 错误日志不得包含完整请求体。
4. 诊断日志只输出图片数量、MIME、字节大小、目标协议、处理结果。
5. 缓存层应识别并截断 data URL、疑似 base64 长串、二进制数组 JSON。
6. 用户可见错误应说明「图片过大 / 类型不支持 / 模型不支持视觉 / 后端不支持远程 URL」等原因，但不展示图片内容。

---

## 响应方向多模态兼容预案

当前重点是用户图片输入，但后续需要为模型多模态输出预留处理方式：

1. Anthropic / Responses 流式转换遇到未知多模态 block 时不要静默丢弃。
2. 暂不支持展示的内容应转为占位，例如 `[model returned image output: omitted]`。
3. 日志应记录 output 类型和大小，不记录内容。
4. README 中应明确当前版本是否支持图片 / 音频输出。

---

## 建议测试清单

### 用户输入路径

1. 纯文本 user 消息保持字符串输出。
2. 单张 PNG 图片转为 `image_url`。
3. `image/jpg` 规范化为 `image/jpeg`。
4. 不支持 MIME（如 SVG、BMP、HEIC）被占位或报错。
5. 非视觉模型收到图片时被拦截。
6. 超大单图触发大小限制。
7. 多图总大小超限触发错误。
8. 文本 + 图片连续 user 消息合并不丢内容。
9. 图片 + 文本连续 user 消息合并不丢内容。
10. prompt appendix 不插入用户文本和图片之间。

### 工具结果路径

1. 工具结果纯文本保持原样。
2. 工具结果图片在 OpenAI Chat Completions 路径变成安全占位。
3. 工具结果图片在 Anthropic 路径转为合法 `tool_result` image block 或占位。
4. 工具结果图片在 Responses 路径不会把 data URL 写进 `function_call_output.output`。
5. 异常 tool result 对象不会触发运行时错误。
6. 未知工具结果 part 不会被直接 `JSON.stringify` 成大段上下文。

### Anthropic 转换路径

1. user 图片转换为合法 image block。
2. assistant 图片被占位或丢弃，不生成非法 image block。
3. data URL 解析失败时不回退为 url source。
4. 非 http/https 远程图片 URL 被拒绝。
5. `tool_result` 后紧跟用户图片时不会被错误合并。
6. Anthropic 原生 base64 source 能被跨协议识别。

### Responses API 转换路径

1. user 图片生成标准 `input_image`。
2. assistant 图片不生成 `input_image`。
3. assistant 带 `tool_calls` 且 content 含图片时不会把图片 data URL 文本化。
4. `image_url.detail` 在支持路径中被保留或明确丢弃。
5. 兼容后端需要对象格式时可配置输出。

### 缓存、日志与响应路径

1. 缓存层不会保存完整图片 data URL。
2. 错误日志不会包含图片 base64。
3. 未知响应多模态 block 生成占位而非静默丢弃。
4. README 支持矩阵与实际行为一致。

---

## 修复优先级总结

### 第一优先级（立即修）：保护内容保真与协议合法

1. **H-2** `_convertMessages` 合并逻辑补齐 `string + array` / `array + string`，否则会静默丢内容。
2. **H-1** 根据 `model.vision` 拦截图片输入。
3. **H-4 / H-5** 按 role 限制 assistant / output 中是否允许图片 block。
4. **H-3 / H-6 / H-7** 工具结果中的图片不能被 `JSON.stringify`、原样透传或 data URL 文本化，需按目标协议占位或转换。
5. **H-8** Anthropic 合并逻辑避免把 `tool_result` 与后续用户图片错误合并。
6. **H-9 / H-10** Anthropic `tool_result.content` 只允许 text/image，并正确合并连续 tool_result 消息。

### 第二优先级：MIME 与 data URL 规范

1. **M-1 / M-5** 统一在用户图片入口使用 `isSupportedImageType` + `normalizeImageMediaType`。
2. **M-2** Anthropic 不支持的 MIME 不要静默丢弃。
3. **M-4** Anthropic 在 data URL 解析失败时不要错误回退为远程 url。
4. **M-3** Anthropic 远程 url 图片需要按端点能力开关控制。
5. **M-6** `getImageUrlFromPart` 支持 Anthropic 原生 base64 source。
6. **M-7** Responses API 提供 `image_url` 对象/字符串两种输出模式。
7. **M-11** 明确并实现 `image_url.detail` 在不同后端的策略。
8. **M-16** 纯文本化路径识别 Anthropic 原生 image block 并输出占位。

### 第三优先级：健壮性与可观测性

1. **L-1** 图片转换路径补充日志。
2. **L-2** 增加单图 / 总图大小限制。
3. **L-3 / M-8** prompt 后缀注入避免破坏多模态图文顺序，并尽量绑定到含图片的当前用户消息。
4. **L-4** `parseDataImageUrl` 返回结构化错误。
5. **M-9 / M-10** 收紧工具结果守卫，并补充缓存层防御。
6. **M-14 / M-15 / M-17** 合并相邻 text part、梳理 TODO-LOCK 注入位置、要求工具结果 callId 非空。
7. **L-5 / L-6 / L-7** 明确日志脱敏、响应方向多模态预案和 README 支持矩阵。

---

## 附录：建议的最小补丁草案

仅作为修复方向示意，**不代表最终实现**。

### A. `_extractUserContent` 规范化 MIME 并尊重模型能力

```ts
import { isSupportedImageType, normalizeImageMediaType } from './utils/visionContent';

private _extractUserContent(
    message: vscode.LanguageModelChatRequestMessage,
    model: vscode.LanguageModelChatInformation & { __providerData?: any },
) {
    const allowImages = !!(model as any).capabilities?.imageInput;
    const textParts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
    const toolResults: Array<{ tool_call_id: string; text: string }> = [];

    for (const part of message.content) {
        if (part instanceof vscode.LanguageModelTextPart) {
            textParts.push({ type: 'text', text: part.value });
        } else if (part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith('image/')) {
            const mediaType = normalizeImageMediaType(part.mimeType);
            if (!allowImages || !isSupportedImageType(mediaType)) {
                textParts.push({
                    type: 'text',
                    text: `[image omitted: ${!allowImages ? 'model does not support vision' : `unsupported type ${mediaType}`}]`,
                });
                continue;
            }
            const base64 = Buffer.from(part.data).toString('base64');
            textParts.push({
                type: 'image_url',
                image_url: { url: `data:${mediaType};base64,${base64}` },
            });
        } else if (isToolResultPart(part)) {
            // ... 同前
        }
    }
    return { textParts, toolResults };
}
```

### B. `_convertMessages` 合并逻辑统一化

```ts
const toParts = (c: any) =>
    typeof c === 'string' ? [{ type: 'text', text: c }] : Array.isArray(c) ? c : [];

if (canMerge) {
    const merged = [...toParts(lastMsg.content), ...toParts(content)];
    // 单 part 纯文本可回退为字符串
    if (merged.length === 1 && merged[0].type === 'text') {
        lastMsg.content = merged[0].text ?? '';
    } else {
        lastMsg.content = merged;
    }
} else {
    result.push({ role: 'user', content });
}
```

### C. Anthropic 转换按 role 处理图片

```ts
function convertContentBlocks(content: any, role: 'user' | 'assistant'): AnyObj[] {
    // ...
    } else if (part.type === 'image_url') {
        if (role !== 'user') {
            // assistant 消息忽略图片
            continue;
        }
        // 原有 base64 / url 处理
    }
}
```

### D. Responses API 按 role 处理图片

```ts
function convertMessageContentForResponses(content: any, role: string): AnyObj[] {
    // ...
    } else if (part.type === 'image_url') {
        if (role !== 'user') {
            // assistant 历史不允许 input_image，写占位
            parts.push({ type: 'output_text', text: '[assistant image omitted]' });
            continue;
        }
        const imageUrl = getImageUrlFromPart(part);
        if (imageUrl) {
            parts.push({ type: 'input_image', image_url: imageUrl });
        }
    }
}
```

---

> 报告完。建议先解决「第一优先级」中的内容丢失与协议合法性问题，再处理 MIME / data URL 规范，最后完善日志与限流。建议为视觉相关代码补一组覆盖以下场景的单元测试：纯文本与图片消息合并、非视觉模型收到图片、`image/jpg` 规范化、Anthropic user/assistant 图片、Responses user/assistant 图片、工具结果图片、非 base64 data URL。
