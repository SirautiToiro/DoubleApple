import { highlightManager } from "./higilightManager";
import { Editor, Transforms, Element, Range } from "slate";
import { RenderElementProps, RenderLeafProps, ReactEditor, useSlateStatic } from "slate-react";
import styles from "./page.module.css";
import React, { useContext } from "react";
import { ModeContext } from "./modeContext";

//カーソルを重ねるとハイライトを提供する
export const HighlightElement = (props: RenderElementProps) => {
  var tag = props.element.hovertag;
  const mode = useContext(ModeContext);

  const HandleMouseEnter = () => {
    if (mode !== "confirm") return;
    console.log("HandleMouseEnter", tag);
    if (tag === null || tag === undefined) return;
    highlightManager?.AddMouseEnterings(tag);
    highlightManager?.SetHighlighted();
  };
  const HandleMouseLeave = () => {
    if (mode !== "confirm") return;
    if (tag === null || tag === undefined) return;
    highlightManager?.RemoveMouseEntering(tag);
    highlightManager?.SetHighlighted();
  };

  return (
    <span
      {...props.attributes}
      data-hovertag={tag}
      onMouseEnter={HandleMouseEnter}
      onMouseLeave={HandleMouseLeave}
      className={tag?.toString() ?? ""}
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
  const style: React.CSSProperties = {
    fontWeight: props.leaf.bold ? "bold" : "normal",
    backgroundColor: (props.leaf as any).insertHighlight ? "#5b8f2aff" : undefined,
    color: (props.leaf as any).insertHighlight ? "#FFFFFF" : undefined,
  };
  return (
    <span
      {...props.attributes}
      style={style}
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
