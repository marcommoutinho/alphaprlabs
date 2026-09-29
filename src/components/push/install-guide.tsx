"use client";

import { Tabs } from "@base-ui/react/tabs";
import { Bell, Check, Copy, Info } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { encode } from "uqr";
import { Button } from "@/components/alpha/button";
import {
  firstTab,
  GUIDE_TABS,
  type GuideTab,
  type InstallDevice,
  installLink,
  onPhone,
  opensElsewhereFirst,
  type SafariLayout,
  thisPhoneTab,
} from "@/lib/install/detect";
import { cn } from "@/lib/utils";
import { InstallSketch, type SketchKind } from "./install-sketches";

// The install guide (Marco, 2026-09-29): one guide for iPhone and Android,
// opened on this phone and browser's steps, with tabs for the others. Shown
// at joining (R16, /auth/install) and on its own page (/app/install, from Me
// and the account menu). Every step is one short sentence with the button's
// exact name in bold and a drawing of where it is; the words alone are
// complete (the drawings are decorative).

type Step = { text: React.ReactNode; note?: React.ReactNode; sketch: SketchKind };
type Section = { key: string; title?: string; steps: Step[] };

/** The tab's name: "iPad · Safari" / "iPad · Chrome" on an iPad, else the iPhone's. */
function tabLabel(tab: GuideTab, device: Pick<InstallDevice, "platform" | "tablet">): string {
  if (tab === "android") return "Android";
  const apple = device.platform === "ios" && device.tablet ? "iPad" : "iPhone";
  return `${apple} · ${tab === "ios-safari" ? "Safari" : "Chrome"}`;
}

/** The button's name, as the browser shows it. */
function B({ children }: { children: React.ReactNode }) {
  return <b className="font-semibold text-ink">{children}</b>;
}

/**
 * Safari's ••• button, named for screen readers by its look: its own label
 * changes between versions (More on iOS 26, Page Menu on iOS 27).
 */
const THREE_DOTS = "the three-dot button";

/** A button drawn as a symbol (•••, ⋮, ☰), with its name for screen readers. */
function Key({ glyph, name }: { glyph: string; name: string }) {
  return (
    <b className="font-semibold text-ink">
      <span aria-hidden>{glyph}</span>
      <span className="sr-only">{name}</span>
    </b>
  );
}

const openAlpha = (iphone: boolean): Step => ({
  text: (
    <>
      Open <B>Alpha</B> from your Home Screen.
    </>
  ),
  // The Home Screen app on iPhone has its own storage; Android shares Chrome's sign-in.
  note: iphone ? "Sign in once more there. The Home Screen app keeps its own sign-in." : undefined,
  sketch: "home-screen",
});

/**
 * Share on iOS 26: in the toolbar with the Bottom and Top tab layouts, behind
 * ••• with Compact. The user agent can't tell the layouts apart, so the step
 * covers both.
 */
const SHARE_IOS26: Step = {
  text: <>Tap <B>Share</B>.</>,
  note: (
    <>
      Don&apos;t see it? Tap <Key glyph="•••" name={THREE_DOTS} /> first (Page Menu on iOS 27), then <B>Share</B>.
    </>
  ),
  sketch: "safari-share",
};

/**
 * iPad Safari (iPadOS 26, Apple's steps): Share, then More, then Add to
 * Home Screen. iPad Safari has a compact layout too, so Share keeps the •••
 * note; the iPhone's Edit Actions fallback doesn't apply.
 */
const IPAD_SAFARI_STEPS: Step[] = [
  SHARE_IOS26,
  {
    text: (
      <>
        Tap <B>More</B>, then <B>Add to Home Screen</B>.
      </>
    ),
    sketch: "share-sheet",
  },
  { text: <>Keep <B>Open as Web App</B> on.</>, sketch: "web-app-switch" },
  { text: <>Tap <B>Add</B>.</>, sketch: "add-button" },
  openAlpha(true),
];

/**
 * Add to Home Screen in the iPhone share sheet (Safari and Chrome both use
 * the system one): when it's missing, it is added from Edit Actions.
 */
