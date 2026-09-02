import { execFile } from "node:child_process";

/**
 * The image on this machine's clipboard, if there is one. The agent runs in a
 * workspace with no display, so its own Ctrl+V finds nothing; the CLI reads
 * the clipboard here and hands the bytes to Mend instead.
 */
export interface ClipboardImage {
  readonly bytes: Buffer;
  readonly mediaType: string;
}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

/** The first image type this reader accepts from a clipboard's offered list. */
export const pickImageType = (offered: string): string | null => {
  const types = offered.split(/\s+/).map((type) => type.trim().toLowerCase());
  for (const type of IMAGE_TYPES) if (types.includes(type)) return type;
  return null;
};

/**
 * AppleScript's `«data PNGf…»` literal: the PNG bytes as hex, from
 * `the clipboard as «class PNGf»`. Null when the clipboard held no image.
 */
export const parsePngfHex = (output: string): Buffer | null => {
  const match = /«data PNGf([0-9A-Fa-f]+)»/.exec(output.trim());
  if (match?.[1] === undefined || match[1].length === 0) return null;
  return Buffer.from(match[1], "hex");
};

const MAX_BYTES = 32 * 1024 * 1024;

/** One clipboard tool call; null when the tool is missing, fails, or times out. */
const run = (command: string, args: ReadonlyArray<string>): Promise<Buffer | null> =>
  new Promise((resolve) => {
    execFile(
      command,
      [...args],
      { encoding: "buffer", maxBuffer: MAX_BYTES, timeout: 3000 },
      (error, stdout) => {
        resolve(error === null ? stdout : null);
      },
    );
  });

const fromWayland = async (): Promise<ClipboardImage | null> => {
  const offered = await run("wl-paste", ["--list-types"]);
  if (offered === null) return null;
  const mediaType = pickImageType(offered.toString("utf8"));
  if (mediaType === null) return null;
  const bytes = await run("wl-paste", ["--no-newline", "--type", mediaType]);
  return bytes === null || bytes.length === 0 ? null : { bytes, mediaType };
};

const fromX11 = async (): Promise<ClipboardImage | null> => {
  const offered = await run("xclip", ["-selection", "clipboard", "-t", "TARGETS", "-o"]);
  if (offered === null) return null;
  const mediaType = pickImageType(offered.toString("utf8"));
  if (mediaType === null) return null;
  const bytes = await run("xclip", ["-selection", "clipboard", "-t", mediaType, "-o"]);
  return bytes === null || bytes.length === 0 ? null : { bytes, mediaType };
};

const fromMac = async (): Promise<ClipboardImage | null> => {
  const output = await run("osascript", ["-e", "the clipboard as «class PNGf»"]);
  if (output === null) return null;
  const bytes = parsePngfHex(output.toString("utf8"));
  return bytes === null ? null : { bytes, mediaType: "image/png" };
};

/**
 * Read an image off the clipboard: wl-paste on Wayland, xclip on X11,
 * osascript on macOS. Null when there is no image or no way to ask — the
 * caller then forwards the keystroke as it was.
 */
export const readClipboardImage = async (
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ClipboardImage | null> => {
  if (platform === "darwin") return fromMac();
  if (platform !== "linux" && platform !== "freebsd" && platform !== "openbsd") return null;
  if (env["WAYLAND_DISPLAY"] !== undefined && env["WAYLAND_DISPLAY"] !== "") {
    const image = await fromWayland();
    if (image !== null) return image;
  }
  if (env["DISPLAY"] !== undefined && env["DISPLAY"] !== "") return fromX11();
  return null;
};
