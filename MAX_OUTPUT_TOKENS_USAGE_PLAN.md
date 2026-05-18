# 最大输出 Token 参数传递修复方案

## 背景

当前模型编辑弹窗中的字段名为“最大 Token 数 / Max Tokens”，但从现有代码语义看，它实际表示模型单次响应可生成的最大输出 tokens，而不是上下文总长度。

已有证据：

- `src/types.ts` 中 `ModelConfig.maxTokens` 注释为 `Maximum tokens to generate`。
- `src/views/configView.ts` 拉取模型列表时将 API 的 `max_output_tokens` 映射为 `maxTokens`。
- `src/provider.ts` 在注册 VS Code Language Model 信息时将 `model.maxTokens` 映射为 `maxOutputTokens`。
- `src/utils/v1ResponseConverter.ts` 会把 Chat Completions 请求中的 `max_tokens` 转成 Responses API 的 `max_output_tokens`。

因此 UI 文案应该明确为“最大输出 Token 数 / Max Output Tokens”。

## 当前问题

### 1. UI 文案不够准确

当前弹窗文案容易让用户理解为：

```text
最大 Token 数 = 上下文总 token 数
```

但实际配置逻辑是：

```text
maxTokens = 最大输出 tokens
```

所以需要将多语言文案改为“最大输出 Token 数 / Max Output Tokens”。

### 2. 主模型请求没有实际传递输出 token 上限

虽然模型配置中的 `maxTokens` 已经传给 VS Code 的模型信息：

```ts
maxOutputTokens: maxOutput
```

但在扩展自己向 OpenAI-compatible / Anthropic / Responses API 发起请求时，主模型请求体没有显式设置：

```ts
max_tokens: model.maxTokens
```

目前主模型请求体大致为：

```ts
const requestBody: any = {
  model: modelId,
  messages: ...,
  stream: true,
};
```

后续只追加了 `temperature`、`top_p`、`tools` 等参数，没有追加 `max_tokens`。

这会导致用户在弹窗中配置的“最大输出 Token 数”只影响 VS Code 模型元信息展示/能力描述，但没有真正限制发送到模型 API 的最大输出 tokens。

## 期望行为

用户在模型编辑弹窗中配置：

```text
最大输出 Token 数 = 16000
```

则扩展向模型服务发送请求时应带上：

OpenAI-compatible / Anthropic 统一内部请求字段：

```json
{
  "max_tokens": 16000
}
```

Responses API 由现有转换器自动转成：

```json
{
  "max_output_tokens": 16000
}
```

Anthropic API 由现有转换器保留/转换为：

```json
{
  "max_tokens": 16000
}
```

## 建议实现方案

### 1. 扩展主请求上下文

在 `src/provider.ts` 的 `MainRequestContext` 中增加最大输出 token 字段：

```ts
interface MainRequestContext {
  providerId: string;
  modelId: string;
  baseUrl: string;
  apiType: string;
  apiKey: string;
  temperature: number;
  topP: number;
  samplingMode: string;
  transformThink: boolean;
  maxOutputTokens: number;
}
```

### 2. 注册模型元信息时继续使用现有逻辑

现有逻辑保留：

```ts
const contextLen = model.contextLength || DEFAULT_CONTEXT_LENGTH;
const maxOutput = model.maxTokens || DEFAULT_MAX_TOKENS;
const maxInput = Math.max(1, contextLen - maxOutput);

maxInputTokens: maxInput,
maxOutputTokens: maxOutput,
```

### 3. 在主模型请求开始时读取配置

在 `provideLanguageModelChatResponse()` 中构建 `mainContext` 前，从模型 metadata 或配置中取最大输出 tokens。

当前 `__providerData` 里还没有保存 `maxOutputTokens`，建议在 `provideLanguageModelChatInformation()` 的 `__providerData` 增加：

```ts
maxOutputTokens: maxOutput,
```

然后读取：

```ts
const maxOutputTokens = Number(metadata.maxOutputTokens) || DEFAULT_MAX_TOKENS;
```

构建 `mainContext` 时加入：

```ts
maxOutputTokens,
```

### 4. 统一应用输出 token 参数

新增或扩展一个方法，专门把最大输出 tokens 写入请求体。

推荐新方法：

```ts
/**
 * Apply the configured maximum output token limit to a model request body.
 */
private _applyMaxOutputTokens(requestBody: any, context: MainRequestContext): void {
  if (Number.isFinite(context.maxOutputTokens) && context.maxOutputTokens > 0) {
    requestBody.max_tokens = Math.floor(context.maxOutputTokens);
  }
}
```

然后在每个主模型/专家模型/方案模型继续请求体创建后调用：

```ts
this._applySamplingOptions(requestBody, mainContext);
this._applyMaxOutputTokens(requestBody, mainContext);
```

或者将其合并进 `_applySamplingOptions()`，但为了语义清晰，建议独立方法。

### 5. 需要覆盖的请求位置

`src/provider.ts` 中凡是创建请求体并调用 `_requestModel(...)` 的地方都需要考虑。主要包括：

- 主模型首轮请求：`provideLanguageModelChatResponse()` 中的 `requestBody`。
- 内部工具调用冲突后继续主模型：`_continueMainAfterInvalidInternalToolCalls()`。
- 专家不可用后继续主模型。
- 方案不可用后继续主模型。
- 专家/方案工具结果返回后继续主模型。
- 专家模型请求。
- 方案模型请求。

由于 expert/solution 也使用 `MainRequestContext`，它们也应该带上各自模型配置的 `maxTokens`。

### 6. Responses API 无需额外处理

当前 `src/utils/v1ResponseConverter.ts` 已经有：

```ts
if (typeof req.max_tokens === 'number') {
  body.max_output_tokens = req.max_tokens;
}
```

所以只要 provider 层统一写入 `requestBody.max_tokens`，Responses API 会自动转换成 `max_output_tokens`。

### 7. Anthropic API 无需额外处理

当前 `src/utils/anthropicConverter.ts` 会处理 `max_tokens`，并且 Anthropic 本身字段名也是 `max_tokens`。

因此 provider 层也只需要统一写 `requestBody.max_tokens`。

## 已完成的小改动

已将配置弹窗的多语言文案从笼统的“最大 Token 数 / Max Tokens”调整为更准确的输出语义：

- English: `Max Output Tokens`
- 简体中文：`最大输出 Token 数`
- 繁体中文：`最大輸出 Token 數`
- 韩语：`최대 출력 토큰 수`
- 日语：`最大出力トークン数`
- 法语：`Tokens de sortie max.`
- 德语：`Max. Ausgabe-Tokens`

## 验证建议

实现请求传递后建议验证：

1. 执行编译：

```bash
npm run compile
```

2. 配置某个模型的“最大输出 Token 数”为较小值，例如 `100`。

3. 发送一个要求长输出的请求。

4. 检查实际请求体中是否包含：

```json
"max_tokens": 100
```

5. 如果使用 v1-response provider，检查最终请求体是否包含：

```json
"max_output_tokens": 100
```

## 注意事项

- `contextLength` 继续表示上下文总长度或模型上下文容量。
- `maxTokens` 不建议改字段名，避免破坏已有配置兼容性；只需要在 UI 和内部注释上明确它是输出 token 上限。
- 后续如果要彻底重命名，可新增 `maxOutputTokens` 字段并做配置迁移，但当前阶段不建议做破坏性迁移。
