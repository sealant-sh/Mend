import { defineRelations } from "drizzle-orm";

import * as schema from "./workbench.ts";

export const relations = defineRelations(schema, (r) => ({
  issues: {
    change: r.one.changes({ from: r.issues.id, to: r.changes.issueId }),
    runs: r.many.runs({ from: r.issues.id, to: r.runs.issueId }),
  },
  changes: {
    issue: r.one.issues({ from: r.changes.issueId, to: r.issues.id }),
    runs: r.many.runs({ from: r.changes.id, to: r.runs.changeId }),
    brief: r.one.briefs({ from: r.changes.id, to: r.briefs.changeId }),
  },
  runs: {
    issue: r.one.issues({ from: r.runs.issueId, to: r.issues.id }),
    change: r.one.changes({ from: r.runs.changeId, to: r.changes.id }),
  },
  briefs: {
    change: r.one.changes({ from: r.briefs.changeId, to: r.changes.id }),
    versions: r.many.briefVersions({ from: r.briefs.id, to: r.briefVersions.briefId }),
    questions: r.many.reviewQuestions({ from: r.briefs.id, to: r.reviewQuestions.briefId }),
    comments: r.many.briefComments({ from: r.briefs.id, to: r.briefComments.briefId }),
  },
  briefVersions: {
    brief: r.one.briefs({ from: r.briefVersions.briefId, to: r.briefs.id }),
  },
  reviewQuestions: {
    brief: r.one.briefs({ from: r.reviewQuestions.briefId, to: r.briefs.id }),
  },
  briefComments: {
    brief: r.one.briefs({ from: r.briefComments.briefId, to: r.briefs.id }),
  },
  projects: {
    sessions: r.many.agentSessions({ from: r.projects.id, to: r.agentSessions.projectId }),
    worktrees: r.many.worktrees({ from: r.projects.id, to: r.worktrees.projectId }),
    changes: r.many.worktreeChanges({ from: r.projects.id, to: r.worktreeChanges.projectId }),
    mounts: r.many.projectMounts({ from: r.projects.id, to: r.projectMounts.projectId }),
    references: r.many.projectReferences({
      from: r.projects.id,
      to: r.projectReferences.projectId,
    }),
  },
  projectMounts: {
    project: r.one.projects({ from: r.projectMounts.projectId, to: r.projects.id }),
  },
  referenceRepos: {
    projects: r.many.projectReferences({
      from: r.referenceRepos.id,
      to: r.projectReferences.referenceId,
    }),
  },
  projectReferences: {
    project: r.one.projects({ from: r.projectReferences.projectId, to: r.projects.id }),
    reference: r.one.referenceRepos({
      from: r.projectReferences.referenceId,
      to: r.referenceRepos.id,
    }),
  },
  contextSnapshots: {
    sessions: r.many.agentSessions({
      from: r.contextSnapshots.id,
      to: r.agentSessions.contextSnapshotId,
    }),
  },
  worktrees: {
    project: r.one.projects({ from: r.worktrees.projectId, to: r.projects.id }),
    sessions: r.many.agentSessions({ from: r.worktrees.id, to: r.agentSessions.worktreeId }),
    change: r.one.worktreeChanges({ from: r.worktrees.id, to: r.worktreeChanges.worktreeId }),
    checkpoints: r.many.checkpoints({ from: r.worktrees.id, to: r.checkpoints.worktreeId }),
  },
  agentSessions: {
    project: r.one.projects({ from: r.agentSessions.projectId, to: r.projects.id }),
    // `worktree` would collide with the mirror column; the row link gets a suffix.
    worktreeRow: r.one.worktrees({ from: r.agentSessions.worktreeId, to: r.worktrees.id }),
    contextSnapshot: r.one.contextSnapshots({
      from: r.agentSessions.contextSnapshotId,
      to: r.contextSnapshots.id,
    }),
    runs: r.many.sessionRuns({ from: r.agentSessions.id, to: r.sessionRuns.sessionId }),
    processes: r.many.sessionProcesses({
      from: r.agentSessions.id,
      to: r.sessionProcesses.sessionId,
    }),
    agentTurns: r.many.agentTurns({ from: r.agentSessions.id, to: r.agentTurns.sessionId }),
    agentItems: r.many.agentItems({ from: r.agentSessions.id, to: r.agentItems.sessionId }),
    agentRequests: r.many.agentRequests({
      from: r.agentSessions.id,
      to: r.agentRequests.sessionId,
    }),
    change: r.one.worktreeChanges({ from: r.agentSessions.id, to: r.worktreeChanges.sessionId }),
    checkpoints: r.many.checkpoints({
      from: r.agentSessions.id,
      to: r.checkpoints.sessionId,
    }),
    followUps: r.many.followUps({ from: r.agentSessions.id, to: r.followUps.sessionId }),
    sentReviewComments: r.many.reviewComments({
      from: r.agentSessions.id,
      to: r.reviewComments.sentToSessionId,
    }),
    changeTours: r.many.changeTours({ from: r.agentSessions.id, to: r.changeTours.sessionId }),
  },
  sessionProcesses: {
    session: r.one.agentSessions({
      from: r.sessionProcesses.sessionId,
      to: r.agentSessions.id,
    }),
    turns: r.many.agentTurns({ from: r.sessionProcesses.id, to: r.agentTurns.processId }),
    items: r.many.agentItems({ from: r.sessionProcesses.id, to: r.agentItems.processId }),
    requests: r.many.agentRequests({
      from: r.sessionProcesses.id,
      to: r.agentRequests.processId,
    }),
  },
  agentTurns: {
    session: r.one.agentSessions({ from: r.agentTurns.sessionId, to: r.agentSessions.id }),
    process: r.one.sessionProcesses({ from: r.agentTurns.processId, to: r.sessionProcesses.id }),
    items: r.many.agentItems({ from: r.agentTurns.id, to: r.agentItems.turnId }),
    requests: r.many.agentRequests({ from: r.agentTurns.id, to: r.agentRequests.turnId }),
  },
  agentItems: {
    session: r.one.agentSessions({ from: r.agentItems.sessionId, to: r.agentSessions.id }),
    process: r.one.sessionProcesses({ from: r.agentItems.processId, to: r.sessionProcesses.id }),
    turn: r.one.agentTurns({ from: r.agentItems.turnId, to: r.agentTurns.id }),
  },
  agentRequests: {
    session: r.one.agentSessions({ from: r.agentRequests.sessionId, to: r.agentSessions.id }),
    process: r.one.sessionProcesses({
      from: r.agentRequests.processId,
      to: r.sessionProcesses.id,
    }),
    turn: r.one.agentTurns({ from: r.agentRequests.turnId, to: r.agentTurns.id }),
  },
  sessionRuns: {
    session: r.one.agentSessions({ from: r.sessionRuns.sessionId, to: r.agentSessions.id }),
    checkpoints: r.many.checkpoints({
      from: r.sessionRuns.sealantRunId,
      to: r.checkpoints.sealantRunId,
    }),
  },
  worktreeChanges: {
    project: r.one.projects({ from: r.worktreeChanges.projectId, to: r.projects.id }),
    worktree: r.one.worktrees({ from: r.worktreeChanges.worktreeId, to: r.worktrees.id }),
    session: r.one.agentSessions({ from: r.worktreeChanges.sessionId, to: r.agentSessions.id }),
    followUps: r.many.followUps({ from: r.worktreeChanges.id, to: r.followUps.changeId }),
    reviewComments: r.many.reviewComments({
      from: r.worktreeChanges.id,
      to: r.reviewComments.changeId,
    }),
    tour: r.one.changeTours({ from: r.worktreeChanges.id, to: r.changeTours.changeId }),
    passes: r.many.changePasses({ from: r.worktreeChanges.id, to: r.changePasses.changeId }),
    reviewSlices: r.many.reviewSlices({
      from: r.worktreeChanges.id,
      to: r.reviewSlices.changeId,
    }),
  },
  followUps: {
    session: r.one.agentSessions({ from: r.followUps.sessionId, to: r.agentSessions.id }),
    change: r.one.worktreeChanges({ from: r.followUps.changeId, to: r.worktreeChanges.id }),
  },
  reviewComments: {
    change: r.one.worktreeChanges({
      from: r.reviewComments.changeId,
      to: r.worktreeChanges.id,
    }),
    sentToSession: r.one.agentSessions({
      from: r.reviewComments.sentToSessionId,
      to: r.agentSessions.id,
    }),
  },
  changeTours: {
    change: r.one.worktreeChanges({ from: r.changeTours.changeId, to: r.worktreeChanges.id }),
    session: r.one.agentSessions({ from: r.changeTours.sessionId, to: r.agentSessions.id }),
  },
  changePasses: {
    change: r.one.worktreeChanges({ from: r.changePasses.changeId, to: r.worktreeChanges.id }),
  },
  reviewSlices: {
    change: r.one.worktreeChanges({ from: r.reviewSlices.changeId, to: r.worktreeChanges.id }),
    checkpointA: r.one.checkpoints({
      from: r.reviewSlices.checkpointAId,
      to: r.checkpoints.id,
    }),
    checkpointB: r.one.checkpoints({
      from: r.reviewSlices.checkpointBId,
      to: r.checkpoints.id,
    }),
  },
  checkpoints: {
    worktree: r.one.worktrees({ from: r.checkpoints.worktreeId, to: r.worktrees.id }),
    session: r.one.agentSessions({ from: r.checkpoints.sessionId, to: r.agentSessions.id }),
    run: r.one.sessionRuns({
      from: r.checkpoints.sealantRunId,
      to: r.sessionRuns.sealantRunId,
    }),
  },
}));
