import {
  createWorkspaceSdk,
} from "./sdk/workspace-sdk.js";

const WORKSPACE_BASE_URL =
  "https://sakura-welfare-platform.fangwl591021.workers.dev";

const TOKEN_STORAGE_KEY =
  "sakuraWorkspaceToken";

const workspace = createWorkspaceSdk({
  baseUrl: WORKSPACE_BASE_URL,
});

async function loadToken() {
  const stored = await chrome.storage.session.get(
    TOKEN_STORAGE_KEY,
  );

  workspace.setToken(
    stored[TOKEN_STORAGE_KEY] || "",
  );
}

async function saveToken() {
  if (workspace.token) {
    await chrome.storage.session.set({
      [TOKEN_STORAGE_KEY]: workspace.token,
    });
  } else {
    await chrome.storage.session.remove(
      TOKEN_STORAGE_KEY,
    );
  }
}

async function handleWorkspaceMessage(message) {
  console.log(
    "[Workspace handling]",
    message?.type,
    message?.payload,
  );

  const type = String(message?.type || "");

  await loadToken();

  if (type === "workspace.login") {
    const result = await workspace.login(
      message.payload || {},
    );

    await saveToken();
    return result;
  }

  if (type === "workspace.activity.create") {
    return workspace.createActivity(
      message.payload || {},
    );
  }

  if (type === "workspace.photo.upload") {
    throw new Error(
      "Photo upload messaging will be connected after the activity API.",
    );
  }

  if (type === "workspace.logout") {
    const result = await workspace.logout();

    await saveToken();
    return result;
  }

  if (type === "workspace.session.status") {
    return {
      success: true,
      data: {
        authenticated: Boolean(workspace.token),
      },
    };
  }

  return null;
}

chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
    console.log(
      "[Workspace message received]",
      message,
      sender,
    );

    if (
      !String(message?.type || "")
        .startsWith("workspace.")
    ) {
      return false;
    }

    handleWorkspaceMessage(message)
      .then((result) => {
        sendResponse({
          ok: true,
          result,
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: {
            message:
              error?.message ||
              "Workspace request failed.",
            status:
              Number(error?.status || 0),
          },
        });
      });

    return true;
  },
);

console.info(
  "[SAKURA AI Workspace] Service worker loaded.",
);
