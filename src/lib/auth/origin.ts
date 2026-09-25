import "server-only";
import { headers } from "next/headers";

const isLocalHost = (host: string) => {
  const name = host.replace(/:\d+$/, "");
  return name === "localhost" || name.endsWith(".localhost") || name === "127.0.0.1";
};

/**
 * Origin of the private app for links in emails: APP_HOST (https, or http for
 * *.localhost). Only when APP_HOST is unset (single-host local development)
 * does it fall back to the request's own host.
 */
export async function appOrigin(): Promise<string> {
  const configured = process.env.APP_HOST?.trim().toLowerCase();
  const host = configured || (await headers()).get("host") || "localhost:3000";
  return `${isLocalHost(host) ? "http" : "https"}://${host}`;
}
