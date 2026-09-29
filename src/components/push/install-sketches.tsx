"use client";

import {
  Bookmark,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Ellipsis,
  EllipsisVertical,
  House,
  Layers,
  Menu,
  Plus,
  Share,
  SquarePlus,
  type LucideIcon,
} from "lucide-react";
import { useId } from "react";
import { cn } from "@/lib/utils";

// The install guide's drawings (Marco, 2026-09-29): a simplified sketch of
// the browser's toolbar, menu or share sheet beside each step, with the
// button to tap in `signal`. Inline SVG on the v3 tokens, so light and dark
// follow the page; decorative (aria-hidden): the step's words are complete
// without them. No browser logos or artwork, only Lucide glyphs and shapes.

export type SketchKind =
  | "safari-toolbar"
  | "safari-share"
  | "share-sheet"
  | "web-app-switch"
  | "add-button"
  | "chrome-ios-bar"
  | "android-bar"
  | "android-menu"
  | "install-dialog"
  | "samsung-toolbar"
  | "samsung-menu"
  | "samsung-home"
  | "home-screen";

const W = 96;
const H = 72;
const R = 12;

/** A Lucide glyph centred on (cx, cy); `on` draws the signal disc behind it (the button to tap). */
function Glyph({ icon: Icon, cx, cy, size = 12, on = false, muted = false }: { icon: LucideIcon; cx: number; cy: number; size?: number; on?: boolean; muted?: boolean }) {
  return (
    <>
      {on ? <circle cx={cx} cy={cy} r={size * 0.9} className="fill-signal" /> : null}
      <Icon
        x={cx - size / 2}
        y={cy - size / 2}
        width={size}
        height={size}
        strokeWidth={2.25}
        className={on ? "text-on-signal" : muted ? "text-ink-3" : "text-ink-2"}
      />
    </>
  );
}

/** A line of text, drawn as a bar. */
function Line({ x, y, w, tone = "faint" }: { x: number; y: number; w: number; tone?: "faint" | "ink" | "soft" | "on" }) {
  const fill = { faint: "fill-line", ink: "fill-ink", soft: "fill-ink-3", on: "fill-on-signal" }[tone];
  return <rect x={x} y={y} width={w} height={3} rx={1.5} className={fill} />;
}

/** A pill with a word in it, in `signal` (a text button to tap: Add, Install). */
function Pill({ x, y, w, label }: { x: number; y: number; w: number; label: string }) {
  return (
    <>
      <rect x={x} y={y} width={w} height={14} rx={7} className="fill-signal" />
      <text x={x + w / 2} y={y + 10} textAnchor="middle" className="fill-on-signal text-[8.5px] font-semibold">
        {label}
      </text>
    </>
  );
}

/** A switch, on (`ink` track), ringed in `signal`. */
function OnSwitch({ x, y }: { x: number; y: number }) {
  return (
    <>
      <rect x={x - 3} y={y - 3} width={26} height={18} rx={9} className="fill-none stroke-signal" strokeWidth={2} />
      <rect x={x} y={y} width={20} height={12} rx={6} className="fill-ink" />
      <circle cx={x + 14} cy={y + 6} r={4.5} className="fill-surface" />
    </>
  );
}

/** The app's icon (the real one, from the web app manifest), `size` px, rounded. */
function AppIcon({ x, y, size, clip }: { x: number; y: number; size: number; clip: string }) {
  return (
    <>
      <clipPath id={clip}>
        <rect x={x} y={y} width={size} height={size} rx={size * 0.24} />
      </clipPath>
      <rect x={x} y={y} width={size} height={size} rx={size * 0.24} className="fill-ink" />
      <image href="/app-icons/icon-192.png" x={x} y={y} width={size} height={size} clipPath={`url(#${clip})`} preserveAspectRatio="xMidYMid slice" />
    </>
  );
}

/** Page content behind the browser's own controls. */
function Page({ top = 10, count = 3 }: { top?: number; count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <Line key={i} x={12} y={top + i * 7} w={i % 2 ? 48 : 64} />
      ))}
    </>
  );
}

/** A bar across the bottom of the screen (a toolbar), from `y`. */
const bottomBar = (y: number) => `M0 ${y} H${W} V${H} H0 Z`;
/** A bar across the top of the screen, down to `y`. */
const topBar = (y: number) => `M0 0 H${W} V${y} H0 Z`;

/** The browser's own bar (toolbar or address bar), on `surface`. */
function Bar({ d }: { d: string }) {
  return <path d={d} className="fill-surface" />;
}

