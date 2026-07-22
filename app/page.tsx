"use client";
import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import Image from "next/image";
import { createEditor, BaseEditor, Element, Descendant, Editor, Transforms, Range, Text, Node, NodeEntry, Path, Point } from "slate";
import { Slate, Editable, withReact, ReactEditor, RenderElementProps, RenderLeafProps } from "slate-react";
import { withHistory, HistoryEditor } from "slate-history";
import { initHighlightManager, highlightManager } from "./higilightManager";
import { Leaf, HighlightElement, CodeElement, IsSameElement } from "./elements";
import { Mode, ModeContext } from "./modeContext";
import {
  FILE_FORMAT_NAME,
  FILE_FORMAT_VERSION,
  FILE_EXTENSION,
  FILE_DESCRIPTION,
  FILE_MIME_TYPE,
  FILE_PREFIX,
} from "./constants";
export interface Theme {
  black: string;
  white: string;
  editorBg: string;
  hoverHighlightBg: string;
  hoverHighlightText: string;
  insertHighlightBg: string;
  insertHighlightText: string;
}

const defaultTheme: Theme = {
  black: "#000000",
  white: "#FFFFFF",
  editorBg: "#FAF9F5",
  hoverHighlightBg: "#e8f5e9",
  hoverHighlightText: "#3ac941",
  insertHighlightBg: "#5b8f2a",
  insertHighlightText: "#ffffff",
};


//DoubleApple\node_modules\slate\dist\types\custom-types.d.ts
//に、型定義ファイルがある

///説明///
//手動翻訳の支援アプリ。
//左右のエディタに対応をタグ付けでき、その対応をマウスカーソルを重ねることでハイライトできる

// ─── ヘルパー関数（コンポーネント外） ────────────────────────────────────────

/** insertHighlight が付いたテキストノードの範囲情報を返す。なければ null。 */
function getInsertHighlightRange(editor: Editor): {
  sorted: Path[];
  selectionStart: Point;
  selectionEnd: Point;
} | null {
  const paths: Path[] = [];
  for (const [node, path] of Node.nodes(editor)) {
    if (Text.isText(node) && (node as any).insertHighlight) {
      paths.push(path);
    }
  }
  if (paths.length === 0) return null;
  const sorted = [...paths].sort(Path.compare);
  return {
    sorted,
    selectionStart: Editor.start(editor, sorted[0]),
    selectionEnd: Editor.end(editor, sorted[sorted.length - 1]),
  };
}

/** エディタを1回走査して、最大 hovertag と insertHighlight が付いたテキストノードの範囲情報を返す */
function scanEditorForHighlightAndMaxTag(editor: Editor): {
  maxTag: number;
  range: {
    sorted: Path[];
    selectionStart: Point;
    selectionEnd: Point;
  } | null;
} {
  let maxTag = 0;
  const paths: Path[] = [];
  for (const [node, path] of Node.nodes(editor)) {
    if (Element.isElement(node) && typeof (node as any).hovertag === "number") {
      const tag = (node as any).hovertag as number;
      if (tag > maxTag) maxTag = tag;
    } else if (Text.isText(node) && (node as any).insertHighlight) {
      paths.push(path);
    }
  }
  if (paths.length === 0) {
    return { maxTag, range: null };
  }
  const sorted = [...paths].sort(Path.compare);
  return {
    maxTag,
    range: {
      sorted,
      selectionStart: Editor.start(editor, sorted[0]),
      selectionEnd: Editor.end(editor, sorted[sorted.length - 1]),
    },
  };
}

/**
 * hovertag グループを A・B・C に分類して返す。
 *   A: グループ範囲が選択範囲に完全に内包される
 *   B: グループ範囲が選択範囲を完全に内包する
 *   C: 一部のみ重なる（拡張 or エラー対象）
 * hovertag: null のノードは typeof 判定で除外される。
 */
function classifyHovertagGroups(
  editor: Editor,
  selectionStart: Point,
  selectionEnd: Point
): {
  classA: number[];
  classB: number[];
  classC: number[];
  groups: Map<number, Path[]>;
} {
  const groups = new Map<number, Path[]>();
  for (const [node, path] of Node.nodes(editor)) {
    if (Element.isElement(node) && typeof (node as any).hovertag === "number") {
      const tag = (node as any).hovertag as number;
      if (!groups.has(tag)) groups.set(tag, []);
      groups.get(tag)!.push(path);
    }
  }

  const classA: number[] = [];
  const classB: number[] = [];
  const classC: number[] = [];

  for (const [tag, paths] of groups) {
    const sp = [...paths].sort(Path.compare);
    const gStart = Editor.start(editor, sp[0]);
    const gEnd = Editor.end(editor, sp[sp.length - 1]);

    // 重なりなし → スキップ
    if (Point.isAfter(gStart, selectionEnd) || Point.isBefore(gEnd, selectionStart)) continue;

    // B: グループ範囲が選択範囲を完全に内包する
    const isB = !Point.isAfter(gStart, selectionStart) && !Point.isBefore(gEnd, selectionEnd);
    // A: グループ範囲が選択範囲に完全に内包される
    const isA = !Point.isBefore(gStart, selectionStart) && !Point.isAfter(gEnd, selectionEnd);

    if (isB) classB.push(tag);
    else if (isA) classA.push(tag);
    else classC.push(tag);
  }

  return { classA, classB, classC, groups };
}

/**
 * 分類済みの情報をもとに、insertHighlight のテキスト範囲を
 * hovertag inline ノードに変換する。
 * wrapNodes は Range が収まる最内の共通親（最内 B ノード）の中に
 * 自動的に新ノードを配置し、A ノードを子として内包する
 */
function applyHighlightTransform(
  editor: Editor,
  newHoverTag: number
): void {
  const rangeInfo = getInsertHighlightRange(editor);
  if (!rangeInfo) return;

  const { selectionStart } = rangeInfo;

  Editor.withoutNormalizing(editor, () => {
    // 1. selectionStart の位置でインラインノードを分割
    Transforms.splitNodes(editor, {
      at: selectionStart,
      match: (n) => Element.isElement(n) && editor.isInline(n),
      always: false,
    });

    // 2. 分割によりパスが変わった可能性があるため、最新の範囲を再取得
    let tempRangeInfo = getInsertHighlightRange(editor);
    if (!tempRangeInfo) return;

    // 3. selectionEnd の位置でインラインノードを分割
    Transforms.splitNodes(editor, {
      at: tempRangeInfo.selectionEnd,
      match: (n) => Element.isElement(n) && editor.isInline(n),
      always: false,
    });

    // 4. 再度、最新の範囲を取得
    const newRangeInfo = getInsertHighlightRange(editor);
    if (!newRangeInfo) return;

    const { sorted: newSorted, selectionStart: newStart, selectionEnd: newEnd } = newRangeInfo;

    // 5. insertHighlight マークを除去
    for (const p of [...newSorted].reverse()) {
      Transforms.unsetNodes(editor, "insertHighlight", { at: p });
    }

    // 6. 新要素でラップする
    Transforms.wrapNodes(
      editor,
      { type: "inline", hovertag: newHoverTag, children: [] } as any,
      { at: { anchor: newStart, focus: newEnd } }
    );
  });
}

/**
 * カスタム正規化ルールを適用する。
 * 修正を行った場合は true を返し、そうでない場合は false を返す。
 */
