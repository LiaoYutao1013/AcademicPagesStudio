/**
 * Inline SVG icon set. All icons are 24×24, stroke-based and inherit
 * `currentColor`, so a single CSS colour rule covers the whole UI.
 */

const PATHS = {
  docs: 'M7 3h7l4 4v14H7z M14 3v4h4 M10 12h6 M10 16h6',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4.5 20a7.5 7.5 0 0 1 15 0',
  nav: 'M4 7h16 M4 12h10 M4 17h7',
  layers: 'M12 3l8 4.5-8 4.5-8-4.5L12 3z M4 12.5l8 4.5 8-4.5 M4 17l8 4.5 8-4.5',
  sync: 'M20 11a8 8 0 0 0-13.7-5M4 13a8 8 0 0 0 13.7 5 M20 4v5h-5 M4 20v-5h5',
  branch: 'M7 5v9 M7 5a2 2 0 1 0 0-.01 M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M7 11a6 6 0 0 0 6 6h2',
  plus: 'M12 5v14 M5 12h14',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M16.4 16.4L21 21',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7 M20 4v7h-7',
  folder: 'M3 7h6l2 2h10v10H3z',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13',
  close: 'M6 6l12 12 M18 6L6 18',
  bold: 'M7 4h6a4 4 0 0 1 0 8H7z M7 12h7a4 4 0 0 1 0 8H7z',
  italic: 'M10 4h8 M6 20h8 M15 4l-6 16',
  code: 'M9 8l-4 4 4 4 M15 8l4 4-4 4',
  codeblock: 'M4 5h16v14H4z M9 10l-2 2 2 2 M15 10l2 2-2 2',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 1 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 1 0 5.7 5.7l1-1',
  image: 'M3 5h18v14H3z M8.5 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M4 18l5-5 4 4 3-3 4 4',
  quote: 'M7 7h4v4a4 4 0 0 1-4 4z M15 7h4v4a4 4 0 0 1-4 4z',
  list: 'M8 6h12 M8 12h12 M8 18h12 M4 6h.01 M4 12h.01 M4 18h.01',
  ordered: 'M8 6h12 M8 12h12 M8 18h12 M3 5h1v4 M3 13h2l-2 2h2 M3 19h2v2H3',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 6l6 6-6 6',
  up: 'M12 19V5 M6 11l6-6 6 6',
  down: 'M12 5v14 M6 13l6 6 6-6',
  drag: 'M9 6h.01 M9 12h.01 M9 18h.01 M15 6h.01 M15 12h.01 M15 18h.01',
  check: 'M5 12l4 4 10-10',
  warn: 'M12 4l9 16H3z M12 10v4 M12 17h.01',
  external: 'M14 4h6v6 M20 4l-9 9 M18 14v6H4V6h6',
  key: 'M15 9a3 3 0 1 0-2.8 3.9L10 15H8v2H6v2H3v-3l7.1-7.1A3 3 0 0 0 15 9z',
  commit: 'M12 3v10 M12 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M5 12h4 M15 12h4',
  cloud: 'M7 18a4 4 0 0 1 0-8 5 5 0 0 1 9.6 1.3A3.5 3.5 0 0 1 17 18z',
  file: 'M7 3h7l4 4v14H7z M14 3v4h4',
  edit: 'M4 20h4l10-10-4-4L4 16z M14 6l4 4',
  eye: 'M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  split: 'M12 4v16 M4 5h5v14H4z M15 5h5v14h-5z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v6 M12 8h.01',
  play: 'M7 4l12 8-12 8z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19 12c0-.6-.1-1.1-.2-1.6l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2.8-1.6L13.3 2h-3.6l-.4 2.9A7 7 0 0 0 6.5 6.5l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 3.2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2.8 1.6l.4 2.9h3.6l.4-2.9a7 7 0 0 0 2.8-1.6l2.3 1 2-3.4-2-1.5c.1-.5.2-1 .2-1.6z',
};

export function Icon({ name, size = 16, className = '' }) {
  const path = PATHS[name];
  if (!path) return null;
  return (
    <svg
      className={`icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} />
    </svg>
  );
}

export default Icon;
