// Install guide (Marco, 2026-09-29): which phone and browser this is, so the
// guide opens on the steps that fit it. Pure: the browser facts are passed in
// (readFacts in src/components/push/use-reminders.ts), so every rule is
// tested with real user-agent strings (tests/unit/install-detect.test.ts).

export type InstallPlatform = "ios" | "android" | "desktop" | "other";
export type InstallBrowser = "safari" | "chrome" | "samsung" | "firefox" | "edge" | "in-app" | "other";
/**
 * Safari's generation on iPhone: iOS 26 ("ios26") has three tab layouts;
 * Bottom and Top keep Share in the toolbar, Compact puts it behind •••, and
 * the user agent can't tell them apart. Earlier versions ("classic") have
 * Share in the toolbar. "unknown" when the version can't be read, and on
 * iPad, whose toolbar differs: the guide then words the steps for every
 * layout.
 */
export type SafariLayout = "classic" | "ios26" | "unknown";

export type InstallFacts = {
  userAgent: string;
  maxTouchPoints: number;
  /** display-mode: standalone, or iOS navigator.standalone. */
  standalone: boolean;
  /** The browser offered its install prompt (beforeinstallprompt was captured). */
  canPrompt?: boolean;
};

export type InstallDevice = {
  platform: InstallPlatform;
  /** iPad (including iPadOS reporting itself as a Mac with touch). */
  tablet: boolean;
  browser: InstallBrowser;
  /** Safari's own version (the `Version/NN` token), or null. */
  safariVersion: number | null;
  layout: SafariLayout;
  /** Already running as the installed app. */
  installed: boolean;
  canPrompt: boolean;
};

/** The guide's tabs, in their order. */
export type GuideTab = "ios-safari" | "ios-chrome" | "android";
export const GUIDE_TABS: readonly GuideTab[] = ["ios-safari", "ios-chrome", "android"];

// Apps that open links in their own browser. Their pages can't be added to
// the Home Screen: the person has to open the page in Safari or Chrome.
// FBAN/FBAV/FB_IAB Facebook and Messenger, Instagram, LinkedInApp, Line,
// GSA the Google app, Snapchat, TikTok (musical_ly, BytedanceWebview),
// Twitter / X, Pinterest, WhatsApp, Threads (Barcelona), KAKAOTALK, WeChat
// (MicroMessenger), Gmail on Android (; wv) is caught as a WebView below.
const IN_APP =
  /FBAN|FBAV|FB_IAB|FBIOS|Instagram|LinkedInApp|\bLine\/|GSA\/|Snapchat|TikTok|musical_ly|BytedanceWebview|Twitter|TwitterAndroid|Pinterest|WhatsApp|Barcelona|KAKAOTALK|MicroMessenger/i;

/** iPhone, iPod or iPad, including iPadOS reporting itself as a Mac with touch. */
function appleMobile(userAgent: string, maxTouchPoints: number): { apple: boolean; tablet: boolean } {
  if (/iPad/.test(userAgent)) return { apple: true, tablet: true };
  if (/iPhone|iPod/.test(userAgent)) return { apple: true, tablet: false };
  if (/Macintosh/.test(userAgent) && maxTouchPoints > 1) return { apple: true, tablet: true };
  return { apple: false, tablet: false };
}

