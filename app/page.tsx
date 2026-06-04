"use client";
import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import Image from "next/image";
import { createEditor, BaseEditor, Element, Descendant, Editor, Transforms, Range } from "slate";
import { Slate, Editable, withReact, ReactEditor, RenderElementProps, RenderLeafProps } from "slate-react";
import { initHighlightManager, highlightManager } from "./higilightManager";
import { Leaf, HighlightElement, CodeElement, IsSameElement } from "./elements";
import { Mode, ModeContext } from "./modeContext";

//DoubleApple\node_modules\slate\dist\types\custom-types.d.ts
//に、型定義ファイルがある

///説明///
//手動翻訳の支援アプリ。
//左右のエディタに対応をタグ付けでき、その対応をマウスカーソルを重ねることでハイライトできる

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
    const { isInline } = editor;
    editor.isInline = (element: any) => {
      return element.type === "inline" ? true : isInline(element);
    };
    return editor;
  });
  const [editorRight] = useState(() => {
    const editor = withReact(createEditor());
    const { isInline } = editor;
    editor.isInline = (element: any) => {
      return element.type === "inline" ? true : isInline(element);
    };
    return editor;
  });

  // HighlightManagerの初期化（エディタをキャッシュ）
  useMemo(() => initHighlightManager(editorLeft, editorRight), [editorLeft, editorRight]);

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

      if (!allowedKeys.includes(event.key)) {
        event.preventDefault();
      }
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      editor.insertText("\n");
    }
  }, [mode]);

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
