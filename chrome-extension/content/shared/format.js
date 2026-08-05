/**
 * SAKURA AI Workspace
 * Shared formatting utilities.
 */

(() => {
  const workspace =
    globalThis.__SAKURA_AI_WORKSPACE__;

  if (!workspace) {
    throw new Error(
      "Workspace core must load before shared/format.js.",
    );
  }

  workspace.shared =
    workspace.shared || {};

  function escapeHtml(value) {
    return String(value || "").replace(
      /[&<>"']/g,
      (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character],
    );
  }

  function normalizeDateTime(value) {
    return String(value || "")
      .trim()
      .replace(" ", "T");
  }

  function formatDateTime(value) {
    const source =
      normalizeDateTime(value);

    if (!source) {
      return "-";
    }

    const match = source.match(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/,
    );

    if (!match) {
      return source;
    }

    return (
      `${match[2]}/${match[3]} ` +
      `${match[4]}:${match[5]}`
    );
  }

  function splitDateTime(value) {
    const source =
      normalizeDateTime(value);

    const match = source.match(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/,
    );

    if (!match) {
      return {
        year: "",
        monthDay: "",
        time: "",
      };
    }

    return {
      year: match[1],
      monthDay:
        `${match[2]}/${match[3]}`,
      time:
        `${match[4]}:${match[5]}`,
    };
  }

  function parseMonthDay(
    value,
    year = new Date().getFullYear(),
  ) {
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

  function buildDateTime({
    monthDay,
    time,
    year = new Date().getFullYear(),
  } = {}) {
    const date =
      parseMonthDay(monthDay, year);

    const normalizedTime =
      String(time || "").trim();

    if (
      !date ||
      !/^\d{2}:\d{2}$/.test(
        normalizedTime,
      )
    ) {
      return "";
    }

    const pad = (value) =>
      String(value).padStart(2, "0");

    return (
      `${date.year}-` +
      `${pad(date.month)}-` +
      `${pad(date.day)}T` +
      normalizedTime
    );
  }

  workspace.shared.format = {
    escapeHtml,
    normalizeDateTime,
    formatDateTime,
    splitDateTime,
    parseMonthDay,
    buildDateTime,
  };
})();
