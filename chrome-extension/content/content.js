(() => {
  const ROOT_ID = "sakura-ai-workspace-extension";

  if (document.getElementById(ROOT_ID)) {
    return;
  }

  const text = {
    launcher: "\u6d3b\u52d5\u7ba1\u7406",
    managerTitle: "\u6d3b\u52d5\u7ba1\u7406",
    newActivity: "\uff0b \u65b0\u589e\u6d3b\u52d5",
    refresh: "\u91cd\u65b0\u8f09\u5165",
    loading: "\u8b80\u53d6\u4e2d...",
    empty: "\u76ee\u524d\u5c1a\u7121\u6d3b\u52d5\u3002",
    edit: "\u67e5\u770b\uff0f\u4fee\u6539",
    createTitle: "\u5efa\u7acb\u54e1\u5de5\u6d3b\u52d5",
    editTitle: "\u4fee\u6539\u54e1\u5de5\u6d3b\u52d5",
    back: "\u8fd4\u56de\u5217\u8868",
    close: "\u95dc\u9589",
    cancel: "\u53d6\u6d88",
    create: "\u5efa\u7acb\u6d3b\u52d5",
    save: "\u5132\u5b58\u4fee\u6539",
    saving: "\u5132\u5b58\u4e2d...",
    title: "\u6d3b\u52d5\u540d\u7a31",
    description: "\u6d3b\u52d5\u8aaa\u660e",
    start: "\u958b\u59cb\u6642\u9593",
    end: "\u7d50\u675f\u6642\u9593",
    location: "\u6d3b\u52d5\u5730\u9ede",
    photo: "\u6d3b\u52d5\u7167\u7247",
    photoHint:
      "\u652f\u63f4 JPG\u3001PNG\u3001WebP\u3002\u76ee\u524d\u5148\u672c\u6a5f\u9810\u89bd\uff0c\u7167\u7247\u4e0a\u50b3\u5c07\u5728\u4e0b\u4e00\u968e\u6bb5\u4e32\u63a5\u3002",
    titlePlaceholder: "\u4f8b\uff1a\u5065\u884c\u793e\u4e2d\u79cb\u70e4\u8089",
    descriptionPlaceholder:
      "\u8acb\u8f38\u5165\u6d3b\u52d5\u5167\u5bb9\u3001\u96c6\u5408\u65b9\u5f0f\u8207\u6ce8\u610f\u4e8b\u9805",
    locationPlaceholder: "\u4f8b\uff1a\u672c\u5ee0\u6d3b\u52d5\u4e2d\u5fc3",
    loginUsername: "\u8acb\u8f38\u5165\u5f8c\u53f0\u5e33\u865f\uff1a",
    loginPassword: "\u8acb\u8f38\u5165\u5f8c\u53f0\u5bc6\u78bc\uff1a",
    loginCancelled: "\u5df2\u53d6\u6d88\u767b\u5165\u3002",
    requiredTitle: "\u8acb\u8f38\u5165\u6d3b\u52d5\u540d\u7a31\u3002",
    requiredStart: "\u8acb\u9078\u64c7\u958b\u59cb\u6642\u9593\u3002",
    requiredEnd: "\u8acb\u9078\u64c7\u7d50\u675f\u6642\u9593\u3002",
    invalidRange: "\u7d50\u675f\u6642\u9593\u5fc5\u9808\u665a\u65bc\u958b\u59cb\u6642\u9593\u3002",
    requiredLocation: "\u8acb\u8f38\u5165\u6d3b\u52d5\u5730\u9ede\u3002",
    invalidPhoto: "\u8acb\u9078\u64c7\u5716\u7247\u6a94\u6848\u3002",
    photoTooLarge: "\u6d3b\u52d5\u7167\u7247\u4e0d\u53ef\u8d85\u904e 8 MB\u3002",
    createSuccess: "\u6d3b\u52d5\u5efa\u7acb\u6210\u529f",
    updateSuccess: "\u6d3b\u52d5\u4fee\u6539\u6210\u529f",
    loadFailed: "\u6d3b\u52d5\u8cc7\u6599\u8b80\u53d6\u5931\u6557\u3002",
    saveFailed: "\u6d3b\u52d5\u5132\u5b58\u5931\u6557\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66\u3002",
  };

  const host = document.createElement("div");
  host.id = ROOT_ID;
  host.style.all = "initial";
  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.width = "0";
  host.style.height = "0";
  host.style.zIndex = "2147483647";
  host.style.pointerEvents = "none";
  host.style.overflow = "visible";

  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });

  shadow.innerHTML = `
    <style>
      * { box-sizing: border-box; }

      button,
      input,
      textarea {
        font: inherit;
      }

      .launcher {
        position: fixed;
        right: 24px;
        bottom: 24px;
        z-index: 2147483647;
        pointer-events: auto;
        min-width: 154px;
        height: 48px;
        padding: 0 18px;
        border: 0;
        border-radius: 999px;
        background: #06c755;
        color: #fff;
        font: 700 15px/1 system-ui, sans-serif;
        box-shadow: 0 12px 30px rgba(15, 23, 42, .28);
        cursor: pointer;
      }

      .backdrop {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        pointer-events: auto;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: rgba(15, 23, 42, .52);
      }

      .backdrop.open { display: flex; }

      .modal {
        width: min(820px, 100%);
        max-height: calc(100vh - 48px);
        overflow: auto;
        border-radius: 18px;
        background: #fff;
        color: #0f172a;
        box-shadow: 0 26px 70px rgba(15, 23, 42, .35);
        font-family: system-ui, sans-serif;
      }

      .header {
        position: sticky;
        top: 0;
        z-index: 3;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 18px 22px;
        border-bottom: 1px solid #e2e8f0;
        background: #fff;
      }

      .header h2 {
        margin: 0;
        font-size: 21px;
      }

      .close {
        width: 36px;
        height: 36px;
        border: 0;
        border-radius: 50%;
        background: #f1f5f9;
        color: #334155;
        font-size: 22px;
        cursor: pointer;
      }

      .body { padding: 22px; }

      .toolbar {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 18px;
      }

      .toolbar-actions {
        display: flex;
        gap: 8px;
      }

      .button {
        min-height: 42px;
        padding: 0 18px;
        border: 1px solid #cbd5e1;
        border-radius: 10px;
        background: #fff;
        color: #0f172a;
        font-weight: 700;
        cursor: pointer;
      }

      .button.primary {
        border-color: #06c755;
        background: #06c755;
        color: #fff;
      }

      .button.danger {
        border-color: #fecaca;
        background: #fff;
        color: #b91c1c;
      }

      .button.danger:hover {
        border-color: #dc2626;
        background: #fef2f2;
      }

      .button:disabled {
        opacity: .6;
        cursor: wait;
      }

      .activity-list {
        display: grid;
        gap: 12px;
      }

      .activity-card {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 16px;
        padding: 16px;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        background: #fff;
      }

      .activity-card h3 {
        margin: 0 0 7px;
        font-size: 17px;
      }

      .activity-meta {
        color: #64748b;
        font-size: 13px;
        line-height: 1.7;
      }

      .empty {
        padding: 28px;
        border: 1px dashed #cbd5e1;
        border-radius: 14px;
        color: #64748b;
        text-align: center;
      }

      .view[hidden] { display: none; }

      .grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
      }

      .field { margin-bottom: 16px; }
      .field.full { grid-column: 1 / -1; }

      .field label {
        display: block;
        margin-bottom: 7px;
        color: #334155;
        font-weight: 800;
      }

      .field input,
      .field textarea {
        width: 100%;
        min-height: 44px;
        padding: 10px 12px;
        border: 1px solid #cbd5e1;
        border-radius: 10px;
        background: #fff;
        color: #0f172a;
        outline: none;
      }

      .field textarea {
        min-height: 110px;
        resize: vertical;
      }

      .field.invalid input,
      .field.invalid textarea {
        border-color: #dc2626;
        box-shadow: 0 0 0 3px rgba(220, 38, 38, .10);
      }

      .field-error {
        margin-top: 6px;
        color: #b91c1c;
        font-size: 13px;
        font-weight: 700;
        line-height: 1.5;
      }

      .field input:focus,
      .field textarea:focus {
        border-color: #06c755;
        box-shadow: 0 0 0 3px rgba(6, 199, 85, .12);
      }

      .date-time-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 120px;
        gap: 8px;
      }

      .date-time-row input {
        min-width: 0;
      }

      .hint {
        margin-top: 6px;
        color: #64748b;
        font-size: 12px;
        line-height: 1.5;
      }

      .preview {
        display: none;
        margin-top: 10px;
        overflow: hidden;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
      }

      .preview.show { display: block; }

      .preview img {
        display: block;
        width: 100%;
        max-height: 260px;
        object-fit: cover;
      }

      .error {
        display: none;
        margin-bottom: 16px;
        padding: 12px 14px;
        border: 1px solid #fecaca;
        border-radius: 10px;
        background: #fef2f2;
        color: #991b1b;
        line-height: 1.6;
      }

      .error.show { display: block; }

      .actions {
        position: sticky;
        bottom: 0;
        display: flex;
        justify-content: space-between;
        gap: 10px;
        padding: 18px 22px;
        border-top: 1px solid #e2e8f0;
        background: #fff;
      }

      .right-actions {
        display: flex;
        gap: 10px;
      }

      .toast {
        position: fixed;
        right: 24px;
        bottom: 84px;
        z-index: 2147483647;
        display: none;
        min-width: 240px;
        max-width: 380px;
        padding: 14px 16px;
        border-radius: 12px;
        background: #111827;
        color: #fff;
        font-family: system-ui, sans-serif;
        font-weight: 700;
        box-shadow: 0 14px 34px rgba(15, 23, 42, .3);
      }

      .toast.show { display: block; }

      .workspace-login-dialog {
        pointer-events: auto;
        width: min(380px, calc(100vw - 32px));
        padding: 0;
        border: 0;
        border-radius: 16px;
        background: #ffffff;
        color: #0f172a;
        font-family: system-ui, sans-serif;
        box-shadow:
          0 24px 70px rgba(15, 23, 42, .35);
      }

      .workspace-login-dialog::backdrop {
        pointer-events: auto;
        background: rgba(15, 23, 42, .52);
      }

      .workspace-login-form {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 24px;
      }

      .workspace-login-form h3 {
        margin: 0 0 10px;
        font-size: 21px;
      }

      .workspace-login-form label {
        font-weight: 800;
      }

      .workspace-login-form input {
        width: 100%;
        height: 44px;
        padding: 0 12px;
        border: 1px solid #cbd5e1;
        border-radius: 10px;
        background: #ffffff;
        color: #0f172a;
        outline: none;
      }

      .workspace-login-form input:focus {
        border-color: #06c755;
        box-shadow:
          0 0 0 3px rgba(6, 199, 85, .12);
      }

      .workspace-login-error {
        padding: 10px 12px;
        border: 1px solid #fecaca;
        border-radius: 9px;
        background: #fef2f2;
        color: #991b1b;
        line-height: 1.5;
      }

      .workspace-login-error[hidden] {
        display: none;
      }

      .workspace-login-form menu {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin: 12px 0 0;
        padding: 0;
      }

      .workspace-login-form button {
        min-height: 42px;
        padding: 0 18px;
        border: 1px solid #cbd5e1;
        border-radius: 10px;
        background: #ffffff;
        color: #0f172a;
        font-weight: 800;
        cursor: pointer;
        pointer-events: auto;
      }

      .workspace-login-form .login-submit {
        border-color: #06c755;
        background: #06c755;
        color: #ffffff;
      }

      @media (max-width: 720px) {
        .grid { grid-template-columns: 1fr; }
        .field.full { grid-column: auto; }
        .activity-card { grid-template-columns: 1fr; }
      }
    </style>

    <button class="launcher" type="button">${text.launcher}</button>

    <div class="backdrop" role="dialog" aria-modal="true">
      <section class="modal">
        <header class="header">
          <h2 class="modal-title">${text.managerTitle}</h2>
          <button class="close" type="button" aria-label="${text.close}">×</button>
        </header>

        <section class="view list-view">
          <main class="body">
            <div class="toolbar">
              <strong>${text.managerTitle}</strong>

              <div class="toolbar-actions">
                <button class="button refresh" type="button">
                  ${text.refresh}
                </button>

                <button class="button primary new-activity" type="button">
                  ${text.newActivity}
                </button>
              </div>
            </div>

            <div class="list-error error"></div>
            <div class="activity-list"></div>
          </main>
        </section>

        <section class="view form-view" hidden>
          <form class="activity-form" novalidate>
            <main class="body">
              <div class="form-error error"></div>

              <div class="grid">
                <div class="field full">
                  <label for="activity-title">${text.title} *</label>
                  <input
                    id="activity-title"
                    name="title"
                    type="text"
                    maxlength="120"
                    placeholder="${text.titlePlaceholder}"
                    required
                  >
                </div>

                <div class="field full">
                  <label for="activity-description">${text.description}</label>
                  <textarea
                    id="activity-description"
                    name="description"
                    maxlength="2000"
                    placeholder="${text.descriptionPlaceholder}"
                  ></textarea>
                </div>

                <div class="field">
                  <label for="activity-start-date">${text.start} *</label>

                  <div class="date-time-row">
                    <input
                      id="activity-start-date"
                      name="startDate"
                      type="text"
                      inputmode="numeric"
                      maxlength="5"
                      placeholder="09/20"
                      aria-label="開始月日"
                      required
                    >

                    <input
                      id="activity-start-time"
                      name="startTime"
                      type="time"
                      aria-label="開始時間"
                      required
                    >
                  </div>
                </div>

                <div class="field">
                  <label for="activity-end-date">${text.end} *</label>

                  <div class="date-time-row">
                    <input
                      id="activity-end-date"
                      name="endDate"
                      type="text"
                      inputmode="numeric"
                      maxlength="5"
                      placeholder="09/20"
                      aria-label="結束月日"
                      required
                    >

                    <input
                      id="activity-end-time"
                      name="endTime"
                      type="time"
                      aria-label="結束時間"
                      required
                    >
                  </div>
                </div>

                <div class="field full">
                  <label for="activity-location">${text.location} *</label>
                  <input
                    id="activity-location"
                    name="location"
                    type="text"
                    maxlength="200"
                    placeholder="${text.locationPlaceholder}"
                    required
                  >
                </div>

                <div class="field full">
                  <label for="activity-photo">${text.photo}</label>
                  <input
                    id="activity-photo"
                    name="photo"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                  >
                  <div class="hint">${text.photoHint}</div>
                  <div class="preview">
                    <img alt="">
                  </div>
                </div>
              </div>
            </main>

            <footer class="actions">
              <button class="button back-list" type="button">
                ${text.back}
              </button>

              <div class="right-actions">
                <button
                  class="button danger archive-activity"
                  type="button"
                  hidden
                >
                  \u5c01\u5b58\u6d3b\u52d5
                </button>

                <button class="button cancel" type="button">
                  ${text.cancel}
                </button>
                <button class="button primary submit" type="submit">
                  ${text.create}
                </button>
              </div>
            </footer>
          </form>
        </section>
      </section>
    </div>

    <div class="toast"></div>
  `;

  const launcher = shadow.querySelector(".launcher");
  const backdrop = shadow.querySelector(".backdrop");
  const closeButton = shadow.querySelector(".close");
  const modalTitle = shadow.querySelector(".modal-title");
  const listView = shadow.querySelector(".list-view");
  const formView = shadow.querySelector(".form-view");
  const activityList = shadow.querySelector(".activity-list");
  const listError = shadow.querySelector(".list-error");
  const formError = shadow.querySelector(".form-error");
  const newButton = shadow.querySelector(".new-activity");
  const refreshButton = shadow.querySelector(".refresh");
  const backButton = shadow.querySelector(".back-list");
  const cancelButton = shadow.querySelector(".cancel");
  const form = shadow.querySelector(".activity-form");
  const submitButton = shadow.querySelector(".submit");
  const archiveButton =
    shadow.querySelector(".archive-activity");
  const photoInput = shadow.querySelector("#activity-photo");
  const preview = shadow.querySelector(".preview");
  const previewImage = shadow.querySelector(".preview img");
  const toast = shadow.querySelector(".toast");

  const Workspace = {

    ui: {},

    activity: {},

    auth: {},

  };


  let currentActivityId = "";
  let previewUrl = "";

  Workspace.ui.showToast = function(message) {

    toast.textContent = message;

    toast.classList.add("show");

    window.setTimeout(() => {

      toast.classList.remove("show");

    }, 2600);

  };

  const showToast =
    Workspace.ui.showToast;

  function showError(box, message) {
    box.textContent = message;
    box.classList.add("show");
  }

  function clearError(box) {
    box.textContent = "";
    box.classList.remove("show");
  }

  function resetPreview() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = "";
    }

    previewImage.removeAttribute("src");
    preview.classList.remove("show");
  }

  function resetForm() {
    currentActivityId = "";
    form.reset();
    clearError(formError);
    resetPreview();
  }

  function splitActivityDateTime(value) {
    const source =
      String(value || "")
        .trim()
        .replace(" ", "T");

    const match = source.match(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/,
    );

    if (!match) {
      return {
        date: "",
        time: "",
      };
    }

    return {
      date: `${match[2]}/${match[3]}`,
      time: `${match[4]}:${match[5]}`,
    };
  }

  function parseMonthDay(value, year) {
    const source =
      String(value || "").trim();

    const match = source.match(
      /^(\d{1,2})[\/\-](\d{1,2})$/,
    );

    if (!match) {
      return null;
    }

    const month = Number(match[1]);
    const day = Number(match[2]);

    const date = new Date(
      year,
      month - 1,
      day,
      0,
      0,
      0,
      0,
    );

    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }

    return {
      year,
      month,
      day,
    };
  }

  function buildActivityDateTime(
    monthDay,
    time,
    year,
  ) {
    const parsed =
      parseMonthDay(monthDay, year);

    if (!parsed) {
      return "";
    }

    const normalizedTime =
      String(time || "").trim();

    if (!/^\d{2}:\d{2}$/.test(normalizedTime)) {
      return "";
    }

    const pad = (value) =>
      String(value).padStart(2, "0");

    return (
      `${parsed.year}-` +
      `${pad(parsed.month)}-` +
      `${pad(parsed.day)}T` +
      normalizedTime
    );
  }

  function formatDateTime(value) {
    const source = String(value || "").trim();

    if (!source) {
      return "-";
    }

    return source.replace("T", " ").slice(0, 16);
  }

  function showListView() {
    listView.hidden = false;
    formView.hidden = true;
    modalTitle.textContent = text.managerTitle;
  }

  function showFormView(mode) {
    listView.hidden = true;
    formView.hidden = false;

    const isEdit = mode === "edit";

    modalTitle.textContent =
      isEdit ? text.editTitle : text.createTitle;

    submitButton.textContent =
      isEdit ? text.save : text.create;

    archiveButton.hidden = !isEdit;
  }


  let loginDialog = null;
  let loginRequest = null;

  function finishLoginDialog(result) {
    if (!loginRequest) {
      return;
    }

    const request = loginRequest;
    loginRequest = null;

    if (loginDialog?.open) {
      loginDialog.close(
        result?.ok ? "login" : "cancel",
      );
    }

    if (result?.ok) {
      request.resolve(result.credentials);
    } else {
      request.reject(
        new Error(
          "\u5df2\u53d6\u6d88\u767b\u5165\u3002",
        ),
      );
    }
  }

  function ensureLoginDialog() {
    if (loginDialog) {
      return loginDialog;
    }

    loginDialog =
      document.createElement("dialog");

    loginDialog.className =
      "workspace-login-dialog";

    loginDialog.innerHTML = `
      <form class="workspace-login-form">
        <h3>
          Workspace \u767b\u5165
        </h3>

        <label for="workspace-login-user">
          \u5e33\u865f
        </label>

        <input
          id="workspace-login-user"
          autocomplete="username"
        >

        <label for="workspace-login-pass">
          \u5bc6\u78bc
        </label>

        <input
          id="workspace-login-pass"
          type="password"
          autocomplete="current-password"
        >

        <div
          class="workspace-login-error"
          hidden
        ></div>

        <menu>
          <button
            class="login-cancel"
            type="button"
          >
            \u53d6\u6d88
          </button>

          <button
            class="button primary login-submit"
            type="submit"
          >
            \u767b\u5165
          </button>
        </menu>
      </form>
    `;

    const form =
      loginDialog.querySelector(
        ".workspace-login-form",
      );

    const usernameInput =
      loginDialog.querySelector(
        "#workspace-login-user",
      );

    const passwordInput =
      loginDialog.querySelector(
        "#workspace-login-pass",
      );

    const errorElement =
      loginDialog.querySelector(
        ".workspace-login-error",
      );

    loginDialog
      .querySelector(".login-cancel")
      .addEventListener("click", () => {
        finishLoginDialog({
          ok: false,
        });
      });

    function submitLoginDialog() {
      const username =
        usernameInput.value.trim();

      const password =
        passwordInput.value;

      errorElement.hidden = true;
      errorElement.textContent = "";

      if (!username) {
        errorElement.textContent =
          "\u8acb\u8f38\u5165\u5e33\u865f\u3002";
        errorElement.hidden = false;
        usernameInput.focus();
        return;
      }

      if (!password) {
        errorElement.textContent =
          "\u8acb\u8f38\u5165\u5bc6\u78bc\u3002";
        errorElement.hidden = false;
        passwordInput.focus();
        return;
      }

      console.log(
        "[SAKURA Login] credentials submitted",
      );

      finishLoginDialog({
        ok: true,
        credentials: {
          username,
          password,
        },
      });
    }

    form.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        submitLoginDialog();
      },
    );

    loginDialog
      .querySelector(".login-submit")
      .addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          event.stopPropagation();
          submitLoginDialog();
        },
      );

    loginDialog.addEventListener(
      "cancel",
      (event) => {
        event.preventDefault();

        finishLoginDialog({
          ok: false,
        });
      },
    );

    shadow.appendChild(loginDialog);

    return loginDialog;
  }

  async function sendWorkspaceMessage(type, payload = {}) {
    const response = await chrome.runtime.sendMessage({
      type,
      payload,
    });

    if (!response?.ok) {
      const error = new Error(
        response?.error?.message ||
        "Workspace request failed.",
      );

      error.status = Number(
        response?.error?.status || 0,
      );

      throw error;
    }

    return response.result;
  }


