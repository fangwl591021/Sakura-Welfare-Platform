/**
 * SAKURA AI Workspace
 * Shared content-script namespace.
 */

(() => {
  const globalKey =
    "__SAKURA_AI_WORKSPACE__";

  const existing =
    globalThis[globalKey];

  const workspace =
    existing &&
    typeof existing === "object"
      ? existing
      : {};

  workspace.ui =
    workspace.ui || {};

  workspace.auth =
    workspace.auth || {};

  workspace.activity =
    workspace.activity || {};

  workspace.state =
    workspace.state || {
      activities: [],
      currentActivityId: "",
    };

  globalThis[globalKey] =
    workspace;
})();