const addToHomeScreen = (lead: string): Step => ({
  text: (
    <>
      {lead} <B>Add to Home Screen</B>.
    </>
  ),
  note: (
    <>
      Don&apos;t see it? Scroll down, tap <B>Edit Actions</B>, and add <B>Add to Home Screen</B>.
    </>
  ),
  sketch: "share-sheet",
});

function safariSteps(layout: SafariLayout): Step[] {
  if (layout === "classic") {
    return [
      { text: <>Tap <B>Share</B> in the toolbar.</>, sketch: "safari-toolbar" },
      addToHomeScreen("Scroll down and choose"),
      { text: <>Tap <B>Add</B>.</>, sketch: "add-button" },
      openAlpha(true),
    ];
  }
  if (layout === "ios26") {
    return [
      SHARE_IOS26,
      addToHomeScreen("Choose"),
      { text: <>Keep <B>Open as Web App</B> on.</>, sketch: "web-app-switch" },
      { text: <>Tap <B>Add</B>.</>, sketch: "add-button" },
      openAlpha(true),
    ];
  }
  // The version is unknown (an iPad, or read from a laptop): worded for every layout.
  return [
    SHARE_IOS26,
    addToHomeScreen("Choose"),
    { text: <>If <B>Open as Web App</B> is shown, keep it on.</>, sketch: "web-app-switch" },
    { text: <>Tap <B>Add</B>.</>, sketch: "add-button" },
    openAlpha(true),
  ];
}

const CHROME_IOS_STEPS: Step[] = [
  { text: <>Tap <B>Share</B> in the address bar (top right).</>, sketch: "chrome-ios-bar" },
  addToHomeScreen("Choose"),
  { text: <>Tap <B>Add</B>.</>, note: <>If an <B>Open as Web App</B> switch is shown, keep it on.</>, sketch: "add-button" },
  openAlpha(true),
];

const CHROME_ANDROID: Section = {
  key: "chrome",
  title: "In Chrome",
  steps: [
    { text: <>Tap <Key glyph="⋮" name="More options" /> (top right).</>, sketch: "android-bar" },
    { text: <>Tap <B>Install app</B> or <B>Add to Home screen</B>.</>, sketch: "android-menu" },
    { text: <>Tap <B>Install</B>.</>, sketch: "install-dialog" },
    openAlpha(false),
  ],
};

const SAMSUNG: Section = {
  key: "samsung",
  title: "In Samsung Internet",
  steps: [
    // The menu button varies by version and toolbar setup.
    {
      text: (
        <>
          Tap the menu (<Key glyph="☰" name="three lines" /> or <Key glyph="⋮" name="three dots" />).
        </>
      ),
      sketch: "samsung-toolbar",
    },
    { text: <>Tap <B>Add page to</B>.</>, sketch: "samsung-menu" },
    { text: <>Choose <B>Home screen</B>.</>, sketch: "samsung-home" },
    openAlpha(false),
  ],
};

function sectionsFor(tab: GuideTab, device: InstallDevice): Section[] {
  if (tab === "ios-safari") {
    // An iPad gets its own steps; everyone else (a laptop reading ahead included) is setting up an iPhone.
    if (device.platform === "ios" && device.tablet) return [{ key: "safari-ipad", steps: IPAD_SAFARI_STEPS }];
    return [{ key: "safari", steps: safariSteps(device.platform === "ios" && device.browser === "safari" ? device.layout : "unknown") }];
  }
  if (tab === "ios-chrome") return [{ key: "chrome-ios", steps: CHROME_IOS_STEPS }];
  return device.platform === "android" && device.browser === "samsung" ? [SAMSUNG, CHROME_ANDROID] : [CHROME_ANDROID, SAMSUNG];
}

/** "Get the app on your phone" on a laptop; "Install the app" on a phone. */
export function installTitle(device: InstallDevice, joining = false): string {
  if (!onPhone(device)) return "Get the app on your phone";
  return joining ? "Put Alpha on your Home Screen" : "Install the app";
}