function customNormalize(editor: Editor, entry: NodeEntry): boolean {
  const [node, path] = entry;

  // 1. 親関係の解体ルール：
  // ノードがインラインノードかつ hovertag が null であり、
  // その子要素に別のインラインノードが存在する場合、その親ノードを unwrap (解体) する。
  if (Element.isElement(node) && node.type === "inline" && node.hovertag === null) {
    const hasInlineChild = node.children.some(
      (child) => Element.isElement(child) && child.type === "inline"
    );
    if (hasInlineChild) {
      Transforms.unwrapNodes(editor, { at: path });
      return true;
    }
  }

  // 2. 隣接ノードの統合ルール：
  // 現在のノードの子要素の中に、同一の hovertag を持つインラインノードが連続して並んでいる場合、
  // それらを 1 つのインラインノードにマージする。
  if (Element.isElement(node)) {
    for (let i = 0; i < node.children.length - 1; i++) {
      const child = node.children[i];
      const nextChild = node.children[i + 1];

      if (
        Element.isElement(child) &&
        child.type === "inline" &&
        Element.isElement(nextChild) &&
        nextChild.type === "inline" &&
        (child as any).hovertag === (nextChild as any).hovertag
      ) {
        const nextPath = path.concat(i + 1);
        Transforms.mergeNodes(editor, { at: nextPath });
        return true;
      }
    }
  }

  return false;
}

// ─── 初期値 ────────────────────────────────────────────────────────────────

const initialValueLeft: Descendant[] = [
  {
    type: "block",
    children: [
      { text: "It's a " },
      {
        type: "inline",
        hovertag: 1,
        children: [
          {
            type: "inline",
            hovertag: 2,
            children: [{ text: "test" }],
          },
          {
            type: "inline",
            hovertag: 3,
            children: [{ text: "word" }],
          },
          {
            type: "inline",
            hovertag: null,
            children: [{ text: "text" }],
          },
        ],
      },
    ],
  },
];

const initialValueRight: Descendant[] = [
  {
    type: "block",
    children: [
      { text: "これは" },
      {
        type: "inline",
        hovertag: 1,
        children: [
          {
            type: "inline",
            hovertag: 2,
            children: [{ text: "テスト" }],
          },
          {
            type: "inline",
            hovertag: 3,
            children: [{ text: "単語" }],
          },
          {
            type: "inline",
            hovertag: null,
            children: [{ text: "テキストです。" }],
          },
        ],
      },
    ],
  },
];

