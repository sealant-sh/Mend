import type { QRCodeToStringOptions } from "qrcode";

/**
 * `mend pair` and `mend qr`: hand a phone (or any second device) a token for this
 * server without typing one.
 *
 * `mend pair` asks the server for a short-lived pairing code and prints it three
 * ways — a QR of the `mend://pair` deep link, the grouped code, and the base URL
 * the device should reach — so the device can scan it or be told it by hand. The
 * code is single use and expires; the token is minted when the device claims it.
 *
 * `mend qr` is the bare renderer the installer uses: no config, no server, no
 * login. Both print on a pipe as well as in a terminal.
 */

/** POST /me/devices/pairings — the code, when it dies, and the URLs a phone could reach. */
export interface PairingDto {
  readonly code: string;
  readonly expiresAt: string;
  readonly urls: ReadonlyArray<string>;
}

/** main.ts's one-shot API call: any failure prints `mend: …` and exits 1. */
export type ApiCall = <T>(
  method: "GET" | "POST" | "DELETE",
  route: string,
  body?: unknown,
) => Promise<T>;

const paint = (code: string) => (text: string) =>
  process.stdout.isTTY === true ? `[${code}m${text}[0m` : text;
const dim = paint("2");
const green = paint("32");
const say = (line: string) => process.stdout.write(`${line}\n`);
const fail = (message: string): never => {
  process.stderr.write(`mend: ${message}\n`);
  process.exit(1);
};

const takeFlagValue = (args: ReadonlyArray<string>, flag: string): string | null => {
  const at = args.indexOf(flag);
  return at !== -1 && args[at + 1] !== undefined ? String(args[at + 1]) : null;
};

/**
 * The code as a human reads it aloud: 8 Crockford characters in two groups. The
 * server compares case-insensitively with dashes stripped, so the dash is purely
 * for the eye and either form can be typed back.
 */
export const groupCode = (code: string): string => {
  const bare = code.replace(/[^0-9a-z]/gi, "").toUpperCase();
  return bare.length <= 4 ? bare : `${bare.slice(0, 4)}-${bare.slice(4)}`;
};

/** The scanned string. The device reads the base URL and the code out of it, nothing else. */
export const pairingLink = (url: string, code: string): string =>
  `mend://pair?u=${encodeURIComponent(url)}&c=${code}`;

/**
 * Tailscale hands every node an IPv4 in the CGNAT range 100.64.0.0/10 — the same
 * observation packages/api/src/machine.ts makes. A tailnet URL is preferred because
 * it keeps working when the phone leaves the LAN.
 */
const isTailnetUrl = (value: string): boolean => {
  let host: string;
  try {
    host = new URL(value).hostname;
  } catch {
    return false;
  }
  const parts = host.split(".").map(Number);
  const [first, second] = parts;
  if (parts.length !== 4 || first === undefined || second === undefined) return false;
  return first === 100 && second >= 64 && second <= 127;
};

/** `--url` wins; otherwise the tailnet address, otherwise the first candidate the server offered. */
export const chooseUrl = (urls: ReadonlyArray<string>, override: string | null): string | null =>
  override ?? urls.find(isTailnetUrl) ?? urls[0] ?? null;

/** Whole minutes left, floored at 0; null when the server sent a date this CLI cannot read. */
export const minutesUntil = (expiresAt: string, now: number = Date.now()): number | null => {
  const at = Date.parse(expiresAt);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.round((at - now) / 60_000));
};

/** The QR as block characters. Deliberately not gated on isTTY — a piped QR still scans. */
export const renderQr = async (text: string): Promise<string> => {
  const { toString: toQrString } = await import("qrcode");
  const options: QRCodeToStringOptions = { type: "terminal", small: true };
  return (await toQrString(text, options)).trimEnd();
};

/**
 * `mend pair [--url <base url>]`: mint a pairing code and show it. The device names
 * itself when it claims the code, so this side sends nothing but the request.
 */
export const pairCommand = async (args: ReadonlyArray<string>, api: ApiCall): Promise<void> => {
  const pairing = await api<PairingDto>("POST", "/me/devices/pairings");
  const url = chooseUrl(pairing.urls, takeFlagValue(args, "--url"));
  if (url === null) {
    return fail(
      "no LAN or tailnet address to hand the device — pass one: mend pair --url http://<host>:<port>",
    );
  }
  const minutes = minutesUntil(pairing.expiresAt);
  say(await renderQr(pairingLink(url, pairing.code)));
  say(`${green("✓")} pairing code ${groupCode(pairing.code)}`);
  say(`  ${dim("url")}     ${url}`);
  say(
    `  ${dim("expires")} ${minutes === null ? pairing.expiresAt : `in ${minutes} min`} ${dim("· one device, once")}`,
  );
  say("");
  say(dim("  scan it in the Mend app, or enter the url and the code there by hand"));
  say(dim("  the app is apps/mobile — build it yourself; it is not published yet"));
};

/** `mend qr <text>`: print a terminal QR of anything. Hidden from help; the installer uses it. */
export const qrCommand = async (args: ReadonlyArray<string>): Promise<void> => {
  const text = args.join(" ").trim();
  if (text === "") return fail("usage: mend qr <text>");
  say(await renderQr(text));
};
