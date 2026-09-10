// ============ 弹窗释义渲染器（参照柯林斯卡片样板美化） ============
// 纯 DOM 节点渲染（不解析任何 HTML 字符串）：词性=蓝色徽章、英/中释义分色、
// 例句=浅蓝底方块列表，例句中的查询词用 <b> 加粗。样式类见 styles.css。
import type { DictDefinition, DictLookupBundle, DictResult } from "./dict-types";
import { posPretty } from "./dict-utils";

function hasCjk(s: string): boolean {
  return /[\u4e00-\u9fff]/.test(s);
}

/** 把文本分段塞入 parent：命中 word（含常见屈折变化）的片段加粗（大小写不敏感） */
function fillHighlighted(parent: HTMLElement, text: string, word: string): void {
  if (!word) {
    parent.appendChild(document.createTextNode(text));
    return;
  }
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b(${esc})(?:s|es|ed|ing|d)?\\b`, "gi");
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
    parent.createEl("b", { text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
}

function addSentenceList(wrap: HTMLElement, sentences: Array<{ en?: string; zh?: string }>, word: string): void {
  const ul = wrap.createEl("ul", { cls: "p2a-sents" });
  for (const s of sentences) {
    const li = ul.createEl("li", { cls: "p2a-sent" });
    if (s.en) {
      const en = li.createSpan({ cls: "p2a-eng-sent" });
      fillHighlighted(en, s.en, word);
    }
    if (s.zh) li.createSpan({ cls: "p2a-chn-sent", text: s.zh });
  }
}

function renderDefinition(container: HTMLElement, def: DictDefinition, word: string): void {
  const row = container.createDiv({ cls: "p2a-def" });
  if (def.pos) row.createSpan({ cls: "p2a-pos", text: posPretty(def.pos).toLowerCase() });
  const tran = row.createSpan({ cls: "p2a-tran" });
  // 英汉双解/英英：meaning 为英文 → eng_tran；纯中文源（meaning 即中文）→ chn_tran
  const zh = def.zh || "";
  const meaning = def.meaning || "";
  if (zh) {
    if (meaning && !hasCjk(meaning)) {
      const eng = tran.createSpan({ cls: "p2a-eng-tran" });
      fillHighlighted(eng, meaning, word);
    } else if (meaning) {
      // 中英混排释义（如有道聚合长串）：整段按中文色展示
      tran.createSpan({ cls: "p2a-chn-tran", text: meaning });
    }
    tran.createSpan({ cls: "p2a-chn-tran", text: zh });
  } else if (meaning) {
    const eng = tran.createSpan({ cls: "p2a-eng-tran" });
    fillHighlighted(eng, meaning, word);
  }
  // 例句紧跟对应释义
  const sentences: Array<{ en?: string; zh?: string }> = [];
  if (def.example) sentences.push({ en: def.example, zh: def.exampleZh });
  if (sentences.length) addSentenceList(row, sentences, word);
}

/** 把查词结果渲染进 popup 内容容器（只渲染“排序最前且可用 maxSources 个源”） */
export function renderBundleInto(container: HTMLElement, bundle: DictLookupBundle, maxSources = 2): void {
  const okSources = bundle.sources.filter((s) => s.ok && !!s.result);
  const shown = okSources.slice(0, Math.max(1, maxSources));
  if (shown.length === 0) {
    container.createSpan({ text: "在线词典未查询到结果" });
    return;
  }
  for (const src of shown) {
    const r = src.result as DictResult;
    const section = container.createDiv({ cls: "p2a-dict-src" });

    const head = section.createDiv({ cls: "p2a-dict-head" });
    head.createSpan({ cls: "p2a-src-badge", text: src.name });
    if (src.url) head.createSpan({ cls: "p2a-src-url", text: src.url });
    if (r.phonetic) section.createDiv({ cls: "p2a-phon", text: `音标 ${r.phonetic}` });

    // 释义：例句已跟随各自释义
    for (const def of r.definitions) renderDefinition(section, def, r.word);

    // 释义未涵盖的额外例句
    const used = new Set<string>();
    r.definitions.forEach((d) => { if (d.example) used.add(d.example.trim().toLowerCase()); });
    const rest = (r.examples || []).filter((ex) => !ex.en || !used.has(ex.en.trim().toLowerCase()));
    if (rest.length) {
      const label = section.createDiv({ cls: "p2a-more", text: "更多例句" });
      addSentenceList(label.parentElement ?? section, rest, r.word);
    }
    // 附加信息（词形/搭配等）
    for (const extra of (r.extras || []).slice(0, 3)) section.createDiv({ cls: "p2a-extra", text: extra });
  }
  const hidden = okSources.length - shown.length;
  if (hidden > 0) {
    const names = okSources.slice(shown.length).map((s) => s.name);
    container.createDiv({ cls: "p2a-more", text: `…（另有 ${names.join("、")} 收录该词，弹窗未展开）` });
  }
}
