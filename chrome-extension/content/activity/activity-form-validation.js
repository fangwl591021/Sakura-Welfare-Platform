/**
 * SAKURA AI Workspace
 * Activity form validation.
 */

(() => {
  const workspace =
    globalThis.__SAKURA_AI_WORKSPACE__;

  if (!workspace) {
    throw new Error(
      "Workspace core must load before activity-form-validation.js.",
    );
  }

  workspace.activity =
    workspace.activity || {};

  function parseMonthDay(value, year) {
    const source =
      String(value || "").trim();

    const match = source.match(
      /^(\d{1,2})[\/-](\d{1,2})$/,
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

  function buildDateTime(
    monthDay,
    time,
    year,
  ) {
    const parsed =
      parseMonthDay(monthDay, year);

    const normalizedTime =
      String(time || "").trim();

    if (
      !parsed ||
      !/^\d{2}:\d{2}$/.test(
        normalizedTime,
      )
    ) {
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

  function create({
    form,
    clearErrors,
    now = () => new Date(),
    maxPhotoBytes = 8 * 1024 * 1024,
  } = {}) {
    if (!form) {
      throw new TypeError(
        "Activity validation requires a form.",
      );
    }

    if (typeof clearErrors !== "function") {
      throw new TypeError(
        "Activity validation requires clearErrors().",
      );
    }

    return function validate() {
      clearErrors();

      const formData =
        new FormData(form);

      const title =
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

      const checkinStartAt =
        String(
          formData.get("checkinStartAt") || "",
        ).trim();

      const checkinEndAt =
        String(
          formData.get("checkinEndAt") || "",
        ).trim();

      const location =
        String(
          formData.get("location") || "",
        ).trim();

      const photo =
        formData.get("photo");

      const audienceScope = formData
        .getAll("audienceScope")
        .map((value) => String(value).trim())
        .filter(Boolean);

      const status =
        String(
          formData.get("status") || "active",
        ).trim();

      const currentDate =
        now();

      const currentYear =
        currentDate.getFullYear();

      if (!title) {
        return {
          ok: false,
          field: "title",
          message:
            "請輸入活動名稱。",
        };
      }

      if (!startDate) {
        return {
          ok: false,
          field: "startDate",
          message:
            "請輸入開始月日，例如 09/20。",
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
            "請使用 MM/DD 格式，例如 09/20。",
        };
      }

      if (!startTime) {
        return {
          ok: false,
          field: "startTime",
          message:
            "請選擇開始時間。",
        };
      }

      if (!endDate) {
        return {
          ok: false,
          field: "endDate",
          message:
            "請輸入結束月日，例如 09/20。",
        };
      }

      const parsedEnd =
        parseMonthDay(
          endDate,
          currentYear,
        );

      if (!parsedEnd) {
        return {
          ok: false,
          field: "endDate",
          message:
            "請使用 MM/DD 格式，例如 09/20。",
        };
      }

      if (!endTime) {
        return {
          ok: false,
          field: "endTime",
          message:
            "請選擇結束時間。",
        };
      }

      let endYear =
        currentYear;

      const startOrder =
        parsedStart.month * 100 +
        parsedStart.day;

      const endOrder =
        parsedEnd.month * 100 +
        parsedEnd.day;

      if (endOrder < startOrder) {
        endYear += 1;
      }

      const startAt =
        buildDateTime(
          startDate,
          startTime,
          currentYear,
        );

      const endAt =
        buildDateTime(
          endDate,
          endTime,
          endYear,
        );

      if (
        !startAt ||
        !endAt ||
        new Date(endAt).getTime() <=
          new Date(startAt).getTime()
      ) {
        return {
          ok: false,
          field: "endTime",
          message:
            "結束時間必須晚於開始時間。",
        };
      }

      if (!location) {
        return {
          ok: false,
          field: "location",
          message:
            "請輸入活動地點。",
        };
      }

      if (!checkinStartAt) {
        return {
          ok: false,
          field: "checkinStartAt",
          message: "請選擇報到開始時間。",
        };
      }

      const checkinStartTime = new Date(checkinStartAt).getTime();

      if (!Number.isFinite(checkinStartTime)) {
        return {
          ok: false,
          field: "checkinStartAt",
          message: "報到開始時間格式不正確。",
        };
      }

      if (checkinEndAt) {
        const checkinEndTime = new Date(checkinEndAt).getTime();

        if (
          !Number.isFinite(checkinEndTime) ||
          checkinEndTime <= checkinStartTime
        ) {
          return {
            ok: false,
            field: "checkinEndAt",
            message: "報到截止時間必須晚於報到開始時間。",
          };
        }
      }

      if (
        photo &&
        typeof photo.arrayBuffer ===
          "function" &&
        photo.size > maxPhotoBytes
      ) {
        return {
          ok: false,
          field: "photo",
          message:
            "活動照片不可超過 8 MB。",
        };
      }

      return {
        ok: true,
        data: {
          title,
          description,
          startAt,
          endAt,
          checkinStartAt,
          checkinEndAt,
          location,
          audienceScope:
            audienceScope.length
              ? audienceScope
              : ["all"],
          status,
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
  }

  workspace.activity.formValidation = {
    create,
    parseMonthDay,
    buildDateTime,
  };
})();
