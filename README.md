# Pick2anki

> Obsidian 划词词典插件：选中英文单词/短语 → 多源在线词典聚合释义 → 一键写入 Anki 生词卡。无需任何 AI / 翻译 API Key。

Pick2anki 为一条工作流设计：在 Obsidian 里读英文资料 → 遇到生词划一下 → 释义进卡片 → 碎片时间用 Anki 复习。查词与制卡都在当前笔记的上下文里完成，原句随词一起进卡。

---

## 功能

| 功能 | 说明 |
|------|------|
| **多源词典聚合** | 划选英文单词/短语即弹出聚合释义，内置 5 个词典源：有道（含柯林斯英汉双解授权数据）、柯林斯英汉双解官网、牛津高阶学习者词典、必应（英汉）、剑桥。源可启停、可排序；弹窗只完整展开排在最前且可用的 2 个源，避免刷屏 |
| **Anki 一键写卡** | 通过 AnkiConnect 直连本地 Anki（默认 `127.0.0.1:8765`），无需额外插件。写入指定牌组与笔记类型，弹窗按钮实时反馈：写入中 → 成功 / 已存在 |
| **内置推荐模板** | 自带与插件内容源一一对应的 Anki 笔记类型，支持一键创建（AnkiConnect `createModel`，无需手动搭模板），也提供 `.apkg` 供手动导入 |
| **字段映射（固定内容 → 你的模板）** | 插件固定提供 9 种内容：单词/词组、原句笔记、发音音标、单一释义、全部释义、例句、额外信息、音频文件、来源地址。读取你笔记类型的字段后，用下拉把每个内容指到你模板的字段；留空 = 不写入。同一字段被多个内容指向时自动合并 |
| **发音** | 词典真人发音优先（英/美），失败自动用 Edge TTS 合成；音频经 AnkiConnect 存入 Anki 媒体库（`[sound:…]`），离线可播 |
| **语境与来源** | 自动截取当前笔记中含该词的原句；来源字段写入命中的词典链接与笔记链接，可溯源 |
| **轻量精简** | 无 AI / 长句翻译依赖、无缓存、无外部服务、无任何 API Key |

> 只处理英文单词/短语：中文、整段文字、超过 5 个词或 60 字符的选区不会触发查词。

## 安装

1. 从 Releases 下载 `main.js`、`manifest.json`、`styles.css`
2. 放入 `<vault>/.obsidian/plugins/pick-to-anki/`
3. 重启 Obsidian → 设置 → 第三方插件 → 启用 Pick2anki

## 使用

### 1. 划词查词

在笔记中划选英文单词/短语，弹窗显示多源聚合释义。默认直接划选触发；可在设置中改为 `Ctrl+划选` 触发，或调整防抖时间。

设置 →「在线词典」可调整词典顺序与启停，点"试查"验证网络连通。

> 注意：柯林斯/牛津/剑桥等官网存在反爬或改版，失败时插件会自动跳过该源并继续其它源。有道、必应最稳定，普通词建议以有道为主（含柯林斯英汉双解授权数据），生僻/技术词有道覆盖也最广。

### 2. 写入 Anki

前置：安装 Anki 桌面版并启用 AnkiConnect 插件（Anki → 工具 → 插件 → 获取插件，代码 `2055492159`）。

设置 →「Anki」：

1. 启用开关 →「测试连接并读取」获取牌组/笔记类型
2. 点「创建推荐模板」一键生成推荐笔记类型（见下一节；也可以跳过，用你自己的模板）
3. 选择目标牌组（子牌组用 `::` 分隔）与笔记类型（切换时会自动读取其字段）
4. 字段映射：为每个内容选择你模板中的字段（例如 `单词/词组 → Word`、`原句笔记 → Context`、`发音音标 → Phonetic`、`全部释义 → AllDefs`、`音频文件 → Audio`、`来源地址 → Source`），留空 = 该内容不写入；创建推荐模板后会自动套用默认映射
5. 可选：开启「查词后自动写卡」；设置重复卡片处理（跳过 / 仍然添加）、查重范围（牌组 / 整个笔记类型）、卡片标签

之后划词查词 → 弹窗点「加入 Anki」（或命令面板执行「将选中文本加入 Anki」）。

### 3. 推荐的 Anki 模板

两种获取方式，任选其一：

