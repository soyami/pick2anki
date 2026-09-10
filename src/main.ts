import {
  Plugin, MarkdownView, Notice, PluginSettingTab, Setting,
} from "obsidian";
import type { Pick2ankiSettings } from "./settings";
import { DEFAULT_SETTINGS } from "./settings";
import type { AnkiFieldSource, OnlineDictSource } from "./settings";
import {
  ANKI_FIELD_SOURCES, ANKI_SOURCE_LABELS,
  ONLINE_DICT_SOURCES, ONLINE_DICT_NAMES,
} from "./settings";
import type { DictLookupBundle } from "./online-dict";
import { canUseOnlineDict, dictHasContent, lookupWordOnline } from "./online-dict";
import { renderBundleInto } from "./dict-render";
import type { CardInput } from "./anki";
import { addWordCard, ankiVersion, fetchAnkiDecks, fetchAnkiModels, fetchAnkiModelFields } from "./anki";

/** 固定内容源在设置页的补充说明 */
const ANKI_SOURCE_DESC: Record<AnkiFieldSource, string> = {
  word: "填入的内容：所查的单词/词组",
  context: "当前笔记中包含该词的原句 + 笔记名（找不到原句时用词典例句）",
  phonetic: "英/美 IPA 发音音标",
  def_single: "首个简明释义，并内嵌该释义自己的例句",
  def_all: "启用词典的完整释义列表，每条释义均内嵌它自己的例句",
  examples: "例句已内嵌在释义下方，通常无需单独映射；若想单独汇总一栏例句可在此选择字段",
  extra: "词形变化 / 常用搭配 / 考试范围标签",
  audio: "自动获取发音并导入 Anki 媒体库（词典发音优先，Edge 补充）",
  source: "各词典的网页链接 + 当前笔记的 obsidian 链接",
};