export function installLead(device: InstallDevice): string {
  if (device.platform === "ios") return `It opens full screen like any app, and it's the only way ${device.tablet ? "iPad" : "iPhone"} allows dose reminders.`;
  if (device.platform === "android") return "It opens full screen like any app, and faster.";
  return "Alpha is made for your phone. Scan the code with your phone's camera, then add it to your Home Screen.";
}

// ── Copy link ─────────────────────────────────────────────────────────────
/** Copies with the Clipboard API, or the older selection copy some in-app browsers still need. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const done = document.execCommand("copy");
      area.remove();
      return done;
    } catch {
      return false;
    }
  }
}

/** The app's address (Today, never this page's URL: it may hold an invitation or recovery token) and Copy link. */
function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => (timer.current ? clearTimeout(timer.current) : undefined), []);
  const copy = async () => {
    const done = await copyText(link);
    setCopied(done);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 3000);
  };
  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={link}
          aria-label="Link to Alpha"
          onFocus={(event) => event.currentTarget.select()}
          className="h-11 min-w-0 flex-1 truncate rounded-[12px] bg-sunken px-3 font-mono text-[13px] text-ink-2 outline-none focus:shadow-[inset_0_0_0_2px_var(--ink)]"
          data-testid="install-link"
        />
        <Button variant="outline" size="md" onClick={copy} data-testid="install-copy">
          {copied ? <Check className="size-[18px]" aria-hidden /> : <Copy className="size-[18px]" aria-hidden />}
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
      <p role="status" className={cn("mt-1.5 text-[13px] text-ink-2", copied === null && "sr-only")}>
        {copied === true ? "Link copied. Paste it into the browser's address bar." : copied === false ? "Couldn't copy. Press and hold the link to copy it." : ""}
      </p>
    </div>
  );
}

/**
 * "Open this page in Safari / Chrome": first, inside another app's browser;
 * otherwise at the end of each tab as "Don't see Add to Home Screen?".
 */
function OpenElsewhere({ target, first, link }: { target: "Safari" | "Chrome"; first: boolean; link: string }) {
  const how =
    target === "Safari" ? (
      <>
        Look for <B>Open in Safari</B> in this app&apos;s menu (often <Key glyph="•••" name={THREE_DOTS} /> or <B>Share</B>), or copy the link and paste it into Safari.
      </>
    ) : (
      <>
        Tap <Key glyph="⋮" name="More options" /> and choose <B>Open in Chrome</B> (or <B>Open in browser</B>), or copy the link and paste it into Chrome.
      </>
    );
  return (
    <section
      aria-labelledby={first ? "install-elsewhere-title" : undefined}
      aria-label={first ? undefined : "Don't see Add to Home Screen?"}
      className={cn("mx-3 laptop:mx-0", first ? "mt-5 rounded-group bg-signal-tint px-4 py-4" : "mt-6 rounded-group border border-line bg-surface px-4 py-4")}
      data-testid={first ? "install-elsewhere-first" : "install-elsewhere"}
    >
      <h2 id={first ? "install-elsewhere-title" : undefined} className="flex items-center gap-2 text-[16px] font-semibold">
        {first ? <Info className="size-[18px] shrink-0 text-signal-ink" aria-hidden /> : null}
        {first ? `Open this page in ${target}` : "Don't see Add to Home Screen?"}
      </h2>
      <p className="mt-1.5 text-[14px] leading-[20px] text-ink-2">
        {first
          ? "You're inside another app's browser (after tapping a link in an email or chat app, for example). Pages opened there can't be added to the Home Screen. "
          : `You may be inside another app's browser (for example after tapping the link in an email app). Open the page in ${target} instead. `}
        {how}
      </p>
      <CopyLink link={link} />
    </section>
  );
}

// ── QR code (laptop) ──────────────────────────────────────────────────────
/**
 * The app's address as a QR code, encoded here (uqr, no network). Always dark
 * on light, whatever the appearance: phone cameras read that reliably.
 */
