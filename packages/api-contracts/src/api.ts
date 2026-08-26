import { HttpApi } from "effect/unstable/httpapi";

import { accountsGroup } from "./accounts.ts";
import { sessionChangesGroup } from "./changes.ts";
import { devicesGroup, userDevicesGroup, pairGroup } from "./devices.ts";
import { githubGroup } from "./github.ts";
import {
  projectClusterBindingsGroup,
  projectEnvironmentGroup,
  projectSecretsGroup,
  projectRecipesGroup,
} from "./project-environment.ts";
import { projectsGroup, gitKeysGroup, referencesGroup, projectMountsGroup } from "./projects.ts";
import { issuesGroup, briefsGroup, runsGroup } from "./queue.ts";
import { sessionsGroup } from "./sessions.ts";
import { settingsGroup, dotfilesGroup } from "./settings.ts";
import { healthGroup, machineGroup, sealantGroup } from "./system.ts";

export const MendApi = HttpApi.make("mend")
  .add(healthGroup)
  .add(machineGroup)
  .add(sealantGroup)
  .add(accountsGroup)
  .add(settingsGroup)
  .add(dotfilesGroup)
  .add(issuesGroup)
  .add(briefsGroup)
  .add(runsGroup)
  .add(projectsGroup)
  .add(gitKeysGroup)
  .add(projectEnvironmentGroup)
  .add(projectSecretsGroup)
  .add(projectClusterBindingsGroup)
  .add(projectMountsGroup)
  .add(projectRecipesGroup)
  .add(referencesGroup)
  .add(sessionsGroup)
  .add(sessionChangesGroup)
  .add(githubGroup)
  .add(devicesGroup)
  .add(userDevicesGroup)
  .add(pairGroup)
  .prefix("/api");
