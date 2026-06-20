"use client";
import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import Image from "next/image";
import { createEditor, BaseEditor, Element, Descendant, Editor, Transforms, Range, Text, Node, NodeEntry, Path, Point } from "slate";
import { Slate, Editable, withReact, ReactEditor, RenderElementProps, RenderLeafProps } from "slate-react";
import { initHighlightManager, highlightManager } from "./higilightManager";
import { Leaf, HighlightElement, CodeElement, IsSameElement } from "./elements";
import { Mode, ModeContext } from "./modeContext";

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
  const lastActiveMode = useRef<"edit" | "confirm">("edit");

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
      // Ctrl+q または Ctrl+Q で対応挿入モードをトグル
      if (event.ctrlKey && (event.key === "q" || event.key === "Q")) {
        event.preventDefault();
        setMode((prev) => {
          if (prev === "insert") {
            return lastActiveMode.current;
          } else {
            lastActiveMode.current = prev as "edit" | "confirm";
            return "insert";
          }
        });
      }
      // Tabキーで編集モードと対応確認モードをトグル
      else if (event.key === "Tab") {
        event.preventDefault();
        setMode((prev) => {
          if (prev === "edit") {
            const next: "edit" | "confirm" = "confirm";
            lastActiveMode.current = next;
            return next;
          } else if (prev === "confirm") {
            const next: "edit" | "confirm" = "edit";
            lastActiveMode.current = next;
            return next;
          } else if (prev === "insert") {
            // insert モードからは confirm モードへ遷移
            const next: "edit" | "confirm" = "confirm";
            lastActiveMode.current = next;
            return next;
          }
          return prev;
        });
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown);
    };
  }, []);

  // modeがconfirmから他の状態に遷移したとき、すべてのハイライトを消去
  useEffect(() => {
    if (mode !== "confirm") {
      highlightManager?.ClearHighlight();
    }
  }, [mode]);



  const handleMouseUp = useCallback((editor: ReactEditor & BaseEditor) => {
    if (mode !== "insert") return;
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

  const [editorLeft] = useState(() => {
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
  });
  const [editorRight] = useState(() => {
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
  });

  // HighlightManagerの初期化（エディタをキャッシュ）
  useMemo(() => initHighlightManager(editorLeft, editorRight), [editorLeft, editorRight]);

  // modeがinsertから他の状態に遷移したとき、insertHighlightマークをすべて破棄
  const prevMode = useRef<Mode>(mode);
  useEffect(() => {
    if (prevMode.current === "insert" && mode !== "insert") {
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
    prevMode.current = mode;
  }, [mode, editorLeft, editorRight]);

  // フォーカス状態を管理するState
  const [isFocusedLeft, setIsFocusedLeft] = useState(false);
  const [isFocusedRight, setIsFocusedRight] = useState(false);

  // 3色定義
  const COLOR_BLACK = "#000000";
  const COLOR_WHITE = "#FFFFFF";
  const COLOR_BEIGE_WHITE = "#FAF9F5"; // ごく僅かにベージュが混ざった白

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

      // モード切り替え用のキー（Tab, Ctrl+Q）は許可
      if (event.key === "Tab" || (isCmdOrCtrl && (event.key === "q" || event.key === "Q"))) {
        return;
      }

      // insert モード中の Ctrl+Enter: insertHighlight を hovertag inline ノードに変換
      if (mode === "insert" && isCmdOrCtrl && event.key === "Enter") {
        event.preventDefault();

        // 左右エディタ全体から最大 hovertag を取得し +1 を新タグとする
        let maxTag = 0;
        for (const targetEditor of [editorLeft, editorRight]) {
          for (const [node] of Node.nodes(targetEditor)) {
            if (Element.isElement(node) && typeof (node as any).hovertag === "number") {
              const tag = (node as any).hovertag as number;
              if (tag > maxTag) maxTag = tag;
            }
          }
        }
        const newHoverTag = maxTag + 1;

        // 両エディタの insertHighlight 範囲を取得
        const rangeLeft = getInsertHighlightRange(editorLeft);
        const rangeRight = getInsertHighlightRange(editorRight);
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

      // insert モード中の Ctrl + - : 左右のエディタの選択範囲と重なる hovertag を持つノードのハイライトを解除
      if (mode === "insert" && isCmdOrCtrl && event.key === "-") {
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
      <div style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
        backgroundColor: COLOR_WHITE,
        color: COLOR_BLACK,
        fontFamily: "var(--font-geist-sans), sans-serif",
      }}>
        {/* ヘッダー部分 */}
        <header style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.75rem 2rem", // 上下の余白を少し減らす
          borderBottom: `4px double ${COLOR_BLACK}`, // 二本線かつ少し太い境界線
          backgroundColor: COLOR_WHITE,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
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
              { id: "confirm", label: "対応確認モード", shortcut: "Tab" },
              { id: "insert", label: "対応挿入モード", shortcut: "Ctrl+Q" },
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
                <Slate editor={editorLeft} initialValue={initialValueLeft}>
                  <Editable
                    placeholder="左側のエディタに入力..."
                    readOnly={mode === "confirm"}
                    onBeforeInput={(event) => {
                      if (mode !== "edit") event.preventDefault();
                    }}
                    onFocus={() => setIsFocusedLeft(true)}
                    onBlur={() => setIsFocusedLeft(false)}
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
                <Slate editor={editorRight} initialValue={initialValueRight}>
                  <Editable
                    placeholder="右側のエディタに入力..."
                    readOnly={mode === "confirm"}
                    onBeforeInput={(event) => {
                      if (mode !== "edit") event.preventDefault();
                    }}
                    onFocus={() => setIsFocusedRight(true)}
                    onBlur={() => setIsFocusedRight(false)}
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
