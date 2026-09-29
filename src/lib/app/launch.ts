// The iOS launch images (apple-touch-startup-image) the private layout links:
// one per iPhone screen in ./launch-images.json and colour scheme, made by
// scripts/launch-images.mjs into public/app-icons/launch/. Pure.
import screens from "./launch-images.json";

export type LaunchScreen = { width: number; height: number; ratio: number };
export type LaunchImage = { url: string; media: string };

export const LAUNCH_SCREENS: readonly LaunchScreen[] = screens;

/** The image's path for a screen (CSS px and device pixel ratio) and scheme. */
export const launchImagePath = ({ width, height, ratio }: LaunchScreen, scheme: "light" | "dark") =>
  `/app-icons/launch/launch-${width * ratio}x${height * ratio}-${scheme}.png`;

/** Metadata `appleWebApp.startupImage`: each screen's portrait image, light and dark by prefers-color-scheme. */
export function launchImages(): LaunchImage[] {
  return LAUNCH_SCREENS.flatMap((screen) =>
    (["light", "dark"] as const).map((scheme) => ({
      url: launchImagePath(screen, scheme),
      media: [
        `(device-width: ${screen.width}px)`,
        `(device-height: ${screen.height}px)`,
        `(-webkit-device-pixel-ratio: ${screen.ratio})`,
        "(orientation: portrait)",
        `(prefers-color-scheme: ${scheme})`,
      ].join(" and "),
    })),
  );
}
