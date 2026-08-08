// The five expanded tabs — one bespoke hairline-grid composition each, built
// from the audited content briefs (workflow marketing-tab-briefs).

import { type ReactNode } from "react";

import { ExpandedAnyTui } from "#/components/expanded/any-tui";
import { ExpandedContext } from "#/components/expanded/context";
import { ExpandedHarness } from "#/components/expanded/harness";
import { ExpandedReview } from "#/components/expanded/review";
import { ExpandedWorktrees } from "#/components/expanded/worktrees";

export const EXPANDED_LAYOUTS: ReadonlyArray<ReactNode> = [
  <ExpandedAnyTui key="x1" />,
  <ExpandedHarness key="x2" />,
  <ExpandedWorktrees key="x3" />,
  <ExpandedReview key="x4" />,
  <ExpandedContext key="x5" />,
];