function appleBrowser(userAgent: string): InstallBrowser {
  if (IN_APP.test(userAgent)) return "in-app";
  if (/CriOS\//.test(userAgent)) return "chrome";
  if (/FxiOS\//.test(userAgent)) return "firefox";
  if (/EdgiOS\//.test(userAgent)) return "edge";
  if (/OPiOS|OPT\/|YaBrowser|DuckDuckGo|Brave|Focus\//.test(userAgent)) return "other";
  // Safari names itself with "Version/NN … Safari/NNN"; an app's own web
  // view (WKWebView) leaves the Safari token out.
  if (/Safari\//.test(userAgent) && /Version\/\d/.test(userAgent)) return "safari";
  return "in-app";
}

function androidBrowser(userAgent: string): InstallBrowser {
  if (IN_APP.test(userAgent)) return "in-app";
  if (/SamsungBrowser\//.test(userAgent)) return "samsung";
  if (/Firefox\//.test(userAgent)) return "firefox";
  if (/EdgA\//.test(userAgent)) return "edge";
  // An app's own web view (Android WebView) marks itself "; wv)".
  if (/; wv\)/.test(userAgent)) return "in-app";
  if (/OPR\/|YaBrowser|UCBrowser|MiuiBrowser|HuaweiBrowser|DuckDuckGo|Brave/.test(userAgent)) return "other";
  if (/Chrome\//.test(userAgent)) return "chrome";
  return "other";
}

function desktopBrowser(userAgent: string): InstallBrowser {
  if (/Edg\//.test(userAgent)) return "edge";
  if (/Firefox\//.test(userAgent)) return "firefox";
  if (/OPR\//.test(userAgent)) return "other";
  if (/Chrome\//.test(userAgent)) return "chrome";
  if (/Safari\//.test(userAgent)) return "safari";
  return "other";
}

/**
 * Safari's own version: "Version/26.0" → 26. iOS 26 freezes the system
 * version in the user agent (it keeps reporting "OS 18_6"), so the Safari
 * version is the one that tells the layouts apart.
 */
export function safariVersionOf(userAgent: string): number | null {
  const match = /Version\/(\d+)(?:\.(\d+))?/.exec(userAgent);
  return match ? Number(match[1]) + (match[2] ? Number(match[2]) / 100 : 0) : null;
}

export function detectInstall(facts: InstallFacts): InstallDevice {
  const { userAgent, maxTouchPoints } = facts;
  const { apple, tablet } = appleMobile(userAgent, maxTouchPoints);
  let platform: InstallPlatform;
  let browser: InstallBrowser;
  if (apple) {
    platform = "ios";
    browser = appleBrowser(userAgent);
  } else if (/Android/.test(userAgent)) {
    platform = "android";
    browser = androidBrowser(userAgent);
  } else if (/Windows NT|Macintosh|CrOS|X11|Linux x86_64/.test(userAgent) && !/Mobile/.test(userAgent)) {
    platform = "desktop";
    browser = desktopBrowser(userAgent);
  } else {
    platform = "other";
    browser = "other";
  }
  const safariVersion = platform === "ios" && browser === "safari" ? safariVersionOf(userAgent) : null;
  const layout: SafariLayout = safariVersion === null || tablet ? "unknown" : safariVersion >= 26 ? "ios26" : "classic";
  return {
    platform,
    tablet,
    browser,
    safariVersion,
    layout,
    installed: facts.standalone,
    canPrompt: Boolean(facts.canPrompt) && !facts.standalone,
  };
}

/**
 * The tab the guide opens on. iPhone: Safari, or the Chrome-style steps in
 * Chrome, Firefox and Edge (they add to the Home Screen from their own Share);
 * an app's browser or any other one opens on Safari, with "open this page in
 * Safari" first. Android: Android. A laptop (or anything else): iPhone ·
 * Safari, the most common phone, and the others a tap away.
 */
export function firstTab(device: Pick<InstallDevice, "platform" | "browser">): GuideTab {
  if (device.platform === "android") return "android";
  if (device.platform === "ios" && (device.browser === "chrome" || device.browser === "firefox" || device.browser === "edge")) return "ios-chrome";
  return "ios-safari";
}

/** The tab marked "This phone": only on a phone or tablet the guide recognised. */
export function thisPhoneTab(device: Pick<InstallDevice, "platform" | "browser">): GuideTab | null {
  return device.platform === "ios" || device.platform === "android" ? firstTab(device) : null;
}

/**
 * "Open this page in Safari / Chrome" comes before the steps: inside another
 * app's browser (after tapping a link in an email or chat app), or in an
 * iPhone browser that can't add to the Home Screen.
 */
export function opensElsewhereFirst(device: Pick<InstallDevice, "platform" | "browser">): boolean {
  if (device.browser === "in-app") return true;
  return device.platform === "ios" && device.browser === "other";
}

/** A phone or tablet (the Me row reads "Install the app"), else a laptop ("Get the app on your phone"). */
export function onPhone(device: Pick<InstallDevice, "platform">): boolean {
  return device.platform === "ios" || device.platform === "android";
}

/** The guide's address: always Today on this app's origin, never the current URL (it may hold an invite or recovery token). */
export const INSTALL_TARGET_PATH = "/app/today";
export const installLink = (origin: string) => `${origin.replace(/\/+$/, "")}${INSTALL_TARGET_PATH}`;

/** The install guide page (every signed-in person). */
export const INSTALL_GUIDE_PATH = "/app/install";

/** The Me row and account-menu item's label. */
export const installItemLabel = (device: Pick<InstallDevice, "platform">) => (onPhone(device) ? "Install the app" : "Get the app on your phone");