- **一键创建**（推荐）：设置 →「Anki」→ 点「创建推荐模板」。插件通过 AnkiConnect 直接在你的 Anki 里生成笔记类型，无需下载任何文件
- **手动导入**：下载 `assets/Pick2anki-Anki模板.apkg`，双击导入 Anki（内含一张示例卡，导入后可删除）

推荐的笔记类型名为 **Pick2anki**，9 个字段与插件的 9 种内容一一对应：

- `Word` — 单词/词组（正面大字）
- `Context` — 原句笔记（正面引号内的句子）
- `Phonetic` — 发音音标（背面发音按钮旁）
- `AllDefs` — 全部释义（背面主区域）
- `SingleDef` — 单一释义（背面备用区）
- `Examples` — 例句（背面 Examples 区）
- `Extra` — 额外信息（背面 Extra 区）
- `Audio` — 音频文件（背面发音按钮位，存入 Anki 媒体库）
- `Source` — 来源地址（背面右下角小字）

两条使用规则：

1. 「单一释义」和「全部释义」二选一即可：模板逻辑是 `AllDefs` 有内容时优先显示，为空才回退到 `SingleDef`。默认建议只映射「全部释义 → AllDefs」，想要精简卡的人反过来只映射 `SingleDef`
2. 留空 = 不写入：不想让卡片带来源链接，把「来源地址」留空即可，无需改动模板

> 提示：AnkiConnect 只能创建、不能覆盖笔记类型。若 Anki 里已存在同名 `Pick2anki` 模板，创建会被跳过（插件会提示并直接套用字段映射）。想换新模板请先在 Anki 里删除旧模板。

## 架构（给开发者）

查词层按适配器模式拆分，一个词典源一个文件：

```
src/
├── main.ts              # 插件入口、命令、划词/弹窗
├── settings.ts          # 设置项与词典源/内容源常量
├── dict-types.ts        # 统一规范：DictResult / DictDefinition / DictAdapter
├── online-dict.ts       # 适配器注册表：并发查词、聚合、渲染、Anki 字段提取
├── youdao-dict.ts       # 有道（含 collins_primary 柯林斯双解解析）
├── collins-dict.ts      # 柯林斯英汉双解官网
├── oxford-dict.ts       # 牛津高阶学习者词典（英英）
├── bing-dict.ts         # 必应词典（英汉）
├── cambridge-dict.ts    # 剑桥词典
├── edge-tts.ts          # Edge TTS 合成兜底发音
├── anki.ts              # AnkiConnect 客户端：牌组/字段读取、音频上传、写卡
├── dict-html.ts / dict-render.ts / dict-utils.ts
└── ...
```

所有源都输出同一结构（见 `src/dict-types.ts`），渲染、写卡、排序只依赖该规范：

```ts
interface DictDefinition {
  pos?: string; meaning: string; zh?: string;
  example?: string; exampleZh?: string;
}
interface DictResult {
  word: string; phonetic?: string;
  audioUrl?: string | { uk?: string; us?: string };
  definitions: DictDefinition[];      // 至少一条，否则适配器返回 null 走兜底
  examples?: { en: string; zh?: string }[];
  source: string; sourceUrl?: string;
  extras?: string[]; raw?: unknown;
}
```

接入新词典源：实现一个 `DictAdapter`（`lookup()` 抓取并返回 `DictResult`，查无/失败返回 `null`），在 `online-dict.ts` 的 `DICT_ADAPTERS` 追加一项，设置页即自动出现：

```ts
import type { DictAdapter } from "./dict-types";
export const myAdapter: DictAdapter = {
  id: "mySource", name: "我的词典",
  sourceUrlFor: (w) => `https://example.com/${w}`,
  async lookup(word) { /* 抓取 → DictResult；失败返回 null */ },
};
```

## 开发

```bash
npm install          # 安装依赖
npm run build        # tsc 类型检查 + esbuild 打包 → main.js
npx eslint src       # lint
```

Tech Stack: TypeScript · esbuild · Obsidian API (`requestUrl` / DOM) · AnkiConnect (JSON-RPC over HTTP) · Edge TTS (WebSocket)

## License

MIT © soyami

致谢：

- `edge-tts.ts` 与部分样式改编自 [wjzixi/kuaifanyi](https://github.com/wjzixi/kuaifanyi)（MIT，Copyright © 2026 BOSS）
- 交互与界面设计参考 [ninja33/ODH (Online Dictionary Helper)](https://github.com/ninja33/ODH)（MIT，Copyright (c) 2018 Zhenyu Huang）
