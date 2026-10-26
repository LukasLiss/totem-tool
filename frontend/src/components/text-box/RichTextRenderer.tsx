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
  dashboardIdFromMarks,
  hrefFromMarks,
  isMailtoHref,
  styleFromBlockAttrs,
  styleFromMarks,
} from './richText';

/**
 * How a dashboard link behaves, supplied by the widget.
 *
 * A context rather than a prop threaded through every walker function: the
 * walk is a set of plain module-level functions and only one leaf cares.
 * `RichTextRenderer` still takes plain props, so tests need no provider.
 */
type LinkTargets = {
  onDashboardLink?: (dashboardId: number) => void;
  /**
   * Dashboards that still exist in this project. A link to one that has been
   * deleted since it was written renders as plain text — the save-time check
   * in `api/views/dashboards.py` cannot catch a later deletion.
   */
  knownDashboardIds?: Set<number>;
};

const LinkTargetContext = React.createContext<LinkTargets>({});

/**
 * Links have to be styled here, not in CSS. Tailwind's preflight strips an
 * anchor's colour and underline, and the stylesheet rule for `.tiptap-text-box`
 * only covers the editor — view mode is this walker. Without this a link was
 * indistinguishable from the text around it.
 *
 * Spread *before* the run's own marks, so a colour the user chose still wins.
 */
const LINK_LOOK: React.CSSProperties = {
  color: 'var(--primary)',
  textDecoration: 'underline',
  cursor: 'pointer',
};

/** A dashboard link is a button; strip the chrome a button comes with. */
const LINK_BUTTON_RESET: React.CSSProperties = {
  background: 'none',
  border: 0,
  padding: 0,
  font: 'inherit',
};

function Inline({ node, keyPrefix }: { node: RichTextNode; keyPrefix: string }) {
  const { onDashboardLink, knownDashboardIds } = React.useContext(LinkTargetContext);

  if (node.type === 'text') {
    const style = styleFromMarks(node.marks);
    const text = node.text ?? '';

    // `target` and `rel` are set here and never read from the mark: the
    // document is untrusted, and these two are what keep an opened tab from
    // reaching back into the app. A mailto gets no `target`, because handing
    // off to the mail client would otherwise leave an empty tab behind.
    const href = hrefFromMarks(node.marks);
    if (href) {
      return (
        <a
          href={href}
          target={isMailtoHref(href) ? undefined : '_blank'}
          rel="noopener noreferrer"
          style={{ ...LINK_LOOK, ...style }}
        >
          {text}
        </a>
      );
    }

    // No href at all for a dashboard link: it is an in-app view change, not
    // a navigation, so there is nothing for a URL to leak through.
    const dashboardId = dashboardIdFromMarks(node.marks);
    if (dashboardId !== null && onDashboardLink && knownDashboardIds?.has(dashboardId)) {
      return (
        <button
          type="button"
          style={{ ...LINK_BUTTON_RESET, ...LINK_LOOK, ...style }}
          onClick={() => onDashboardLink(dashboardId)}
        >
          {text}
        </button>
      );
    }

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

export function RichTextRenderer({
  doc,
  onDashboardLink,
  knownDashboardIds,
}: { doc: RichTextDoc } & LinkTargets) {
  const targets = React.useMemo(
    () => ({ onDashboardLink, knownDashboardIds }),
    [onDashboardLink, knownDashboardIds],
  );
  return (
    <LinkTargetContext.Provider value={targets}>
      {(doc.content ?? []).map((node, index) => (
        <Block key={`b-${index}`} node={node} keyPrefix={`b-${index}`} />
      ))}
    </LinkTargetContext.Provider>
  );
}

export default RichTextRenderer;