function body(kind: SketchKind, ids: { icon: string }) {
  switch (kind) {
    // iPhone Safari (iOS 18 and earlier): the bottom toolbar, Share in the middle.
    case "safari-toolbar":
      return (
        <>
          <Page />
          <rect x={10} y={34} width={76} height={13} rx={6.5} className="fill-surface stroke-line" strokeWidth={1} />
          <Line x={30} y={39} w={36} tone="soft" />
          <Bar d={bottomBar(52)} />
          <line x1={0} x2={W} y1={52} y2={52} className="stroke-line" strokeWidth={1} />
          <Glyph icon={ChevronLeft} cx={13} cy={62} muted />
          <Glyph icon={ChevronRight} cx={31} cy={62} muted />
          <Glyph icon={Share} cx={48} cy={61.5} on />
          <Glyph icon={BookOpen} cx={65} cy={62} />
          <Glyph icon={Copy} cx={83} cy={62} />
        </>
      );
    // iPhone Safari (iOS 26, any layout): Share to tap, and ••• beside it,
    // where Share sits in the Compact layout.
    case "safari-share":
      return (
        <>
          <Page />
          <circle cx={11} cy={58} r={7.5} className="fill-surface stroke-line" strokeWidth={1} />
          <Glyph icon={ChevronLeft} cx={11} cy={58} size={10} muted />
          <rect x={22} y={49.5} width={38} height={17} rx={8.5} className="fill-surface stroke-line" strokeWidth={1} />
          <Line x={29} y={56.5} w={24} tone="soft" />
          <Glyph icon={Share} cx={71} cy={57.5} on />
          <circle cx={87} cy={58} r={7.5} className="fill-surface stroke-line" strokeWidth={1} />
          <Glyph icon={Ellipsis} cx={87} cy={58} size={10} />
        </>
      );
    // The share sheet: Add to Home Screen among its actions.
    case "share-sheet":
      return (
        <>
          <Page count={1} top={6} />
          <path d={`M0 20 Q0 14 6 14 H${W - 6} Q${W} 14 ${W} 20 V${H} H0 Z`} className="fill-surface" />
          <rect x={42} y={17} width={12} height={2.5} rx={1.25} className="fill-line" />
          {[16, 34, 52, 70].map((cx) => (
            <circle key={cx} cx={cx} cy={30} r={6} className="fill-sunken" />
          ))}
          <line x1={8} x2={W - 8} y1={40} y2={40} className="stroke-line" strokeWidth={1} />
          <Glyph icon={Copy} cx={16} cy={47} size={9} muted />
          <Line x={26} y={45.5} w={30} />
          <rect x={6} y={53} width={84} height={13} rx={6.5} className="fill-signal" />
          <SquarePlus x={11.5} y={55} width={9} height={9} strokeWidth={2.5} className="text-on-signal" />
          <Line x={26} y={58} w={44} tone="on" />
        </>
      );
    // The Add to Home Screen sheet: keep Open as Web App on.
    case "web-app-switch":
      return (
        <>
          <Bar d={topBar(20)} />
          <Line x={8} y={9} w={16} tone="soft" />
          <Line x={36} y={9} w={24} tone="ink" />
          <Line x={76} y={9} w={12} tone="soft" />
          <rect x={6} y={25} width={84} height={42} rx={8} className="fill-surface" />
          <AppIcon x={12} y={30} size={14} clip={ids.icon} />
          <Line x={32} y={35.5} w={40} tone="ink" />
          <line x1={12} x2={84} y1={49} y2={49} className="stroke-line" strokeWidth={1} />
          <Line x={12} y={56.5} w={34} tone="ink" />
          <OnSwitch x={64} y={52.5} />
        </>
      );
    // The same sheet: Add, top right.
    case "add-button":
      return (
        <>
          <Bar d={topBar(24)} />
          <Line x={8} y={10.5} w={16} tone="soft" />
          <Line x={32} y={10.5} w={22} tone="ink" />
          <Pill x={62} y={5} w={28} label="Add" />
          <rect x={6} y={30} width={84} height={36} rx={8} className="fill-surface" />
          <AppIcon x={12} y={37} size={20} clip={ids.icon} />
          <Line x={38} y={42} w={40} tone="ink" />
          <Line x={38} y={50} w={28} />
        </>
      );
    // iPhone Chrome: Share at the right of the address bar, top.
    case "chrome-ios-bar":
      return (
        <>
          <Bar d={topBar(28)} />
          <rect x={6} y={6} width={84} height={17} rx={8.5} className="fill-sunken" />
          <Line x={14} y={13} w={40} tone="soft" />
          <Glyph icon={Share} cx={80} cy={14} size={11} on />
          <Page top={38} />
        </>
      );
    // Android Chrome: ⋮ at the top right.
    case "android-bar":
      return (
        <>
          <Bar d={topBar(28)} />
          <Glyph icon={House} cx={12} cy={14} size={11} muted />
          <rect x={22} y={6} width={52} height={17} rx={8.5} className="fill-sunken" />
          <Line x={30} y={13} w={30} tone="soft" />
          <Glyph icon={EllipsisVertical} cx={85} cy={14} on />
          <Page top={38} />
        </>
      );
    // Android Chrome's menu: Install app (or Add to Home screen).
    case "android-menu":
      return (
        <>
          <Bar d={topBar(20)} />
          <Page top={32} />
          <rect x={30} y={4} width={62} height={64} rx={8} className="fill-surface stroke-line" strokeWidth={1} />
          <Line x={38} y={13} w={40} />
          <Line x={38} y={24} w={32} />
          <Line x={38} y={35} w={44} />
          <rect x={33} y={42} width={56} height={13} rx={6.5} className="fill-signal" />
          <Download x={37.5} y={44} width={9} height={9} strokeWidth={2.5} className="text-on-signal" />
          <Line x={50} y={47} w={32} tone="on" />
          <Line x={38} y={61} w={26} />
        </>
      );
    // The browser's install dialog: Install.
    case "install-dialog":
      return (
        <>
          <Page />
          <rect x={0} y={0} width={W} height={H} style={{ fill: "var(--scrim-drawer)" }} />
          <rect x={8} y={12} width={80} height={50} rx={10} className="fill-surface" />
          <AppIcon x={15} y={19} size={14} clip={ids.icon} />
          <Line x={34} y={21} w={40} tone="ink" />
          <Line x={34} y={28} w={28} />
          <Line x={30} y={48.5} w={12} tone="soft" />
          <Pill x={48} y={44} w={36} label="Install" />
        </>
      );
    // Samsung Internet: ☰ at the bottom right.
    case "samsung-toolbar":
      return (
        <>
          <Page />
          <Bar d={bottomBar(50)} />
          <line x1={0} x2={W} y1={50} y2={50} className="stroke-line" strokeWidth={1} />
          <Glyph icon={ChevronLeft} cx={11} cy={61} muted />
          <Glyph icon={ChevronRight} cx={27} cy={61} muted />
          <Glyph icon={House} cx={43} cy={61} />
          <Glyph icon={Bookmark} cx={59} cy={61} />
          <Glyph icon={Layers} cx={73} cy={61} size={11} />
          <Glyph icon={Menu} cx={86} cy={60.5} size={11} on />
        </>
      );
    // Samsung Internet's menu: Add page to.
    case "samsung-menu":
      return (
        <>
          <Page count={1} top={6} />
          <path d={`M0 20 Q0 14 6 14 H${W - 6} Q${W} 14 ${W} 20 V${H} H0 Z`} className="fill-surface" />
          {[0, 1, 2, 3].map((col) =>
            [0, 1].map((row) => {
              const cx = 15 + col * 22;
              const cy = 30 + row * 22;
              return col === 1 && row === 0 ? (
                <Glyph key={`${col}${row}`} icon={Plus} cx={cx} cy={cy} size={11} on />
              ) : (
                <rect key={`${col}${row}`} x={cx - 6} y={cy - 6} width={12} height={12} rx={4} className="fill-sunken" />
              );
            }),
          )}
          <Line x={27} y={43} w={20} tone="ink" />
        </>
      );
    // Add page to: Home screen.
    case "samsung-home":
      return (
        <>
          <Page />
          <rect x={0} y={0} width={W} height={H} style={{ fill: "var(--scrim-drawer)" }} />
          <rect x={10} y={8} width={76} height={58} rx={10} className="fill-surface" />
          <Line x={18} y={15} w={34} tone="ink" />
          <Glyph icon={Bookmark} cx={22} cy={29} size={9} muted />
          <Line x={31} y={27.5} w={30} />
          <rect x={14} y={36} width={68} height={13} rx={6.5} className="fill-signal" />
          <House x={17.5} y={38} width={9} height={9} strokeWidth={2.5} className="text-on-signal" />
          <Line x={31} y={41} w={36} tone="on" />
          <Glyph icon={Download} cx={22} cy={57} size={9} muted />
          <Line x={31} y={55.5} w={26} />
        </>
      );
    // The Home Screen: open Alpha.
    case "home-screen":
      return (
        <>
          {[0, 1, 2, 3].map((col) =>
            [0, 1].map((row) => {
              const x = 9 + col * 21;
              const y = 10 + row * 28;
              return col === 1 && row === 0 ? (
                <g key={`${col}${row}`}>
                  <rect x={x - 3} y={y - 3} width={22} height={22} rx={7} className="fill-none stroke-signal" strokeWidth={2} />
                  <AppIcon x={x} y={y} size={16} clip={ids.icon} />
                  <rect x={x} y={y + 21} width={16} height={3} rx={1.5} className="fill-ink" />
                </g>
              ) : (
                <g key={`${col}${row}`}>
                  <rect x={x} y={y} width={16} height={16} rx={4} className="fill-sunken" />
                  <rect x={x + 2} y={y + 21} width={12} height={3} rx={1.5} className="fill-line" />
                </g>
              );
            }),
          )}
        </>
      );
  }
}

/** One step's drawing: 96 × 72, a crop of the phone's screen. */
export function InstallSketch({ kind, className }: { kind: SketchKind; className?: string }) {
  const raw = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const clip = `sketch-${raw}`;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      aria-hidden
      focusable="false"
      className={cn("shrink-0 overflow-hidden", className)}
      data-sketch={kind}
    >
      <clipPath id={clip}>
        <rect x={0} y={0} width={W} height={H} rx={R} />
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        <rect x={0} y={0} width={W} height={H} className="fill-paper" />
        {body(kind, { icon: `${clip}-icon` })}
      </g>
      <rect x={0.5} y={0.5} width={W - 1} height={H - 1} rx={R - 0.5} className="fill-none stroke-line" strokeWidth={1} />
    </svg>
  );
}
