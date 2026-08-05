/**
 * SAKURA AI Workspace
 * Shared dialog utilities.
 */

(() => {
  const workspace =
    globalThis.__SAKURA_AI_WORKSPACE__;

  if (!workspace) {
    throw new Error(
      "Workspace core must load before shared/dialog.js.",
    );
  }

  workspace.shared =
    workspace.shared || {};

  function create({
    dialog,
    onOpen,
    onClose,
  } = {}) {
    if (!dialog) {
      throw new TypeError(
        "Dialog requires an element.",
      );
    }

    let pendingRequest = null;

    function isOpen() {
      return Boolean(dialog.open);
    }

    function open() {
      if (
        typeof onOpen === "function"
      ) {
        onOpen(dialog);
      }

      if (
        typeof dialog.showModal ===
        "function"
      ) {
        if (!dialog.open) {
          dialog.showModal();
        }

        return;
      }

      dialog.setAttribute(
        "open",
        "",
      );
    }

    function close(returnValue = "") {
      if (
        typeof onClose === "function"
      ) {
        onClose(
          dialog,
          returnValue,
        );
      }

      if (
        typeof dialog.close ===
        "function" &&
        dialog.open
      ) {
        dialog.close(returnValue);
        return;
      }

      dialog.removeAttribute("open");
    }

    function settle(
      method,
      value,
    ) {
      if (!pendingRequest) {
        return;
      }

      const request =
        pendingRequest;

      pendingRequest = null;

      request[method](value);
    }

    function resolve(value) {
      settle(
        "resolve",
        value,
      );

      close("resolved");
    }

    function reject(error) {
      const normalizedError =
        error instanceof Error
          ? error
          : new Error(
              String(
                error ||
                  "Dialog cancelled.",
              ),
            );

      settle(
        "reject",
        normalizedError,
      );

      close("rejected");
    }

    function request() {
      if (pendingRequest) {
        return pendingRequest.promise;
      }

      let resolvePromise;
      let rejectPromise;

      const promise =
        new Promise(
          (resolveHandler, rejectHandler) => {
            resolvePromise =
              resolveHandler;

            rejectPromise =
              rejectHandler;
          },
        );

      pendingRequest = {
        promise,
        resolve: resolvePromise,
        reject: rejectPromise,
      };

      open();

      return promise;
    }

    function cancel(
      message = "Dialog cancelled.",
    ) {
      reject(
        new Error(message),
      );
    }

    function destroy() {
      if (pendingRequest) {
        settle(
          "reject",
          new Error(
            "Dialog was destroyed.",
          ),
        );
      }

      close("destroyed");
    }

    return {
      element: dialog,
      open,
      close,
      request,
      resolve,
      reject,
      cancel,
      isOpen,
      destroy,
    };
  }

  workspace.shared.dialog = {
    create,
  };
})();
