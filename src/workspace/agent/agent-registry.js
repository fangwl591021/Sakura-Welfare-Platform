function normalizeAgentName(value) {
  return String(value || "").trim().toLowerCase();
}

export function createAgentRegistry(
  initialAgents = [],
) {
  const agents = new Map();

  function register(agent) {
    const name = normalizeAgentName(agent?.name);

    if (!name) {
      throw new TypeError("Agent name is required.");
    }

    if (typeof agent.start !== "function") {
      throw new TypeError(
        `Agent ${name} must provide start().`,
      );
    }

    if (typeof agent.resume !== "function") {
      throw new TypeError(
        `Agent ${name} must provide resume().`,
      );
    }

    if (agents.has(name)) {
      throw new Error(
        `Agent ${name} is already registered.`,
      );
    }

    const normalizedAgent = Object.freeze({
      ...agent,
      name,
    });

    agents.set(name, normalizedAgent);

    return normalizedAgent;
  }

  function get(name) {
    return (
      agents.get(normalizeAgentName(name)) ||
      null
    );
  }

  function has(name) {
    return agents.has(normalizeAgentName(name));
  }

  function list() {
    return [...agents.values()];
  }

  for (const agent of initialAgents) {
    register(agent);
  }

  return Object.freeze({
    register,
    get,
    has,
    list,
  });
}
