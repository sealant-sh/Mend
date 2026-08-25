import { Schema } from "effect";

import { run } from "../api/index.ts";
import { input, procedure, router } from "./trpc.ts";

/** Paired devices — pairing itself (`/api/pair`) stays unauthenticated on the raw API. */
export const devicesRouter = router({
  list: procedure.query(({ ctx }) => run(ctx, (api) => api.userDevices.list())),
  createPairing: procedure.mutation(({ ctx }) =>
    run(ctx, (api) => api.userDevices.createPairing()),
  ),
  revoke: procedure
    .input(input(Schema.Struct({ id: Schema.String })))
    .mutation(({ ctx, input: i }) =>
      run(ctx, (api) => api.userDevices.revoke({ params: { id: i.id } })),
    ),
});