export default function Home() {
  const [mode, setMode] = useState<Mode>("edit");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [theme, setTheme] = useState<Theme>(defaultTheme);
  const [isThemeEditorOpen, setIsThemeEditorOpen] = useState(false);
  const [isFileInsertOpen, setIsFileInsertOpen] = useState(false);
  const fileInsertInputRef = useRef<HTMLInputElement>(null);
  const activeInsertTargetRef = useRef<"left" | "right">("left");

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        isMenuOpen &&
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        menuButtonRef.current &&
        !menuButtonRef.current.contains(event.target as Node)
      ) {
        setIsMenuOpen(false);
        setIsThemeEditorOpen(false);
        setIsFileInsertOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isMenuOpen]);

  // エディタデータ状態と再生成用キー
  const [valueLeft, setValueLeft] = useState<Descendant[]>(initialValueLeft);
  const [valueRight, setValueRight] = useState<Descendant[]>(initialValueRight);
  const [importKey, setImportKey] = useState<number>(0);

  // トースト通知
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(msg);
    toastTimerRef.current = setTimeout(() => setToastMessage(null), 3000);
  }, []);

  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      // Tabキーで編集モードと対応モードをトグル
      if (event.key === "Tab") {
        event.preventDefault();
        setMode((prev) => (prev === "edit" ? "match" : "edit"));
      }

      // Ctrl + Shift + D でエディタ状態をダンプ
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.key === "d" || event.key === "D")) {
        event.preventDefault();
        console.log("=== DoubleApple Editor States ===");
        console.log("Left Editor (Editor A) State:", JSON.parse(JSON.stringify(valueLeft)));
        console.log("Right Editor (Editor B) State:", JSON.parse(JSON.stringify(valueRight)));
        console.log("=================================");
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown);
    };
  }, [valueLeft, valueRight]);





  const handleMouseUp = useCallback((editor: ReactEditor & BaseEditor) => {
    if (mode !== "match") return;
    setTimeout(() => {
      const { selection } = editor;
      if (selection && Range.isExpanded(selection)) {
        try {
          Editor.addMark(editor, "insertHighlight", true);
          Transforms.deselect(editor);
          window.getSelection()?.removeAllRanges();
        } catch (e) {
          console.error("Failed to apply mark on selection:", e);
        }
      }
    }, 0);
  }, [mode]);

  const editorLeft = useMemo(() => {
    const editor = withHistory(withReact(createEditor()));
    const { isInline, normalizeNode } = editor;
    editor.isInline = (element: any) => {
      return element.type === "inline" ? true : isInline(element);
    };
    editor.normalizeNode = (entry: NodeEntry) => {
      if (customNormalize(editor, entry)) {
        return;
      }
      normalizeNode(entry);
    };
    return editor;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importKey]);

  const editorRight = useMemo(() => {
    const editor = withHistory(withReact(createEditor()));
    const { isInline, normalizeNode } = editor;
    editor.isInline = (element: any) => {
      return element.type === "inline" ? true : isInline(element);
    };
    editor.normalizeNode = (entry: NodeEntry) => {
      if (customNormalize(editor, entry)) {
        return;
      }
      normalizeNode(entry);
    };
    return editor;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importKey]);

  // ─── Import / Export 機能の実装 ───────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = useCallback(async () => {
    const exportData = {
      format: FILE_FORMAT_NAME,
      version: FILE_FORMAT_VERSION,
      editorLeft: editorLeft.children,
      editorRight: editorRight.children,
    };

    if (typeof window !== "undefined" && "showSaveFilePicker" in window) {
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: `${FILE_PREFIX}${Date.now()}${FILE_EXTENSION}`,
          types: [{
            description: FILE_DESCRIPTION,
            accept: {
              [FILE_MIME_TYPE]: [FILE_EXTENSION],
            },
          }],
        });
        const writable = await handle.createWritable();
        await writable.write(JSON.stringify(exportData, null, 2));
        await writable.close();
        showToast("エクスポートしました");
      } catch (err: any) {
        if (err.name !== "AbortError") {
          console.error(err);
          showToast("保存に失敗しました");
        }
      }
    } else {
      // フォールバック
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: FILE_MIME_TYPE });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${FILE_PREFIX}${Date.now()}${FILE_EXTENSION}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast("エクスポートしました");
    }
  }, [editorLeft, editorRight, showToast]);

  const handleImportButtonClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(FILE_EXTENSION)) {
      showToast(`拡張子が ${FILE_EXTENSION} のファイルを選択してください`);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);

        if (data.format !== FILE_FORMAT_NAME) {
          showToast("無効なファイル形式です");
          return;
        }

        setValueLeft(data.editorLeft);
        setValueRight(data.editorRight);
        setImportKey(prev => prev + 1);
        showToast("インポートしました");
      } catch (err) {
        showToast("ファイルの解析に失敗しました");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  }, [showToast]);

  const handleFileInsertClick = useCallback((target: "left" | "right") => {
    activeInsertTargetRef.current = target;
    setIsMenuOpen(false);
    setIsFileInsertOpen(false);
    setIsThemeEditorOpen(false);
    fileInsertInputRef.current?.click();
  }, []);

  const handleFileInsertChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const target = activeInsertTargetRef.current;
    const targetLabel = target === "left" ? "左エディタ" : "右エディタ";

    const confirmed = window.confirm(`${targetLabel}の内容がファイルの内容で完全に上書きされます。よろしいですか？`);
    if (!confirmed) {
      event.target.value = "";
      return;
    }

    try {
      let text = "";

      if (file.name.endsWith(".txt")) {
        text = await file.text();
      } else if (file.name.endsWith(".pdf")) {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        let extractedText = "";
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items
            .map((item: any) => item.str)
            .join(" ");
          extractedText += pageText + "\n";
        }
        text = extractedText;
      } else {
        showToast("未対応のファイル形式です (.txt または .pdf を選択してください)");
        event.target.value = "";
        return;
      }

      const lines = text.split(/\r?\n/);
      const newValue: Descendant[] = lines.length > 0 && (lines.length > 1 || lines[0] !== "")
        ? lines.map((line) => ({
          type: "block",
          children: [{ text: line }],
        }))
        : [{ type: "block", children: [{ text: "" }] }];

      if (target === "left") {
        setValueLeft(newValue);
      } else {
        setValueRight(newValue);
      }
      setImportKey((prev) => prev + 1);
      showToast(`${targetLabel}をファイル内容で上書きしました`);
    } catch (err) {
      console.error(err);
      showToast("ファイルの読み込みに失敗しました");
    } finally {
      event.target.value = "";
    }
  }, [showToast, setValueLeft, setValueRight]);

  // HighlightManagerの初期化（エディタをキャッシュ）
  useEffect(() => {
    initHighlightManager(editorLeft, editorRight);
  }, [editorLeft, editorRight]);

  // modeがmatchから他の状態に遷移したとき、すべてのハイライトおよびinsertHighlightマークを消去
  const prevMode = useRef<Mode>(mode);
  useEffect(() => {
    if (mode !== "match") {
      highlightManager?.ClearHighlight();
      if (prevMode.current === "match") {
        // 両エディタのすべてのテキストノードからinsertHighlightを除去
        for (const editor of [editorLeft, editorRight]) {
          Editor.withoutNormalizing(editor, () => {
            for (const [node, path] of Node.nodes(editor)) {
              if (Text.isText(node) && (node as any).insertHighlight) {
                Transforms.unsetNodes(editor, "insertHighlight", { at: path });
              }
            }
          });
        }
      }
    }
    prevMode.current = mode;
  }, [mode, editorLeft, editorRight]);

  // フォーカス状態を管理するState
  const [isFocusedLeft, setIsFocusedLeft] = useState(false);
  const [isFocusedRight, setIsFocusedRight] = useState(false);

  // 3色定義
  const COLOR_BLACK = "var(--color-black)";
  const COLOR_WHITE = "var(--color-white)";
  const COLOR_BEIGE_WHITE = "var(--color-editor-bg)";

  // Define a rendering function based on the element passed to `props`. We use
  // `useCallback` here to memoize the function for subsequent renders.
  const renderElement = useCallback((props: RenderElementProps) => {
    switch (props.element.type) {
      case "code":
        return <CodeElement {...props} />;
      case "block":
        return <div {...props.attributes}>{props.children}</div>;
      default:
        return <HighlightElement {...props} />;
    }
  }, []);

  const renderLeaf = useCallback((props: RenderLeafProps) => {
    return <Leaf {...props} />;
  }, []);

  // 対応モード中の挿入アクション
  const handleInsertHighlight = useCallback(() => {
    // 左右エディタそれぞれを1回走査して、最大 hovertag と範囲情報を同時に取得
    const resultLeft = scanEditorForHighlightAndMaxTag(editorLeft);
    const resultRight = scanEditorForHighlightAndMaxTag(editorRight);

    const maxTag = Math.max(resultLeft.maxTag, resultRight.maxTag);
    const newHoverTag = maxTag + 1;

    const rangeLeft = resultLeft.range;
    const rangeRight = resultRight.range;
    if (!rangeLeft && !rangeRight) return;

    // 両エディタを A/B/C 分類
    const emptyClassification = {
      classA: [] as number[],
      classB: [] as number[],
      classC: [] as number[],
      groups: new Map<number, Path[]>(),
    };
    const clLeft = rangeLeft
      ? classifyHovertagGroups(editorLeft, rangeLeft.selectionStart, rangeLeft.selectionEnd)
      : emptyClassification;
    const clRight = rangeRight
      ? classifyHovertagGroups(editorRight, rangeRight.selectionStart, rangeRight.selectionEnd)
      : emptyClassification;

    // どちらかで C≥1 が発生したら両方キャンセルしてトーストを表示
    if (clLeft.classC.length >= 1 || clRight.classC.length >= 1) {
      showToast("親子関係が設定できません");
      return;
    }

    // 適用
    if (rangeLeft) {
      applyHighlightTransform(editorLeft, newHoverTag);
    }
    if (rangeRight) {
      applyHighlightTransform(editorRight, newHoverTag);
    }
  }, [editorLeft, editorRight, showToast]);

  // 対応モード中の解除アクション (差分トリミング処理)
  const handleRemoveHighlight = useCallback(() => {
    // 左右のエディタについて独立して、選択されたテキストノード（insertHighlight 付き）をトリミングする
    Editor.withoutNormalizing(editorLeft, () => {
      Editor.withoutNormalizing(editorRight, () => {
        for (const editor of [editorLeft, editorRight]) {
          // 1. insertHighlight が付いているテキストノードのパスをすべて収集
          const paths: Path[] = [];
          for (const [node, path] of Node.nodes(editor)) {
            if (Text.isText(node) && (node as any).insertHighlight) {
              paths.push(path);
            }
          }
          if (paths.length === 0) continue;

          // 2. パスを降順（後ろのノードから順）にソートして、前方ノードのパスずれを防ぐ
          paths.sort((a, b) => -Path.compare(a, b));

          // 3. パス自動追従のために PathRef の配列を作成
          const pathRefs = paths.map((p) => Editor.pathRef(editor, p));

          // 指定したパスの祖先から、最も深い（子に近い）hovertag: number のインラインノードを取得する
          const getDeepestTarget = (atPath: Path) => {
            let deepest: Node | null = null;
            for (const [node] of Node.ancestors(editor, atPath)) {
              if (Element.isElement(node) && editor.isInline(node) && typeof (node as any).hovertag === "number") {
                deepest = node;
              }
            }
            return deepest;
          };

          // 4. 各パスに対してトリミングを適用
          for (const ref of pathRefs) {
            let currentPath = ref.current;
            if (!currentPath) continue;

            // 解除対象の親タグが存在しない場合は処理をスキップ（ルートノード分割によるクラッシュを防止）
            if (!getDeepestTarget(currentPath)) continue;

            // 4a. 終了位置で分割
            const endPoint = Editor.end(editor, currentPath);
            Transforms.splitNodes(editor, {
              at: endPoint,
              match: (n) => n === getDeepestTarget(endPoint.path),
              always: false,
            });

            // 分割によりパスが変化した可能性があるため、最新のパスを再取得
            currentPath = ref.current;
            if (!currentPath) continue;

            // 4b. 開始位置で分割
            const startPoint = Editor.start(editor, currentPath);
            Transforms.splitNodes(editor, {
              at: startPoint,
              match: (n) => n === getDeepestTarget(startPoint.path),
              always: false,
            });

            // 再度、最新のパスを再取得
            currentPath = ref.current;
            if (!currentPath) continue;

            // 4c. 隔離されたテキストノードの祖先から、最も深い（子に近い）解除対象タグのパスを特定して解除
            let deepestPath: Path | null = null;
            for (const [_, ancestorPath] of Node.ancestors(editor, currentPath)) {
              const node = Node.get(editor, ancestorPath);
              if (Element.isElement(node) && editor.isInline(node) && typeof (node as any).hovertag === "number") {
                deepestPath = ancestorPath;
              }
            }
            if (deepestPath) {
              Transforms.setNodes(editor, { hovertag: null } as any, { at: deepestPath });
            }

            // 4d. テキストノードから insertHighlight マークを解除
            Transforms.unsetNodes(editor, "insertHighlight", { at: currentPath });
          }

          // PathRef のクリーンアップ（メモリリーク防止）
          for (const ref of pathRefs) {
            ref.unref();
          }
        }
      });
    });
  }, [editorLeft, editorRight]);

  // 対応モード中の拡張アクション (既存タグの拡張)
  const handleExtendHighlight = useCallback(() => {
    const rangeLeft = getInsertHighlightRange(editorLeft);
    const rangeRight = getInsertHighlightRange(editorRight);

    if (!rangeLeft && !rangeRight) {
      showToast("拡張する範囲が選択されていません");
      return;
    }

    // 拡張対象となるタグIDを特定するヘルパー
    const getExtendTargetTag = (editor: Editor, range: typeof rangeLeft) => {
      if (!range) return null;

      // 選択範囲を完全に囲む直近の親タグのパスを特定する
      let parentTagPath: Path | null = null;
      for (const [, ancestorPath] of Node.ancestors(editor, range.selectionStart.path)) {
        const ancestorNode = Node.get(editor, ancestorPath);
        if (
          Element.isElement(ancestorNode) &&
          editor.isInline(ancestorNode) &&
          typeof (ancestorNode as any).hovertag === "number"
        ) {
          parentTagPath = ancestorPath;
          break; // 最も内側の親タグ
        }
      }

      // 親タグが存在しなければエディタのルート
      const searchPath = parentTagPath || [];

      // 親タグから見たすべての既存の子孫タグを取得 (自分自身は除外)
      const allHovertagNodes = Array.from(
        Editor.nodes(editor, {
          at: searchPath,
          match: (n, p) =>
            Element.isElement(n) &&
            editor.isInline(n) &&
            typeof (n as any).hovertag === "number" &&
            !Path.equals(p, searchPath),
        })
      );

      const matchedEntries: { node: any; path: Path; editor: Editor }[] = [];

      // 1. 選択範囲の内部に存在する hovertag ノードをスキャン
      for (const [node, path] of allHovertagNodes) {
        const start = Editor.start(editor, path);
        const end = Editor.end(editor, path);

        const isIntersecting =
          (!Point.isBefore(range.selectionStart, start) && !Point.isAfter(range.selectionStart, end)) ||
          (!Point.isBefore(range.selectionEnd, start) && !Point.isAfter(range.selectionEnd, end)) ||
          (!Point.isBefore(start, range.selectionStart) && !Point.isAfter(end, range.selectionEnd));

        if (isIntersecting) {
          matchedEntries.push({ node, path, editor });
        }
      }

      // 2. 選択範囲内に既存タグがない場合 ➡ 隣接する場所（左隣・右隣）を検索する
      if (matchedEntries.length === 0) {
        for (const [node, path] of allHovertagNodes) {
          const start = Editor.start(editor, path);
          const end = Editor.end(editor, path);

          // 左隣の判定: ノードの終了点 `end` から選択開始点 `range.selectionStart` までの実質テキストが空
          if (Point.isBefore(end, range.selectionStart) || Point.equals(end, range.selectionStart)) {
            const betweens = Editor.string(editor, { anchor: end, focus: range.selectionStart });
            if (betweens === "") {
              matchedEntries.push({ node, path, editor });
            }
          }

          // 右隣の判定: 選択終了点 `range.selectionEnd` からノードの開始点 `start` までの実質テキストが空
          if (Point.isBefore(range.selectionEnd, start) || Point.equals(range.selectionEnd, start)) {
            const betweens = Editor.string(editor, { anchor: range.selectionEnd, focus: start });
            if (betweens === "") {
              matchedEntries.push({ node, path, editor });
            }
          }
        }
      }

      if (matchedEntries.length === 0) return null;

      // 3. 親子関係のフィルタリング（最も階層が「上」のものを残し、その子孫を除外する）
      matchedEntries.sort((a, b) => a.path.length - b.path.length); // 浅い順 (階層が上のものが先)

      const selectedEntries: typeof matchedEntries = [];
      for (const entry of matchedEntries) {
        // すでに採用された浅いノード（selected）が、今回のノード（entry）の祖先である場合は無視する
        const isDescendantOfAlreadySelected = selectedEntries.some(
          (selected) =>
            selected.editor === entry.editor &&
            Path.isAncestor(selected.path, entry.path)
        );
        if (!isDescendantOfAlreadySelected) {
          selectedEntries.push(entry);
        }
      }

      // 4. ユニークなタグIDを集計
      const uniqueTags = new Set<number>();
      for (const entry of selectedEntries) {
        uniqueTags.add((entry.node as any).hovertag as number);
      }

      if (uniqueTags.size === 0) return null;
      if (uniqueTags.size > 1) {
        return -1; // 複数検出時はエラーを表す -1 を返す
      }

      return Array.from(uniqueTags)[0];
    };

    const tagLeft = getExtendTargetTag(editorLeft, rangeLeft);
    const tagRight = getExtendTargetTag(editorRight, rangeRight);

    if (tagLeft === -1 || tagRight === -1) {
      showToast("複数の異なるタグが検出されたため拡張できません");
      return;
    }

    const tags = new Set<number>();
    if (tagLeft !== null) tags.add(tagLeft);
    if (tagRight !== null) tags.add(tagRight);

    if (tags.size === 0) {
      showToast("隣接または重複する既存のタグが見つかりません");
      return;
    }

    if (tags.size > 1) {
      showToast("複数の異なるタグが検出されたため拡張できません");
      return;
    }

    const targetTag = Array.from(tags)[0];

    // 親要素の範囲を超えた拡張を制限するバリデーション
    const validateParentConstraint = (editor: Editor, range: typeof rangeLeft) => {
      if (!range) return true;

      const matches = Array.from(
        Editor.nodes(editor, {
          match: (n) => Element.isElement(n) && editor.isInline(n) && (n as any).hovertag === targetTag,
        })
      );
      if (matches.length === 0) return true;

      for (const [node, path] of matches) {
        // 親（祖先）に別のタグ（hovertag が number）があるか探す
        let parentTagPath: Path | null = null;
        for (const [ancestorNode, ancestorPath] of Node.ancestors(editor, path)) {
          if (
            Element.isElement(ancestorNode) &&
            editor.isInline(ancestorNode) &&
            typeof (ancestorNode as any).hovertag === "number"
          ) {
            parentTagPath = ancestorPath;
            break;
          }
        }

        if (parentTagPath) {
          const parentStart = Editor.start(editor, parentTagPath);
          const parentEnd = Editor.end(editor, parentTagPath);

          const targetStart = Editor.start(editor, path);
          const targetEnd = Editor.end(editor, path);

          // 拡張後の全体の範囲（現在のtargetTagの範囲と、新しく追加するrangeの範囲を合わせた全領域）
          const newStart = Point.isBefore(range.selectionStart, targetStart) ? range.selectionStart : targetStart;
          const newEnd = Point.isAfter(range.selectionEnd, targetEnd) ? range.selectionEnd : targetEnd;

          // 親の範囲 [parentStart, parentEnd] からはみ出していないか検証
          if (Point.isBefore(newStart, parentStart) || Point.isAfter(newEnd, parentEnd)) {
            return false; // 制約違反
          }
        }
      }
      return true;
    };

    if (!validateParentConstraint(editorLeft, rangeLeft) || !validateParentConstraint(editorRight, rangeRight)) {
      showToast("親要素の範囲を超えて拡張することはできません");
      return;
    }

    // 適用
    if (rangeLeft) {
      applyHighlightTransform(editorLeft, targetTag);
    }
    if (rangeRight) {
      applyHighlightTransform(editorRight, targetTag);
    }
    showToast("タグの範囲を拡張しました");
  }, [editorLeft, editorRight, showToast]);

  // 対応モード中の完全削除アクション (タグの完全消去)
  const handleDeleteHighlight = useCallback(() => {
    const matchedEntries: { node: any; path: Path; editor: Editor }[] = [];

    // 優先1: insertHighlight（選択範囲）からノードを特定
    const rangeLeft = getInsertHighlightRange(editorLeft);
    const rangeRight = getInsertHighlightRange(editorRight);

    const collectEntriesFromRange = (editor: Editor, range: typeof rangeLeft) => {
      if (!range) return;
      const nodes = Editor.nodes(editor, {
        at: { anchor: range.selectionStart, focus: range.selectionEnd },
        match: (n) => Element.isElement(n) && editor.isInline(n) && typeof (n as any).hovertag === "number",
      });
      for (const [node, path] of nodes) {
        matchedEntries.push({ node, path, editor });
      }
    };

    collectEntriesFromRange(editorLeft, rangeLeft);
    collectEntriesFromRange(editorRight, rangeRight);

    // 優先2: 選択範囲がない場合、現在フォーカスがあるエディタのカーソル位置から特定
    if (matchedEntries.length === 0) {
      const activeEditor = isFocusedLeft ? editorLeft : (isFocusedRight ? editorRight : null);
      if (activeEditor && activeEditor.selection) {
        const nodes = Editor.nodes(activeEditor, {
          at: activeEditor.selection,
          match: (n) => Element.isElement(n) && activeEditor.isInline(n) && typeof (n as any).hovertag === "number",
        });
        for (const [node, path] of nodes) {
          matchedEntries.push({ node, path, editor: activeEditor });
        }
      }
    }

    // 優先3: それでも見つからない場合、両方のエディタの現在の選択範囲から特定
    if (matchedEntries.length === 0) {
      for (const editor of [editorLeft, editorRight]) {
        if (editor.selection) {
          const nodes = Editor.nodes(editor, {
            at: editor.selection,
            match: (n) => Element.isElement(n) && editor.isInline(n) && typeof (n as any).hovertag === "number",
          });
          for (const [node, path] of nodes) {
            matchedEntries.push({ node, path, editor });
          }
        }
      }
    }

    if (matchedEntries.length === 0) {
      showToast("削除対象のタグが特定できません");
      return;
    }

    // 階層（パスの長さ）で降順ソート（深い子孫ノードが先に来るようにする）
    matchedEntries.sort((a, b) => b.path.length - a.path.length);

    // 親子関係にあるものをフィルタリングする
    // 深い順から処理し、すでに採用された子の祖先であるノード（＝同じエディタ内で、パスが前方一致するもの）は無視する
    const selectedEntries: typeof matchedEntries = [];
    for (const entry of matchedEntries) {
      const isAncestorOfAlreadySelected = selectedEntries.some(
        (selected) =>
          selected.editor === entry.editor &&
          Path.isAncestor(entry.path, selected.path)
      );
      if (!isAncestorOfAlreadySelected) {
        selectedEntries.push(entry);
      }
    }

    // フィルタリング後に残ったタグIDのユニーク数を集計
    const finalTags = new Set<number>();
    for (const entry of selectedEntries) {
      finalTags.add((entry.node as any).hovertag as number);
    }

    if (finalTags.size === 0) {
      showToast("削除対象のタグが特定できません");
      return;
    }

    // 複数種類存在する場合は、誤操作を防ぐためにキャンセルしてトースト表示
    if (finalTags.size > 1) {
      showToast("複数の異なるタグを同時に削除することはできません");
      return;
    }

    const targetTag = Array.from(finalTags)[0];

    // 削除処理の実行 (対象IDの解除と黄緑ハイライトのクリーンアップ)
    Editor.withoutNormalizing(editorLeft, () => {
      Editor.withoutNormalizing(editorRight, () => {
        for (const editor of [editorLeft, editorRight]) {
          const paths: Path[] = [];
          for (const [node, path] of Node.nodes(editor)) {
            if (
              Element.isElement(node) &&
              editor.isInline(node) &&
              typeof (node as any).hovertag === "number" &&
              (node as any).hovertag === targetTag
            ) {
              paths.push(path);
            }
          }
          for (const path of [...paths].reverse()) {
            Transforms.setNodes(editor, { hovertag: null } as any, { at: path });
          }

          // タグ削除後、該当エディタのすべてのテキストノードから insertHighlight を解除する
          for (const [node, path] of Node.nodes(editor)) {
            if (Text.isText(node) && (node as any).insertHighlight) {
              Transforms.unsetNodes(editor, "insertHighlight", { at: path });
            }
          }
        }
      });
    });

    showToast("タグを削除しました");
  }, [editorLeft, editorRight, isFocusedLeft, isFocusedRight, showToast]);

  // キー入力ハンドラー
  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>, editor: ReactEditor & BaseEditor) => {
    const isCmdOrCtrl = event.metaKey || event.ctrlKey;

    // Ctrl+Z: アンドゥ (Undo)
    if (isCmdOrCtrl && (event.key === "z" || event.key === "Z")) {
      event.preventDefault();
      try {
        HistoryEditor.undo(editor as any);
      } catch (e) {
        console.error("Undo failed:", e);
      }
      return;
    }

    // Ctrl+Y: リドゥ (Redo)
    if (isCmdOrCtrl && (event.key === "y" || event.key === "Y")) {
      event.preventDefault();
      try {
        HistoryEditor.redo(editor as any);
      } catch (e) {
        console.error("Redo failed:", e);
      }
      return;
    }

    if (mode !== "edit") {
      const allowedKeys = [
        "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
        "Home", "End", "PageUp", "PageDown",
      ];

      // Ctrl+C などのコピー操作は許可
      if (isCmdOrCtrl && (event.key === "c" || event.key === "C")) {
        return;
      }

      // モード切り替え用のキー（Tab）は許可
      if (event.key === "Tab") {
        return;
      }

      // 対応モード中の Ctrl + Shift + Enter: 既存タグの拡張
      if (mode === "match" && isCmdOrCtrl && event.shiftKey && event.key === "Enter") {
        event.preventDefault();
        handleExtendHighlight();
        return;
      }

      // 対応モード中の Ctrl+Enter: insertHighlight を hovertag inline ノードに変換 (Shiftがない場合)
      if (mode === "match" && isCmdOrCtrl && !event.shiftKey && event.key === "Enter") {
        event.preventDefault();
        handleInsertHighlight();
        return;
      }

      const isMinusKey = event.key === "-" || event.code === "Minus" || event.code === "NumpadSubtract";

      // 対応モード中の Ctrl + Shift + - : タグ自体の完全削除
      if (mode === "match" && isCmdOrCtrl && event.shiftKey && isMinusKey) {
        event.preventDefault();
        handleDeleteHighlight();
        return;
      }

      // 対応モード中の Ctrl + - : 左右のエディタの選択範囲と重なる hovertag を持つノードのハイライトを解除 (Shiftがない場合)
      if (mode === "match" && isCmdOrCtrl && !event.shiftKey && isMinusKey) {
        event.preventDefault();
        handleRemoveHighlight();
        return;
      }

      if (!allowedKeys.includes(event.key)) {
        event.preventDefault();
      }
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      editor.insertText("\n");
    }
  }, [mode, handleInsertHighlight, handleRemoveHighlight, handleExtendHighlight, handleDeleteHighlight]);

  return (
    <ModeContext.Provider value={mode}>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".dapl"
        style={{ display: "none" }}
      />
      <input
        type="file"
        ref={fileInsertInputRef}
        onChange={handleFileInsertChange}
        accept=".txt,.pdf"
        style={{ display: "none" }}
      />
      <div style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
        backgroundColor: "var(--color-white)",
        color: "var(--color-black)",
        fontFamily: "var(--font-geist-sans), sans-serif",
        "--color-black": theme.black,
        "--color-white": theme.white,
        "--color-editor-bg": theme.editorBg,
        "--color-hover-highlight-text": theme.hoverHighlightText,
        "--color-hover-highlight-bg": theme.hoverHighlightBg,
        "--color-insert-highlight-bg": theme.insertHighlightBg,
        "--color-insert-highlight-text": theme.insertHighlightText,
      } as React.CSSProperties}>
        {/* ヘッダー部分 */}
        <header style={{
          display: "flex",
          flexDirection: "column",
          borderBottom: `4px double ${COLOR_BLACK}`, // 二本線かつ少し太い境界線
          backgroundColor: COLOR_WHITE,
        }}>
          {/* 1段目 */}
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "1rem",
            padding: "0.75rem 2rem 0.25rem 2rem", // 下の余白を少し減らす
            position: "relative", // メニューの絶対配置基準
            width: "100%",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              {/* ハンバーガーボタン */}
              <button
                ref={menuButtonRef}
                onClick={() => setIsMenuOpen(prev => !prev)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-around",
                  width: "28px",
                  height: "20px",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  zIndex: 101,
                }}
                aria-label="Menu"
              >
                <div style={{
                  width: "24px",
                  height: "3px",
                  backgroundColor: COLOR_BLACK,
                  transition: "transform 0.2s, opacity 0.2s",
                  transform: isMenuOpen ? "translateY(6px) rotate(45deg)" : "none",
                }} />
                <div style={{
                  width: "24px",
                  height: "3px",
                  backgroundColor: COLOR_BLACK,
                  transition: "opacity 0.2s",
                  opacity: isMenuOpen ? 0 : 1,
                }} />
                <div style={{
                  width: "24px",
                  height: "3px",
                  backgroundColor: COLOR_BLACK,
                  transition: "transform 0.2s, opacity 0.2s",
                  transform: isMenuOpen ? "translateY(-5px) rotate(-45deg)" : "none",
                }} />
              </button>

              {/* ロゴの表示 */}
              <div style={{ position: "relative", width: "40px", height: "40px" }}>
                <Image
                  src="/images/LOGO.png"
                  alt="DoubleApple Logo"
                  width={40}
                  height={40}
                  style={{ objectFit: "contain" }}
                  priority
                />
              </div>
              <h1 style={{
                fontSize: "1.75rem",
                fontWeight: "800",
                letterSpacing: "-0.05em",
                margin: 0,
              }}>
                DoubleApple
              </h1>
            </div>

            {/* モード選択インジケーター */}
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              {[
                { id: "edit", label: "編集モード", shortcut: "Tab" },
                { id: "match", label: "対応モード", shortcut: "Tab" },
              ].map((item) => {
                const isActive = mode === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setMode(item.id as Mode)}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      padding: "0.4rem 0.8rem",
                      border: `1.5px solid ${COLOR_BLACK}`,
                      borderRadius: "4px",
                      backgroundColor: isActive ? COLOR_BLACK : COLOR_WHITE,
                      color: isActive ? COLOR_WHITE : COLOR_BLACK,
                      fontWeight: isActive ? "700" : "400",
                      fontSize: "0.85rem",
                      transition: "all 0.15s ease-in-out",
                      minWidth: "120px",
                      textAlign: "center",
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    <span>{item.label}</span>
                    <span style={{
                      fontSize: "0.65rem",
                      opacity: 0.7,
                      marginTop: "0.1rem",
                      color: isActive ? COLOR_WHITE : "#666"
                    }}>
                      {item.shortcut}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* 縦連結ハンバーガーメニュー */}
            {isMenuOpen && (
              <div
                ref={menuRef}
                style={{
                  position: "absolute",
                  top: "100%",
                  left: "2rem",
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "flex-start",
                  zIndex: 100,
                  marginTop: "0.25rem",
                }}
              >
                {/* メインメニュー項目 */}
                <div style={{
                  display: "flex",
                  flexDirection: "column",
                  backgroundColor: COLOR_WHITE,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
                }}>
                  {[
                    { label: "Import", onClick: () => { setIsMenuOpen(false); handleImportButtonClick(); } },
                    { label: "Export", onClick: () => { setIsMenuOpen(false); handleExport(); } },
                    { label: "Button A", onClick: () => { setIsMenuOpen(false); showToast("Button A がクリックされました"); } },
                    { label: "Button B", onClick: () => { setIsMenuOpen(false); showToast("Button B がクリックされました"); } },
                    { label: "Button C", onClick: () => { setIsMenuOpen(false); showToast("Button C がクリックされました"); } },
                    {
                      label: `ファイル挿入 ▶`,
                      onClick: () => {
                        setIsFileInsertOpen(prev => !prev);
                        setIsThemeEditorOpen(false);
                      },
                      isActive: isFileInsertOpen
                    },
                    {
                      label: `色設定 ▶`,
                      onClick: () => {
                        setIsThemeEditorOpen(prev => !prev);
                        setIsFileInsertOpen(false);
                      },
                      isActive: isThemeEditorOpen
                    },
                  ].map((btn, index) => {
                    const isActive = btn.isActive;
                    return (
                      <button
                        key={btn.label}
                        onClick={btn.onClick}
                        style={{
                          width: "180px", // 横長の直方体
                          height: "44px",
                          border: `2px solid ${COLOR_BLACK}`,
                          // 隣接するボタンの境界線が重なって太くなるのを防ぐため、2番目以降のボタンの borderTop を "none" にする
                          borderTop: index === 0 ? `2px solid ${COLOR_BLACK}` : "none",
                          backgroundColor: isActive ? COLOR_BLACK : COLOR_WHITE,
                          color: isActive ? COLOR_WHITE : COLOR_BLACK,
                          fontSize: "0.9rem",
                          fontWeight: "700",
                          cursor: "pointer",
                          textAlign: "left",
                          padding: "0 1.25rem",
                          transition: "all 0.15s ease-in-out",
                          display: "flex",
                          alignItems: "center",
                        }}
                        onMouseEnter={(e) => {
                          if (!isActive) {
                            e.currentTarget.style.backgroundColor = COLOR_BLACK;
                            e.currentTarget.style.color = COLOR_WHITE;
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isActive) {
                            e.currentTarget.style.backgroundColor = COLOR_WHITE;
                            e.currentTarget.style.color = COLOR_BLACK;
                          }
                        }}
                      >
                        {btn.label}
                      </button>
                    );
                  })}
                </div>

                {/* テーマ色の各ピッカー（右展開） */}
                {isThemeEditorOpen && (
                  <div style={{
                    display: "flex",
                    flexDirection: "column",
                    backgroundColor: COLOR_WHITE,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
                    marginLeft: "-2px", // メインメニューの右ボーダーと重ねる
                  }}>
                    {[
                      { key: "black", label: "文字と装飾色" },
                      { key: "white", label: "アプリ背景色" },
                      { key: "editorBg", label: "入力欄背景色" },
                      { key: "hoverHighlightBg", label: "強調背景色" },
                      { key: "hoverHighlightText", label: "強調文字色" },
                      { key: "insertHighlightBg", label: "挿入背景色" },
                      { key: "insertHighlightText", label: "挿入文字色" },
                    ].map((item, index) => {
                      return (
                        <div
                          key={item.key}
                          style={{
                            width: "180px",
                            height: "44px",
                            border: `2px solid ${COLOR_BLACK}`,
                            borderTop: index === 0 ? `2px solid ${COLOR_BLACK}` : "none",
                            backgroundColor: COLOR_WHITE,
                            color: COLOR_BLACK,
                            fontSize: "0.85rem",
                            fontWeight: "700",
                            padding: "0 1.25rem",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            boxSizing: "border-box",
                          }}
                        >
                          <span style={{ fontSize: "0.75rem", opacity: 0.8 }}>{item.label}</span>
                          <input
                            type="color"
                            value={(theme as any)[item.key]}
                            onChange={(e) => {
                              setTheme(prev => ({
                                ...prev,
                                [item.key]: e.target.value
                              }));
                            }}
                            style={{
                              border: "none",
                              width: "24px",
                              height: "24px",
                              padding: 0,
                              backgroundColor: "transparent",
                              cursor: "pointer",
                              outline: "none",
                            }}
                          />
                        </div>
                      );
                    })}
                    {/* Reset ボタン */}
                    <button
                      onClick={() => {
                        setTheme(defaultTheme);
                        showToast("テーマを初期値に戻しました");
                      }}
                      style={{
                        width: "180px",
                        height: "44px",
                        border: `2px solid ${COLOR_BLACK}`,
                        borderTop: "none",
                        backgroundColor: COLOR_WHITE,
                        color: COLOR_BLACK,
                        fontSize: "0.85rem",
                        fontWeight: "700",
                        cursor: "pointer",
                        textAlign: "center",
                        padding: "0 1.25rem",
                        transition: "all 0.15s ease-in-out",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = COLOR_BLACK;
                        e.currentTarget.style.color = COLOR_WHITE;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = COLOR_WHITE;
                        e.currentTarget.style.color = COLOR_BLACK;
                      }}
                    >
                      Reset
                    </button>
                  </div>
                )}

                {/* ファイル挿入の各ターゲット（右展開） */}
                {isFileInsertOpen && (
                  <div style={{
                    display: "flex",
                    flexDirection: "column",
                    backgroundColor: COLOR_WHITE,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
                    marginLeft: "-2px", // メインメニューの右ボーダーと重ねる
                  }}>
                    {[
                      { label: "左エディタに挿入", target: "left" as const },
                      { label: "右エディタに挿入", target: "right" as const },
                    ].map((item, index) => {
                      return (
                        <button
                          key={item.target}
                          onClick={() => handleFileInsertClick(item.target)}
                          style={{
                            width: "180px",
                            height: "44px",
                            border: `2px solid ${COLOR_BLACK}`,
                            borderTop: index === 0 ? `2px solid ${COLOR_BLACK}` : "none",
                            backgroundColor: COLOR_WHITE,
                            color: COLOR_BLACK,
                            fontSize: "0.85rem",
                            fontWeight: "700",
                            cursor: "pointer",
                            textAlign: "left",
                            padding: "0 1.25rem",
                            transition: "all 0.15s ease-in-out",
                            display: "flex",
                            alignItems: "center",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = COLOR_BLACK;
                            e.currentTarget.style.color = COLOR_WHITE;
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = COLOR_WHITE;
                            e.currentTarget.style.color = COLOR_BLACK;
                          }}
                        >
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 2段目: コマンド表示領域 */}
          <div style={{
            padding: "0.6rem 2rem 0.6rem 2rem", // 上下の余白を十分に確保
            fontSize: "0.85rem",
            color: COLOR_BLACK,
            display: "flex",
            justifyContent: "center", // 中央寄せ
            gap: "1.5rem", // ボタンが増えたため、間隔を少し狭める
            visibility: mode === "match" ? "visible" : "hidden",
            height: "3.2rem", // 高さを広げてボタンが二重境界線に重ならないように調整
            alignItems: "center",
            boxSizing: "border-box",
          }}>
            <button
              onClick={handleInsertHighlight}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                background: "transparent",
                border: `1px solid ${COLOR_BLACK}`, // 枠線を細く
                borderRadius: "4px",
                padding: "0.3rem 0.8rem",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: "0.85rem",
                fontWeight: "700",
                color: COLOR_BLACK,
                transition: "all 0.15s ease-in-out",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = COLOR_BLACK;
                e.currentTarget.style.color = COLOR_WHITE;
                const keycap = e.currentTarget.querySelector(".keycap") as HTMLElement;
                if (keycap) {
                  keycap.style.backgroundColor = COLOR_WHITE;
                  keycap.style.color = COLOR_BLACK;
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
                e.currentTarget.style.color = COLOR_BLACK;
                const keycap = e.currentTarget.querySelector(".keycap") as HTMLElement;
                if (keycap) {
                  keycap.style.backgroundColor = COLOR_BLACK;
                  keycap.style.color = COLOR_WHITE;
                }
              }}
            >
              <span>新規挿入</span>
              <span className="keycap" style={{
                backgroundColor: COLOR_BLACK,
                color: COLOR_WHITE,
                padding: "0.1rem 0.35rem",
                borderRadius: "3px",
                fontSize: "0.7rem",
                fontWeight: "700",
                transition: "all 0.15s ease-in-out",
              }}>Ctrl + Enter</span>
            </button>
            <button
              onClick={handleExtendHighlight}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                background: "transparent",
                border: `1px solid ${COLOR_BLACK}`, // 枠線を細く
                borderRadius: "4px",
                padding: "0.3rem 0.8rem",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: "0.85rem",
                fontWeight: "700",
                color: COLOR_BLACK,
                transition: "all 0.15s ease-in-out",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = COLOR_BLACK;
                e.currentTarget.style.color = COLOR_WHITE;
                const keycap = e.currentTarget.querySelector(".keycap") as HTMLElement;
                if (keycap) {
                  keycap.style.backgroundColor = COLOR_WHITE;
                  keycap.style.color = COLOR_BLACK;
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
                e.currentTarget.style.color = COLOR_BLACK;
                const keycap = e.currentTarget.querySelector(".keycap") as HTMLElement;
                if (keycap) {
                  keycap.style.backgroundColor = COLOR_BLACK;
                  keycap.style.color = COLOR_WHITE;
                }
              }}
            >
              <span>範囲拡張</span>
              <span className="keycap" style={{
                backgroundColor: COLOR_BLACK,
                color: COLOR_WHITE,
                padding: "0.1rem 0.35rem",
                borderRadius: "3px",
                fontSize: "0.7rem",
                fontWeight: "700",
                transition: "all 0.15s ease-in-out",
              }}>Ctrl + Shift + Enter</span>
            </button>
            <button
              onClick={handleRemoveHighlight}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                background: "transparent",
                border: `1px solid ${COLOR_BLACK}`, // 枠線を細く
                borderRadius: "4px",
                padding: "0.3rem 0.8rem",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: "0.85rem",
                fontWeight: "700",
                color: COLOR_BLACK,
                transition: "all 0.15s ease-in-out",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = COLOR_BLACK;
                e.currentTarget.style.color = COLOR_WHITE;
                const keycap = e.currentTarget.querySelector(".keycap") as HTMLElement;
                if (keycap) {
                  keycap.style.backgroundColor = COLOR_WHITE;
                  keycap.style.color = COLOR_BLACK;
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
                e.currentTarget.style.color = COLOR_BLACK;
                const keycap = e.currentTarget.querySelector(".keycap") as HTMLElement;
                if (keycap) {
                  keycap.style.backgroundColor = COLOR_BLACK;
                  keycap.style.color = COLOR_WHITE;
                }
              }}
            >
              <span>部分解除</span>
              <span className="keycap" style={{
                backgroundColor: COLOR_BLACK,
                color: COLOR_WHITE,
                padding: "0.1rem 0.35rem",
                borderRadius: "3px",
                fontSize: "0.7rem",
                fontWeight: "700",
                transition: "all 0.15s ease-in-out",
              }}>Ctrl + -</span>
            </button>
            <button
              onClick={handleDeleteHighlight}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                background: "transparent",
                border: `1px solid ${COLOR_BLACK}`, // 枠線を細く
                borderRadius: "4px",
                padding: "0.3rem 0.8rem",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: "0.85rem",
                fontWeight: "700",
                color: COLOR_BLACK,
                transition: "all 0.15s ease-in-out",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = COLOR_BLACK;
                e.currentTarget.style.color = COLOR_WHITE;
                const keycap = e.currentTarget.querySelector(".keycap") as HTMLElement;
                if (keycap) {
                  keycap.style.backgroundColor = COLOR_WHITE;
                  keycap.style.color = COLOR_BLACK;
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
                e.currentTarget.style.color = COLOR_BLACK;
                const keycap = e.currentTarget.querySelector(".keycap") as HTMLElement;
                if (keycap) {
                  keycap.style.backgroundColor = COLOR_BLACK;
                  keycap.style.color = COLOR_WHITE;
                }
              }}
            >
              <span>タグ削除</span>
              <span className="keycap" style={{
                backgroundColor: COLOR_BLACK,
                color: COLOR_WHITE,
                padding: "0.1rem 0.35rem",
                borderRadius: "3px",
                fontSize: "0.7rem",
                fontWeight: "700",
                transition: "all 0.15s ease-in-out",
              }}>Ctrl + Shift + -</span>
            </button>
          </div>
        </header>

        {/* メインの左右スプリットビュー */}
        <main style={{
          display: "flex",
          flex: 1,
          borderBottom: `2px solid ${COLOR_BLACK}`, // 境界線を少し太く
        }}>
          {/* 左側エディタ領域 */}
          <section style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            padding: "0 1rem", // 左右の余白を減らし、エディタの幅を拡張
            backgroundColor: COLOR_WHITE,
          }}>
            <h2 style={{
              fontSize: "1.25rem",
              fontWeight: "700",
              marginBottom: "0.5rem",
              marginTop: "0.5rem",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}>
              Editor A
            </h2>

            {/* 左右に3px線を含めたコンテナ */}
            <div style={{
              display: "flex",
              alignItems: "stretch",
              flex: 1,
              gap: "1rem",
            }}>
              {/* 左の3px線 */}
              <div style={{
                width: "3px",
                backgroundColor: COLOR_BLACK,
                opacity: isFocusedLeft ? 1 : 0,
                transition: "opacity 0.15s ease-in-out",
              }} />

              {/* エディタ入力領域 */}
              <div style={{
                flex: 1,
                backgroundColor: COLOR_BEIGE_WHITE,
                border: `2px solid ${COLOR_BLACK}`, // エディタ枠線を少し太く
                padding: "1.5rem 2rem", // 内部の左右余白を広げ、文字の空間を確保
                minHeight: "400px",
                outline: "none",
                display: "flex",
                flexDirection: "column",
              }}>
                <Slate key={`left-${importKey}`} editor={editorLeft} initialValue={valueLeft}>
                  <Editable
                    placeholder="左側のエディタに入力..."
                    onBeforeInput={(event) => {
                      if (mode !== "edit") event.preventDefault();
                    }}
                    onFocus={() => { setIsFocusedLeft(true); setIsFocusedRight(false); }}
                    onBlur={() => { setIsFocusedLeft(false); setIsFocusedRight(true); }}
                    onKeyDown={(event) => handleKeyDown(event, editorLeft)}
                    onMouseUp={() => handleMouseUp(editorLeft)}
                    renderElement={renderElement}
                    renderLeaf={renderLeaf}
                    style={{ flex: 1, height: "100%", outline: "none" }}
                  />
                </Slate>
              </div>

              {/* 右の3px線 */}
              <div style={{
                width: "3px",
                backgroundColor: COLOR_BLACK,
                opacity: isFocusedLeft ? 1 : 0,
                transition: "opacity 0.15s ease-in-out",
              }} />
            </div>
          </section>

          {/* Editor AとBの境界線（ヘッダの二本線から離すために独立したディバイダーにする） */}
          <div style={{
            width: "2px", // 境界線を少し太く
            backgroundColor: COLOR_BLACK,
            marginTop: "0.5rem", // ヘッダとの境界線から離すための余白
            marginBottom: "0.5rem", // 下部も同様に離す
          }} />

          {/* 右側エディタ領域 */}
          <section style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            padding: "0 1rem", // 左右の余白を減らし、エディタの幅を拡張
            backgroundColor: COLOR_WHITE,
          }}>
            <h2 style={{
              fontSize: "1.25rem",
              fontWeight: "700",
              marginBottom: "0.5rem",
              marginTop: "0.5rem",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}>
              Editor B
            </h2>

            {/* 左右に3px線を含めたコンテナ */}
            <div style={{
              display: "flex",
              alignItems: "stretch",
              flex: 1,
              gap: "1rem",
            }}>
              {/* 左の3px線 */}
              <div style={{
                width: "3px",
                backgroundColor: COLOR_BLACK,
                opacity: isFocusedRight ? 1 : 0,
                transition: "opacity 0.15s ease-in-out",
              }} />

              {/* エディタ入力領域 */}
              <div style={{
                flex: 1,
                backgroundColor: COLOR_BEIGE_WHITE,
                border: `2px solid ${COLOR_BLACK}`, // エディタ枠線を少し太く
                padding: "1.5rem 2rem", // 内部の左右余白を広げ、文字の空間を確保
                minHeight: "400px",
                outline: "none",
                display: "flex",
                flexDirection: "column",
              }}>
                <Slate key={`right-${importKey}`} editor={editorRight} initialValue={valueRight}>
                  <Editable
                    placeholder="右側のエディタに入力..."
                    onBeforeInput={(event) => {
                      if (mode !== "edit") event.preventDefault();
                    }}
                    onFocus={() => { setIsFocusedRight(true); setIsFocusedLeft(false); }}
                    onBlur={() => { setIsFocusedRight(false); setIsFocusedLeft(true); }}
                    onKeyDown={(event) => handleKeyDown(event, editorRight)}
                    onMouseUp={() => handleMouseUp(editorRight)}
                    renderElement={renderElement}
                    renderLeaf={renderLeaf}
                    style={{ flex: 1, height: "100%", outline: "none" }}
                  />
                </Slate>
              </div>

              {/* 右の3px線 */}
              <div style={{
                width: "3px",
                backgroundColor: COLOR_BLACK,
                opacity: isFocusedRight ? 1 : 0,
                transition: "opacity 0.15s ease-in-out",
              }} />
            </div>
          </section>
        </main>

        {/* トースト通知 */}
        {toastMessage && (
          <div style={{
            position: "fixed",
            bottom: "2.5rem",
            left: "50%",
            transform: "translateX(-50%)",
            backgroundColor: "#1a1a1a",
            color: "#ffffff",
            padding: "0.65rem 1.4rem",
            borderRadius: "6px",
            fontSize: "0.875rem",
            fontWeight: "500",
            boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
            zIndex: 9999,
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}>
            {toastMessage}
          </div>
        )}

        {/* フッター（補助的テキスト） */}
        <footer style={{
          padding: "1rem 2rem",
          textAlign: "center",
          fontSize: "0.75rem",
          letterSpacing: "0.05em",
          backgroundColor: COLOR_WHITE,
          color: COLOR_BLACK,
        }}>
          © {new Date().getFullYear()} DoubleApple. Minimal Slate Editor.
        </footer>
      </div>
    </ModeContext.Provider>
  );
}
