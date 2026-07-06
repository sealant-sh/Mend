import { Schema } from "effect";

export class IssueNotFoundError extends Schema.TaggedErrorClass<IssueNotFoundError>()(
  "IssueNotFoundError",
  {
    issueId: Schema.String,
  },
) {}
