import styles from "./page.module.css";
import { Path, Editor, Transforms } from "slate";

//マウスが重ねられた位置のhovertagを認識し、それより下位にhovertagがない場合、
//そのhovertagと同一とみなされる全てのhovertagが(CSSのタグをつけられて)光る。
//マウスが重ねられた位置のhovertagには、idが文字列になって記述されている。
//読み込むときは、highlightTagMapにidと対応するPathの配列をMapにしたものを格納し、
//マウスが重ねられた時はidからPath of Allを検索する。
//useRef と requestAnimationFrame を使用し、最後に重ねられた時のonMouseEnterイベントで、
//光らせられるべき場所にstyles.highlightedを追加し、CSSが認識して色を変える

class HighlightManager {
  //マウスが現在重ねられている場所のidをすべて配列にして保存
  private mouseEnterings: number[];
  private animationFrameId: number | null = null;

  //hovertagのIDとハイライトされるべき場所のMap
  private highlightTagMap = new Map<number, Path[]>();

  //前回ハイライトしたパスの記録
  private lastHighlightedPaths: Path[];

  // コンストラクタ
  constructor() {
    this.mouseEnterings = [];
    this.lastHighlightedPaths = [];
    console.log("start");

    // highlightTagMap の仮データ初期化
    // 1 -> Path [1] (親要素)
    // 2 -> Path [1, 0] (子要素)
    this.highlightTagMap.set(1, [[1]]);
    this.highlightTagMap.set(2, [[1, 0]]);
  }

  AddMouseEnterings = (tag: number) => {
    console.log("add", tag);
    // 重複を避けるため、すでに存在する場合は一度削除して末尾（最新）に追加する
    this.mouseEnterings = this.mouseEnterings.filter((t) => t !== tag);
    this.mouseEnterings.push(tag);

    console.log(this.mouseEnterings);
  };

  RemoveMouseEntering = (tag: number) => {
    console.log("remove", tag);
    // 配列から該当のタグを取り除く
    this.mouseEnterings = this.mouseEnterings.filter((t) => t !== tag);

    console.log(this.mouseEnterings);
  };

  // ユーザーの呼び出し方に合わせたエイリアス
  RemoveMouseEnterings = this.RemoveMouseEntering;

  //ハイライトのオンオフを調節する
  SetHighlighted = (editor: Editor) => {
    // すでに予約されているアニメーションフレームがあればキャンセル（デバウンス）
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }

    // requestAnimationFrame を使い、同期的イベント処理がすべて完了した次のフレームで実行する
    this.animationFrameId = requestAnimationFrame(() => {
      this.animationFrameId = null;

      // 1. 前回のハイライトをクリアする
      if (this.lastHighlightedPaths.length > 0) {
        this.lastHighlightedPaths.forEach((path) => {
          if (Editor.hasPath(editor, path)) {
            Transforms.setNodes(editor, { highlighted: false } as any, {
              at: path,
            });
          }
        });
        this.lastHighlightedPaths = [];
      }

      // 2. 重なっている要素がないなら終了
      if (this.mouseEnterings.length === 0) return;

      // 3. mouseEnterings配列内を探索し、最も深いPathのものをtargetTagに入れる
      let targetTag = this.mouseEnterings[this.mouseEnterings.length - 1];
      let maxDepth = -1;

      for (const tag of this.mouseEnterings) {
        const paths = this.highlightTagMap.get(tag);
        if (paths && paths.length > 0) {
          const depth = Math.max(...paths.map((p) => p.length));
          if (depth >= maxDepth) {
            maxDepth = depth;
            targetTag = tag;
          }
        }
      }

      // 4. highlightTagMapから対応するPath[]を取得し、それに対応するDOM要素をハイライトする
      const paths = this.highlightTagMap.get(targetTag);
      if (paths) {
        paths.forEach((path) => {
          if (Editor.hasPath(editor, path)) {
            Transforms.setNodes(editor, { highlighted: true } as any, {
              at: path,
            });
            this.lastHighlightedPaths.push(path);
          }
        });
      }

      console.log(`Highlighted elements for tag: ${targetTag}`);
    });
  };
}

export const highlightManager = new HighlightManager();

// //マウスが重なっているものの一覧を管理するリスト
// let mouseEnterings: string[] = [];

// const SetHighlighted = () => {
//   console.log(mouseEnterings);
//   let highlighteds = document.getElementsByClassName(styles.highlighted);
//   Array.from(highlighteds).forEach((e) => {
//     e.classList.remove(styles.highlighted);
//     console.log("削除");
//   });

//   if (mouseEnterings.includes("hover0_0")) {
//     var hovers = document.getElementsByClassName("hover0_0");

//     Array.from(hovers).forEach((element) => {
//       element.classList.add(styles.highlighted);
//     });
//   } else if (mouseEnterings.includes("hover0")) {
//     var hovers = document.getElementsByClassName("hover0");

//     Array.from(hovers).forEach((element) => {
//       element.classList.add(styles.highlighted);
//     });
//   }
// };
