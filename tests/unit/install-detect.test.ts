// The install guide's detection (src/lib/install/detect.ts) with real
// user-agent strings: the phone, the browser, Safari's layout (iOS 26 moved
// Share behind •••) and the tab the guide opens on.
import { describe, expect, it } from "vitest";
import {
  detectInstall,
  firstTab,
  installItemLabel,
  installLink,
  type InstallFacts,
  onPhone,
  opensElsewhereFirst,
  safariVersionOf,
  thisPhoneTab,
} from "@/lib/install/detect";

const UA = {
  iosSafari18:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  iosSafari17:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  // iOS 26 freezes the system version in the user agent at 18_6; Safari's own version says 26.
  iosSafari26:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  // iPadOS asks for the desktop site by default: it reports itself as a Mac, with touch.
  ipadDesktopMode: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
  ipad: "Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  iosChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.101 Mobile/15E148 Safari/604.1",
  iosFirefox:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/142.0 Mobile/15E148 Safari/605.1.15",
  iosEdge:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/140.0.3485.94 Mobile/15E148 Safari/605.1.15",
  iosDuckDuckGo:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 DuckDuckGo/7 Safari/605.1.15",
  iosInstagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 390.0.0.28.85 (iPhone15,3; iOS 18_5; en_US; en-US; scale=3.00; 1290x2796; 755829410)",
  iosFacebook:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/500.0.0.43.109;FBBV/712345678;FBDV/iPhone15,3;FBMD/iPhone;FBSN/iOS;FBSV/18.5;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]",
  iosLinkedIn:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.30.1234",
  iosGoogleApp:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/380.0.782654312 Mobile/15E148 Safari/604.1",
  // An email app's own web view: no Safari token.
  iosWebView: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  androidChrome: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  androidSamsung:
    "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36",
  androidFirefox: "Mozilla/5.0 (Android 14; Mobile; rv:142.0) Gecko/142.0 Firefox/142.0",
  androidEdge: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 EdgA/140.0.0.0",
  androidFacebook:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240905.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/484.0.0.63.83;]",
  androidWebView:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240905.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36",
  androidTikTok:
    "Mozilla/5.0 (Linux; Android 13; SM-A536B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.6613.146 Mobile Safari/537.36 trill_360105 JsSdk/1.0 NetType/WIFI Channel/googleplay AppName/musical_ly app_version/36.1.5 ByteLocale/en ByteFullLocale/en Region/US BytedanceWebview/d8a21c6",
  macChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  windowsChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  windowsEdge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
  linuxFirefox: "Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0",
};

const PHONE_TOUCH = 5;
const detect = (userAgent: string, extra: Partial<InstallFacts> = {}) =>
  detectInstall({ userAgent, maxTouchPoints: /Macintosh|Windows|X11/.test(userAgent) ? 0 : PHONE_TOUCH, standalone: false, ...extra });

describe("install guide: detection", () => {
  it.each([
    ["iOS 18 Safari", UA.iosSafari18, "ios", "safari", "classic"],
    ["iOS 17 Safari", UA.iosSafari17, "ios", "safari", "classic"],
    ["iOS 26 Safari (system version frozen at 18_6)", UA.iosSafari26, "ios", "safari", "ios26"],
    ["iOS Chrome", UA.iosChrome, "ios", "chrome", "unknown"],
    ["iOS Firefox", UA.iosFirefox, "ios", "firefox", "unknown"],
    ["iOS Edge", UA.iosEdge, "ios", "edge", "unknown"],
    ["iOS DuckDuckGo", UA.iosDuckDuckGo, "ios", "other", "unknown"],
    ["Instagram on iPhone", UA.iosInstagram, "ios", "in-app", "unknown"],
    ["Facebook on iPhone", UA.iosFacebook, "ios", "in-app", "unknown"],
    ["LinkedIn on iPhone", UA.iosLinkedIn, "ios", "in-app", "unknown"],
    ["the Google app on iPhone", UA.iosGoogleApp, "ios", "in-app", "unknown"],
    ["an app's web view on iPhone", UA.iosWebView, "ios", "in-app", "unknown"],
    ["Android Chrome", UA.androidChrome, "android", "chrome", "unknown"],
    ["Samsung Internet", UA.androidSamsung, "android", "samsung", "unknown"],
    ["Android Firefox", UA.androidFirefox, "android", "firefox", "unknown"],
    ["Android Edge", UA.androidEdge, "android", "edge", "unknown"],
    ["Facebook on Android", UA.androidFacebook, "android", "in-app", "unknown"],
    ["an Android web view", UA.androidWebView, "android", "in-app", "unknown"],
    ["TikTok on Android", UA.androidTikTok, "android", "in-app", "unknown"],
    ["Mac Chrome", UA.macChrome, "desktop", "chrome", "unknown"],
    ["Mac Safari", UA.macSafari, "desktop", "safari", "unknown"],
    ["Windows Chrome", UA.windowsChrome, "desktop", "chrome", "unknown"],
    ["Windows Edge", UA.windowsEdge, "desktop", "edge", "unknown"],
    ["Linux Firefox", UA.linuxFirefox, "desktop", "firefox", "unknown"],
  ] as const)("%s", (_name, userAgent, platform, browser, layout) => {
    const device = detect(userAgent);
    expect({ platform: device.platform, browser: device.browser, layout: device.layout }).toEqual({ platform, browser, layout });
  });

  it("iPad in desktop mode (a Mac with touch) is iOS Safari; a Mac without touch is a laptop", () => {
    const ipad = detect(UA.ipadDesktopMode, { maxTouchPoints: 5 });
    expect(ipad).toMatchObject({ platform: "ios", tablet: true, browser: "safari", safariVersion: 18.05 });
    // iPad's toolbar differs from iPhone's: the step is worded for both layouts.
    expect(ipad.layout).toBe("unknown");
    expect(detect(UA.ipad)).toMatchObject({ platform: "ios", tablet: true, browser: "safari", layout: "unknown" });
    expect(detect(UA.ipadDesktopMode, { maxTouchPoints: 0 })).toMatchObject({ platform: "desktop", tablet: false, browser: "safari" });
  });

  it("reads Safari's own version, not the frozen system version", () => {
    expect(safariVersionOf(UA.iosSafari26)).toBe(26);
    expect(safariVersionOf(UA.iosSafari18)).toBe(18.05);
    expect(safariVersionOf(UA.iosWebView)).toBeNull();
    expect(detect(UA.iosSafari26).safariVersion).toBe(26);
    expect(detect(UA.iosChrome).safariVersion).toBeNull();
  });

  it("installed when running standalone; the install prompt counts only in a browser tab", () => {
    expect(detect(UA.iosSafari18, { standalone: true }).installed).toBe(true);
    expect(detect(UA.iosSafari18).installed).toBe(false);
    expect(detect(UA.androidChrome, { canPrompt: true }).canPrompt).toBe(true);
    expect(detect(UA.androidChrome).canPrompt).toBe(false);
    expect(detect(UA.androidChrome, { canPrompt: true, standalone: true }).canPrompt).toBe(false);
  });
});

