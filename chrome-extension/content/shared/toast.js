/**
 * SAKURA AI Workspace
 * Shared toast utilities.
 */

(() => {
  const workspace =
    globalThis.__SAKURA_AI_WORKSPACE__;

  if (!workspace) {
    throw new Error(
      "Workspace core must load before shared/toast.js.",
    );
  }

  workspace.shared =
    workspace.shared || {};

  function resolveToastElement(value) {
    if (
      value &&
      typeof value === "object" &&
      typeof value.textContent === "string"
    ) {
      return value;
    }

    return null;
  }

  function create({
    element,
    duration = 2200,
  } = {}) {
    const toast =
      resolveToastElement(element);

    if (!toast) {
      throw new TypeError(
        "Toast requires an element.",
      );
    }

    let timer = null;

    function clearTimer() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }

    function hide() {
      clearTimer();

      toast.classList.remove(
        "show",
        "success",
        "error",
        "warning",
        "info",
      );

      toast.textContent = "";
    }

    function show(
      message,
      type = "info",
      customDuration = duration,
    ) {
      clearTimer();

      toast.textContent =
        String(message || "");

      toast.classList.remove(
        "success",
        "error",
        "warning",
        "info",
      );

      toast.classList.add(
        type,
        "show",
      );

      timer = setTimeout(
        hide,
        Number(customDuration) ||
          duration,
      );
    }

    return {
      show,

      success(message, customDuration) {
        show(
          message,
          "success",
          customDuration,
        );
      },

      error(message, customDuration) {
        show(
          message,
          "error",
          customDuration,
        );
      },

      warning(message, customDuration) {
        show(
          message,
          "warning",
          customDuration,
        );
      },

      info(message, customDuration) {
        show(
          message,
          "info",
          customDuration,
        );
      },

      hide,
      destroy() {
        hide();
      },
    };
  }

  workspace.shared.toast = {
    create,
  };
})();
