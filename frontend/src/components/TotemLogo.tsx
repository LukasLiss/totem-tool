/**
 * The TOTeM logo (the two staggered T's of the favicon, public/favicon.svg),
 * in the current text colour: black on light, white on dark backgrounds.
 */
export function TotemLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 1024 1024" fill="currentColor" role="img" aria-label="TOTeM" className={className}>
      <g transform="translate(123, 123) scale(0.5557)">
        <path d="M 0 0 H 800 V 160 H 500 V 1000 H 300 V 160 H 0 Z" />
      </g>
      <g transform="translate(456, 345) scale(0.5557)">
        <path d="M 0 0 H 800 V 160 H 500 V 1000 H 300 V 160 H 0 Z" />
      </g>
    </svg>
  );
}

export default TotemLogo;
