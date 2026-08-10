import { defineRelations } from "drizzle-orm";

import * as schema from "./workbench.ts";

export const relations = defineRelations(schema, (r) => ({
  projects: {
    sessions: r.many.agentSessions({ from: r.projects.id, to: r.agentSessions.projectId }),
    changes: r.many.sessionChanges({ from: r.projects.id, to: r.sessionChanges.projectId }),
    mounts: r.many.projectMounts({ from: r.projects.id, to: r.projectMounts.projectId }),
  },
  projectMounts: {
    project: r.one.projects({ from: r.projectMounts.projectId, to: r.projects.id }),
  },
  contextSnapshots: {
    sessions: r.many.agentSessions({
      from: r.contextSnapshots.id,
      to: r.agentSessions.contextSnapshotId,
    }),
  },
  agentSessions: {
    project: r.one.projects({ from: r.agentSessions.projectId, to: r.projects.id }),
    contextSnapshot: r.one.contextSnapshots({
      from: r.agentSessions.contextSnapshotId,
      to: r.contextSnapshots.id,
    }),
    runs: r.many.sessionRuns({ from: r.agentSessions.id, to: r.sessionRuns.sessionId }),
    change: r.one.sessionChanges({ from: r.agentSessions.id, to: r.sessionChanges.sessionId }),
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
  sessionRuns: {
    session: r.one.agentSessions({ from: r.sessionRuns.sessionId, to: r.agentSessions.id }),
    checkpoints: r.many.checkpoints({
      from: r.sessionRuns.sealantRunId,
      to: r.checkpoints.sealantRunId,
    }),
  },
  sessionChanges: {
    project: r.one.projects({ from: r.sessionChanges.projectId, to: r.projects.id }),
    session: r.one.agentSessions({ from: r.sessionChanges.sessionId, to: r.agentSessions.id }),
    followUps: r.many.followUps({ from: r.sessionChanges.id, to: r.followUps.changeId }),
    reviewComments: r.many.reviewComments({
      from: r.sessionChanges.id,
      to: r.reviewComments.changeId,
    }),
    tour: r.one.changeTours({ from: r.sessionChanges.id, to: r.changeTours.changeId }),
    passes: r.many.changePasses({ from: r.sessionChanges.id, to: r.changePasses.changeId }),
  },
  followUps: {
    session: r.one.agentSessions({ from: r.followUps.sessionId, to: r.agentSessions.id }),
    change: r.one.sessionChanges({ from: r.followUps.changeId, to: r.sessionChanges.id }),
  },
  reviewComments: {
    change: r.one.sessionChanges({
      from: r.reviewComments.changeId,
      to: r.sessionChanges.id,
    }),
    sentToSession: r.one.agentSessions({
      from: r.reviewComments.sentToSessionId,
      to: r.agentSessions.id,
    }),
  },
  changeTours: {
    change: r.one.sessionChanges({ from: r.changeTours.changeId, to: r.sessionChanges.id }),
    session: r.one.agentSessions({ from: r.changeTours.sessionId, to: r.agentSessions.id }),
  },
  changePasses: {
    change: r.one.sessionChanges({ from: r.changePasses.changeId, to: r.sessionChanges.id }),
  },
  checkpoints: {
    session: r.one.agentSessions({ from: r.checkpoints.sessionId, to: r.agentSessions.id }),
    run: r.one.sessionRuns({
      from: r.checkpoints.sealantRunId,
      to: r.sessionRuns.sealantRunId,
    }),
  },
}));
