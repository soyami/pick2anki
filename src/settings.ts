// ============ 在线词典（有道 / 柯林斯英汉双解官网 / 牛津高阶 / 必应 / 剑桥） ============
export type OnlineDictSource = "youdao" | "collins" | "oxford" | "bing" | "cambridge";

export const ONLINE_DICT_SOURCES: OnlineDictSource[] = ["youdao", "collins", "oxford", "bing", "cambridge"];

export const ONLINE_DICT_NAMES: Record<OnlineDictSource, string> = {
  youdao: "有道词典（含柯林斯英汉双解）",
  collins: "柯林斯英汉双解官网",
  oxford: "牛津高阶学习者词典",
  bing: "必应词典（英汉）",
  cambridge: "剑桥词典（英英）",
};

// ============ Anki 卡片内容源（固定列表；每个内容源由用户填入自己模板中的字段名） ============
export type AnkiFieldSource =
  | "word"        // 单词/词组
  | "context"     // 原句笔记（当前笔记中含该词的句子）
  | "phonetic"    // 发音音标
  | "def_single"  // 单一释义（简明）
  | "def_all"     // 全部释义
  | "examples"    // 例句
  | "extra"       // 额外信息（词形/搭配/考试标签）
  | "audio"       // 音频文件（存入 Anki 媒体库）
  | "source";     // 来源地址（词典链接 + 笔记链接）

export const ANKI_FIELD_SOURCES: AnkiFieldSource[] = [
  "word", "context", "phonetic", "def_single", "def_all",
  "examples", "extra", "audio", "source",
];

export const ANKI_SOURCE_LABELS: Record<AnkiFieldSource, string> = {
  word: "单词/词组",
  context: "原句笔记",
  phonetic: "发音音标",
  def_single: "单一释义",
  def_all: "全部释义",
  examples: "例句",
  extra: "额外信息",
  audio: "音频文件",
  source: "来源地址",
};

/** 每个内容源在设置里的输入占位提示（根据模板习惯自填字段名） */
export const ANKI_SOURCE_PLACEHOLDERS: Record<AnkiFieldSource, string> = {
  word: "如 Word / 单词",
  context: "如 Sentence / 原句",
  phonetic: "如 Phonetic / 音标",
  def_single: "如 Meaning / 释义",
  def_all: "如 Details / 详解",
  examples: "如 Example / 例句",
  extra: "如 Extra / 补充",
  audio: "如 Sound / 音频",
  source: "如 Source / 来源",
};

// ============ 插件设置（仅保留：划词在线词典 + Anki 写卡） ============
export interface Pick2ankiSettings {
  // 触发
  triggerMode: "direct" | "ctrl";
  triggerDebounce: number;
  // 在线词典
  onlineDictSources: OnlineDictSource[];
  // Anki（AnkiConnect）
  ankiEnabled: boolean;
  ankiConnectUrl: string;
  ankiDeck: string;
  ankiNoteType: string;
  // 固定映射：内容源 -> 用户自己模板里的字段名（留空 = 不写入该内容）
  ankiFieldMap: Partial<Record<AnkiFieldSource, string>>;
  ankiAutoAdd: boolean;       // 查词完成后自动写卡
  ankiDup: "skip" | "add";    // 重复卡片处理
  ankiDupScope: "deck" | "model";
  ankiTags: string;           // 逗号分隔的标签
}

export const DEFAULT_SETTINGS: Pick2ankiSettings = {
  triggerMode: "direct",
  triggerDebounce: 500,
  onlineDictSources: ["youdao", "bing", "cambridge", "collins", "oxford"],
  ankiEnabled: false,
  ankiConnectUrl: "http://127.0.0.1:8765",
  ankiDeck: "",
  ankiNoteType: "",
  ankiFieldMap: {},
  ankiAutoAdd: false,
  ankiDup: "skip",
  ankiDupScope: "deck",
  ankiTags: "pick2anki",
};
