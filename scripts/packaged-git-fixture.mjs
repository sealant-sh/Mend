import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { isInside } from "./packaged-server-assertions.mjs";

/** Dumb Git HTTP over a copied bare repository. No host ports, credentials, or directory listings. */
export function gitFixtureServer(root) {
  return createServer(async (request, response) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405).end();
        return;
      }
      const pathname = decodeURIComponent(new URL(request.url, "http://fixture").pathname);
      const target = await realpath(resolve(root, `.${pathname}`));
      if (!isInside(root, target) || !(await stat(target)).isFile()) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "cache-control": "no-store",
      });
      if (request.method === "HEAD") response.end();
      else
        createReadStream(target)
          .on("error", () => response.destroy())
          .pipe(response);
    } catch {
      response.writeHead(404).end();
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  gitFixtureServer("/fixture").listen(9080, "0.0.0.0");
}
