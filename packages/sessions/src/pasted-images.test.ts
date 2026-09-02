import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { HARNESS_HOME_MOUNT_PATH } from "./harness-state.ts";
import {
  PASTED_IMAGE_MAX_BYTES,
  detectImageType,
  pastedImageName,
  storePastedImage,
} from "./pasted-images.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38,
]);

const tempHome = () => fs.mkdtempSync(path.join(os.tmpdir(), "mend-paste-"));

describe("detectImageType", () => {
  it("recognises the four accepted formats by signature", () => {
    expect(detectImageType(PNG)).toBe("image/png");
    expect(detectImageType(JPEG)).toBe("image/jpeg");
    expect(detectImageType(GIF)).toBe("image/gif");
    expect(detectImageType(WEBP)).toBe("image/webp");
  });

  it("rejects anything else — a RIFF that is not WebP included", () => {
    expect(detectImageType(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBeNull();
    expect(detectImageType(new TextEncoder().encode("RIFF....WAVE"))).toBeNull();
    expect(detectImageType(new Uint8Array())).toBeNull();
  });
});

describe("pastedImageName", () => {
  it("stamps local time, the nonce, and the format's extension", () => {
    expect(pastedImageName("image/jpeg", new Date(2026, 8, 2, 14, 30, 12), "3f9a")).toBe(
      "20260902-143012-3f9a.jpg",
    );
  });
});

describe("storePastedImage", () => {
  it("writes under paste/ and answers with the workspace path", async () => {
    const home = tempHome();
    const stored = await Effect.runPromise(
      storePastedImage(home, PNG, { now: new Date(2026, 8, 2, 14, 30, 12), nonce: "abcd" }),
    );
    expect(stored.path).toBe(`${HARNESS_HOME_MOUNT_PATH}/paste/20260902-143012-abcd.png`);
    expect(stored.hostPath).toBe(path.join(home, "paste", "20260902-143012-abcd.png"));
    expect(stored.mediaType).toBe("image/png");
    expect(stored.bytes).toBe(PNG.byteLength);
    expect(new Uint8Array(fs.readFileSync(stored.hostPath))).toEqual(PNG);
    // Readable by the workspace uid, whatever it is.
    expect(fs.statSync(stored.hostPath).mode & 0o044).toBe(0o044);
  });

  it("creates the harness home when the session has not launched yet", async () => {
    const home = path.join(tempHome(), "sessions", "s1", "harness-home");
    const stored = await Effect.runPromise(storePastedImage(home, GIF));
    expect(fs.existsSync(stored.hostPath)).toBe(true);
  });

  it("refuses bytes that are not an image, writing nothing", async () => {
    const home = tempHome();
    const result = await Effect.runPromise(
      Effect.result(storePastedImage(home, new TextEncoder().encode("hello"))),
    );
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") expect(result.failure.reason).toBe("not-an-image");
    expect(fs.existsSync(path.join(home, "paste"))).toBe(false);
  });

  it("refuses an image over the cap before looking at the bytes", async () => {
    const home = tempHome();
    const huge = new Uint8Array(PASTED_IMAGE_MAX_BYTES + 1);
    huge.set(PNG);
    const result = await Effect.runPromise(Effect.result(storePastedImage(home, huge)));
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") expect(result.failure.reason).toBe("too-large");
  });
});
