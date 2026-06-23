"use client";
import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import Image from "next/image";
import { createEditor, BaseEditor, Element, Descendant, Editor, Transforms, Range, Text, Node, NodeEntry, Path, Point } from "slate";
import { Slate, Editable, withReact, ReactEditor, RenderElementProps, RenderLeafProps } from "slate-react";
import { initHighlightManager, highlightManager } from "./higilightManager";
import { Leaf, HighlightElement, CodeElement, IsSameElement } from "./elements";
import { Mode, ModeContext } from "./modeContext";
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
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown);
    };
  }, []);





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
    const editor = withReact(createEditor());
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
    const editor = withReact(createEditor());
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
      format: "DoubleApple",
      version: "1.0",
      editorLeft: editorLeft.children,
      editorRight: editorRight.children,
    };

    if (typeof window !== "undefined" && "showSaveFilePicker" in window) {
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: `doubleapple_backup_${Date.now()}.dapl`,
          types: [{
            description: "DoubleApple Backup File",
            accept: {
              "application/json": [".dapl"],
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
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `doubleapple_backup_${Date.now()}.dapl`;
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

    if (!file.name.endsWith(".dapl")) {
      showToast("拡張子が .dapl のファイルを選択してください");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);

        if (data.format !== "DoubleApple") {
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

  // キー入力ハンドラー
  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>, editor: ReactEditor & BaseEditor) => {
    if (mode !== "edit") {
      const allowedKeys = [
        "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
        "Home", "End", "PageUp", "PageDown",
      ];
      const isCmdOrCtrl = event.metaKey || event.ctrlKey;

      // Ctrl+C などのコピー操作は許可
      if (isCmdOrCtrl && (event.key === "c" || event.key === "C")) {
        return;
      }

      // モード切り替え用のキー（Tab）は許可
      if (event.key === "Tab") {
        return;
      }

      // 対応モード中の Ctrl+Enter: insertHighlight を hovertag inline ノードに変換
      if (mode === "match" && isCmdOrCtrl && event.key === "Enter") {
        event.preventDefault();

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
        return;
      }

      // 対応モード中の Ctrl + - : 左右のエディタの選択範囲と重なる hovertag を持つノードのハイライトを解除
      if (mode === "match" && isCmdOrCtrl && event.key === "-") {
        event.preventDefault();

        const tagsToRemove = new Set<number>();

        // 1. 左右それぞれのエディタで範囲取得と hovertag 収集を行う
        for (const targetEditor of [editorLeft, editorRight]) {
          const rangeInfo = getInsertHighlightRange(targetEditor);
          if (rangeInfo) {
            const { selectionStart, selectionEnd } = rangeInfo;
            // 選択範囲と少しでも重なっている hovertag を収集
            for (const [node, path] of Node.nodes(targetEditor)) {
              if (Element.isElement(node) && typeof (node as any).hovertag === "number") {
                const nodeStart = Editor.start(targetEditor, path);
                const nodeEnd = Editor.end(targetEditor, path);

                // 重なりの判定：nodeStart <= selectionEnd かつ nodeEnd >= selectionStart
                const overlaps = !Point.isAfter(nodeStart, selectionEnd) && !Point.isBefore(nodeEnd, selectionStart);
                if (overlaps) {
                  tagsToRemove.add((node as any).hovertag);
                }
              }
            }
          }
        }

        if (tagsToRemove.size === 0) return;

        // 2. 左右のエディタから、該当する hovertag を持つノードの hovertag を null に更新し、
        // insertHighlight マークもすべて解除する
        for (const targetEditor of [editorLeft, editorRight]) {
          Editor.withoutNormalizing(targetEditor, () => {
            const matches: Path[] = [];
            for (const [node, path] of Node.nodes(targetEditor)) {
              if (Element.isElement(node) && typeof (node as any).hovertag === "number") {
                if (tagsToRemove.has((node as any).hovertag)) {
                  matches.push(path);
                }
              }
            }
            // パスが変わらないように後ろから適用
            for (const path of [...matches].reverse()) {
              Transforms.setNodes(targetEditor, { hovertag: null } as any, { at: path });
            }

            // すべてのエディタから insertHighlight マークを解除する
            for (const [node, path] of Node.nodes(targetEditor)) {
              if (Text.isText(node) && (node as any).insertHighlight) {
                Transforms.unsetNodes(targetEditor, "insertHighlight", { at: path });
              }
            }
          });
        }

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
  }, [mode, editorLeft, editorRight, showToast]);

  return (
    <ModeContext.Provider value={mode}>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".dapl"
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
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "1rem",
          padding: "0.75rem 2rem", // 上下の余白を少し減らす
          borderBottom: `4px double ${COLOR_BLACK}`, // 二本線かつ少し太い境界線
          backgroundColor: COLOR_WHITE,
          position: "relative", // メニューの絶対配置基準
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
                <div
                  key={item.id}
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
                </div>
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
                    label: `Theme Settings ▶`,
                    onClick: () => setIsThemeEditorOpen(prev => !prev),
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
                    { key: "black", label: "Text & Line" },
                    { key: "white", label: "App Bg" },
                    { key: "editorBg", label: "Editor Bg" },
                    { key: "hoverHighlightBg", label: "Hover Bg" },
                    { key: "hoverHighlightText", label: "Hover Text" },
                    { key: "insertHighlightBg", label: "Insert Bg" },
                    { key: "insertHighlightText", label: "Insert Text" },
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
            </div>
          )}
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