async function openLoginPrompt() {
    const dialog =
      ensureLoginDialog();

    const usernameInput =
      dialog.querySelector(
        "#workspace-login-user",
      );

    const passwordInput =
      dialog.querySelector(
        "#workspace-login-pass",
      );

    const errorElement =
      dialog.querySelector(
        ".workspace-login-error",
      );

    passwordInput.value = "";
    errorElement.hidden = true;
    errorElement.textContent = "";

    if (!dialog.open) {
      dialog.showModal();
    }

    window.setTimeout(() => {
      (
        usernameInput.value
          ? passwordInput
          : usernameInput
      ).focus();
    }, 0);

    return await new Promise(
      (resolve, reject) => {
        loginRequest = {
          resolve,
          reject,
        };
      },
    );
  }

  async function ensureWorkspaceLogin() {
    const status = await sendWorkspaceMessage(
      "workspace.session.status",
    );

    if (status?.data?.authenticated) {
      return true;
    }

    const credentials =
      await openLoginPrompt();

    if (
      !credentials?.username ||
      !credentials?.password
    ) {
      throw new Error(
        "請輸入帳號與密碼。",
      );
    }

    await sendWorkspaceMessage(
      "workspace.login",
      credentials,
    );

    return true;
  }

  function renderActivities(activities) {
    if (!activities.length) {
      activityList.innerHTML =
        `<div class="empty">${text.empty}</div>`;
      return;
    }

    activityList.innerHTML = activities
      .map((activity) => `
        <article class="activity-card">
          <div>
            <h3>${escapeHtml(activity.title || "")}</h3>
            <div class="activity-meta">
              ${escapeHtml(formatDateTime(activity.start_at))}
              ～ ${escapeHtml(formatDateTime(activity.end_at))}
              <br>
              ${escapeHtml(activity.location || "-")}
            </div>
          </div>

          <button
            class="button edit-activity"
            type="button"
            data-activity-id="${escapeHtml(activity.id)}"
          >
            ${text.edit}
          </button>
        </article>
      `)
      .join("");

    shadow
      .querySelectorAll(".edit-activity")
      .forEach((button) => {
        button.addEventListener("click", () => {
          openEditActivity(button.dataset.activityId);
        });
      });
  }

  function escapeHtml(value) {
    return String(value || "").replace(
      /[&<>"']/g,
      (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
    );
  }

  async function loadActivities() {
    clearError(listError);
    activityList.innerHTML =
      `<div class="empty">${text.loading}</div>`;

    try {
      await ensureWorkspaceLogin();

      const result = await sendWorkspaceMessage(
        "workspace.activity.list",
      );

      renderActivities(
        result?.data?.activities || [],
      );
    } catch (error) {
      activityList.innerHTML = "";
      showError(
        listError,
        error?.message || text.loadFailed,
      );
    }
  }

  async function openEditActivity(id) {
    clearError(formError);

    try {
      await ensureWorkspaceLogin();

      const result = await sendWorkspaceMessage(
        "workspace.activity.get",
        { id },
      );

      const activity = result?.data?.event;

      if (!activity) {
        throw new Error(text.loadFailed);
      }

      resetForm();
      currentActivityId = String(activity.id || "");

      form.elements.title.value =
        activity.title || "";
      form.elements.description.value =
        activity.description || "";
      const startParts =
        splitActivityDateTime(
          activity.start_at,
        );

      const endParts =
        splitActivityDateTime(
          activity.end_at,
        );

      form.elements.startDate.value =
        startParts.date;

      form.elements.startTime.value =
        startParts.time;

      form.elements.endDate.value =
        endParts.date;

      form.elements.endTime.value =
        endParts.time;
      form.elements.location.value =
        activity.location || "";

      showFormView("edit");
    } catch (error) {
      showError(
        listError,
        error?.message || text.loadFailed,
      );
    }
  }

  function openCreateActivity() {
    resetForm();
    showFormView("create");

    window.setTimeout(() => {
      form.elements.title.focus();
    }, 0);
  }

  function openModal() {
    backdrop.classList.add("open");
    showListView();
    loadActivities();
  }

  function closeModal() {
    backdrop.classList.remove("open");
    resetForm();
    showListView();
  }

  function clearFieldErrors() {
    form
      .querySelectorAll(".field.invalid")
      .forEach((field) => {
        field.classList.remove("invalid");
      });

    form
      .querySelectorAll(".field-error")
      .forEach((error) => {
        error.remove();
      });
  }

  function showFieldError(
    fieldName,
    message,
  ) {
    const input =
      form.elements[fieldName];

    if (!input) {
      showError(
        formError,
        message,
      );
      return;
    }

    const field =
      input.closest(".field");

    if (!field) {
      showError(
        formError,
        message,
      );
      return;
    }

    field.classList.add("invalid");

    const error =
      document.createElement("div");

    error.className = "field-error";
    error.textContent = message;

    field.appendChild(error);

    input.focus({
      preventScroll: true,
    });

    field.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }

  Workspace.activity.validateForm = function() {
    clearFieldErrors();

    const formData =
      new FormData(form);

    const titleValue =
      String(
        formData.get("title") || "",
      ).trim();

    const description =
      String(
        formData.get("description") || "",
      ).trim();

    const startDate =
      String(
        formData.get("startDate") || "",
      ).trim();

    const startTime =
      String(
        formData.get("startTime") || "",
      ).trim();

    const endDate =
      String(
        formData.get("endDate") || "",
      ).trim();

    const endTime =
      String(
        formData.get("endTime") || "",
      ).trim();

    const locationValue =
      String(
        formData.get("location") || "",
      ).trim();

    const photo =
      formData.get("photo");

    const currentYear =
      new Date().getFullYear();

    if (!titleValue) {
      return {
        ok: false,
        field: "title",
        message:
          "\u8acb\u8f38\u5165\u6d3b\u52d5\u540d\u7a31\u3002",
      };
    }

    if (!startDate) {
      return {
        ok: false,
        field: "startDate",
        message:
          "\u8acb\u8f38\u5165\u958b\u59cb\u6708\u65e5\uff0c\u4f8b\u5982 09/20\u3002",
      };
    }

    const parsedStart =
      parseMonthDay(
        startDate,
        currentYear,
      );

    if (!parsedStart) {
      return {
        ok: false,
        field: "startDate",
        message:
          "\u8acb\u4f7f\u7528 MM/DD \u683c\u5f0f\uff0c\u4f8b\u5982 09/20\u3002",
      };
    }

    if (!startTime) {
      return {
        ok: false,
        field: "startTime",
        message:
          "\u8acb\u9078\u64c7\u958b\u59cb\u6642\u9593\u3002",
      };
    }

    if (!endDate) {
      return {
        ok: false,
        field: "endDate",
        message:
          "\u8acb\u8f38\u5165\u7d50\u675f\u6708\u65e5\uff0c\u4f8b\u5982 09/20\u3002",
      };
    }

    const parsedEndCurrentYear =
      parseMonthDay(
        endDate,
        currentYear,
      );

    if (!parsedEndCurrentYear) {
      return {
        ok: false,
        field: "endDate",
        message:
          "\u8acb\u4f7f\u7528 MM/DD \u683c\u5f0f\uff0c\u4f8b\u5982 09/20\u3002",
      };
    }

    if (!endTime) {
      return {
        ok: false,
        field: "endTime",
        message:
          "\u8acb\u9078\u64c7\u7d50\u675f\u6642\u9593\u3002",
      };
    }

    let endYear =
      currentYear;

    const startOrder =
      parsedStart.month * 100 +
      parsedStart.day;

    const endOrder =
      parsedEndCurrentYear.month * 100 +
      parsedEndCurrentYear.day;

    if (endOrder < startOrder) {
      endYear += 1;
    }

    const startAt =
      buildActivityDateTime(
        startDate,
        startTime,
        currentYear,
      );

    const endAt =
      buildActivityDateTime(
        endDate,
        endTime,
        endYear,
      );

    if (
      new Date(endAt).getTime() <=
      new Date(startAt).getTime()
    ) {
      return {
        ok: false,
        field: "endTime",
        message:
          "\u7d50\u675f\u6642\u9593\u5fc5\u9808\u665a\u65bc\u958b\u59cb\u6642\u9593\u3002",
      };
    }

    if (!locationValue) {
      return {
        ok: false,
        field: "location",
        message:
          "\u8acb\u8f38\u5165\u6d3b\u52d5\u5730\u9ede\u3002",
      };
    }

    if (
      photo &&
      typeof photo.arrayBuffer ===
        "function" &&
      photo.size >
        8 * 1024 * 1024
    ) {
      return {
        ok: false,
        field: "photo",
        message:
          "\u5716\u7247\u4e0d\u53ef\u8d85\u904e 8 MB\u3002",
      };
    }

    return {
      ok: true,
      data: {
        title: titleValue,
        description,
        startAt,
        endAt,
        location: locationValue,
        photo:
          photo &&
          typeof photo.arrayBuffer ===
            "function" &&
          photo.size > 0
            ? photo
            : null,
      },
    };
  };

  const validateForm =
    Workspace.activity.validateForm;

  launcher.addEventListener("click", openModal);
  closeButton.addEventListener("click", closeModal);
  newButton.addEventListener("click", openCreateActivity);
  refreshButton.addEventListener("click", loadActivities);
  backButton.addEventListener("click", () => {
    resetForm();
    showListView();
    loadActivities();
  });
  cancelButton.addEventListener("click", () => {
    resetForm();
    showListView();
  });

  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) {
      closeModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeModal();
    }
  });

  photoInput.addEventListener("change", () => {
    resetPreview();

    const file = photoInput.files?.[0];

    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      showError(formError, text.invalidPhoto);
      photoInput.value = "";
      return;
    }

    clearError(formError);
    previewUrl = URL.createObjectURL(file);
    previewImage.src = previewUrl;
    preview.classList.add("show");
  });

  archiveButton.addEventListener(
    "click",
    async () => {
      if (!currentActivityId) {
        return;
      }

      const confirmed = window.confirm(
        "\u78ba\u5b9a\u8981\u5c01\u5b58\u9019\u500b\u6d3b\u52d5\u55ce\uff1f\n\n\u5c01\u5b58\u5f8c\u5c07\u4e0d\u6703\u51fa\u73fe\u5728\u4e00\u822c\u6d3b\u52d5\u5217\u8868\u3002",
      );

      if (!confirmed) {
        return;
      }

      const originalText =
        archiveButton.textContent;

      archiveButton.disabled = true;
      archiveButton.textContent =
        "\u5c01\u5b58\u4e2d...";

      try {
        await ensureWorkspaceLogin();

        await sendWorkspaceMessage(
          "workspace.activity.archive",
          {
            id: currentActivityId,
          },
        );

        showToast(
          "\u6d3b\u52d5\u5df2\u5c01\u5b58\u3002",
        );

        resetForm();
        showListView();
        await loadActivities();
      } catch (error) {
        showError(
          formError,
          error?.message ||
            "\u6d3b\u52d5\u5c01\u5b58\u5931\u6557\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66\u3002",
        );
      } finally {
        archiveButton.disabled = false;
        archiveButton.textContent =
          originalText;
      }
    },
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearError(formError);

    const validation = validateForm();

    if (!validation.ok) {
      showFieldError(
        validation.field,
        validation.message,
      );
      return;
    }

    const originalText = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = text.saving;

    try {
      await ensureWorkspaceLogin();

      if (currentActivityId) {
        await sendWorkspaceMessage(
          "workspace.activity.update",
          {
            id: currentActivityId,
            data: validation.data,
          },
        );

        showToast(
          `${text.updateSuccess}\uff1a${validation.data.title}`,
        );
      } else {
        await sendWorkspaceMessage(
          "workspace.activity.create",
          validation.data,
        );

        showToast(
          `${text.createSuccess}\uff1a${validation.data.title}`,
        );
      }

      resetForm();
      showListView();
      await loadActivities();
    } catch (error) {
      showError(
        formError,
        error?.message || text.saveFailed,
      );
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = originalText;
    }
  });

  console.info(
    "[SAKURA AI Workspace] Activity manager loaded:",
    location.href,
  );
})();
