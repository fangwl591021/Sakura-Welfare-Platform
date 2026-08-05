/**
 * SAKURA AI Workspace
 * Activity dashboard summary.
 */

(() => {
  const workspace =
    globalThis.__SAKURA_AI_WORKSPACE__;

  if (!workspace) {
    throw new Error(
      "Workspace core must load before activity-dashboard.js.",
    );
  }

  workspace.activity =
    workspace.activity || {};

  function create({
    totalElement,
    activeElement,
    endedElement,
    now = () => Date.now(),
  } = {}) {
    if (
      !totalElement ||
      !activeElement ||
      !endedElement
    ) {
      throw new TypeError(
        "Activity dashboard summary elements are required.",
      );
    }

    function update(activities = []) {
      const items =
        Array.isArray(activities)
          ? activities
          : [];

      const currentTime =
        Number(now());

      let activeCount = 0;
      let endedCount = 0;

      items.forEach((activity) => {
        const endTime =
          new Date(
            String(activity?.end_at || "")
              .replace(" ", "T"),
          ).getTime();

        if (
          Number.isFinite(endTime) &&
          endTime < currentTime
        ) {
          endedCount += 1;
        } else {
          activeCount += 1;
        }
      });

      totalElement.textContent =
        String(items.length);

      activeElement.textContent =
        String(activeCount);

      endedElement.textContent =
        String(endedCount);

      return {
        total: items.length,
        active: activeCount,
        ended: endedCount,
      };
    }

    return {
      update,
    };
  }

  workspace.activity.dashboard = {
    create,
  };
})();