function QrCode({ text }: { text: string }) {
  const { path, size } = useMemo(() => {
    const qr = encode(text, { ecc: "M", border: 0 });
    let d = "";
    qr.data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      }),
    );
    return { path: d, size: qr.size };
  }, [text]);
  return (
    <div data-alpha-theme="light" className="shrink-0 rounded-[16px] border border-line p-3.5">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="block size-[136px]"
        shapeRendering="crispEdges"
        role="img"
        aria-label={`QR code for ${text}`}
        data-testid="install-qr"
        data-link={text}
      >
        <path d={path} className="fill-ink" />
      </svg>
    </div>
  );
}

function PhoneCode({ link }: { link: string }) {
  return (
    <section aria-labelledby="install-qr-title" className="mx-3 mt-6 flex flex-col items-center gap-4 rounded-group border border-line bg-surface p-4 text-center laptop:mx-0 laptop:flex-row laptop:items-center laptop:text-left">
      <QrCode text={link} />
      <div className="min-w-0">
        <h2 id="install-qr-title" className="text-[17px] leading-[22px] font-semibold">
          Scan with your phone&apos;s camera
        </h2>
        <p className="mt-1 text-[14px] leading-[20px] text-ink-2">It opens Alpha in your phone&apos;s browser. Then follow the steps for your phone below.</p>
        <p className="mt-2 font-mono text-[12px] break-all text-ink-3">{link}</p>
      </div>
    </section>
  );
}

// ── Steps ─────────────────────────────────────────────────────────────────
function StepList({ steps, label }: { steps: Step[]; label: string }) {
  return (
    <ol aria-label={label} className="mx-3 divide-y divide-line overflow-hidden rounded-group border border-line bg-surface laptop:mx-0" data-testid="install-steps">
      {steps.map((step, index) => (
        <li key={index} className="flex items-center gap-3 py-3 pr-3 pl-3.5" data-testid="install-step">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ink font-mono text-[14px] font-semibold text-surface" aria-hidden>
            {index + 1}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] leading-[21px] text-ink" data-testid="install-step-text">
              {step.text}
            </span>
            {step.note ? (
              <span className="mt-1 block text-[13px] leading-[18px] text-ink-2" data-testid="install-step-note">
                {step.note}
              </span>
            ) : null}
          </span>
          <InstallSketch kind={step.sketch} />
        </li>
      ))}
    </ol>
  );
}

function Panel({ tab, device, link, install, acceptedHere, elsewhereFirst }: PanelProps) {
  const iphone = tab !== "android";
  const sections = sectionsFor(tab, device);
  const oneTap = tab === "android" && device.platform === "android" && !device.installed;
  return (
    <Tabs.Panel value={tab} className="outline-none" data-testid="install-panel" data-tab={tab}>
      {oneTap && acceptedHere ? (
        <p role="status" className="mx-3 mb-4 flex items-center gap-2 rounded-group bg-done-tint px-4 py-3 text-[15px] font-semibold text-done laptop:mx-0">
          <Check className="size-[18px] shrink-0" aria-hidden />
          Installed. Open Alpha from your Home Screen.
        </p>
      ) : oneTap && device.canPrompt ? (
        <div className="mx-3 mb-5 laptop:mx-0">
          <Button variant="primary" size="lg" block onClick={install}>
            Install app
          </Button>
          <p className="mt-2 text-center text-[13px] text-ink-2">Or add it yourself:</p>
        </div>
      ) : null}
      {sections.map((section, index) => (
        <div key={section.key} className={cn(index > 0 && "mt-5")}>
          {section.title ? <h3 className="mb-2 px-5 text-[13px] font-semibold text-ink-2 laptop:px-0">{section.title}</h3> : null}
          <StepList steps={section.steps} label={section.title ? `${tabLabel(tab, device)}, ${section.title.toLowerCase()}` : tabLabel(tab, device)} />
        </div>
      ))}
      <p className="mx-5 mt-3.5 flex gap-2.5 text-[14px] leading-[1.45] text-ink-2 laptop:mx-0" data-testid="install-reminders">
        <Bell className="mt-px size-[18px] shrink-0" aria-hidden />
        {iphone
          ? "Dose reminders only work from the Home Screen app."
          : "Dose reminders work in the browser too. The app just opens full screen, and faster."}
      </p>
      {tab === "ios-chrome" ? (
        <p className="mx-5 mt-2 text-[13px] leading-[18px] text-ink-3 laptop:mx-0">
          Firefox and Edge on {device.platform === "ios" && device.tablet ? "iPad" : "iPhone"} work the same way: their <B>Share</B> is in the browser&apos;s menu.
        </p>
      ) : null}
      {elsewhereFirst ? null : <OpenElsewhere target={tab === "ios-safari" ? "Safari" : "Chrome"} first={false} link={link} />}
    </Tabs.Panel>
  );
}

