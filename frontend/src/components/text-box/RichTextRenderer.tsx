/**
 * View-mode rendering for the Text Box's rich-text document (#373 follow-up).
 *
 * Walks the stored JSON into React elements. Nothing here builds an HTML
 * string and nothing uses `dangerouslySetInnerHTML`, so a document cannot
 * carry markup into the page no matter what is in the database — the text of
 * every run reaches the DOM as a React text node, which React escapes.
 *
 * Unknown node types render their children rather than vanishing, so a
 * document written by a newer client still shows its text here.
 */
import React from 'react';

import {
  type RichTextDoc,
  type RichTextNode,
  styleFromBlockAttrs,
  styleFromMarks,
} from './richText';

function Inline({ node, keyPrefix }: { node: RichTextNode; keyPrefix: string }) {
  if (node.type === 'text') {
    const style = styleFromMarks(node.marks);
    const text = node.text ?? '';
    // No marks means no wrapper element at all.
    return Object.keys(style).length === 0 ? <>{text}</> : <span style={style}>{text}</span>;
  }
  if (node.type === 'hardBreak') return <br />;
  return <>{renderChildren(node, keyPrefix)}</>;
}

function renderChildren(node: RichTextNode, keyPrefix: string): React.ReactNode[] {
  return (node.content ?? []).map((child, index) => (
    <Block key={`${keyPrefix}-${index}`} node={child} keyPrefix={`${keyPrefix}-${index}`} />
  ));
}

function Block({ node, keyPrefix }: { node: RichTextNode; keyPrefix: string }) {
  const style = styleFromBlockAttrs(node.attrs);

  switch (node.type) {
    case 'text':
    case 'hardBreak':
      return <Inline node={node} keyPrefix={keyPrefix} />;

    case 'paragraph':
      // `margin: 0` because the box controls its own spacing; an empty
      // paragraph still needs height, hence the zero-width space.
      return (
        <p style={{ ...style, margin: 0, minHeight: '1em' }}>
          {(node.content ?? []).length === 0 ? '​' : renderChildren(node, keyPrefix)}
        </p>
      );

    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 3);
      const Tag = (`h${level}` as unknown) as React.ElementType;
      // Headings scale off the box's own font size rather than the browser
      // default, so a heading inside a 12px box stays proportionate.
      const scale = { 1: '1.6em', 2: '1.3em', 3: '1.1em' }[level as 1 | 2 | 3];
      return (
        <Tag style={{ ...style, margin: 0, fontSize: scale, fontWeight: 'bold' }}>
          {renderChildren(node, keyPrefix)}
        </Tag>
      );
    }

    case 'bulletList':
      return (
        <ul style={{ ...style, margin: 0, paddingLeft: '1.4em', listStyle: 'disc' }}>
          {renderChildren(node, keyPrefix)}
        </ul>
      );

    case 'orderedList':
      return (
        <ol style={{ ...style, margin: 0, paddingLeft: '1.6em', listStyle: 'decimal' }}>
          {renderChildren(node, keyPrefix)}
        </ol>
      );

    case 'listItem':
      return <li style={style}>{renderChildren(node, keyPrefix)}</li>;

    case 'blockquote':
      return (
        <blockquote
          style={{
            ...style,
            margin: 0,
            paddingLeft: '0.8em',
            borderLeft: '3px solid currentColor',
            opacity: 0.85,
          }}
        >
          {renderChildren(node, keyPrefix)}
        </blockquote>
      );

    case 'codeBlock':
      return (
        <pre style={{ ...style, margin: 0, whiteSpace: 'pre-wrap' }}>
          <code>{renderChildren(node, keyPrefix)}</code>
        </pre>
      );

    case 'horizontalRule':
      return <hr style={{ border: 0, borderTop: '1px solid currentColor', opacity: 0.3 }} />;

    default:
      // Unknown block: keep the text rather than dropping it.
      return <>{renderChildren(node, keyPrefix)}</>;
  }
}

export function RichTextRenderer({ doc }: { doc: RichTextDoc }) {
  return <>{(doc.content ?? []).map((node, index) => (
    <Block key={`b-${index}`} node={node} keyPrefix={`b-${index}`} />
  ))}</>;
}

export default RichTextRenderer;
