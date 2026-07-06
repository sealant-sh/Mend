import { Config, Effect, Layer, Option, Redacted } from "effect";
import * as Context from "effect/Context";

/** Where the operator's Sealant control plane lives. */
export class SealantEnv extends Context.Service<
  SealantEnv,
  {
    readonly baseUrl: string;
    readonly apiKey: Option.Option<Redacted.Redacted>;
  }
>()("@mend/sealant/SealantEnv") {
  static readonly layer = Layer.effect(
    SealantEnv,
    Effect.gen(function* () {
      const baseUrl = yield* Config.string("SEALANT_BASE_URL").pipe(
        Config.orElse(() => Config.succeed("http://localhost:8080")),
      );
      const apiKey = yield* Config.option(Config.redacted("SEALANT_API_KEY"));
      return { baseUrl, apiKey };
    }),
  );
}
