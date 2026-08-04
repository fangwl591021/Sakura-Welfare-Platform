(() => {
  const ROOT_ID = "sakura-ai-workspace-extension";

  if (document.getElementById(ROOT_ID)) {
    return;
  }

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
      * {
        box-sizing: border-box;
      }

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
        color: #ffffff;
        font: 700 15px/1 system-ui, sans-serif;
        box-shadow: 0 12px 30px rgba(15, 23, 42, 0.28);
        cursor: pointer;
      }

      .launcher:hover {
        transform: translateY(-1px);
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
        background: rgba(15, 23, 42, 0.52);
      }

      .backdrop.open {
        display: flex;
      }

      .modal {
        width: min(760px, 100%);
        max-height: calc(100vh - 48px);
        overflow: auto;
        border-radius: 18px;
        background: #ffffff;
        color: #0f172a;
        box-shadow: 0 26px 70px rgba(15, 23, 42, 0.35);
        font-family: system-ui, sans-serif;
      }

      .header {
        position: sticky;
        top: 0;
        z-index: 2;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        padding: 20px 22px;
        border-bottom: 1px solid #e2e8f0;
        background: #ffffff;
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

      .body {
        padding: 22px;
      }

      .grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
      }

      .field {
        margin-bottom: 16px;
      }

      .field.full {
        grid-column: 1 / -1;
      }

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
        background: #ffffff;
        color: #0f172a;
        outline: none;
      }

      .field textarea {
        min-height: 110px;
        resize: vertical;
      }

      .field input:focus,
      .field textarea:focus {
        border-color: #06c755;
        box-shadow: 0 0 0 3px rgba(6, 199, 85, 0.12);
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
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        overflow: hidden;
        background: #f8fafc;
      }

      .preview.show {
        display: block;
      }

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

      .error.show {
        display: block;
      }

      .actions {
        position: sticky;
        bottom: 0;
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        padding: 18px 22px;
        border-top: 1px solid #e2e8f0;
        background: #ffffff;
      }

      .button {
        min-height: 42px;
        padding: 0 18px;
        border: 1px solid #cbd5e1;
        border-radius: 10px;
        background: #ffffff;
        color: #0f172a;
        font-weight: 700;
        cursor: pointer;
      }

      .button.primary {
        border-color: #06c755;
        background: #06c755;
        color: #ffffff;
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
        color: #ffffff;
        font-family: system-ui, sans-serif;
        font-weight: 700;
        line-height: 1.5;
        box-shadow: 0 14px 34px rgba(15, 23, 42, 0.3);
      }

      .toast.show {
        display: block;
      }

      @media (max-width: 720px) {
        .grid {
          grid-template-columns: 1fr;
        }

        .field.full {
          grid-column: auto;
        }
      }
    </style>

    <button class="launcher" type="button">
      新增活動
    </button>

    <div class="backdrop" role="dialog" aria-modal="true">
      <section class="modal">
        <header class="header">
          <h2>建立員工活動</h2>
          <button class="close" type="button" aria-label="關閉">×</button>
        </header>

        <form class="activity-form" novalidate>
          <main class="body">
            <div class="error"></div>

            <div class="grid">
              <div class="field full">
                <label for="activity-title">活動名稱 *</label>
                <input
                  id="activity-title"
                  name="title"
                  type="text"
                  maxlength="120"
                  placeholder="例：健行社中秋烤肉"
                  required
                >
              </div>

              <div class="field full">
                <label for="activity-description">活動說明</label>
                <textarea
                  id="activity-description"
                  name="description"
                  maxlength="2000"
                  placeholder="請輸入活動內容、注意事項與集合方式"
                ></textarea>
              </div>

              <div class="field">
                <label for="activity-start">開始時間 *</label>
                <input
                  id="activity-start"
                  name="startAt"
                  type="datetime-local"
                  required
                >
              </div>

              <div class="field">
                <label for="activity-end">結束時間 *</label>
                <input
                  id="activity-end"
                  name="endAt"
                  type="datetime-local"
                  required
                >
              </div>

              <div class="field full">
                <label for="activity-location">活動地點 *</label>
                <input
                  id="activity-location"
                  name="location"
                  type="text"
                  maxlength="200"
                  placeholder="例：本廠活動中心"
                  required
                >
              </div>

              <div class="field full">
                <label for="activity-photo">活動照片</label>
                <input
                  id="activity-photo"
                  name="photo"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                >
                <div class="hint">
                  支援 JPG、PNG、WebP；目前只做本機預覽，下一階段才會上傳 R2。
                </div>
                <div class="preview">
                  <img alt="活動照片預覽">
                </div>
              </div>
            </div>
          </main>

          <footer class="actions">
            <button class="button cancel" type="button">取消</button>
            <button class="button primary submit" type="submit">建立活動</button>
          </footer>
        </form>
      </section>
    </div>

    <div class="toast"></div>
  `;

  const launcher = shadow.querySelector(".launcher");
  const backdrop = shadow.querySelector(".backdrop");
  const closeButton = shadow.querySelector(".close");
  const cancelButton = shadow.querySelector(".cancel");
  const form = shadow.querySelector(".activity-form");
  const errorBox = shadow.querySelector(".error");
  const photoInput = shadow.querySelector("#activity-photo");
  const preview = shadow.querySelector(".preview");
  const previewImage = shadow.querySelector(".preview img");
  const toast = shadow.querySelector(".toast");

  let previewUrl = "";

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");

    window.setTimeout(() => {
      toast.classList.remove("show");
    }, 2600);
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.add("show");
  }

  function clearError() {
    errorBox.textContent = "";
    errorBox.classList.remove("show");
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
    form.reset();
    clearError();
    resetPreview();
  }

  function openModal() {
    resetForm();
    backdrop.classList.add("open");

    window.setTimeout(() => {
      shadow.querySelector("#activity-title")?.focus();
    }, 0);
  }

  function closeModal() {
    backdrop.classList.remove("open");
    resetForm();
  }

  function validateForm() {
    const formData = new FormData(form);
    const title = String(formData.get("title") || "").trim();
    const description = String(
      formData.get("description") || "",
    ).trim();
    const startAt = String(formData.get("startAt") || "").trim();
    const endAt = String(formData.get("endAt") || "").trim();
    const location = String(formData.get("location") || "").trim();
    const photo = formData.get("photo");

    if (!title) {
      return { ok: false, message: "請輸入活動名稱。" };
    }

    if (!startAt) {
      return { ok: false, message: "請選擇開始時間。" };
    }

    if (!endAt) {
      return { ok: false, message: "請選擇結束時間。" };
    }

    if (new Date(endAt).getTime() <= new Date(startAt).getTime()) {
      return {
        ok: false,
        message: "結束時間必須晚於開始時間。",
      };
    }

    if (!location) {
      return { ok: false, message: "請輸入活動地點。" };
    }

    if (
      photo instanceof File &&
      photo.size > 0 &&
      photo.size > 8 * 1024 * 1024
    ) {
      return {
        ok: false,
        message: "活動照片不可超過 8 MB。",
      };
    }

    return {
      ok: true,
      data: {
        title,
        description,
        startAt,
        endAt,
        location,
        photo:
          photo instanceof File && photo.size > 0
            ? photo
            : null,
      },
    };
  }

  launcher.addEventListener("click", openModal);
  closeButton.addEventListener("click", closeModal);
  cancelButton.addEventListener("click", closeModal);

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
      showError("請選擇圖片檔案。");
      photoInput.value = "";
      return;
    }

    clearError();
    previewUrl = URL.createObjectURL(file);
    previewImage.src = previewUrl;
    preview.classList.add("show");
  });

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

  function openLoginPrompt() {
    const username = window.prompt(
      "\u8acb\u8f38\u5165\u5f8c\u53f0\u5e33\u865f\uff1a",
    );

    if (!username) {
      throw new Error(
        "\u5df2\u53d6\u6d88\u767b\u5165\u3002",
      );
    }

    const password = window.prompt(
      "\u8acb\u8f38\u5165\u5f8c\u53f0\u5bc6\u78bc\uff1a",
    );

    if (!password) {
      throw new Error(
        "\u5df2\u53d6\u6d88\u767b\u5165\u3002",
      );
    }

    return {
      username: String(username).trim(),
      password: String(password),
    };
  }

  async function ensureWorkspaceLogin() {
    const status = await sendWorkspaceMessage(
      "workspace.session.status",
    );

    if (status?.data?.authenticated) {
      return true;
    }

    const credentials = openLoginPrompt();

    await sendWorkspaceMessage(
      "workspace.login",
      credentials,
    );

    return true;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    console.log("[SAKURA Activity] submit fired");
    clearError();

    const result = validateForm();

    if (!result.ok) {
      showError(result.message);
      return;
    }

    const submitButton =
      shadow.querySelector(".submit");

    const originalText =
      submitButton.textContent;

    submitButton.disabled = true;
    submitButton.textContent = "\u5efa\u7acb\u4e2d...";

    try {
      await ensureWorkspaceLogin();

      const response = await sendWorkspaceMessage(
        "workspace.activity.create",
        {
          title: result.data.title,
          description: result.data.description,
          startAt: result.data.startAt,
          endAt: result.data.endAt,
          location: result.data.location,
          coverImageUrl: "",
        },
      );

      const eventData =
        response?.data?.event || {};

      closeModal();

      showToast(
        eventData.title
          ? `\u6d3b\u52d5\u5efa\u7acb\u6210\u529f\uff1a${eventData.title}`
          : "\u6d3b\u52d5\u5efa\u7acb\u6210\u529f\u3002",
      );
    } catch (error) {
      if (
        Number(error?.status || 0) === 401 ||
        /login|expired|session|unauthorized/i.test(
          String(error?.message || ""),
        )
      ) {
        await chrome.runtime.sendMessage({
          type: "workspace.logout",
        }).catch(() => {});
      }

      showError(
        error?.message ||
        "\u6d3b\u52d5\u5efa\u7acb\u5931\u6557\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66\u3002",
      );
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = originalText;
    }
  });

  console.info(
    "[SAKURA AI Workspace] Activity form loaded:",
    location.href,
  );
})();
