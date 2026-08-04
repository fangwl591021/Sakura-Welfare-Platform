function buildVendorLoginFlex(loginUrl) {
  return {
    type: "flex",
    altText: "廠商專區登入",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: "廠商專區",
            weight: "bold",
            size: "xl",
          },
          {
            type: "text",
            text: "尚未辨識到已綁定的廠商身分，請使用廠商帳號密碼登入。",
            wrap: true,
            color: "#475569",
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            style: "primary",
            action: {
              type: "uri",
              label: "廠商登入",
              uri: loginUrl,
            },
          },
        ],
      },
    },
  };
}

export async function handleVendorPortalIntent({
  lineUserId,
  resolveIdentity,
  loadVendor,
  buildVendorFlex,
  loginUrl,
} = {}) {
  const identityResult =
    typeof resolveIdentity === "function"
      ? await resolveIdentity({ userId: lineUserId })
      : null;

  const identity = identityResult?.identity || identityResult || null;

  if (
    identity?.role === "vendor" &&
    identity?.authenticated === true &&
    identity?.vendorId
  ) {
    const vendor =
      typeof loadVendor === "function"
        ? await loadVendor(identity.vendorId)
        : null;

    if (vendor && typeof buildVendorFlex === "function") {
      return {
        handled: true,
        authorized: true,
        authenticated: true,
        vendorId: String(identity.vendorId),
        message: await buildVendorFlex(vendor),
      };
    }
  }

  const resolvedLoginUrl = String(loginUrl || "").trim();

  if (resolvedLoginUrl) {
    return {
      handled: true,
      authorized: false,
      authenticated: false,
      vendorId: null,
      message: buildVendorLoginFlex(resolvedLoginUrl),
    };
  }

  return {
    handled: true,
    authorized: false,
    authenticated: false,
    vendorId: null,
    text: "請先登入廠商專區。",
  };
}