export default class Pick2ankiPlugin extends Plugin {
  settings!: Pick2ankiSettings;
  private timer: number | null = null;
  private popup: HTMLElement | null = null;
  private dictEl: HTMLElement | null = null;
  private popupRange: Range | null = null;
  private popupMoved = false;
  private followFrame: number | null = null;
  private streamSeq = 0; // 查词序号，用于竞态中止
  // Anki / 上下文状态
  private lastDictBundle: DictLookupBundle | null = null;
  private lastCardWord = "";
  private lastCardNote: { name: string; uri?: string; path?: string } | null = null;
  private lastContextSentence = "";
  private ankiAdding = false;
  ankiDecks: string[] = [];
  ankiModels: string[] = [];
  ankiError = "";
  private ankiMetaUrl = "";
  // 当前目标模板的字段（供设置页字段映射下拉）
  ankiTemplateFields: string[] = [];
  ankiFieldsModel = "";
  // 弹窗内 Anki 按钮（动态状态：➕ / ✔ / ↺）
  private ankiBtn: HTMLElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new Pick2ankiSettingTab(this.app, this));

    const onScroll = () => {
      if (this.popup && !this.popupMoved) this.repositionPopup();
    };
    this.registerDomEvent(document, "scroll", onScroll, { capture: true });
    this.registerDomEvent(document, "wheel", onScroll, { capture: true });

    this.registerDomEvent(document, "mouseup", (evt: MouseEvent) => {
      if (this.timer) window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.onSelection(evt), this.settings.triggerDebounce);
    });

    this.registerDomEvent(document, "mousedown", (evt: MouseEvent) => {
      if (this.popup && !(evt.target as HTMLElement).closest(".p2a-popup")) this.hidePopup();
    });

    this.addCommand({
      id: "add-selection-to-anki", name: "将选中单词/短语加入 Anki",
      editorCallback: (editor) => {
        const t = editor.getSelection().trim();
        if (t) void this.addSelectionToAnki(t);
      },
    });
  }

  onunload(): void {
    this.hidePopup();
  }

  // ---- 划词触发 ----
  private onSelection(evt: MouseEvent): void {
    if (this.settings.triggerMode === "ctrl" && !evt.ctrlKey) return;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return;
    if (!view.contentEl.contains(evt.target as Node)) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;
    const text = selection.toString().trim();
    if (!canUseOnlineDict(text)) return;

    const range = selection.getRangeAt(0).cloneRange();
    // 记录上下文（原句/来源字段用）
    this.lastCardWord = text;
    this.lastDictBundle = null;
    const ctx = this.captureContext(text);
    this.lastCardNote = ctx ? { name: ctx.noteName, uri: ctx.noteUri, path: ctx.notePath } : null;
    this.lastContextSentence = ctx?.sentence ?? "";

    this.showPopup(range);
    void this.lookup(text);
  }

  /** 在线词典查词：多源并行，任一失败仅该源失败，全部失败时弹窗给出说明 */
  private async lookup(text: string): Promise<void> {
    const seq = ++this.streamSeq;
    if (this.dictEl) this.dictEl.textContent = "查询中…";
    const sources = this.settings.onlineDictSources || [];
    if (sources.length === 0) {
      if (this.dictEl) this.dictEl.textContent = "未启用任何词典源，请在设置 → 在线词典查词中勾选";
      return;
    }
    const bundle = await lookupWordOnline(text, sources);
    if (seq !== this.streamSeq) return;
    const has = dictHasContent(bundle);
    this.lastDictBundle = has ? bundle : null;
    if (this.dictEl) {
      this.dictEl.empty();
      renderBundleInto(this.dictEl, bundle);
      this.dictEl.scrollTop = this.dictEl.scrollHeight;
    }
    // 可选自动写卡
    if (has && this.settings.ankiEnabled && this.settings.ankiAutoAdd && this.lastCardWord === text) {
      await this.addSelectionToAnki(text);
    }
  }

  /** 把查到的词写入 Anki；弹窗按钮会动态显示 ➕/✔/↺，成功不再弹 Notice */
  private async addSelectionToAnki(text: string): Promise<void> {
    if (this.ankiAdding) return;
    const word = text.trim();
    if (!word) { new Notice("请先选中一个单词/短语"); return; }
    if (!canUseOnlineDict(word)) { new Notice("仅英文单词/短语可写入 Anki 卡片"); return; }
    if (!this.settings.ankiEnabled) { new Notice("Anki 写卡未启用：设置 → 写入 Anki 单词卡"); return; }
    if (!this.settings.ankiDeck || !this.settings.ankiNoteType) {
      new Notice("请先在设置中配置目标牌组与模板"); return;
    }
    if ((this.settings.onlineDictSources || []).length === 0) {
      new Notice("未启用任何词典源：设置 → 在线词典查词"); return;
    }
    this.ankiAdding = true;
    if (this.ankiBtn) this.setAnkiButton("busy");
    try {
      const sameWord = this.lastCardWord === word;
      let bundle = sameWord ? this.lastDictBundle : null;
      if (!bundle) {
        const b = await lookupWordOnline(word, this.settings.onlineDictSources);
        bundle = dictHasContent(b) ? b : null;
        if (sameWord) this.lastDictBundle = bundle;
      }
      if (!bundle) {
        this.setAnkiButton("err");
        new Notice(`词典未查到「${word}」的释义，未写入卡片（可检查网络或更换词典源）`, 6000);
        return;
      }
      const input: CardInput = {
        word,
        contextSentence: sameWord ? this.lastContextSentence : undefined,
        note: sameWord ? (this.lastCardNote ?? undefined) : this.captureNoteRef(word),
        bundle,
      };
      const res = await addWordCard(this.settings, input);
      if (!res.ok) {
        this.setAnkiButton("err");
        new Notice("Anki 写入失败：" + res.message, 8000);
      } else if (res.skipped) {
        // 按钮已给出“已存在”状态；非按钮场景（如命令）仍用 Notice 提示
        this.setAnkiButton("dup");
        if (!this.ankiBtn) new Notice(res.message);
      } else if (res.added) {
        this.setAnkiButton("ok");
        // 成功不再弹“已写入…”提示，按钮变为 ✔ 即反馈
        if (!this.ankiBtn) new Notice(res.message, 4000);
      }
    } catch (e) {
      this.setAnkiButton("err");
      new Notice("Anki 写入失败：" + (e instanceof Error ? e.message : String(e)), 8000);
    } finally {
      this.ankiAdding = false;
    }
  }

  // ---- 弹窗 ----
  private showPopup(range: Range): void {
    this.popupRange = range;
    this.popupMoved = false;
    this.removePopupDom();
    ++this.streamSeq; // 中止旧查询渲染

    this.popup = this.app.workspace.containerEl.createDiv("p2a-popup");
    const pos = this.computePosition(range);
    this.popup.style.top = `${pos.top}px`;
    this.popup.style.left = `${pos.left}px`;
    this.startFollow();

    const d = this.popup.createDiv("p2a-section");
    const hdr = d.createDiv("p2a-section-hdr");
    const label = hdr.createDiv("p2a-label");
    label.textContent = "📖 在线词典";
    this.makeDraggable(label);
    this.dictEl = d.createDiv("p2a-text");
    this.dictEl.textContent = "查询中…";

    if (this.settings.ankiEnabled) {
      const btnRow = this.popup.createDiv("p2a-btn-row");
      const b = btnRow.createEl("button", { text: "➕ Anki", cls: "p2a-anki" });
      this.ankiBtn = b;
      b.onclick = () => { void this.addSelectionToAnki(this.lastCardWord || ""); };
    }
  }

  private hidePopup(): void {
    this.popupRange = null;
    this.removePopupDom();
  }

  private removePopupDom(): void {
    if (this.popup) { this.popup.remove(); this.popup = null; }
    this.ankiBtn = null;
    this.dictEl = null;
    if (this.followFrame !== null) { window.cancelAnimationFrame(this.followFrame); this.followFrame = null; }
  }

  private computePosition(range: Range): { top: number; left: number } {
    const ws = this.app.workspace.containerEl;
    const wsRect = ws.getBoundingClientRect();
    let rect: DOMRect;
    try { rect = range.getBoundingClientRect(); }
    catch { return { top: 100, left: 100 }; }

    if (rect.width === 0 && rect.height === 0) {
      return this.popup ? { top: this.popup.offsetTop, left: this.popup.offsetLeft } : { top: 100, left: 100 };
    }

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const contentTop = view
      ? Math.max(wsRect.top, (view.contentEl.getBoundingClientRect?.().top ?? 0))
      : wsRect.top;

    const popupH = this.popup?.offsetHeight || 220;
    if (this.popup) {
      this.popup.style.maxHeight = popupH > wsRect.height - 16 ? `${wsRect.height - 16}px` : "";
    }

    let top = rect.bottom - wsRect.top + 8;
    if (top + popupH > wsRect.height - 8) {
      top = Math.max(contentTop - wsRect.top, wsRect.height - popupH - 8);
    }
    top = Math.max(contentTop - wsRect.top + 4, top);

    const left = rect.left - wsRect.left;
    return {
      top,
      left: Math.max(8, Math.min(left, wsRect.width - 480)),
    };
  }

  private repositionPopup(): void {
    if (!this.popup || !this.popupRange) return;
    const pos = this.computePosition(this.popupRange);
    this.popup.style.top = `${pos.top}px`;
    this.popup.style.left = `${pos.left}px`;
  }

  private startFollow(): void {
    if (this.followFrame !== null) window.cancelAnimationFrame(this.followFrame);
    const loop = () => {
      if (!this.popup) { this.followFrame = null; return; }
      if (!this.popupMoved) this.repositionPopup();
      this.followFrame = window.requestAnimationFrame(loop);
    };
    this.followFrame = window.requestAnimationFrame(loop);
  }

  private makeDraggable(handle: HTMLElement): void {
    handle.addClass("p2a-drag-handle");
    const onDown = (e: MouseEvent) => {
      if (!this.popup) return;
      this.popupMoved = true;
      const startX = e.clientX, startY = e.clientY;
      const startLeft = this.popup.offsetLeft, startTop = this.popup.offsetTop;
      const onMove = (ev: MouseEvent) => {
        if (!this.popup) return;
        this.popup.style.left = `${startLeft + ev.clientX - startX}px`;
        this.popup.style.top = `${startTop + ev.clientY - startY}px`;
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove, true);
        document.removeEventListener("mouseup", onUp, true);
      };
      document.addEventListener("mousemove", onMove, true);
      document.addEventListener("mouseup", onUp, true);
      e.preventDefault();
      e.stopPropagation();
    };
    this.registerDomEvent(handle, "mousedown", onDown);
  }

  // ---- 原句/笔记上下文（Anki 原句、来源字段） ----
  private captureContext(text: string): { sentence: string; noteName: string; notePath: string; noteUri: string } | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file) return null;
    const file = view.file;
    const full = view.editor?.getValue() ?? "";
    const sentence = extractSentenceAround(full, text);
    const vault = encodeURIComponent(this.app.vault.getName());
    const noteUri = `obsidian://open?vault=${vault}&file=${encodeURIComponent(file.path)}`;
    return { sentence, noteName: file.basename, notePath: file.path, noteUri };
  }

  private captureNoteRef(text: string): { name: string; uri?: string } | undefined {
    const ctx = this.captureContext(text);
    if (!ctx) return undefined;
    return { name: ctx.noteName, uri: ctx.noteUri };
  }

  /** 拉取 Anki 牌组/模板元数据（设置页共用） */
  async refreshAnkiMeta(force = false): Promise<void> {
    const s = this.settings;
    if (!s.ankiConnectUrl) return;
    if (!force && this.ankiMetaUrl === s.ankiConnectUrl && (this.ankiDecks.length > 0 || this.ankiModels.length > 0)) return;
    this.ankiMetaUrl = s.ankiConnectUrl;
    this.ankiError = "";
    try {
      await ankiVersion(s.ankiConnectUrl);
      const [decks, models] = await Promise.all([fetchAnkiDecks(s), fetchAnkiModels(s)]);
      this.ankiDecks = decks;
      this.ankiModels = models;
    } catch (e) {
      this.ankiError = e instanceof Error ? e.message : String(e);
      this.ankiDecks = [];
      this.ankiModels = [];
    }
  }

  /** 读取指定模板的字段列表（供字段映射下拉用）；失败时置空并返回错误信息 */
  async loadAnkiTemplateFields(model: string): Promise<string> {
    this.ankiFieldsModel = model;
    this.ankiTemplateFields = [];
    if (!model || !this.settings.ankiConnectUrl) return "";
    try {
      this.ankiTemplateFields = await fetchAnkiModelFields(this.settings, model);
      return "";
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }

  /** 弹窗 Anki 按钮状态：busy=… / ok=✔ / dup=↺ / err 及 idle 回 ➕ */
  private setAnkiButton(state: "busy" | "ok" | "dup" | "err"): void {
    if (!this.ankiBtn) return;
    this.ankiBtn.removeClass("p2a-anki-ok");
    this.ankiBtn.removeClass("p2a-anki-dup");
    this.ankiBtn.removeClass("p2a-anki-err");
    if (state === "busy") {
      this.ankiBtn.textContent = "⏳ Anki…";
      this.ankiBtn.addClass("p2a-anki-err");
      (this.ankiBtn as HTMLButtonElement).disabled = true;
    } else {
      (this.ankiBtn as HTMLButtonElement).disabled = false;
      if (state === "ok") {
        this.ankiBtn.textContent = "✔ Anki";
        this.ankiBtn.addClass("p2a-anki-ok");
      } else if (state === "dup") {
        this.ankiBtn.textContent = "↺ 已有";
        this.ankiBtn.addClass("p2a-anki-dup");
      } else {
        this.ankiBtn.textContent = "➕ Anki";
        this.ankiBtn.addClass("p2a-anki-err");
      }
    }
  }

  // ---- 设置持久化 ----
  async loadSettings(): Promise<void> {
    const stored = (await this.loadData()) as Partial<Pick2ankiSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
    if (!Array.isArray(this.settings.onlineDictSources) || this.settings.onlineDictSources.length === 0) {
      this.settings.onlineDictSources = [...DEFAULT_SETTINGS.onlineDictSources];
    }
    let dirty = false;
    // 内容源 → 模板字段名
    const rawMap = this.settings.ankiFieldMap as unknown;
    if (rawMap && typeof rawMap === "object" && !Array.isArray(rawMap)) {
      const entries = Object.entries(rawMap as Record<string, unknown>);
      const looksLegacy = entries.some(([, v]) => typeof v === "string" && (ANKI_FIELD_SOURCES as string[]).includes(v));
      if (looksLegacy) {
        const next: Partial<Record<AnkiFieldSource, string>> = {};
        for (const [field, v] of entries) {
          if (typeof v === "string" && (ANKI_FIELD_SOURCES as string[]).includes(v) && !next[v as AnkiFieldSource]) {
            next[v as AnkiFieldSource] = field;
          }
        }
        this.settings.ankiFieldMap = next;
        dirty = true;
      }
    }
    const legacyKeys = [
      "apiProvider", "apiKey", "providerKeys", "customApiUrl", "customModel", "translateModel",
      "chunkSize", "autoTranslate", "autoExplain", "autoRead", "explainModel", "ttsEngine",
      "ttsVoice", "ttsRate", "ttsPitch", "volcanoAppId", "volcanoToken", "volcanoVoiceTrans",
      "volcanoVoiceExpl", "volcanoVoiceStyle", "volcanoCloneVoice", "volcanoAccessKeyId",
      "volcanoSecretAccessKey", "aliyunAccessKeyId", "aliyunSecretAccessKey", "ttsCacheEnabled",
      "ttsCacheDir", "dictProvider", "baiduAppId", "baiduKey", "youdaoAppId", "youdaoKey",
      "targetLang", "explainLang", "onlineDictEnabled",
    ];
    const anySettings = this.settings as unknown as Record<string, unknown>;
    for (const k of legacyKeys) {
      if (k in anySettings) { delete anySettings[k]; dirty = true; }
    }
    if (dirty) await this.saveSettings();
  }

  async saveSettings(): Promise<void> { await this.saveData(this.settings); }
}

