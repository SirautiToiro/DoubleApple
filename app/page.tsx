"use client";
import React, { useState } from "react";
import Image from "next/image";
import { createEditor, BaseEditor, Element, Descendant } from "slate";
import { Slate, Editable, withReact, ReactEditor } from "slate-react";

//DoubleApple\node_modules\slate\dist\types\custom-types.d.ts
//に、型定義ファイルがある

const initialValueLeft: Descendant[] = [
  {
    type: "paragraph",
    hovertag: null,
    children: [{ text: "左側のエディタです。ここにテキストを入力してください。" }],
  },
];

const initialValueRight: Descendant[] = [
  {
    type: "paragraph",
    hovertag: null,
    children: [{ text: "右側のエディタです。ここにテキストを入力してください。" }],
  },
];

export default function Home() {
  const [editorLeft] = useState(() => withReact(createEditor()));
  const [editorRight] = useState(() => withReact(createEditor()));

  // フォーカス状態を管理するState
  const [isFocusedLeft, setIsFocusedLeft] = useState(false);
  const [isFocusedRight, setIsFocusedRight] = useState(false);

  // 3色定義
  const COLOR_BLACK = "#000000";
  const COLOR_WHITE = "#FFFFFF";
  const COLOR_BEIGE_WHITE = "#FAF9F5"; // ごく僅かにベージュが混ざった白

  return (
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
                  onFocus={() => setIsFocusedLeft(true)}
                  onBlur={() => setIsFocusedLeft(false)}
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
                  onFocus={() => setIsFocusedRight(true)}
                  onBlur={() => setIsFocusedRight(false)}
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
  );
}