describe("install guide: the tab it opens on", () => {
  it.each([
    [UA.iosSafari18, "ios-safari", "ios-safari"],
    [UA.iosSafari26, "ios-safari", "ios-safari"],
    [UA.iosChrome, "ios-chrome", "ios-chrome"],
    // Firefox and Edge add to the Home Screen from their own Share, as Chrome does.
    [UA.iosFirefox, "ios-chrome", "ios-chrome"],
    [UA.iosEdge, "ios-chrome", "ios-chrome"],
    // Another app's browser, or one that can't add to the Home Screen: Safari's steps, after "open in Safari".
    [UA.iosInstagram, "ios-safari", "ios-safari"],
    [UA.iosDuckDuckGo, "ios-safari", "ios-safari"],
    [UA.androidChrome, "android", "android"],
    [UA.androidSamsung, "android", "android"],
    [UA.androidFacebook, "android", "android"],
    // A laptop: iPhone · Safari first, and no tab is "This phone".
    [UA.macChrome, "ios-safari", null],
    [UA.windowsEdge, "ios-safari", null],
  ] as const)("%s", (userAgent, tab, marked) => {
    const device = detect(userAgent);
    expect(firstTab(device)).toBe(tab);
    expect(thisPhoneTab(device)).toBe(marked);
  });

  it("puts 'open this page in Safari / Chrome' first inside another app's browser", () => {
    expect(opensElsewhereFirst(detect(UA.iosInstagram))).toBe(true);
    expect(opensElsewhereFirst(detect(UA.iosWebView))).toBe(true);
    expect(opensElsewhereFirst(detect(UA.androidFacebook))).toBe(true);
    expect(opensElsewhereFirst(detect(UA.iosDuckDuckGo))).toBe(true);
    expect(opensElsewhereFirst(detect(UA.iosSafari18))).toBe(false);
    expect(opensElsewhereFirst(detect(UA.iosChrome))).toBe(false);
    expect(opensElsewhereFirst(detect(UA.androidChrome))).toBe(false);
    expect(opensElsewhereFirst(detect(UA.androidSamsung))).toBe(false);
    expect(opensElsewhereFirst(detect(UA.macChrome))).toBe(false);
  });

  it("names the Me row for a phone or a laptop, and always links to Today on this app's origin", () => {
    expect(onPhone(detect(UA.iosSafari18))).toBe(true);
    expect(onPhone(detect(UA.androidChrome))).toBe(true);
    expect(onPhone(detect(UA.macChrome))).toBe(false);
    expect(installItemLabel(detect(UA.iosChrome))).toBe("Install the app");
    expect(installItemLabel(detect(UA.windowsChrome))).toBe("Get the app on your phone");
    expect(installLink("https://app.alphaprlabs.com")).toBe("https://app.alphaprlabs.com/app/today");
    expect(installLink("http://app.localhost:3100/")).toBe("http://app.localhost:3100/app/today");
  });
});
