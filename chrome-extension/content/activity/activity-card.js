/**
 * SAKURA AI Workspace
 * Activity card renderer.
 */

(() => {
  const workspace =
    globalThis.__SAKURA_AI_WORKSPACE__;

  if (!workspace) {
    throw new Error(
      "Workspace core must load before activity-card.js.",
    );
  }

  workspace.activity =
    workspace.activity || {};

  function create({
    container,
    format,
    emptyText = "目前尚無活動。",
    onOpen,
  } = {}) {
    if (!container) {
      throw new TypeError(
        "Activity card requires a container.",
      );
    }

    if (
      !format ||
      typeof format.escapeHtml !== "function" ||
      typeof format.formatDateTime !== "function"
    ) {
      throw new TypeError(
        "Activity card requires format utilities.",
      );
    }

    if (typeof onOpen !== "function") {
      throw new TypeError(
        "Activity card requires onOpen().",
      );
    }

    function render(activities = []) {
      const items =
        Array.isArray(activities)
          ? activities
          : [];

      if (!items.length) {
        container.innerHTML =
          `<div class="empty">${format.escapeHtml(emptyText)}</div>`;
        return;
      }

      container.innerHTML = items
        .map((activity) => {
          const coverImageUrl =
            String(
              activity?.cover_image_url || "",
            ).trim();

          const title =
            String(activity?.title || "");

          const coverHtml =
            coverImageUrl
              ? `
                <div class="activity-cover">
                  <img
                    src="${format.escapeHtml(coverImageUrl)}"
                    alt="${format.escapeHtml(title)}"
                    loading="lazy"
                  >
                </div>
              `
              : `
                <div class="activity-cover">
                  <div
                    class="activity-cover-empty"
                    aria-hidden="true"
                  >
                    &#9633;
                  </div>
                </div>
              `;

          return `
            <article
              class="activity-card"
              role="button"
              tabindex="0"
              data-activity-id="${format.escapeHtml(activity?.id)}"
              aria-label="編輯活動：${format.escapeHtml(title)}"
            >
              ${coverHtml}

              <div class="activity-content">
                <h3>
                  ${format.escapeHtml(title)}
                </h3>

                <div class="activity-meta">
                  ${format.escapeHtml(
                    format.formatDateTime(activity?.start_at),
                  )}
                  —
                  ${format.escapeHtml(
                    format.formatDateTime(activity?.end_at),
                  )}
                  <br>
                  ${format.escapeHtml(activity?.location || "-")}
                </div>
              </div>
            </article>
          `;
        })
        .join("");

      container
        .querySelectorAll(".activity-card")
        .forEach((card) => {
          const openCard = () => {
            onOpen(card.dataset.activityId);
          };

          card.addEventListener(
            "click",
            openCard,
          );

          card.addEventListener(
            "keydown",
            (event) => {
              if (
                event.key === "Enter" ||
                event.key === " "
              ) {
                event.preventDefault();
                openCard();
              }
            },
          );
        });
    }

    return {
      render,
    };
  }

  workspace.activity.card = {
    create,
  };
})();