// ========== 从笔记全文提取包含目标文本的原句（供 Anki 原句笔记字段） ==========
function extractSentenceAround(doc: string, term: string): string {
  if (!doc || !term) return "";
  const searchDoc = doc.includes(term) ? doc : doc.replace(/[*_`#~|>\\]/g, "");
  const idx = searchDoc.indexOf(term);
  if (idx === -1 || !searchDoc) return "";
  const sentences = searchDoc.split(/(?<=[。！？!?；;])|\n+/).map((s) => s.trim()).filter(Boolean);
  let best = "";
  for (const s of sentences) {
    if (s.includes(term) && (!best || s.length < best.length)) best = s;
  }
  if (!best) {
    const lineStart = searchDoc.lastIndexOf("\n", idx) + 1;
    const lineEnd = searchDoc.indexOf("\n", idx);
    best = searchDoc.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim();
  }
  if (!best) return "";
  if (best.length > 220) {
    const rel = Math.max(0, best.indexOf(term));
    const half = 100;
    const s2 = Math.max(0, rel - half);
    const pre = s2 > 0 ? "…" : "";
    best = pre + best.slice(s2, s2 + 220) + (s2 + 220 < best.length ? "…" : "");
  }
  return best.replace(/\s+/g, " ").trim();
}

// ========== 设置面板 ==========
class Pick2ankiSettingTab extends PluginSettingTab {
  plugin: Pick2ankiPlugin;
  private fieldsLoading = false;

  constructor(app: import("obsidian").App, plugin: Pick2ankiPlugin) { super(app, plugin); this.plugin = plugin; }

  getSettingDefinitions(): ReturnType<PluginSettingTab["getSettingDefinitions"]> {
    return [];
  }

  /** Obsidian 生命周期入口：打开设置页时由宿主调用 */
  display(): void {
    this.render();
  }

  private render(): void {
    const { containerEl } = this;
    const p = this.plugin;
    containerEl.empty();
    new Setting(containerEl).setHeading().setName("Pick2anki - 设置");

    // ---- 在线词典 ----
    new Setting(containerEl).setHeading().setName("📖 在线词典查词");
    new Setting(containerEl).setName("说明").setDesc("划选英文单词/短语即弹出多源词典释义。"
      + "部分官网受反爬影响失败时会自动跳过该源；弹窗只完整展示“排序最前且可用”的两个源的释义");
    const activeList: OnlineDictSource[] = [...(p.settings.onlineDictSources || [])];
    const disabledList = ONLINE_DICT_SOURCES.filter((s) => !activeList.includes(s));
    new Setting(containerEl).setName("顺序与启用").setDesc("直接拖动整行调整顺序（越靠上越优先，单一/全部释义与发音按此合并）；行尾开关可停用该源");
    const dragList = containerEl.createDiv({ cls: "p2a-src-list" });
    let dragSrcId: string | null = null;
    for (const src of activeList) {
      const row = dragList.createDiv({ cls: "p2a-src-row", attr: { draggable: "true" } });
      row.dataset.src = src;
      row.createSpan({ cls: "p2a-src-grip", text: "⠿" });
      row.createSpan({ cls: "p2a-src-name", text: ONLINE_DICT_NAMES[src] });
      // Obsidian 原生风格开关
      const label = row.createEl("label", { cls: "checkbox-container is-enabled" });
      const input = label.createEl("input", { attr: { type: "checkbox", checked: "" } });
      label.createDiv({ cls: "checkbox" });
      input.addEventListener("change", () => {
        p.settings.onlineDictSources = (p.settings.onlineDictSources || []).filter((x) => x !== src);
        void p.saveSettings().then(() => this.render());
      });
      row.addEventListener("dragstart", (e) => {
        dragSrcId = src;
        if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", src); }
        row.addClass("p2a-src-dragging");
      });
      row.addEventListener("dragend", () => {
        dragSrcId = null;
        row.removeClass("p2a-src-dragging");
        for (const el of Array.from(dragList.querySelectorAll(".p2a-src-row"))) (el as HTMLElement).removeClass("p2a-src-drag-over");
      });
      row.addEventListener("dragover", (e) => {
        if (!dragSrcId || dragSrcId === (row.dataset.src || "")) return;
        e.preventDefault();
        row.addClass("p2a-src-drag-over");
      });
      row.addEventListener("dragleave", () => row.removeClass("p2a-src-drag-over"));
      row.addEventListener("drop", (e) => {
        e.preventDefault();
        const fromId = dragSrcId;
        const toId = row.dataset.src || "";
        row.removeClass("p2a-src-drag-over");
        if (!fromId || fromId === toId) return;
        const list = [...(p.settings.onlineDictSources || [])];
        const fi = list.indexOf(fromId as OnlineDictSource);
        const ti = list.indexOf(toId as OnlineDictSource);
        if (fi >= 0 && ti >= 0 && fi !== ti) {
          list.splice(ti, 0, list.splice(fi, 1)[0]);
          p.settings.onlineDictSources = list;
          void p.saveSettings().then(() => this.render());
        }
      });
    }
    if (disabledList.length > 0) {
      new Setting(containerEl).setName("已停用词典").setDesc("重新启用会追加到列表末尾");
      for (const src of disabledList) {
        new Setting(containerEl).setName(ONLINE_DICT_NAMES[src])
          .addToggle((tg) => tg.setValue(false).onChange(async (v) => {
            if (v) {
              p.settings.onlineDictSources = [...(p.settings.onlineDictSources || []), src];
              await p.saveSettings();
              this.render();
            }
          }));
      }
    }
    new Setting(containerEl).setName("连通性自测").setDesc("用 hello 联网试查一次各词典源，确认网络可用")
      .addButton((btn) => btn.setButtonText("试查 hello").onClick(async () => {
        new Notice("在线词典测试中…");
        const b = await lookupWordOnline("hello", p.settings.onlineDictSources);
        const lines = b.sources.map((s) => `${s.name}：${s.ok ? "✅" : "❌ " + (s.error || "无结果")}`);
        new Notice(lines.join("\n"), 10000);
      }));

    // ---- Anki ----
    new Setting(containerEl).setHeading().setName("🗂 写入 Anki 单词卡");
    new Setting(containerEl).setName("启用 Anki 写卡")
      .setDesc("需要 Anki 桌面版并启用其本地桥接扩展（Anki 内：工具 → 插件，默认端口 8765）。启用后查词弹窗出现 ➕ Anki 按钮")
      .addToggle((tg) => tg.setValue(p.settings.ankiEnabled).onChange(async (v) => {
        p.settings.ankiEnabled = v;
        await p.saveSettings();
        this.render();
      }));
    if (p.settings.ankiEnabled) {
      new Setting(containerEl).setName("本地桥接地址")
        .setDesc("一般无需修改")
        .addText((t) => t.setPlaceholder("127.0.0.1:8765")
          .setValue(p.settings.ankiConnectUrl)
          .onChange(async (v) => {
            p.settings.ankiConnectUrl = v.trim() || "http://127.0.0.1:8765";
            p.ankiError = "";
            await p.saveSettings();
          }));
      new Setting(containerEl).setName("牌组 / 模板").setDesc(p.ankiDecks.length > 0
        ? `已连接：${p.ankiDecks.length} 个牌组、${p.ankiModels.length} 个模板`
        : "点击右侧按钮测试连接并读取牌组/模板列表")
        .addButton((btn) => btn.setButtonText("测试连接并读取").onClick(async () => {
          new Notice("正在连接 Anki…");
          await p.refreshAnkiMeta(true);
          if (p.ankiError) new Notice("连接失败：" + p.ankiError, 9000);
          else {
            new Notice(`✅ 已连接 Anki，读取到 ${p.ankiDecks.length} 个牌组、${p.ankiModels.length} 个模板`);
            if (!p.settings.ankiDeck && p.ankiDecks.length > 0) {
              p.settings.ankiDeck = p.ankiDecks[0];
              await p.saveSettings();
            }
            if (!p.settings.ankiNoteType && p.ankiModels.length > 0) {
              p.settings.ankiNoteType = p.ankiModels[0];
              await p.saveSettings();
            }
          }
          this.render();
        }));
      if (p.ankiError) {
        new Setting(containerEl).setName("连接状态").setDesc("⚠️ " + p.ankiError);
      }
      const decksAvail = p.ankiDecks || [];
      const chosenDeck = p.settings.ankiDeck && decksAvail.includes(p.settings.ankiDeck)
        ? p.settings.ankiDeck : (decksAvail[0] || "");
      if (decksAvail.length > 0) {
        new Setting(containerEl).setName("目标牌组")
          .setDesc("写入的牌组，子牌组用 :: 分隔（如 英语::核心词汇）。如列表中没有请先在 Anki 中创建")
          .addDropdown((dd) => {
            for (const d of decksAvail) dd.addOption(d, d);
            dd.setValue(chosenDeck).onChange(async (v) => {
              p.settings.ankiDeck = v;
              await p.saveSettings();
            });
          });
      } else {
        new Setting(containerEl).setName("目标牌组").setDesc("请先点击上方“测试连接并读取”");
      }
      const modelsAvail = p.ankiModels || [];
      const chosenModel = p.settings.ankiNoteType && modelsAvail.includes(p.settings.ankiNoteType)
        ? p.settings.ankiNoteType : (modelsAvail[0] || "");
      if (modelsAvail.length > 0) {
        new Setting(containerEl).setName("目标模板")
          .setDesc("Anki 中的笔记类型；切换后会读取该模板的字段用于下拉选择")
          .addDropdown((dd) => {
            for (const m of modelsAvail) dd.addOption(m, m);
            dd.setValue(chosenModel).onChange(async (v) => {
              p.settings.ankiNoteType = v;
              await p.saveSettings();
              const err = await p.loadAnkiTemplateFields(v);
              if (err) p.ankiError = err;
              this.render();
            });
          });
        new Setting(containerEl).setName("读取模板字段")
          .setDesc("随模板选择自动读取；此按钮可手动刷新。下方每个“内容”用下拉单选一个模板字段；留空 = 不写入")
          .addButton((btn) => btn.setButtonText("读取 / 刷新字段").onClick(async () => {
            const m = p.settings.ankiNoteType || chosenModel;
            if (!m) { new Notice("请先选择目标模板"); return; }
            const err = await p.loadAnkiTemplateFields(m);
            if (err) p.ankiError = err;
            this.render();
            if (err) new Notice("读取模板字段失败：" + err, 8000);
            else new Notice(`模板「${m}」共 ${p.ankiTemplateFields.length} 个字段：${p.ankiTemplateFields.join("、")}`, 9000);
          }));
      } else {
        new Setting(containerEl).setName("目标模板").setDesc("请先点击上方“测试连接并读取”");
      }

      // 固定映射：内容源 → 下拉单选模板字段（字段名按模板读取，省去手输）
      new Setting(containerEl).setHeading().setName("模板字段映射（固定）");
      const fieldsLoaded = chosenModel !== "" && p.ankiFieldsModel === chosenModel;
      new Setting(containerEl).setName("映射方式")
        .setDesc(fieldsLoaded
          ? `已读取模板「${p.ankiFieldsModel}」的字段，每个内容从下拉单选。同一字段可被多个内容共用，写卡时自动合并为多行（一般不推荐）`
          : "请先在上方选择目标模板并读取字段，再为每个“内容”选择要写入的模板字段");
      if (p.ankiTemplateFields.length > 0) {
        for (const src of ANKI_FIELD_SOURCES) {
          new Setting(containerEl).setName(ANKI_SOURCE_LABELS[src])
            .setDesc(ANKI_SOURCE_DESC[src])
            .addDropdown((dd) => {
              dd.addOption("", "（不填）");
              for (const f of p.ankiTemplateFields) dd.addOption(f, f);
              const cur = (p.settings.ankiFieldMap?.[src] || "").trim();
              if (cur && !p.ankiTemplateFields.includes(cur)) dd.addOption(cur, cur + "（当前模板无此字段）");
              dd.setValue(cur || "").onChange(async (v) => {
                if (!p.settings.ankiFieldMap) p.settings.ankiFieldMap = {};
                p.settings.ankiFieldMap[src] = v.trim();
                await p.saveSettings();
              });
            });
        }
      } else {
        new Setting(containerEl).setName("当前模板字段").setDesc("暂无可用字段（请先点击上方“读取 / 刷新字段”）");
      }
      // 自动读取当前目标模板的字段（只在字段缓存与所选模板不一致时触发一次，避免反复刷新）
      if (chosenModel && !this.fieldsLoading && p.ankiFieldsModel !== chosenModel) {
        this.fieldsLoading = true;
        void p.loadAnkiTemplateFields(chosenModel).then((err) => {
          this.fieldsLoading = false;
          if (err) p.ankiError = err;
          this.render();
        });
      }

      new Setting(containerEl).setName("查词后自动写卡")
        .setDesc("开启后，单词查询一完成即自动写入卡片（重复按下方策略处理）；不开启时用弹窗 ➕ Anki 按钮或命令手动添加")
        .addToggle((tg) => tg.setValue(p.settings.ankiAutoAdd).onChange(async (v) => {
          p.settings.ankiAutoAdd = v;
          await p.saveSettings();
        }));
      new Setting(containerEl).setName("重复卡片处理")
        .addDropdown((dd) => {
          dd.addOption("skip", "跳过（不重复添加）");
          dd.addOption("add", "仍然添加（允许重复）");
          dd.setValue(p.settings.ankiDup).onChange(async (v) => {
            p.settings.ankiDup = v as "skip" | "add";
            await p.saveSettings();
          });
        });
      new Setting(containerEl).setName("查重范围")
        .addDropdown((dd) => {
          dd.addOption("deck", "仅当前牌组");
          dd.addOption("model", "整个模板（所有牌组）");
          dd.setValue(p.settings.ankiDupScope).onChange(async (v) => {
            p.settings.ankiDupScope = v as "deck" | "model";
            await p.saveSettings();
          });
        });
      new Setting(containerEl).setName("卡片标签").setDesc("逗号分隔，例如 pick2anki、生词")
        .addText((t) => t.setPlaceholder("如：生词、复习")
          .setValue(p.settings.ankiTags)
          .onChange(async (v) => { p.settings.ankiTags = v; await p.saveSettings(); }));
    }

    // ---- 触发 ----
    new Setting(containerEl).setHeading().setName("⚡ 触发");
    new Setting(containerEl).setName("触发模式").setDesc("直接选中 | ctrl+选中")
      .addDropdown((dd) => {
        dd.addOption("direct", "直接选中"); dd.addOption("ctrl", "Ctrl+选中");
        dd.setValue(p.settings.triggerMode).onChange(async (v) => {
          p.settings.triggerMode = v as "direct" | "ctrl"; await p.saveSettings();
        });
      });
    new Setting(containerEl).setName("触发延迟(ms)").setDesc("选中后等待多久触发查词")
      .addSlider((s) => s.setLimits(100, 2000, 100).setValue(p.settings.triggerDebounce)
        .onChange(async (v) => { p.settings.triggerDebounce = v; await p.saveSettings(); }));
  }
}
