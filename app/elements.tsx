import { highlightManager } from "./higilightManager";
import { Editor, Transforms, Element, Range } from "slate";
import { RenderElementProps, RenderLeafProps, ReactEditor, useSlateStatic } from "slate-react";
import styles from "./page.module.css";

//カーソルを重ねるとハイライトを提供する
export const HighlightElement = (props: RenderElementProps) => {
  const editor = useSlateStatic();
  var tag = props.element.hovertag;
  var isHighlighted = (props.element as any).highlighted === true;

  const HandleMouseEnter = () => {
    console.log("HandleMouseEnter", tag);
    if (tag === null) return;
    highlightManager?.AddMouseEnterings(tag);
    highlightManager?.SetHighlighted();
  };
  const HandleMouseLeave = () => {
    if (tag === null) return;
    highlightManager?.RemoveMouseEntering(tag);
    highlightManager?.SetHighlighted();
  };

  return (
    <span
      {...props.attributes}
      onMouseEnter={HandleMouseEnter}
      onMouseLeave={HandleMouseLeave}
      //Pathであるタグが文字列化したものがclassNameに追加される
      className={`${tag?.toString() ?? ""} ${isHighlighted ? styles.highlighted : ""}`}
    >
      {props.children}
    </span>
  );
};

export const CodeElement = (props: RenderElementProps) => {
  return (
    <pre {...props.attributes}>
      <code>{props.children}</code>
    </pre>
  );
};

// Define a React component to render leaves with bold text.
export const Leaf = (props: RenderLeafProps) => {
  return (
    <span
      {...props.attributes}
      style={{ fontWeight: props.leaf.bold ? "bold" : "normal" }}
    >
      {props.children}
    </span>
  );
};

export const IsSameElement = (e1: Element, e2: Element) => {
  return e1.type === e2.type && e1.hovertag === e2.hovertag;
};

// //カーソルを重ねるとハイライトを提供する
// const HighlightElement = (props: any) => {
//   var tag = props.element.hovertag;

//   const HandleMouseEnter = () => {
//     console.log("hovered");
//     mouseEnterings.push(tag);
//     SetHighlighted();
//   };
//   const HandleMouseLeave = () => {
//     console.log("leave");
//     mouseEnterings = mouseEnterings.filter((n) => !(n === tag));
//     SetHighlighted();
//   };

//   return (
//     <span
//       {...props.attributes}
//       onMouseEnter={HandleMouseEnter}
//       onMouseLeave={HandleMouseLeave}
//       className={tag}
//     >
//       {props.children}
//     </span>
//   );
// };

// const CodeElement = (props: any) => {
//   return (
//     <pre {...props.attributes}>
//       <code>{props.children}</code>
//     </pre>
//   );
// };

// // Define a React component to render leaves with bold text.
// const Leaf = (props: any) => {
//   return (
//     <span
//       {...props.attributes}
//       style={{ fontWeight: props.leaf.bold ? "bold" : "normal" }}
//     >
//       {props.children}
//     </span>
//   );
// };

// const IsSameElement = (e1: Element, e2: Element) => {
//   return e1.type === e2.type && e1.hovertag === e2.hovertag;
// };
