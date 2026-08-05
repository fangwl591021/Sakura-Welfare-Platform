/**
 * SAKURA AI Workspace
 * Activity search module.
 */

(() => {
  const workspace =
    globalThis.__SAKURA_AI_WORKSPACE__;

  if (!workspace) {
    throw new Error(
      "Workspace core must load before activity-search.js.",
    );
  }

  workspace.activity =
    workspace.activity || {};

  workspace.activity.search = {
    create({
      input,
      clearButton,
      getActivities,
      render,
    } = {}) {
      if (!input || !clearButton) {
        throw new TypeError(
          "Activity search UI is incomplete.",
        );
      }

      if (
        typeof getActivities !== "function" ||
        typeof render !== "function"
      ) {
        throw new TypeError(
          "Activity search callbacks are required.",
        );
      }

      const normalize = (value) =>
        String(value || "")
          .trim()
          .toLocaleLowerCase();

      function filterActivities() {
        const source =
          getActivities();

        const activities =
          Array.isArray(source)
            ? source
            : [];

        const keyword =
          normalize(input.value);

        clearButton.hidden =
          !keyword;

        if (!keyword) {
          return activities;
        }

        return activities.filter(
          (activity) => {
            const searchable = [
              activity?.title,
              activity?.description,
              activity?.location,
            ]
              .map(normalize)
              .join(" ");

            return searchable.includes(
              keyword,
            );
          },
        );
      }

      function refresh() {
        render(filterActivities());
      }

      function clear() {
        input.value = "";
        refresh();
        input.focus();
      }

      input.addEventListener(
        "input",
        refresh,
      );

      clearButton.addEventListener(
        "click",
        clear,
      );

      return {
        refresh,
        clear,
        filterActivities,

        destroy() {
          input.removeEventListener(
            "input",
            refresh,
          );

          clearButton.removeEventListener(
            "click",
            clear,
          );
        },
      };
    },
  };
})();
