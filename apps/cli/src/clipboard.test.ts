import { describe, expect, it } from "vitest";

import { parsePngfHex, pickImageType, readClipboardImage } from "./clipboard.ts";

describe("pickImageType", () => {
  it("takes the first accepted image type from an offered list", () => {
    expect(pickImageType("text/plain\nimage/png\nimage/jpeg\n")).toBe("image/png");
    expect(pickImageType("TARGETS\nimage/jpeg\ntext/uri-list")).toBe("image/jpeg");
    expect(pickImageType("text/plain\ntext/html")).toBeNull();
    expect(pickImageType("")).toBeNull();
  });
});

describe("parsePngfHex", () => {
  it("decodes the AppleScript data literal and rejects everything else", () => {
    expect(parsePngfHex("«data PNGf89504E47»\n")).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(parsePngfHex("«data PNGf»")).toBeNull();
    expect(parsePngfHex("some text")).toBeNull();
    expect(parsePngfHex("")).toBeNull();
  });
});

describe("readClipboardImage", () => {
  it("answers null where there is no way to ask", async () => {
    expect(await readClipboardImage("win32", {})).toBeNull();
    expect(await readClipboardImage("linux", {})).toBeNull();
  });
});