type PanelProps = {
  tab: GuideTab;
  device: InstallDevice;
  link: string;
  install: () => Promise<void>;
  acceptedHere: boolean;
  elsewhereFirst: boolean;
};

/**
 * The guide itself, for a detected device (see useInstallDevice). A laptop
 * gets the QR code first; inside another app's browser, "open this page in
 * Safari / Chrome" comes first; then the tabs, opened on this phone's.
 */
export function InstallGuide({
  device,
  install,
  acceptedHere,
  className,
}: {
  device: InstallDevice;
  install: () => Promise<void>;
  acceptedHere: boolean;
  className?: string;
}) {
  const [tab, setTab] = useState<GuideTab>(() => firstTab(device));
  const marked = thisPhoneTab(device);
  const thisDevice = device.tablet ? "This iPad" : "This phone";
  const link = installLink(window.location.origin);
  const elsewhereFirst = opensElsewhereFirst(device);
  const phone = onPhone(device);

  return (
    <div className={className} data-testid="install-guide" data-platform={device.platform} data-browser={device.browser} data-layout={device.layout}>
      {device.installed ? (
        <p role="status" className="mx-3 mt-5 flex items-center gap-2 rounded-group bg-done-tint px-4 py-3 text-[15px] font-semibold text-done laptop:mx-0" data-testid="install-installed">
          <Check className="size-[18px] shrink-0" aria-hidden />
          You&apos;re using the app from your Home Screen.
        </p>
      ) : null}
      {phone ? null : <PhoneCode link={link} />}
      {elsewhereFirst ? <OpenElsewhere target={device.platform === "android" ? "Chrome" : "Safari"} first link={link} /> : null}
      <Tabs.Root value={tab} onValueChange={(value) => setTab(value as GuideTab)} className="mt-6">
        {phone ? null : <h2 className="mb-2 px-5 text-[13px] font-semibold text-ink-2 laptop:px-0">Steps for your phone</h2>}
        <Tabs.List aria-label="Your phone and browser" className="mx-3 mb-4 grid grid-cols-3 gap-0.5 rounded-[12px] bg-sunken p-[3px] laptop:mx-0">
          {GUIDE_TABS.map((value) => (
            <Tabs.Tab
              key={value}
              value={value}
              className={cn(
                "flex min-h-[44px] min-w-0 cursor-pointer flex-col items-center justify-center rounded-[9px] px-1 py-1 text-center text-[14px] leading-[18px] font-medium text-ink-2 select-none",
                "transition-[background-color,box-shadow,color] duration-150 focus-visible:outline-offset-0",
                "data-active:bg-surface data-active:font-semibold data-active:text-ink data-active:shadow-seg",
              )}
              data-testid="install-tab"
              data-tab={value}
              data-this-phone={value === marked || undefined}
              // One name, "iPad · Safari, This iPad", for the tab and (through it) its panel.
              aria-label={value === marked ? `${tabLabel(value, device)}, ${thisDevice}` : undefined}
            >
              <span>{tabLabel(value, device)}</span>
              {value === marked ? (
                <span className="text-[12px] leading-4 font-semibold text-signal-ink" data-testid="install-this-phone">
                  {thisDevice}
                </span>
              ) : null}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {GUIDE_TABS.map((value) => (
          <Panel key={value} tab={value} device={device} link={link} install={install} acceptedHere={acceptedHere} elsewhereFirst={elsewhereFirst} />
        ))}
      </Tabs.Root>
    </div>
  );
}
