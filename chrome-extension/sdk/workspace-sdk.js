function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

async function readJsonResponse(response) {
  const text = await response.text();

  let body = {};

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = {
        success: false,
        message: text,
      };
    }
  }

  if (!response.ok || body.success === false) {
    const error = new Error(
      body.message ||
      `Workspace API request failed (${response.status}).`,
    );

    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
}

export class WorkspaceSdk {
  constructor({
    baseUrl,
    fetchImpl,
    token = "",
  } = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.fetchImpl =
      fetchImpl ||
      globalThis.fetch?.bind(globalThis);
    this.token = String(token || "").trim();

    if (!this.baseUrl) {
      throw new TypeError("Workspace SDK requires baseUrl.");
    }

    if (typeof this.fetchImpl !== "function") {
      throw new TypeError("Workspace SDK requires fetch().");
    }
  }

  setToken(token) {
    this.token = String(token || "").trim();
  }

  clearToken() {
    this.token = "";
  }

  async request(
    path,
    {
      method = "GET",
      json,
      body,
      headers = {},
    } = {},
  ) {
    const requestHeaders = new Headers(headers);

    if (this.token) {
      requestHeaders.set(
        "Authorization",
        `Bearer ${this.token}`,
      );
    }

    let requestBody = body;

    if (json !== undefined) {
      requestHeaders.set(
        "Content-Type",
        "application/json",
      );

      requestBody = JSON.stringify(json);
    }

    const response = await this.fetchImpl(
      `${this.baseUrl}${path}`,
      {
        method,
        headers: requestHeaders,
        body: requestBody,
      },
    );

    return readJsonResponse(response);
  }

  async login({ username, password } = {}) {
    const result = await this.request(
      "/workspace-api/login",
      {
        method: "POST",
        json: {
          username: String(username || "").trim(),
          password: String(password || ""),
        },
      },
    );

    const token = String(
      result.data?.token ||
      result.token ||
      "",
    ).trim();

    if (!token) {
      throw new Error(
        "Workspace login did not return a token.",
      );
    }

    this.setToken(token);

    return result;
  }

  async createActivity(data = {}) {
    return this.request(
      "/workspace-api/activity",
      {
        method: "POST",
        json: {
          title: String(data.title || "").trim(),
          description: String(
            data.description || "",
          ).trim(),
          startAt: String(
            data.startAt || "",
          ).trim(),
          endAt: String(data.endAt || "").trim(),
          location: String(
            data.location || "",
          ).trim(),
          coverImageUrl: String(
            data.coverImageUrl || "",
          ).trim(),
          coverImageKey: String(
            data.coverImageKey || "",
          ).trim(),
        },
      },
    );
  }

  async listActivities() {
    return this.request(
      "/workspace-api/activities",
    );
  }

  async getActivity(id) {
    const activityId =
      String(id || "").trim();

    if (!activityId) {
      throw new TypeError(
        "getActivity() requires an activity id.",
      );
    }

    return this.request(
      `/workspace-api/activity/${encodeURIComponent(activityId)}`,
    );
  }

  async updateActivity(id, data = {}) {
    const activityId =
      String(id || "").trim();

    if (!activityId) {
      throw new TypeError(
        "updateActivity() requires an activity id.",
      );
    }

    return this.request(
      `/workspace-api/activity/${encodeURIComponent(activityId)}`,
      {
        method: "PUT",
        json: {
          title: String(data.title || "").trim(),
          description: String(
            data.description || "",
          ).trim(),
          startAt: String(
            data.startAt || "",
          ).trim(),
          endAt: String(
            data.endAt || "",
          ).trim(),
          location: String(
            data.location || "",
          ).trim(),
          status: String(
            data.status || "active",
          ).trim(),
          coverImageUrl: String(
            data.coverImageUrl || "",
          ).trim(),
          coverImageKey: String(
            data.coverImageKey || "",
          ).trim(),
        },
      },
    );
  }

  async uploadPhoto(file) {
    if (!(file instanceof Blob)) {
      throw new TypeError(
        "uploadPhoto() requires an image Blob or File.",
      );
    }

    const formData = new FormData();
    formData.set("file", file);

    if (file.name) {
      formData.set("filename", file.name);
    }

    return this.request(
      "/workspace-api/upload",
      {
        method: "POST",
        body: formData,
      },
    );
  }

  async archiveActivity(id) {
    const activityId =
      String(id || "").trim();

    if (!activityId) {
      throw new TypeError(
        "archiveActivity() requires an activity id.",
      );
    }

    return this.request(
      `/workspace-api/activity/${encodeURIComponent(activityId)}/archive`,
      {
        method: "PUT",
      },
    );
  }

  async logout() {
    try {
      if (this.token) {
        await this.request(
          "/workspace-api/logout",
          {
            method: "POST",
          },
        );
      }
    } finally {
      this.clearToken();
    }

    return {
      success: true,
    };
  }
}

export function createWorkspaceSdk(options) {
  return new WorkspaceSdk(options);
}
