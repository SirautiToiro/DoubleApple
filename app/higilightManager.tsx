import styles from "./page.module.css";
import { Editor } from "slate";

// マウスが重ねられた位置のhovertagを認識し、
// document.querySelectorAllを用いて同一のhovertagを持つ全DOM要素に
// 一括してハイライト用CSSクラス（styles.highlighted）を着脱します。
// これにより、極めて長大なドキュメントでも処理速度ほぼゼロで動作します。

class HighlightManager {
  // マウスが現在重ねられている場所のidをすべて配列にして保存
  private mouseEnterings: number[];
  private animationFrameId: number | null = null;

  // キャッシュされたエディタ参照
  private leftEditor: Editor;
  private rightEditor: Editor;

  // コンストラクタ
  constructor(leftEditor: Editor, rightEditor: Editor) {
    this.mouseEnterings = [];
    this.leftEditor = leftEditor;
    this.rightEditor = rightEditor;
  }

  AddMouseEnterings = (tag: number) => {
    // 重複を避けるため、すでに存在する場合は一度削除して末尾（最新）に追加する
    this.mouseEnterings = this.mouseEnterings.filter((t) => t !== tag);
    this.mouseEnterings.push(tag);
  };

  RemoveMouseEntering = (tag: number) => {
    // 配列から該当のタグを取り除く
    this.mouseEnterings = this.mouseEnterings.filter((t) => t !== tag);
  };

  // ユーザーの呼び出し方に合わせたエイリアス
  RemoveMouseEnterings = this.RemoveMouseEntering;

  // ハイライトのオンオフを調節する
  SetHighlighted = () => {
    // すでに予約されているアニメーションフレームがあればキャンセル（デバウンス）
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }

    // requestAnimationFrame を使い、同期的イベント処理がすべて完了した次のフレームで実行する
    this.animationFrameId = requestAnimationFrame(() => {
      this.animationFrameId = null;

      // 1. 古いハイライト要素からクラスを一括削除 (ブラウザネイティブ処理のため極めて高速)
      const oldHighlights = document.querySelectorAll(`.${styles.highlighted}`);
      oldHighlights.forEach((el) => {
        el.classList.remove(styles.highlighted);
      });

      // 2. 重なっている要素がないなら終了
      if (this.mouseEnterings.length === 0) return;

      // 3. 最も新しくホバーされたタグを特定
      const targetTag = this.mouseEnterings[this.mouseEnterings.length - 1];

      // 4. 対象のタグ属性を持つDOM要素をピンポイントで抽出し、ハイライトクラスを追加
      const newHighlights = document.querySelectorAll(`[data-hovertag="${targetTag}"]`);
      newHighlights.forEach((el) => {
        el.classList.add(styles.highlighted);
      });
    });
  };
}

// モジュールレベルのインスタンス（page.tsxからinitHighlightManagerで初期化される）
let highlightManager: HighlightManager | null = null;

export function initHighlightManager(leftEditor: Editor, rightEditor: Editor): HighlightManager {
  highlightManager = new HighlightManager(leftEditor, rightEditor);
  return highlightManager;
}

export { HighlightManager, highlightManager };
